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

        // 🎯 IMPROVED SYSTEM PROMPT - Πιο specific για musical edits
        const systemPrompt = `You are an expert music production AI assistant specializing in track editing and arrangement.

CRITICAL RULES:
1. Output ONLY valid JSON - no markdown, no code blocks, no explanations
2. Maintain musical coherence and harmonic relationships
3. Respect the original composition's key, tempo, and genre
4. Follow all formatting requirements exactly
5. Ensure edited tracks complement unchanged tracks

Your response must be a single JSON object with this structure:
{
  "title": "string",
  "desc": "string", 
  "tracks": {
    "trackname": "pitch:beat:dur:vel|pitch:beat:dur:vel|..."
  }
}`;

        // 🔥 POST to Pollinations with IMPROVED settings
        const payload = {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            model: model || 'openai',
            temperature: 0.7,  // 🎯 LOWER temp για πιο consistent output
            max_tokens: 8192,  // 🎯 ΠΕΡΙΣΣΟΤΕΡΑ tokens για μεγάλα tracks
            seed: seed || 0,
            stream: true
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 75000); // 🎯 75sec (15sec buffer)

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
                
                // 🎯 BETTER error handling
                console.error('[VARIATIONS] Pollinations error:', response.status, errorText);
                return jsonError(`API error ${response.status}: ${errorText.substring(0, 200)}`, response.status);
            }

            // Handle both SSE and JSON fallback
            const contentType = response.headers.get('content-type') || '';
            const isSSE = contentType.includes('text/event-stream');

            if (isSSE) {
                // 🎯 IMPROVED Stream mode with better error handling
                let buffer = '';
                let totalChunks = 0;
                let hasData = false;
                
                const { readable, writable } = new TransformStream({
                    transform(chunk, controller) {
                        try {
                            buffer += new TextDecoder().decode(chunk);
                            totalChunks++;
                            
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed || !trimmed.startsWith('data:')) continue;
                                
                                const data = trimmed.slice(5).trim();
                                if (data === '[DONE]') continue;
                                
                                try {
                                    const parsed = JSON.parse(data);
                                    const content = parsed?.choices?.[0]?.delta?.content;
                                    if (content) {
                                        hasData = true;
                                        controller.enqueue(new TextEncoder().encode(content));
                                    }
                                } catch (parseErr) {
                                    // Skip malformed SSE chunks
                                    console.warn('[VARIATIONS] SSE parse warning:', parseErr.message);
                                }
                            }
                        } catch (err) {
                            console.error('[VARIATIONS] Transform error:', err);
                            controller.error(err);
                        }
                    },
                    flush(controller) {
                        try {
                            // Process any remaining buffer
                            if (!buffer.trim()) return;
                            
                            const trimmed = buffer.trim();
                            if (trimmed.startsWith('data:')) {
                                const data = trimmed.slice(5).trim();
                                if (data && data !== '[DONE]') {
                                    try {
                                        const parsed = JSON.parse(data);
                                        const content = parsed?.choices?.[0]?.delta?.content;
                                        if (content) {
                                            hasData = true;
                                            controller.enqueue(new TextEncoder().encode(content));
                                        }
                                    } catch { }
                                }
                            }
                            
                            console.log(`[VARIATIONS] Stream complete: ${totalChunks} chunks, hasData: ${hasData}`);
                        } catch (err) {
                            console.error('[VARIATIONS] Flush error:', err);
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
                        'X-Content-Type': 'streaming-json',
                        'X-Remaining-Generations': userApiKey ? 'BYOP' : 'unknown'
                    }
                });

            } else {
                // 🎯 IMPROVED JSON fallback
                const jsonData = await response.json();
                let content = '';
                
                if (jsonData?.choices?.[0]?.message?.content) {
                    content = jsonData.choices[0].message.content;
                } else if (jsonData?.choices?.[0]?.text) {
                    content = jsonData.choices[0].text;
                } else if (jsonData?.content) {
                    content = jsonData.content;
                } else {
                    console.warn('[VARIATIONS] Unexpected JSON structure:', Object.keys(jsonData));
                    content = JSON.stringify(jsonData);
                }

                // 🎯 VALIDATE we got something
                if (!content || content.length < 50) {
                    console.error('[VARIATIONS] Empty or invalid response content');
                    return jsonError('AI returned empty response', 500);
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
                        'X-Content-Type': 'json-fallback',
                        'X-Remaining-Generations': userApiKey ? 'BYOP' : 'unknown'
                    }
                });
            }

        } catch (fetchError) {
            clearTimeout(timeoutId);
            
            if (fetchError.name === 'AbortError') {
                console.error('[VARIATIONS] Request timeout after 75s');
                return jsonError('Request timeout - composition too complex or API slow', 504);
            }
            
            console.error('[VARIATIONS] Fetch error:', fetchError);
            throw fetchError;
        }

    } catch (error) {
        console.error('[VARIATIONS] Handler error:', error);
        return jsonError(error.message || 'Internal server error', 500);
    }
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
