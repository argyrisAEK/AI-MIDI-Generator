// generate.js — Vercel Edge Function, manual streaming proxy
// No extra npm packages needed beyond what you already have.
//
// HOW IT WORKS:
//   1. Client POSTs prompt → this edge function
//   2. Edge function calls Pollinations with stream:true
//   3. Each SSE chunk from Pollinations is immediately forwarded to the client
//   4. Edge function is "alive" only while tokens flow → no 50s wall-clock timeout
//   5. Client reassembles chunks → existing parseApiResponse() runs unchanged

export const config = { runtime: 'edge' }; // no static timeout — streaming keeps it alive

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let prompt, model, enhancedPrompt;

    try {
        ({ prompt, model, enhancedPrompt } = await req.json());
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (!prompt || typeof prompt !== 'string') {
        return new Response(JSON.stringify({ error: 'Invalid prompt' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const apiKey = process.env.POLLINATIONS_GEN_KEY || '';

    const payload = {
        messages: [
            {
                role: 'system',
                content: 'You are a creative musical AI. You must output ONLY valid JSON containing musical track data, no markdown, no preamble.'
            },
            {
                role: 'user',
                content: prompt
            }
        ],
        model: model || 'openai-large',
        temperature: 0.7,
        max_tokens: 4096,
        seed: -1,
        stream: true  // ← key change: ask Pollinations for SSE stream
    };

    try {
        console.log('[EDGE] Calling Pollinations with stream:true ...');

        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGenerator/1.0',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        });

        console.log('[EDGE] Pollinations status:', pollResponse.status);

        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            console.error('[EDGE] Pollinations error:', errorText);
            return new Response(
                JSON.stringify({ error: `Pollinations ${pollResponse.status}: ${errorText}` }),
                { status: pollResponse.status, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // ✅ TRANSFORM: Pollinations SSE → plain text stream
        //
        // Pollinations sends OpenAI-style SSE:
        //   data: {"choices":[{"delta":{"content":"chunk text"},...}]}\n\n
        //   data: [DONE]\n\n
        //
        // We extract just the text content and forward it as a plain stream.
        // The client receives a continuous stream of raw text characters.

        const { readable, writable } = new TransformStream({
            transform(chunk, controller) {
                const text = new TextDecoder().decode(chunk);
                const lines = text.split('\n');

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;

                    const data = line.slice(6).trim();

                    if (data === '[DONE]') {
                        controller.terminate();
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed?.choices?.[0]?.delta?.content;
                        if (content) {
                            controller.enqueue(new TextEncoder().encode(content));
                        }
                    } catch {
                        // Incomplete/malformed SSE frame — skip
                    }
                }
            }
        });

        // Pipe Pollinations stream through our transformer
        pollResponse.body.pipeTo(writable).catch(err => {
            console.error('[EDGE] Pipe error:', err);
        });

        // ✅ Return plain text stream to client
        // Content-Type: text/plain; charset=utf-8 → client reads raw text chunks
        return new Response(readable, {
            status: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'  // disable Nginx/proxy buffering if present
            }
        });

    } catch (err) {
        console.error('[EDGE] Fatal error:', err);
        return new Response(
            JSON.stringify({ error: err.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
