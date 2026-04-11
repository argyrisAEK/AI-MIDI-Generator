const FREE_LIMIT = 2;
const WINDOW_DAYS = 30;

/** Returns caller's identifier: User ID (priority) or IP (fallback) */
function getClientIdentifier(req) {
    const userId = req.headers.get('x-user-id');
    if (userId && userId.startsWith('usr_')) {
        return userId;
    }
    return (
        req.headers.get('x-real-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown'
    );
}

/**
 * Check + increment usage counter with 30-day rolling window.
 */
async function checkRateLimit(identifier) {
    const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
    const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!kvUrl || !kvToken) {
        console.warn('[RATE-LIMIT] KV not configured — skipping');
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
    }
    
    const firstUseKey = `rl:midi:${identifier}:window_start`;
    const countKey    = `rl:midi:${identifier}:count`;
    
    try {
        const [firstUseRes, countRes] = await Promise.all([
            fetch(`${kvUrl}/get/${firstUseKey}`, { headers: { Authorization: `Bearer ${kvToken}` } }),
            fetch(`${kvUrl}/get/${countKey}`,    { headers: { Authorization: `Bearer ${kvToken}` } }),
        ]);
        
        const { result: firstUse } = await firstUseRes.json();
        const { result: countRaw } = await countRes.json();
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
            await Promise.all([
                fetch(`${kvUrl}/del/${firstUseKey}`, { headers: { Authorization: `Bearer ${kvToken}` } }),
                fetch(`${kvUrl}/del/${countKey}`,    { headers: { Authorization: `Bearer ${kvToken}` } }),
            ]);
            windowStart  = now.toISOString();
            windowExpiry = new Date(now);
            windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
        }

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
            return { allowed: false, remaining: 0, resetAt: windowExpiry.getTime() };
        }

        return { allowed: true, remaining: Math.max(0, FREE_LIMIT - newCount), resetAt: windowExpiry.getTime() };
    } catch (err) {
        console.error('[RATE-LIMIT] KV error:', err.message);
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
    }
}

// ── Scale Notes Helper ──────
const SCALE_INTERVALS = {
    major: [0,2,4,5,7,9,11], minor: [0,2,3,5,7,8,10], aeolian: [0,2,3,5,7,8,10],
    dorian: [0,2,3,5,7,9,10], phrygian: [0,1,3,5,7,8,10], lydian: [0,2,4,6,7,9,11],
    mixolydian: [0,2,4,5,7,9,10], locrian: [0,1,3,5,6,8,10], 'harmonic-minor': [0,2,3,5,7,8,11],
    'melodic-minor': [0,2,3,5,7,9,11], pentatonic: [0,2,4,7,9], 'minor-pentatonic': [0,3,5,7,10], blues: [0,3,5,6,7,10],
};
const NOTE_NAMES = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };

function getScaleNotes(key, scale) {
    const root = NOTE_NAMES[key] ?? 0;
    const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.major;
    return intervals.map(i => (root + i) % 12).join(',');
}

// ── PromptBuilder (Με τις διορθωμένες εντολές) ──────
const trackInstructions = { 
    bassline:       "MIDI:36-52,monophonic,outline-roots,STRICT-SCALE-ONLY,duration:0.5-2.0,vel:7-9,add-rests",
    chord:          "MIDI:48-72,polyphonic,block-voicings,rhythmic-gaps,vel:4-6",
    melody:         "MIDI:60-84,monophonic,expressive,many-rests,call-response",
    arpeggio:       "MIDI:55-84,8th-or-16th,pulsing,velocity-swells,vel:3-6",
    lead:           "MIDI:60-88,monophonic,legato,soaring,leave-space",
    plucks:         "MIDI:60-84,staccato,percussive,off-beat-accents,vel:5-8",
    strings:        "MIDI:48-79,sustained,harmonic-pads,vel:3-5,slow-attack",
    keys:           "MIDI:48-76,syncopated-comping,rhodes-style,vel:5-7",
    guitar:         "MIDI:40-76,rhythmic-scratches,16th-syncopation,organic",
    'pad-textures': "MIDI:45-72,ambient-wash,ultra-long-notes,vel:3-5",
    brass:          "MIDI:42-79,punchy-stabs,call-and-response,wide-gaps,vel:8-9",
    percs:          "MIDI:60-72,non-tonal,rhythmic-accents,do-not-overfill,vel:5-9",
};

const trackAbbreviations = {
    bassline: 'bass', chord: 'chd', melody: 'mel', arpeggio: 'arp', lead: 'lead', 
    plucks: 'plk', strings: 'str', keys: 'keys', guitar: 'gtr', 'pad-textures': 'pad', brass: 'brss', percs: 'perc'
};

