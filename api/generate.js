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

        // Pollinations payload - απλοποιημένο
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

        console.log('[EDGE] Calling Pollinations API...');
        console.log('[EDGE] Payload size:', JSON.stringify(payload).length);

        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGenerator/1.0',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        });

        console.log('[EDGE] Pollinations response status:', pollResponse.status);

        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            console.error('[EDGE] Pollinations error:', errorText);
            return new Response(
                `data: ${JSON.stringify({ error: `Pollinations error ${pollResponse.status}: ${errorText}` })}\n\n`,
                { 
                    status: 502,
                    headers: { 'Content-Type': 'text/event-stream' }
                }
            );
        }

        if (!pollResponse.body) {
            console.error('[EDGE] Empty response body');
            return new Response(
                `data: ${JSON.stringify({ error: 'Empty response from Pollinations' })}\n\n`,
                { 
                    status: 502,
                    headers: { 'Content-Type': 'text/event-stream' }
                }
            );
        }

        // ✅ Διαβάζουμε ΟΛΟΚΛΗΡΟ το response πρώτα για να δούμε τι στέλνει το Pollinations
        const reader = pollResponse.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let chunkCount = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            chunkCount++;
            const chunk = decoder.decode(value, { stream: true });
            fullResponse += chunk;
            console.log(`[EDGE] Chunk ${chunkCount}: ${chunk.length} bytes`);
        }

        // Final flush
        fullResponse += decoder.decode();
        
        console.log('[EDGE] Total chunks received:', chunkCount);
        console.log('[EDGE] Total response length:', fullResponse.length);
        console.log('[EDGE] Raw response (first 500 chars):', fullResponse.substring(0, 500));

        // ✅ Τώρα στέλνουμε το full response ως SSE stream προς τον client
        // Χωρίζουμε τα SSE events που ήδη υπάρχουν, ή δημιουργούμε ένα αν χρειάζεται
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();

        (async () => {
            try {
                // Αν το Pollinations έστειλε ήδη SSE format, προωθούμε όπως είναι
                if (fullResponse.includes('data:')) {
                    console.log('[EDGE] Response is SSE format, forwarding as-is');
                    await writer.write(new TextEncoder().encode(fullResponse));
                } else if (fullResponse.trim().startsWith('{')) {
                    // Αν είναι raw JSON, τυλίγουμε σε SSE format
                    console.log('[EDGE] Response is raw JSON, wrapping in SSE');
                    const lines = fullResponse.split('\n');
                    for (const line of lines) {
                        if (line.trim()) {
                            await writer.write(
                                new TextEncoder().encode(`data: ${line}\n\n`)
                            );
                        }
                    }
                } else {
                    console.log('[EDGE] Unknown response format');
                    // Στέλνουμε όλο το response ως ένα SSE event
                    await writer.write(
                        new TextEncoder().encode(`data: ${JSON.stringify({ content: fullResponse })}\n\n`)
                    );
                }
                
                await writer.write(new TextEncoder().encode('data: [DONE]\n\n'));
                await writer.close();
            } catch (err) {
                console.error('[EDGE] Stream write error:', err);
                try {
                    await writer.write(
                        new TextEncoder().encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
                    );
                } catch (e) {}
                await writer.close();
            }
        })();

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
        console.error('[EDGE] Fatal error:', err);
        return new Response(
            `data: ${JSON.stringify({ error: err.message })}\n\n`,
            { 
                status: 500,
                headers: { 'Content-Type': 'text/event-stream' }
            }
        );
    }
}
