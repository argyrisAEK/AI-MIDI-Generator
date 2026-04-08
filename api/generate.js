const FREE_LIMIT = 2;
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

// ── Scale Notes Helper ──────
const SCALE_INTERVALS = {
    major:              [0,2,4,5,7,9,11],
    minor:              [0,2,3,5,7,8,10],
    aeolian:            [0,2,3,5,7,8,10],  // Natural minor = Aeolian
    dorian:             [0,2,3,5,7,9,10],
    phrygian:           [0,1,3,5,7,8,10],
    lydian:             [0,2,4,6,7,9,11],
    mixolydian:         [0,2,4,5,7,9,10],
    locrian:            [0,1,3,5,6,8,10],
    'harmonic-minor':   [0,2,3,5,7,8,11],
    'melodic-minor':    [0,2,3,5,7,9,11],
    pentatonic:         [0,2,4,7,9],
    'minor-pentatonic': [0,3,5,7,10],
    blues:              [0,3,5,6,7,10],
};

const NOTE_NAMES = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };

function getScaleNotes(key, scale) {
    const root = NOTE_NAMES[key] ?? 0;
    const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.major;
    const notes = [];
    // Generate MIDI notes 24-96 that belong to the scale
    for (let midi = 24; midi <= 96; midi++) {
        if (intervals.includes((midi - root + 120) % 12)) notes.push(midi);
    }
    return notes.join(',');
}

// ── PromptBuilder ──────
const trackInstructions = { 
    bassline:       "MIDI:36-55,role:rhythmic-low-end,style:root-notes-and-octaves-on-beat ",
    chord:          "MIDI:48-76,role:harmonic-sustained,style:block-or-broken-chords-midrange ",
    melody:         "MIDI:60-84,role:melodic-lead,style:singable-phrases-with-rests ",
    arpeggio:       "MIDI:55-84,role:rhythmic-arpeggiated,style:fast-short-notes-chord-tones-only ",
    lead:           "MIDI:60-88,role:expressive-solo,style:mono-legato-with-bends-and-slides ",
    plucks:         "MIDI:60-84,role:rhythmic-short-notes,style:staccato-percussive-short-dur ",
    strings:        "MIDI:48-79,role:sustained-harmonic,style:slow-attack-long-notes-chordal ",
    keys:           "MIDI:48-76,role:chordal-rhythmic,style:rhythmic-chords-or-comping ",
    guitar:         "MIDI:40-76,role:rhythmic-chordal,style:strummed-or-picked-patterns ",
    'pad-textures': "MIDI:45-72,role:atmospheric-long,style:very-long-notes-background-wash ",
    brass:          "MIDI:42-79,role:stab-accent,style:short-punchy-stabs-on-offbeats ",
    percs:          "MIDI:60-72,role:rhythmic-percussion,style:short-dur-vel-variation-syncopated ",
};

const trackAbbreviations = {
    bassline: 'bass', chord: 'chd', melody: 'mel', arpeggio: 'arp',
    lead: 'lead', plucks: 'plk', strings: 'str', keys: 'keys',
    guitar: 'gtr', 'pad-textures': 'pad', brass: 'brss', percs: 'perc'
};

