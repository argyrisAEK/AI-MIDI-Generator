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
            model: model || 'claude',
            temperature: 0.8,
            max_tokens: 3048,
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

                    // ✅ ΚΡΊΣΙΜΟ: Διάβασε ΟΛΟΚΛΗΡΟ το response πριν το κλείσεις
                    let content = '';
                    try {
                        // Χρόνος περιμονής για το Pollinations να απαντήσει
                        console.log('[EDGE] Waiting for full response from Pollinations...');
                        
                        const jsonData = await pollResponse.json();
                        console.log('[EDGE] Got JSON response, parsing...');

                        // Εξάγουμε το content
                        if (jsonData.choices?.[0]?.message?.content) {
                            content = jsonData.choices[0].message.content;
                        } else if (jsonData.choices?.[0]?.text) {
                            content = jsonData.choices[0].text;
                        } else {
                            content = JSON.stringify(jsonData);
                        }

                        console.log('[EDGE] Content extracted, length:', content.length);
                        
                        // Βεβαιώσου ότι είναι valid JSON πριν το στείλεις
                        if (content.length === 0) {
                            throw new Error('Empty content from API');
                        }

                        // Δοκίμασε να parse για να βεβαιωθείς ότι είναι valid
                        try {
                            JSON.parse(content);
                            console.log('[EDGE] Content is valid JSON');
                        } catch (parseErr) {
                            console.warn('[EDGE] Content is not valid JSON, but sending anyway:', parseErr);
                        }

                    } catch (parseErr) {
                        console.error('[EDGE] Failed to get full response:', parseErr);
                        controller.enqueue(
                            new TextEncoder().encode(
                                `data: ${JSON.stringify({ error: `Failed to get full response: ${parseErr.message}` })}\n\n`
                            )
                        );
                        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                        controller.close();
                        return;
                    }

                    // ✅ Escape special characters σωστά
                    const escapedContent = content
                        .replace(/\\/g, '\\\\')  // Backslashes πρώτα!
                        .replace(/"/g, '\\"')    // Quotes
                        .replace(/\n/g, '\\n')   // Newlines
                        .replace(/\r/g, '\\r')   // Carriage returns
                        .replace(/\t/g, '\\t');  // Tabs
                    
                    console.log('[EDGE] Escaped content length:', escapedContent.length);
                    
                    const sseEvent = `data: ${JSON.stringify({ content: escapedContent })}\n\ndata: [DONE]\n\n`;
                    
                    console.log('[EDGE] Sending SSE event...');
                    controller.enqueue(new TextEncoder().encode(sseEvent));
                    controller.close();
                    console.log('[EDGE] Stream closed successfully');

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
