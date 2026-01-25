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

        const payload = {
            messages: [
                {
                    role: 'system',
                    content: 'You are a creative musical AI. You must output ONLY valid JSON containing musical track data.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            model: model || 'openai',
            temperature: 0.8,
            max_tokens: 4096,
            stream: true
        };

        console.log('[EDGE] Fetching from Pollinations...');

        // ✅ Key: Απλά προωθούμε το response stream απευθείας, χωρίς να περιμένουμε
        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGenerator/1.0',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        });

        console.log('[EDGE] Status:', pollResponse.status);

        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            console.error('[EDGE] Error:', pollResponse.status, errorText);
            return new Response(
                `data: ${JSON.stringify({ error: `${pollResponse.status}: ${errorText}` })}\n\ndata: [DONE]\n\n`,
                { 
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                }
            );
        }

        if (!pollResponse.body) {
            return new Response(
                `data: ${JSON.stringify({ error: 'Empty body' })}\n\ndata: [DONE]\n\n`,
                { 
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                }
            );
        }

        // ✅ ΚΛΕΙΔΙ: Δημιουργούμε ένα new TransformStream που θα βγάζει τα δεδομένα αμέσως
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();

        // ✅ Ξεκινάμε το stream πολύ ΓΡΗΓΟΡΑ (μη-blocking)
        (async () => {
            try {
                const reader = pollResponse.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    
                    if (value) {
                        const chunk = decoder.decode(value, { stream: true });
                        buffer += chunk;

                        // Χωρίζουμε τα lines και τα στέλνουμε αμέσως
                        const lines = buffer.split('\n');
                        
                        // Κρατάμε την τελευταία ημιτελή γραμμή στο buffer
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.trim()) {
                                // Αν δεν έχει "data: ", προσθέτουμε
                                const formatted = line.includes('data:') 
                                    ? line 
                                    : `data: ${line}`;
                                
                                await writer.write(
                                    new TextEncoder().encode(formatted + '\n')
                                );
                            }
                        }
                    }

                    if (done) {
                        // Στέλνουμε το υπόλοιπο buffer
                        if (buffer.trim()) {
                            const formatted = buffer.includes('data:')
                                ? buffer
                                : `data: ${buffer}`;
                            await writer.write(
                                new TextEncoder().encode(formatted + '\n')
                            );
                        }
                        break;
                    }
                }

                // Τέλος του stream
                await writer.write(
                    new TextEncoder().encode('data: [DONE]\n\n')
                );
                await writer.close();
            } catch (err) {
                console.error('[EDGE] Stream error:', err);
                try {
                    await writer.write(
                        new TextEncoder().encode(
                            `data: ${JSON.stringify({ error: err.message })}\n\n`
                        )
                    );
                } catch (e) {}
                try {
                    await writer.close();
                } catch (e) {}
            }
        })(); // ← ΑΜΕΣΑ ξεκινάμε την async function

        // ✅ Επιστρέφουμε ΑΜΕΣΑ το readable stream, χωρίς περιμένουμε
        return new Response(readable, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
                'Transfer-Encoding': 'chunked'
            }
        });

    } catch (err) {
        console.error('[EDGE] Fatal:', err);
        return new Response(
            `data: ${JSON.stringify({ error: err.message })}\n\ndata: [DONE]\n\n`,
            { 
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            }
        );
    }
}