function getStructuralGuidance(bars, beatsPerBar) {
    const b = beatsPerBar;
    if (bars <= 2) {
        return `STRUCTURE:single-phrase loop, establish motif immediately, resolve at beat ${bars * b - 0.5}.`;
    }
    if (bars === 4) {
        return `STRUCTURE:A(bar1-2)→A'(bar3-4). ` +
            `bars 1-2: introduce main motif. ` +
            `bars 3-4: repeat motif with rhythmic or pitch variation. ` +
            `Resolve to root at beat ${4 * b - 0.5}.`;
    }
    if (bars === 8) {
        return `STRUCTURE:A(bar1-2)→A(bar3-4)→B(bar5-6)→A'(bar7-8). ` +
            `bars 1-2: introduce main motif (root-focused). ` +
            `bars 3-4: exact or near-exact repeat of motif. ` +
            `bars 5-6: contrasting phrase — different pitch range or rhythm, build tension. ` +
            `bars 7-8: return to motif with variation, resolve firmly to root at beat ${8 * b - 0.5}. ` +
            `Melody and lead MUST have distinct phrases in bars 5-6, not a repeat.`;
    }
    if (bars === 16) {
        return `STRUCTURE:A(1-4)→A(5-8)→B(9-12)→A'(13-16). ` +
            `bars 1-4: establish full theme. ` +
            `bars 5-8: repeat with slight variation (velocity/rhythm). ` +
            `bars 9-12: contrasting section — modulate register or density, build tension. ` +
            `bars 13-16: return and resolve. ` +
            `Bassline and chord may maintain pattern throughout for groove continuity. ` +
            `Melody and lead MUST develop — no flat repetition across all 16 bars.`;
    }
    // generic for other lengths
    const half = Math.floor(bars / 2);
    return `STRUCTURE:A(bar1-${half})→B(bar${half + 1}-${bars}). ` +
        `First half: introduce motif. Second half: develop with variation. ` +
        `Resolve to root at beat ${bars * b - 0.5}.`;
}

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

            // ✅ Compute actual scale notes to enforce harmony precisely
            const scaleNotes = getScaleNotes(key, scale);

            // ✅ Structural guidance based on bar count
            const structuralGuidance = getStructuralGuidance(bars, beatsPerBar);

            const prompt = `CFG:key=${key},scale=${scale},bpm=${bpm},style=${style},mood=${mood},time=${timeSignature},bars=${bars},beats=${totalBeats},cmp=${complexity}` +
                (enhancedPrompt ? ` CONTEXT:${enhancedPrompt}` : '') +
                ` SCALE_NOTES:[${scaleNotes}]` +
                ` TASK:Compose a tight loopable multi-track MIDI arrangement.` +
                ` HARMONY:ONLY use pitches from SCALE_NOTES above — no exceptions, no chromatic passing tones unless blues/chromatic style.` +
                ` LOOP:bar 0 and bar ${bars} must feel identical so the loop is seamless — end notes must resolve before beat ${totalBeats}.` +
                ` RHYTHM:beats 0..${totalBeats - 0.001} only, dur>0, no note extends past beat ${totalBeats}.` +
                ` DENSITY:${complexity === 'simple' ? 'sparse, leave breathing room' : complexity === 'complex' ? 'rich but not cluttered' : 'moderate — quality over quantity'}.` +
                ` VELOCITY:vary vel 1-9 for dynamics — accent downbeats (vel 7-9), offbeats lighter (vel 3-6), ghost notes (vel 1-2). Never flat velocity across whole track.` +
                ` VOICE_LEADING:prefer stepwise motion, avoid leaps >7 semitones unless intentional. Bass stays low, melody stays high.` +
                ` GROOVE:stagger entries — bass first, then chords/pads, then melody/lead on offbeats. Max 3 simultaneous notes per track.` +
                ` ${structuralGuidance}` +
                ` FORMAT:pitch:beat:dur:vel|pitch:beat:dur:vel (pitch=integer, beat/dur=float >=0.5 steps, vel=1-9)` +
                ` TRACKS:${trackList}` +
                ` RETURN:ONLY valid JSON NO_TEXT_BEFORE_OR_AFTER_JSON` +
                ` JSON:{"title":"","desc":"max 20 words","tracks":{${trackSchema}}}`;
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
            { role: 'system', content: 'You are an expert MIDI composer and music theory specialist. You produce tight, professional, genre-accurate MIDI arrangements. You output ONLY valid JSON — no markdown, no explanation, no preamble, no trailing text. Every note you write is musically justified: correct scale, correct register, correct rhythm for the genre. You never output notes outside the given scale or beat range.' },
            { role: 'user', content: prompt }
        ],
        model: model || 'openai-large',
        temperature: 0.85,
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

// Στη συνάρτηση streamResponse:
function streamResponse(readable, remaining, isByop) {
    const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Access-Control-Expose-Headers': 'X-Remaining-Generations' // ✅ ΑΠΑΡΑΙΤΗΤΟ
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
