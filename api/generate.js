
const FREE_LIMIT = 3;        // 3 free generations per 30 days
const WINDOW_DAYS = 30;      // Rolling window duration

/** Returns caller's real IP, handling Vercel / Cloudflare proxy headers. */
function getClientIP(req) {
    return (
        req.headers.get('x-real-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown'
    );
}

/**
 * Check + increment usage counter with 30-day rolling window.
 * Returns { allowed, remaining, resetAt (unix ms) }
 */
async function checkRateLimit(ip) {
    const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
    const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    // Graceful degradation: αν δεν έχεις KV, επιτρέπεις όλα
    if (!kvUrl || !kvToken) {
        console.warn('[RATE-LIMIT] KV not configured — skipping');
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
    }

    const firstUseKey = `rl:midi:${ip}:window_start`;  // Πότε ξεκίνησε το παράθυρο
    const countKey    = `rl:midi:${ip}:count`;         // Πόσα έχει κάνει

    try {
        // Βήμα 1: Πάρε την ημερομηνία έναρξης του παραθύρου
        const firstUseRes = await fetch(`${kvUrl}/get/${firstUseKey}`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });
        const { result: firstUse } = await firstUseRes.json();

        const now = new Date();

        // Βήμα 2: Υπολόγισε πότε λήγει το τρέχον παράθυρο
        let windowStart, windowExpiry;

        if (firstUse) {
            windowStart = firstUse;
            const startDate = new Date(firstUse);
            windowExpiry = new Date(startDate);
            windowExpiry.setDate(startDate.getDate() + WINDOW_DAYS);
        } else {
            // Πρώτη φορά - ξεκίνα νέο παράθυρο
            windowStart = now.toISOString();
            windowExpiry = new Date(now);
            windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
        }

        // Βήμα 3: Έλεγξε αν το παράθυρο έληξε (rolling window)
        if (firstUse && now > windowExpiry) {
            // 🔄 RESET: Το 30-ήμερο παράθυρο έληξε, ξεκίνα από την αρχή
            console.log(`[RATE-LIMIT] Window expired for ${ip}, resetting counter...`);
            
            // Σβήσε τα παλιά δεδομένα
            await fetch(`${kvUrl}/del/${firstUseKey}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            await fetch(`${kvUrl}/del/${countKey}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            
            // Ξεκίνα νέο παράθυρο από τώρα
            windowStart = now.toISOString();
            windowExpiry = new Date(now);
            windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
        }

        // Βήμα 4: Αύξησε τον counter
        const incrRes = await fetch(`${kvUrl}/incr/${countKey}`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });
        const { result: count } = await incrRes.json();

        // Βήμα 5: Αν είναι πρώτη χρήση (μετά το incr), ορισμός expiry
        if (count === 1 || !firstUse || now > windowExpiry) {
            // Αποθήκευσε πότε ξεκίνησε το παράθυρο
            await fetch(`${kvUrl}/set/${firstUseKey}/${windowStart}/ex/${WINDOW_DAYS * 86400}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            
            // Ορισμός expiry και για τον counter (ίδιο με το παράθυρο)
            await fetch(`${kvUrl}/expire/${countKey}/${WINDOW_DAYS * 86400}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
        }

        const remaining = Math.max(0, FREE_LIMIT - count);
        const allowed = count <= FREE_LIMIT;

        console.log(`[RATE-LIMIT] IP=${ip} count=${count}/${FREE_LIMIT} allowed=${allowed} window=${windowStart.slice(0,10)} to ${windowExpiry.toISOString().slice(0,10)}`);

        return { 
            allowed, 
            remaining, 
            resetAt: windowExpiry.getTime() 
        };

    } catch (err) {
        console.error('[RATE-LIMIT] KV error:', err.message);
        // Fail-open: σε περίπτωση σφάλματος, επιτρέπουμε το request
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
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
    `|STR:m1-2~m3-4(var:15%),m5-8=evolve` + // Δυναμική εξέλιξη αντί για απλή επανάληψη
    `|VOX:chord_leap<7st,smooth_lead` +      // Περιορισμός μεγάλων αλμάτων (ημιτόνια)
    `|INT:mel->chd=sync,mel->bass=call-resp` + // Call and response λογική
    `|GRV:swing=8%,human_timing=2ms` +        // Μικρή απόκλιση στο χρόνο για ρεαλισμό
    `|HUM:dens<.65,rest>=1/4bar,vel_range[3,8]`; // Χρήση του εύρους velocity που ήδη έχεις

            // -------- Final prompt with COMPACT FORMAT --------
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

    let remainingGenerations = FREE_LIMIT;

    if (!hasByopKey) {
        const clientIP = getClientIP(req);
        const { allowed, remaining, resetAt } = await checkRateLimit(clientIP);
        remainingGenerations = remaining;
        console.log(`[RATE-LIMIT] IP=${clientIP} allowed=${allowed} remaining=${remaining}`);

        if (!allowed) {
            // 402 Payment Required — client will show the BYOP modal
            return new Response(
                JSON.stringify({
                    error: 'daily_limit_reached',
                    message: `You have used your ${FREE_LIMIT} free generations for this 30-day period.`,
                    resetAt,
                    requiresByop: true
                }),
                {
                    status: 402,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }
    } else {
        console.log('[RATE-LIMIT] BYOP key detected — skipping rate limit');
        remainingGenerations = 999; // Indicate unlimited/BYOP mode
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
        model: model || '-large',
        temperature: 0.9,
        max_tokens: 5096,
        seed: -1,
        stream: true
    };

    // Vercel Edge Functions have a hard execution limit (~25s on hobby, ~30s on pro).
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

        clearTimeout(timeoutId);
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
                        } catch {
                            // Incomplete JSON frame — skip
                        }
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
                            } catch { /* ignore */ }
                        }
                    }
                }
            });

            pollResponse.body.pipeTo(writable).catch(err => {
                console.error('[EDGE] SSE pipe error:', err);
            });

            return streamResponse(readable, remainingGenerations, hasByopKey);

        } else {
            // ── MODE B: Plain JSON fallback ──────────────────────────────
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

            return streamResponse(stream, remainingGenerations, hasByopKey);
        }

    } catch (err) {
        console.error('[EDGE] Fatal error:', err);
        return jsonError(err.message, 500);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function streamResponse(readable, remaining, isByop) {
    const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
    };
    
    // Always send remaining header, special value for BYOP
    if (isByop) {
        headers['X-Remaining-Generations'] = 'BYOP';
    } else if (remaining !== null && remaining !== undefined) {
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
