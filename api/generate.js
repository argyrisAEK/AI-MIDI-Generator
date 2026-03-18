const FREE_LIMIT = 4;
const WINDOW_DAYS = 30;

/** Returns caller's identifier: User ID (priority) or IP (fallback) */
function getClientIdentifier(req) {
    // ✅ FIX: Προτεραιότητα στο User ID από header
    const userId = req.headers.get('x-user-id');
    if (userId && userId.startsWith('usr_')) {
        return userId;
    }
    // Fallback στο IP αν δεν υπάρχει User ID
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
async function checkRateLimit(identifier) {
    const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
    const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!kvUrl || !kvToken) {
        console.warn('[RATE-LIMIT] KV not configured — skipping');
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
    }
    
    // ✅ FIX: Χρήση identifier (User ID ή IP) στα keys
    const firstUseKey = `rl:midi:${identifier}:window_start`;
    const countKey    = `rl:midi:${identifier}:count`;
    
    try {
        const [firstUseRes, countRes] = await Promise.all([
            fetch(`${kvUrl}/get/${firstUseKey}`, { headers: { Authorization: `Bearer ${kvToken}` } }),
            fetch(`${kvUrl}/get/${countKey}`,    { headers: { Authorization: `Bearer ${kvToken}` } }),
        ]);
        
        const { result: firstUse } = await firstUseRes.json();
        const { result: countRaw } = await countRes.json();
        const currentCount = parseInt(countRaw || '0', 10);
        const now = new Date();

        let windowStart, windowExpiry;
        if (firstUse) {
            windowStart  = firstUse;
            const startDate = new Date(firstUse);
            windowExpiry = new Date(startDate);
            windowExpiry.setDate(startDate.getDate() + WINDOW_DAYS);
        } else {
            windowStart  = now.toISOString();
            windowExpiry = new Date(now);
            windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
        }

        if (firstUse && now > windowExpiry) {
            console.log(`[RATE-LIMIT] Window expired for ${identifier}, resetting...`);
            await Promise.all([
                fetch(`${kvUrl}/del/${firstUseKey}`, { headers: { Authorization: `Bearer ${kvToken}` } }),
                fetch(`${kvUrl}/del/${countKey}`,    { headers: { Authorization: `Bearer ${kvToken}` } }),
            ]);
            windowStart  = now.toISOString();
            windowExpiry = new Date(now);
            windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
        }

        // ✅ FIX: INCR first για race condition protection
        const incrRes = await fetch(`${kvUrl}/incr/${countKey}`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });
        const { result: newCount } = await incrRes.json();

        if (newCount === 1 || !firstUse || (firstUse && now > windowExpiry)) {
            await Promise.all([
                fetch(`${kvUrl}/set/${firstUseKey}/${windowStart}/ex/${WINDOW_DAYS * 86400}`, {
                    headers: { Authorization: `Bearer ${kvToken}` }
                }),
                fetch(`${kvUrl}/expire/${countKey}/${WINDOW_DAYS * 86400}`, {
                    headers: { Authorization: `Bearer ${kvToken}` }
                }),
            ]);
        }

        if (newCount > FREE_LIMIT) {
            await fetch(`${kvUrl}/decr/${countKey}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            
            console.log(`[RATE-LIMIT] identifier=${identifier} BLOCKED count=${newCount}/${FREE_LIMIT}`);
            return {
                allowed: false,
                remaining: 0,
                resetAt: windowExpiry.getTime()
            };
        }

        const remaining = Math.max(0, FREE_LIMIT - newCount);
        const allowed   = newCount <= FREE_LIMIT;

        console.log(`[RATE-LIMIT] identifier=${identifier} count=${newCount}/${FREE_LIMIT} allowed=${allowed}`);

        return { allowed, remaining, resetAt: windowExpiry.getTime() };
        
    } catch (err) {
        console.error('[RATE-LIMIT] KV error:', err.message);
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
    }
}

// ── PromptBuilder ──────
const trackInstructions = { 
    bassline:       "MIDI:31-55,role:rhythmic-low-end ",
    chord:          "MIDI:48-72,role:harmonic-sustained ",
    melody:         "MIDI:60-84,role:melodic-lead ",
    arpeggio:       "MIDI:48-84,role:rhythmic-arpeggiated ",
    lead:           "MIDI:60-96,role:expressive-solo ",
    plucks:         "MIDI:60-84,role:rhythmic-short-notes ",
    strings:        "MIDI:48-84,role:sustained-harmonic ",
    keys:           "MIDI:48-72,role:chordal-rhythmic ",
    guitar:         "MIDI:40-76,role:rhythmic-chordal ",
    'pad-textures': "MIDI:36-72,role:atmospheric-long ",
    brass:          "MIDI:40-80,role:stab-accent ",
    percs:          "MIDI:36-60,role:rhythmic-percussion ",
};

const trackAbbreviations = {
    bassline: 'bass', chord: 'chd', melody: 'mel', arpeggio: 'arp',
    lead: 'lead', plucks: 'plk', strings: 'str', keys: 'keys',
    guitar: 'gtr', 'pad-textures': 'pad', brass: 'brss', percs: 'perc'
};

class PromptBuilder {
    constructMultiTrackPrompt(params = {}) {
        try {
            const key = params.key || 'C';
            const bpm = Math.max(40, Math.min(300, parseInt(params.bpm || params.tempo) || 120));
            const bars = Math.max(1, Math.min(64, parseInt(params.duration_bars || params.duration) || 4));
            const style = params.style || 'house';
            const mood = params.mood || 'neutral';
            const trackTypes = Array.isArray(params.trackTypes) ? params.trackTypes : [];
            const complexityMap = { simple: 'simple', moderate: 'moderate', medium: 'moderate', complex: 'complex' };
            const complexity = complexityMap[(params.rhythmicComplexity || 'moderate').toLowerCase()] || 'moderate';
            const timeSignature = params.timeSignature || '4/4';
            const scale = params.scale || params.scaleType || 'major';
            const enhancedPrompt = params.enhancedPrompt || '';

            const validTracks = Object.keys(trackInstructions);
            const tracks = trackTypes.filter(t => validTracks.includes(t));
            if (tracks.length === 0) tracks.push('melody', 'bassline');

            const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
            const totalBeats = beatsPerBar * bars;

            const trackList = tracks.map(t => `${trackAbbreviations[t]}(${trackInstructions[t]})`).join(' ');
            const trackSchema = tracks.map(t => `"${trackAbbreviations[t]}":""`).join(',');
            
            const prompt = `CFG:key=${key},scale=${scale},bpm=${bpm},style=${style},mood=${mood},time=${timeSignature},bars=${bars},beats=${totalBeats},cmp=${complexity} ${enhancedPrompt ? `CONTEXT:${enhancedPrompt} ` : ''}TASK:Create loopable multi-track MIDI phrases. RULES:beat unit only 0 <= beat < ${totalBeats} dur > 0 pitch integer beat,dur may use .5 vel integer 1..9 keep pitch inside each track MIDI range use only notes that fit key+scale use only listed tracks musical and loopable moderate density motif repetition with small variation include rests avoid large leaps keep tracks rhythmically compatible if unsure, use fewer notes max 3 notes simultaneous per track stagger note onsets across tracks: avoid all tracks hitting on the same beat prefer offbeat entries for mid/high tracks (melody, arpeggio, plucks) TRACKS:${trackList} FORMAT:pitch:beat:dur:vel|pitch:beat:dur:vel EMPTY:"" RETURN:ONLY valid JSON JSON:{"title":"","desc":"max 20 words","tracks":{${trackSchema}}} NO_TEXT_BEFORE_OR_AFTER_JSON`;
            
            console.log('[PromptBuilder] Generated ultra-compact prompt');
            return prompt;
        } catch (error) {
            console.error('PromptBuilder error:', error);
            return `CFG:key=C,bpm=120,style=house,time=4/4,bars=4,cmp=M RULES:TIME:u=beat,bar=4,start_in[0,16) TRACKS:mel(MIDI RANGE:60-84) bass(MIDI RANGE:31-55) FORMAT:pitch:beat:dur:vel OUT:{"title":"","desc":"","tracks":{"mel":"","bass":""}}`;
        }
    }
}

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

    const hasByopKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0;
    let remainingGenerations = FREE_LIMIT;

    if (!hasByopKey) {
        // ✅ FIX: Χρήση getClientIdentifier αντί για getClientIP
        const clientIdentifier = getClientIdentifier(req);
        const { allowed, remaining, resetAt } = await checkRateLimit(clientIdentifier);
        remainingGenerations = remaining;
        
        console.log(`[RATE-LIMIT] identifier=${clientIdentifier} allowed=${allowed} remaining=${remaining}`);

        if (!allowed) {
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
        remainingGenerations = 999;
    }

    let prompt;
    try {
        const builder = new PromptBuilder();
        prompt = builder.constructMultiTrackPrompt(promptParams);
    } catch (err) {
        console.error('[EDGE] PromptBuilder error:', err);
        return jsonError('Failed to build prompt', 500);
    }

    const apiKey = hasByopKey ? userApiKey.trim() : (process.env.POLLINATIONS_GEN_KEY || '');

    const payload = {
        messages: [
            { role: 'system', content: 'You are a creative musical AI, genre-style specialist. Output ONLY valid JSON with musical track data. No markdown, no explanation, no preamble.' },
            { role: 'user', content: prompt }
        ],
        model: model || 'openai-large',
        temperature: 0.9,
        max_tokens: 5096,
        seed: -1,
        stream: true
    };

    const TIMEOUT_MS = 25_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
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
            if (err.name === 'AbortError') throw new Error('Request to Pollinations timed out after 25s');
            throw err;
        });

        clearTimeout(timeoutId);

        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            return jsonError(`Pollinations ${pollResponse.status}: ${errorText}`, pollResponse.status);
        }

        const contentType = pollResponse.headers.get('content-type') || '';
        const isSSE = contentType.includes('text/event-stream');

        if (isSSE) {
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
                            if (content) controller.enqueue(new TextEncoder().encode(content));
                        } catch { /* Incomplete JSON frame */ }
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
            pollResponse.body.pipeTo(writable).catch(err => console.error('[EDGE] SSE pipe error:', err));
            return streamResponse(readable, remainingGenerations, hasByopKey);
        } else {
            const jsonData = await pollResponse.json();
            let content = jsonData?.choices?.[0]?.message?.content || jsonData?.choices?.[0]?.text || JSON.stringify(jsonData);
            if (!content || content.trim().length === 0) return jsonError('Pollinations returned empty content', 500);
            
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

function streamResponse(readable, remaining, isByop) {
    const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Access-Control-Expose-Headers': 'X-Remaining-Generations' // ✅ ΑΠΑΡΑΙΤΗΤΟ για CORS
    };
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