function getStructuralGuidance(bars, beatsPerBar) {
    const totalBeats = bars * beatsPerBar;
    const breathingRoom = "SPACING_RULE: Every track must contain at least 25% silence (rests). ";
    if (bars === 8) {
        return breathingRoom + `STRUCTURE: A(1-2) -> A'(3-4) -> B(5-6) -> A''(7-8). Resolution by beat ${totalBeats - 1.0}. LOOP_GAP: Final 0.5 beats must be SILENT.`;
    }
    return breathingRoom + `STRUCTURE: Call(1-2) -> Response(3-4). Resolution by beat ${totalBeats - 1}. LOOP_GAP: Final 0.5 beats SILENT.`;
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
            const complexity = params.rhythmicComplexity || 'moderate';
            const timeSignature = params.timeSignature || '4/4';
            const scale = params.scale || 'major';
            const enhancedPrompt = params.enhancedPrompt || '';

            const validTracks = Object.keys(trackInstructions);
            const tracks = trackTypes.filter(t => validTracks.includes(t));
            if (tracks.length === 0) tracks.push('melody', 'bassline');

            const totalBeats = (parseInt(timeSignature.split('/')[0]) || 4) * bars;
            const trackList = tracks.map(t => `${trackAbbreviations[t]}(${trackInstructions[t]})`).join(' ');
            const trackSchema = tracks.map(t => `"${trackAbbreviations[t]}":""`).join(',');
            const scaleNotes = getScaleNotes(key, scale);
            const structuralGuidance = getStructuralGuidance(bars, 4);

            return `CFG:key=${key},scale=${scale},bpm=${bpm},style=${style},mood=${mood},bars=${bars},beats=${totalBeats},cmp=${complexity}` +
                (enhancedPrompt ? ` CONTEXT:${enhancedPrompt}` : '') +
                ` SCALE_NOTES:[${scaleNotes}]` +
                ` TASK:Compose a loopable multi-track MIDI arrangement. ONLY JSON.` +
                ` \n=== MUSICAL RULES ===\n` +
                ` 1. HARMONY: ONLY use pitches from SCALE_NOTES: [${scaleNotes}]. NO other notes.` +
                ` 2. BREATHING: No constant 16th notes. Use rests for syncopation.` +
                ` 3. VELOCITY: Vary 1-9. Accent beat 1 (8-9), ghost notes (1-3).` +
                ` 4. SEAMLESS_LOOP: Final 0.5 beats must be silent.` +
                ` \n=== STRUCTURE ===\n ${structuralGuidance}` +
                ` TRACKS:${trackList}` +
                ` RETURN:ONLY valid JSON. JSON:{"title":"","desc":"","tracks":{${trackSchema}}}`;
        } catch (error) {
            return `CFG:key=C,bpm=120,style=house OUT:{"title":"","desc":"","tracks":{"mel":"","bass":""}}`;
        }
    }
}

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    
    let promptParams, model, userApiKey;
    try {
        ({ promptParams, model, userApiKey } = await req.json());
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    const hasByopKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0;
    let remainingGenerations = FREE_LIMIT;

    if (!hasByopKey) {
        const clientIdentifier = getClientIdentifier(req);
        const { allowed, remaining, resetAt } = await checkRateLimit(clientIdentifier);
        remainingGenerations = remaining;
        if (!allowed) return new Response(JSON.stringify({ error: 'daily_limit_reached', resetAt, requiresByop: true }), { status: 402, headers: { 'Content-Type': 'application/json' } });
    }

    const builder = new PromptBuilder();
    const prompt = builder.constructMultiTrackPrompt(promptParams);
    const apiKey = hasByopKey ? userApiKey.trim() : (process.env.POLLINATIONS_GEN_KEY || '');

    const payload = {
        messages: [
            { role: 'system', content: 'You are an expert MIDI composer. You output ONLY valid JSON. No markdown, no text.' },
            { role: 'user', content: prompt }
        ],
        model: model || 'midijourney',
        temperature: 0.75,
        max_tokens: 5096,
        stream: true
    };

    const TIMEOUT_MS = 25_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}) },
            body: JSON.stringify(payload)
        });

        clearTimeout(timeoutId);
        if (!pollResponse.ok) return jsonError(`Pollinations Error ${pollResponse.status}`, pollResponse.status);

        let buffer = ''; // ✅ ΚΡΙΣΙΜΟ: Buffer για το streaming
        const { readable, writable } = new TransformStream({
            transform(chunk, controller) {
                buffer += new TextDecoder().decode(chunk);
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Κρατάμε το μισό line για το επόμενο chunk
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:')) continue;
                    const data = trimmed.slice(5).trim();
                    if (data === '[DONE]') return;
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed?.choices?.[0]?.delta?.content;
                        if (content) controller.enqueue(new TextEncoder().encode(content));
                    } catch {}
                }
            },
            flush(controller) {
                // Επεξεργασία του τελευταίου data αν έχει μείνει στο buffer
                if (buffer.startsWith('data:')) {
                    const data = buffer.trim().slice(5).trim();
                    if (data && data !== '[DONE]') {
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed?.choices?.[0]?.delta?.content;
                            if (content) controller.enqueue(new TextEncoder().encode(content));
                        } catch {}
                    }
                }
            }
        });
        pollResponse.body.pipeTo(writable);
        return streamResponse(readable, remainingGenerations, hasByopKey);

    } catch (err) {
        return jsonError(err.message, 500);
    }
}

function streamResponse(readable, remaining, isByop) {
    const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Access-Control-Expose-Headers': 'X-Remaining-Generations'
    };
    headers['X-Remaining-Generations'] = isByop ? 'BYOP' : String(remaining);
    return new Response(readable, { status: 200, headers });
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
