export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, seed, model, userApiKey } = await req.json();

        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return jsonError('Missing or invalid prompt parameter', 400);
        }

        // ── Resolve API key: BYOP > server env ───────────────────────────────────
        const apiKey = userApiKey?.trim() 
            ? userApiKey.trim() 
            : (process.env.POLLINATIONS_GEN_KEY || '');
            
        if (!apiKey) {
            return jsonError('Server configuration error: No API key available', 500);
        }

        // 🔥 POST to Pollinations like generate.js
        const payload = {
            messages: [
                {
                    role: 'system',
                    content: 'You are a music production AI. Output ONLY valid JSON with musical track data. No markdown, no explanation.'
                },
                { role: 'user', content: prompt }
            ],
            model: model || 'openai',
            temperature: 0.9,
            max_tokens: 4096,
            seed: seed || 0,
            stream: true
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        try {
            const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                
                // 402 = Payment Required (daily limit)
                if (response.status === 402) {
                    return new Response(
                        JSON.stringify({
                            error: 'daily_limit_reached',
                            message: 'You have reached your daily generation limit. Please provide your own API key.',
                            requiresByop: true
                        }),
                        { status: 402, headers: { 'Content-Type': 'application/json' } }
                    );
                }
                
                return jsonError(`Pollinations ${response.status}: ${errorText}`, response.status);
            }

            // Handle both SSE and JSON fallback like generate.js
            const contentType = response.headers.get('content-type') || '';
            const isSSE = contentType.includes('text/event-stream');

            if (isSSE) {
                // Stream mode
                let buffer = '';
                const { readable, writable } = new TransformStream({
                    transform(chunk, controller) {
                        buffer += new TextDecoder().decode(chunk);
                        const lines = buffer.split('\n');
                        buffer = lines.pop();

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
                            } catch { /* skip incomplete */ }
                        }
                    },
                    flush(controller) {
                        if (!buffer.trim()) return;
                        const trimmed = buffer.trim();
                        if (trimmed.startsWith('data:')) {
                            const data = trimmed.slice(5).trim();
                            if (data && data !== '[DONE]') {
                                try {
                                    const parsed = JSON.parse(data);
                                    const content = parsed?.choices?.[0]?.delta?.content;
                                    if (content) controller.enqueue(new TextEncoder().encode(content));
                                } catch { }
                            }
                        }
                    }
                });

                response.body.pipeTo(writable).catch(err => {
                    console.error('[VARIATIONS] SSE pipe error:', err);
                });

                return new Response(readable, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Cache-Control': 'no-cache',
                        'X-Remaining-Generations': userApiKey ? 'BYOP' : 'unknown'
                    }
                });

            } else {
                // JSON fallback - wrap as stream
                const jsonData = await response.json();
                let content = '';
                if (jsonData?.choices?.[0]?.message?.content) {
                    content = jsonData.choices[0].message.content;
                } else if (jsonData?.choices?.[0]?.text) {
                    content = jsonData.choices[0].text;
                } else {
                    content = JSON.stringify(jsonData);
                }

                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(content));
                        controller.close();
                    }
                });

                return new Response(stream, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Cache-Control': 'no-cache',
                        'X-Remaining-Generations': userApiKey ? 'BYOP' : 'unknown'
                    }
                });
            }

        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                return jsonError('Request timeout', 504);
            }
            throw fetchError;
        }

    } catch (error) {
        console.error('[VARIATIONS] Error:', error);
        return jsonError(error.message || 'Internal server error', 500);
    }
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
