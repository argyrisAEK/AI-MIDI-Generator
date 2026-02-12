// generate.js — Vercel Edge Function
// Robust dual-mode: tries SSE streaming from Pollinations,
// falls back to plain JSON if Pollinations ignores stream:true.
// Client always receives a plain text stream either way.

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let prompt, model, enhancedPrompt;
    try {
        ({ prompt, model, enhancedPrompt } = await req.json());
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    if (!prompt || typeof prompt !== 'string') {
        return jsonError('Invalid prompt', 400);
    }

    const apiKey = process.env.POLLINATIONS_GEN_KEY || '';

    const payload = {
        messages: [
            {
                role: 'system',
                content: 'You are a creative musical AI, genre specialist. Output ONLY valid JSON with musical track data. No markdown, no explanation, no preamble.'
            },
            { role: 'user', content: prompt }
        ],
        model: model || 'openai-large',
        temperature: 0.7,
        max_tokens: 5096,
        seed: -1,
        stream: true
    };

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

        console.log('[EDGE] Pollinations status:', pollResponse.status);

        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            console.error('[EDGE] Pollinations error:', errorText);
            return jsonError(`Pollinations ${pollResponse.status}: ${errorText}`, pollResponse.status);
        }

        // ── Detect response type from Content-Type header ──────────────────
        const contentType = pollResponse.headers.get('content-type') || '';
        const isSSE = contentType.includes('text/event-stream');

        console.log('[EDGE] Content-Type:', contentType, '| SSE mode:', isSSE);

        if (isSSE) {
            // ── MODE A: True SSE streaming ─────────────────────────────────
            // Pollinations sends:  data: {"choices":[{"delta":{"content":"..."}}]}\n\n
            // We extract text content and pipe it as plain text to the client.
            console.log('[EDGE] Mode: SSE streaming');

            let buffer = '';

            const { readable, writable } = new TransformStream({
                transform(chunk, controller) {
                    buffer += new TextDecoder().decode(chunk);

                    // Process all complete lines (split on newline, keep last incomplete)
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // last element may be incomplete

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith('data:')) continue;

                        const data = trimmed.slice(5).trim();
                        if (data === '[DONE]') return;

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed?.choices?.[0]?.delta?.content;
                            if (content) {
                                controller.enqueue(new TextEncoder().encode(content));
                            }
                        } catch {
                            // Incomplete JSON frame across chunk boundary — skip
                        }
                    }
                },

                flush(controller) {
                    // Flush any remaining buffer content
                    if (!buffer.trim()) return;
                    const trimmed = buffer.trim();
                    if (trimmed.startsWith('data:')) {
                        const data = trimmed.slice(5).trim();
                        if (data && data !== '[DONE]') {
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed?.choices?.[0]?.delta?.content;
                                if (content) controller.enqueue(new TextEncoder().encode(content));
                            } catch { /* ignore */ }
                        }
                    }
                }
            });

            pollResponse.body.pipeTo(writable).catch(err => {
                console.error('[EDGE] SSE pipe error:', err);
            });

            return streamResponse(readable);

        } else {
            // ── MODE B: Plain JSON (Pollinations ignored stream:true) ──────
            // Read full JSON, extract content, wrap in ReadableStream.
            // Client code is identical — it always reads a stream.
            console.log('[EDGE] Mode: JSON fallback → wrapping as stream');

            const jsonData = await pollResponse.json();

            let content = '';
            if (jsonData?.choices?.[0]?.message?.content) {
                content = jsonData.choices[0].message.content;
            } else if (jsonData?.choices?.[0]?.text) {
                content = jsonData.choices[0].text;
            } else {
                content = JSON.stringify(jsonData);
            }

            if (!content || content.trim().length === 0) {
                return jsonError('Pollinations returned empty content', 500);
            }

            console.log(`[EDGE] Content: ${content.length} chars — wrapping in stream`);

            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(content));
                    controller.close();
                }
            });

            return streamResponse(stream);
        }

    } catch (err) {
        console.error('[EDGE] Fatal error:', err);
        return jsonError(err.message, 500);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function streamResponse(readable) {
    return new Response(readable, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    });
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
