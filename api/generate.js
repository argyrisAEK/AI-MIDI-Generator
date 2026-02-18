// generate.js — Vercel Edge Function
// Robust dual-mode: tries SSE streaming from Pollinations,
// falls back to plain JSON if Pollinations ignores stream:true.
// Client always receives a plain text stream either way.
// Prompt is built server-side so prompt engineering logic is never exposed to the client.

import { PromptBuilder } from './prompt-builder.js';

export const config = { runtime: 'edge' }; 
export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let promptParams, model;
    try {
        ({ promptParams, model } = await req.json());
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    if (!promptParams || typeof promptParams !== 'object') {
        return jsonError('Invalid promptParams', 400);
    }

    // Build the prompt server-side — logic never leaves the edge function
    let prompt;
    try {
        const builder = new PromptBuilder();
        prompt = builder.constructMultiTrackPrompt(promptParams);
        console.log('[EDGE] Prompt built server-side, length:', prompt.length);
    } catch (err) {
        console.error('[EDGE] PromptBuilder error:', err);
        return jsonError('Failed to build prompt', 500);
    }

    const apiKey = process.env.POLLINATIONS_GEN_KEY || '';

    const payload = {
        messages: [
            {
                role: 'system',
                content: 'You are a creative musical AI, genre-style specialist. Output ONLY valid JSON with musical track data. No markdown, no explanation, no preamble.'
            },
            { role: 'user', content: prompt }
        ],
        model: model || 'openai-large',
        temperature: 0.7,
        max_tokens: 5096,
        seed: -1,
        stream: true
    };

    // Vercel Edge Functions have a hard execution limit (~25s on hobby, ~30s on pro).
    // Without an explicit timeout the fetch can hang until Vercel kills the function,
    // returning an opaque 504 with no useful error message to the client.
    const TIMEOUT_MS = 25_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        console.error('[EDGE] Pollinations request timed out after', TIMEOUT_MS, 'ms');
    }, TIMEOUT_MS);

    try {
        console.log('[EDGE] Calling Pollinations...');

        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGenerator/1.0',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        }).catch(err => {
            if (err.name === 'AbortError') {
                throw new Error('Request to Pollinations timed out after 25s');
            }
            throw err;
        });

        clearTimeout(timeoutId); // Response received — cancel the abort timer
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
