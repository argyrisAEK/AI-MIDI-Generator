export const config = { runtime: 'edge', timeout: 60 };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, model } = await req.json();

        if (!prompt || typeof prompt !== 'string') {
            return new Response('Invalid prompt', { status: 400 });
        }

        const apiKey = process.env.POLLINATIONS_GEN_KEY || '';

        // Pollinations payload - ακριβώς όπως το endpoint τους
        const payload = {
            messages: [
                {
                    role: 'system',
                    content: 'You are a creative musical AI. You must output ONLY valid JSON containing musical track data.',
                    cache_control: {
                        type: 'ephemeral'
                    }
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            model: model || 'openai',
            modalities: ['text'],
            frequency_penalty: 0,
            presence_penalty: 0,
            temperature: 0.8,
            top_p: 1,
            response_format: {
                type: 'text'
            },
            stream: true, // ΕΝΕΡΓΟΠΟΙΗΣΗ STREAMING
            stream_options: {
                include_usage: true
            },
            max_tokens: 4096,
            seed: Math.floor(Math.random() * 10000)
        };

        // Φτιάχνουμε ένα ReadableStream που θα bufferizει τα chunks
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();

        // Κάνουμε το fetch ΚΑΙ streaming ταυτόχρονα - δεν περιμένουμε το ολόκληρο response
        (async () => {
            try {
                const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
                    },
                    body: JSON.stringify(payload)
                });

                if (!pollResponse.ok) {
                    const errorText = await pollResponse.text();
                    await writer.write(
                        new TextEncoder().encode(`data: ${JSON.stringify({ error: `API Error ${pollResponse.status}: ${errorText}` })}\n\n`)
                    );
                    await writer.close();
                    return;
                }

                if (!pollResponse.body) {
                    await writer.write(
                        new TextEncoder().encode(`data: ${JSON.stringify({ error: 'Empty response from Pollinations' })}\n\n`)
                    );
                    await writer.close();
                    return;
                }

                // Streaming: διαβάζουμε chunks και τα προωθούμε αμέσως
                const reader = pollResponse.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    // Αποκωδικοποιούμε το chunk
                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;

                    // Διαχωρίζουμε τα SSE events (που χωρίζονται με \n\n)
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Κρατάμε την ημιτελή γραμμή

                    for (const line of lines) {
                        if (line.trim()) {
                            // Προωθούμε το line ως SSE event στον client
                            await writer.write(
                                new TextEncoder().encode(line + '\n')
                            );
                        }
                    }
                }

                // Στέλνουμε το υπόλοιπο buffer
                if (buffer.trim()) {
                    await writer.write(
                        new TextEncoder().encode(buffer + '\n')
                    );
                }

                // Τέλος stream
                await writer.write(
                    new TextEncoder().encode('data: [DONE]\n\n')
                );
                await writer.close();

            } catch (streamError) {
                console.error('Streaming error:', streamError);
                try {
                    await writer.write(
                        new TextEncoder().encode(
                            `data: ${JSON.stringify({ error: `Streaming failed: ${streamError.message}` })}\n\n`
                        )
                    );
                } catch (e) {
                    console.error('Failed to write error to stream:', e);
                }
                await writer.close();
            }
        })();

        // Επιστρέφουμε αμέσως το stream χωρίς να περιμένουμε το fetch να ολοκληρωθεί
        return new Response(readable, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            }
        });

    } catch (err) {
        console.error('Generate error:', err);
        return new Response(`data: ${JSON.stringify({ error: err.message })}\n\n`, { 
            status: 500,
            headers: { 'Content-Type': 'text/event-stream' }
        });
    }
}
