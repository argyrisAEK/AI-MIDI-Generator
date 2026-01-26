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
            max_tokens: 2048,
            stream: false  // Non-streaming γιατί είναι πιο γρήγορο
        };

        // ✅ Φτιάχνουμε ένα ReadableStream που ξεκινάει ΑΜΕΣΑ
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    console.log('[EDGE] Calling Pollinations...');
                    
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
                        console.error('[EDGE] Error:', errorText);
                        controller.enqueue(
                            new TextEncoder().encode(
                                `data: ${JSON.stringify({ error: `${pollResponse.status}: ${errorText}` })}\n\ndata: [DONE]\n\n`
                            )
                        );
                        controller.close();
                        return;
                    }

                    const jsonData = await pollResponse.json();
                    console.log('[EDGE] Got JSON response');

                    // Εξάγουμε το content
                    let content = '';
                    if (jsonData.choices?.[0]?.message?.content) {
                        content = jsonData.choices[0].message.content;
                    } else if (jsonData.choices?.[0]?.text) {
                        content = jsonData.choices[0].text;
                    } else {
                        content = JSON.stringify(jsonData);
                    }

                    // ✅ Στέλνουμε το ΟΛΟΚΛΗΡΟ JSON ως ένα μόνο SSE event
                    // (όχι χωρισμένο σε γραμμές που μπορεί να κοπούν)
                    const sseEvent = `data: ${JSON.stringify({ content: content })}\n\ndata: [DONE]\n\n`;
                    controller.enqueue(new TextEncoder().encode(sseEvent));
                    controller.close();

                } catch (err) {
                    console.error('[EDGE] Error:', err);
                    controller.enqueue(
                        new TextEncoder().encode(
                            `data: ${JSON.stringify({ error: err.message })}\n\ndata: [DONE]\n\n`
                        )
                    );
                    controller.close();
                }
            }
        });

        // ✅ Επιστρέφουμε ΑΜΕΣΑ - η συνάρτηση δεν περιμένει το fetch να τελειώσει
        return new Response(stream, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            }
        });

    } catch (err) {
        console.error('[EDGE] Fatal error:', err);
        return new Response(
            `data: ${JSON.stringify({ error: err.message })}\n\ndata: [DONE]\n\n`,
            { 
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            }
        );
    }
}
