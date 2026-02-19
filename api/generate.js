// generate.js — Vercel Edge Function
// Robust dual-mode: tries SSE streaming from Pollinations,
// falls back to plain JSON if Pollinations ignores stream:true.
// Client always receives a plain text stream either way.
// Prompt is built server-side so prompt engineering logic is never exposed to the client.


// ── Rate Limiting via Vercel KV (Upstash Redis) ──────────────────────────────
// Requires @vercel/kv and env vars: KV_REST_API_URL + KV_REST_API_TOKEN.
// Falls back gracefully if KV is not configured (no rate limiting applied).

const FREE_DAILY_LIMIT = 3;

/** Returns caller's real IP, handling Vercel / Cloudflare proxy headers. */
function getClientIP(req) {
    return (
        req.headers.get('x-real-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown'
    );
}

/**
 * Check + increment daily usage counter for an IP via Upstash REST API.
 * Returns { allowed, remaining, resetAt (unix ms) }
 * If KV is not configured, always allows (graceful degradation).
 */
async function checkRateLimit(ip) {
    const kvUrl   = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;

    if (!kvUrl || !kvToken) {
        console.warn('[RATE-LIMIT] KV not configured — skipping');
        return { allowed: true, remaining: FREE_DAILY_LIMIT, resetAt: 0 };
    }

    const today = new Date().toISOString().slice(0, 10); // "2025-02-19"
    const key   = `rl:midi:${ip}:${today}`;

    try {
        const incrRes = await fetch(`${kvUrl}/incr/${key}`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });
        const { result: count } = await incrRes.json();

        // Set TTL on first use — 36h covers day-boundary edge cases
        if (count === 1) {
            await fetch(`${kvUrl}/expire/${key}/129600`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
        }

        const remaining = Math.max(0, FREE_DAILY_LIMIT - count);
        const midnight  = new Date();
        midnight.setUTCHours(24, 0, 0, 0);

        return { allowed: count <= FREE_DAILY_LIMIT, remaining, resetAt: midnight.getTime() };
    } catch (err) {
        console.error('[RATE-LIMIT] KV error — allowing request:', err.message);
        return { allowed: true, remaining: 1, resetAt: 0 };
    }
}

// ── PromptBuilder (inlined to avoid Edge Function module restrictions) ──────
// Track-specific instructions (loaded only when that track is selected)
const trackInstructions = {
    bassline: "MIDI RANGE:31-55",
    chord: "MIDI RANGE:48-72",
    melody: "MIDI RANGE:60-84",
    arpeggio: "MIDI RANGE:48-84",
    lead: "MIDI RANGE:60-96",
    plucks: "MIDI RANGE:60-84",
    strings: "MIDI RANGE:48-84",
    keys: "MIDI RANGE:48-72",
    guitar: "MIDI RANGE:40-76",
    'pad-textures': "MIDI RANGE:36-72",
    brass: "MIDI RANGE:40-80",
    percs: "MIDI RANGE:36-60"
};

// Track abbreviations (loaded only when building the output format)
const trackAbbreviations = {
    bassline: 'bass',
    chord: 'chd',
    melody: 'mel',
    arpeggio: 'arp',
    lead: 'lead',
    plucks: 'plk',
    strings: 'str',
    keys: 'keys',
    guitar: 'gtr',
    'pad-textures': 'pad',
    brass: 'brss',
    percs: 'perc'
};

class PromptBuilder {

    /**
     * Ultra-compact prompt with token optimization.
     * Format: pitch:beat:dur:vel|pitch:beat:dur:vel...
     * Velocity is stored as 1-9 (10% increments)
     * 
     * Benefits:
     * - 40% fewer tokens
     * - Better focus for AI on musical relationships
     * - Reduced hallucination and formatting errors
     * - Single-character separator (|) instead of \n in JSON
     */
    constructMultiTrackPrompt(params = {}) {
        try {
            // -------- Analyzer-compatible normalization --------
            const key = params.key || 'C';
            const bpm = Math.max(
                40,
                Math.min(300, parseInt(params.bpm || params.tempo) || 120)
            );

            const bars = Math.max(
                1,
                Math.min(64, parseInt(params.duration_bars || params.duration) || 4)
            );

            const style = params.style || 'house';
            const mood = params.mood || 'neutral';
            const trackTypes = Array.isArray(params.trackTypes) ? params.trackTypes : [];
            const complexity = (params.rhythmicComplexity || 'medium')
                .charAt(0)
                .toUpperCase(); // S / M / C

            const timeSignature = params.timeSignature || '4/4';
            const enhancedPrompt = params.enhancedPrompt || '';

            // -------- Track validation --------
            const validTracks = Object.keys(trackInstructions);
            const tracks = trackTypes.filter(t => validTracks.includes(t));

            if (tracks.length === 0) {
                tracks.push('melody', 'bassline');
            }

            // -------- Timing --------
            const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
            const totalBeats = beatsPerBar * bars;

            // -------- Track DSL --------
            const trackList = tracks
                .map(t => `${trackAbbreviations[t]}(${trackInstructions[t]})`)
                .join(' ');

            const trackAbbrList = tracks
                .map(t => trackAbbreviations[t])
                .join('","');

            // -------- Compact rules --------
           const rules =
    `TIME:u=beat,bar=${beatsPerBar},start_in[0,${totalBeats})` +
    `|REP:m12>rv34,bass@1-2,!rnd` +
    `|INT:mel->chd=simple,mel->bass=fill` +
    `|HUM:dens<.65,rep<.45,rest>=1/4bar,vel+-2`;

            // -------- Final prompt with COMPACT FORMAT --------
            // Ultra-Compact Format Explanation:
            // - Separator for notes: : (pitch:beat:dur:vel)
            // - Separator between notes: | (instead of \n, saves JSON escaping)
            // - Velocity: integer 1-9 (represents 10%-90% intensity)
            // - Decimals: .5 instead of 0.5 (no leading zero)
            const prompt =
`CFG:key=${key},bpm=${bpm},style=${style},mood=${mood},time=${timeSignature},bars=${bars},cmp=${complexity}
RULES:${rules}
TRACKS:${trackList}
FORMAT:pitch:beat:dur:vel|pitch:beat:dur:vel... (velocity: 1-9 = 10%-90%, decimals as .5)
OUT:{"title":"","desc":"≤20w","tracks":{"${trackAbbrList}":"pitch:beat:dur:vel|pitch:beat:dur:vel"}}
${enhancedPrompt ? `CONTEXT:${enhancedPrompt}` : ''}`;

            console.log('[PromptBuilder] Generated ultra-compact prompt');
            return prompt;

        } catch (error) {
            console.error('PromptBuilder error:', error);

            // -------- Safe fallback with compact format --------
            return (
`CFG:key=C,bpm=120,style=house,time=4/4,bars=4,cmp=M
RULES:TIME:u=beat,bar=4,start_in[0,16)|REP:m12>rv34,bass@1-2,!rnd|INT:mel->chd=simple,mel->bass=fill|HUM:dens<.65,rep<.45,rest>=1/4bar,vel+-2
TRACKS:mel(MIDI RANGE:60-84) bass(MIDI RANGE:31-55)
FORMAT:pitch:beat:dur:vel|pitch:beat:dur:vel... (velocity: 1-9 = 10%-90%, decimals as .5)
OUT:{"title":"","desc":"","tracks":{"mel":"pitch:beat:dur:vel|pitch:beat:dur:vel","bass":"pitch:beat:dur:vel|pitch:beat:dur:vel"}}`
            );
        }
    }

    getTrackInstruction(trackType) {
        return trackInstructions[trackType] || 'default';
    }

    getTrackAbbreviation(trackType) {
        return trackAbbreviations[trackType] || trackType;
    }
}


// ─────────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }; 
export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let promptParams, model, userApiKey;
    try {
        ({ promptParams, model, userApiKey } = await req.json());
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    if (!promptParams || typeof promptParams !== 'object') {
        return jsonError('Invalid promptParams', 400);
    }

    // ── Rate limiting ─────────────────────────────────────────────────────────
    // If the user provides their own Pollinations key (BYOP), skip rate limiting.
    const hasByopKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0;

    if (!hasByopKey) {
        const clientIP = getClientIP(req);
        const { allowed, remaining, resetAt } = await checkRateLimit(clientIP);
        console.log(`[RATE-LIMIT] IP=${clientIP} allowed=${allowed} remaining=${remaining}`);

        if (!allowed) {
            // 402 Payment Required — client will show the BYOP modal
            return new Response(
                JSON.stringify({
                    error: 'daily_limit_reached',
                    message: `You have used your ${FREE_DAILY_LIMIT} free generations for today.`,
                    resetAt,
                    requiresByop: true
                }),
                {
                    status: 402,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }

        // Add remaining-count header so the client can show a counter
        req._remainingHeader = String(remaining);
    }

    // ── Build the prompt server-side ──────────────────────────────────────────
    let prompt;
    try {
        const builder = new PromptBuilder();
        prompt = builder.constructMultiTrackPrompt(promptParams);
        console.log('[EDGE] Prompt built server-side, length:', prompt.length);
    } catch (err) {
        console.error('[EDGE] PromptBuilder error:', err);
        return jsonError('Failed to build prompt', 500);
    }

    // ── Resolve API key: BYOP > server env ───────────────────────────────────
    const apiKey = hasByopKey
        ? userApiKey.trim()
        : (process.env.POLLINATIONS_GEN_KEY || '');

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

            return streamResponse(readable, req._remainingHeader ?? null);

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

            return streamResponse(stream, req._remainingHeader ?? null);
        }

    } catch (err) {
        console.error('[EDGE] Fatal error:', err);
        return jsonError(err.message, 500);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function streamResponse(readable, remaining = null) {
    const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
    };
    if (remaining !== null) {
        headers['X-Remaining-Generations'] = String(remaining);
    }
    return new Response(readable, { status: 200, headers });
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
