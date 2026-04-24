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
    // One octave of pitch classes only — model applies across all octaves
    const notes = intervals.map(i => (root + i) % 12);
    return notes.join(',');
}

// ── PromptBuilder ──────
const trackInstructions = { 
    bassline:       "MIDI:36-52,monophonic,roots-and-fifths,typical-dur:0.5-2.0,vel:7-9",
    chord:          "MIDI:48-72,polyphonic(2-4notes),voice-led,comping,vel:4-7",
    melody:         "MIDI:60-84,monophonic,clear-motifs,call-response,vel:6-9",
    arpeggio:       "MIDI:55-79,16th-or-8th-notes,chord-tones,rhythmic-pulsing,vel:4-6",
    lead:           "MIDI:62-88,monophonic,legato,soaring-phrases,vel:7-9",
    plucks:         "MIDI:60-84,staccato,typical-dur:0.25-0.5,percussive,vel:5-8",
    strings:        "MIDI:48-79,polyphonic,sustained,smooth-voice-leading,vel:2-5",
    keys:           "MIDI:48-76,rhythmic-comping,syncopated,vel:4-7",
    guitar:         "MIDI:40-76,strummed-or-picked,organic-rhythm,vel:5-7",
    'pad-textures': "MIDI:45-72,long-notes,harmonic-wash,vel:2-4",
    brass:          "MIDI:42-75,punchy-stabs,syncopated-accents,vel:7-9",
    percs:          "MIDI:60-72,non-tonal,rhythmic-fills,vel:1-9",
};

// Genre-specific percussion character
const genrePercs = {
    'house':         "Four-on-floor kick feel C2-C3 | Offbeat hi-hat 8ths | Clap on 2&4 | Tight, clean articulation | Lock with bassline",
    'techno':        "Industrial kick pattern C2-C3 | Dense 16th hi-hats | Metallic rimshots | Hard, dry attack | Drive the grid relentlessly",
    'trance':        "Driving kick+snare C2-C3 | 16th open hi-hats | Builds with fills | Energetic, punchy | Propel the energy upward",
    'hip-hop':       "Swing-feel claps and snaps C2-C3 | Off-beat emphasis | Sample-inspired timing | Dry, punchy tone | Support groove pocket",
    'drum-and-bass': "Fast breakbeat fills C2-C3 | 16th-note syncopation | Amen-style ghost notes vel 1-2 | Aggressive, tight articulation | Interlock with bass",
    'jazz':          "Brushed snare and ride C2-C3 | Swing 8ths | Ghost notes on every beat | Soft, warm articulation | Converse with melody",
    'cinematic':     "Taiko-inspired hits C2-C3 | Sparse, impactful | Long decay fills | Powerful, dramatic | Mark structural moments only",
    'rock':          "Snare-backbeat C2-C3 | Driving 8th hi-hats | Crash accents on phrases | Hard attack | Lock with guitar rhythm",
    'ambient':       "Subtle textural hits C2-C3 | Ultra-sparse, 1-2 notes/bar | Soft mallet feel vel 1-3 | Blend into texture | Never dominate",
    'synthwave':     "Gated snare reverb C2-C3 | Offbeat claps | 80s machine-feel | Punchy with long gated tail | Anchor the grid",
    'disco':         "Open hi-hat 8ths C2-C3 | Clap on 2&4 | Tambourine feel off-beats | Bright, live feel | Keep the dancefloor moving",
    'reggae':        "One-drop rim clicks and shakers C2-C3 | Laid-back off-beats | Minimal presence | Warm, natural tone | Support skank groove",
    'afrobeats':     "Polyrhythmic shaker+conga C2-C3 | Cross-rhythm 16ths | Bright, percussive tone | Layered feel | Weave between downbeats",
    'latin':         "Clave-pattern congas C2-C3 | Syncopated 16ths | Timbale accents | Bright, dry attack | Drive the rhythmic conversation",
    'default':       "Rhythmic fills C2-C3 | Varied velocity 1-9 | Accent downbeats | Anchor the groove | Complement other instruments",
};
const trackAbbreviations = {
    bassline: 'bass', chord: 'chd', melody: 'mel', arpeggio: 'arp',
    lead: 'lead', plucks: 'plk', strings: 'str', keys: 'keys',
    guitar: 'gtr', 'pad-textures': 'pad', brass: 'brss', percs: 'perc'
};

function getStructuralGuidance(bars, beatsPerBar) {
    const totalBeats = bars * beatsPerBar;
    
    if (bars === 8) {
        return `STRUCTURE: A(bars 1-2) -> A'(bars 3-4) -> B(bars 5-6) -> A''(bars 7-8). ` +
            `ENERGY_FLOW: Bars 1-4 (Steady Groove), Bars 5-6 (Harmonic Departure/Tension), Bars 7-8 (Climax & Resolution). ` +
            `HARMONIC_AGREEMENT: ALL tracks MUST agree on the underlying implied chord for each half-bar or bar. Do not mix clashing chords across tracks. ` +
            `BARS 1-2: Establish core motif. Bass plays roots, Chords establish harmony, Melody introduces the hook. ` +
            `BARS 3-4: Repeat motif but evolve rhythmically. Add passing notes. ` +
            `BARS 5-6 (TENSION): Shift the implied harmony to a different diatonic chord (e.g., IV or vi). Melody moves to higher register. ` +
            `BARS 7-8 (RESOLUTION): Return to the root harmony (I or i). Highest velocities on downbeats. ` +
            `RESOLUTION_RULE: All tracks must resolve to the tonic/root note or chord between beat ${totalBeats - 2.0} and ${totalBeats - 0.5}. ` +
            `LOOP_GAP: Final 0.25 beats must be completely empty (no notes starting or sustaining) for seamless looping.`;
    }
    
    // Default: 4 bars
    return `STRUCTURE: Statement(bar 1) -> Development(bar 2) -> Tension(bar 3) -> Resolution(bar 4). ` +
        `HARMONIC_AGREEMENT: ALL tracks MUST share the same implied chord progression. Bass outlines the root, Chords/Pads play the harmony, Melody plays chord tones on strong beats. ` +
        `RHYTHMIC_INTERPLAY: When the Melody rests or holds a long note, Chords/Bass should move (fill the gaps). When Melody is busy, Chords/Bass should be simple and supportive. ` +
        `RESOLUTION_RULE: Strong resolution to the root harmony in Bar 4. Tension must resolve by beat ${totalBeats - 1}. ` +
        `LOOP_GAP: Leave the final 0.25 beats empty to ensure a seamless loop restart.`;
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

            const percDesc = genrePercs[style] || genrePercs.default;
            const trackList = tracks.map(t => {
                const desc = (t === 'percs') ? `MIDI:60-72,${percDesc}` : trackInstructions[t];
                return `${trackAbbreviations[t]}(${desc})`;
            }).join(' ');
            const trackSchema = tracks.map(t => `"${trackAbbreviations[t]}":""`).join(',');

           // ✅ Computed exactly as before
            const scaleNotes = getScaleNotes(key, scale);
            const structuralGuidance = getStructuralGuidance(bars, beatsPerBar);

            // Genre-specific behavior — replaces generic defaults entirely
            const GENRE_BEHAVIOR = {
                house:      'Bass plays steady quarters. Chords hit offbeats (8th). Melody: 4-8 notes/bar with space. Pads hold long.',
                techno:     'Bass drives 8th notes. Pads sustain, never stab. Percs fill 16ths. Lead phrases with gaps between.',
                trance:     'Arpeggio runs 16ths. Bass lands on beats 1 and 3. Melody soars in long phrases. Pads swell slowly.',
                'hip-hop':  'Bass syncopates and rests. Keys comp sparsely. Melody phrases loosely with breath between bars.',
                jazz:       'All tracks swing 8ths. Frequent rests. Instruments converse — one moves while others hold.',
                cinematic:  'Strings and pads sustain for bars. Bass uses whole or half notes. Melody enters sparingly for impact.',
                ambient:    'Pads hold for 4+ bars. All other tracks play slowly and sparsely. Silence is structural.',
                rock:       'Guitar anchors rhythmic 8ths. Bass locks to kick. Melody punches on strong beats.',
                synthwave:  'Bass and lead trade phrases. Arpeggios run 8th or 16th. Pads stay wide and held.',
                disco:      'Bass walks and grooves. Guitar comps on offbeats. Brass stabs on 2 and 4.',
                default:    'Balance density across tracks. Each track occupies a distinct register and rhythm.'
            };
            const behavior = GENRE_BEHAVIOR[style] || GENRE_BEHAVIOR.default;

            const prompt =
                // 1. ROLE
                `ROLE: Expert MIDI composer. Output ONLY valid JSON — no text outside the JSON object.\n` +

                // 2. USER INTENT (overrides everything below if present)
                (enhancedPrompt
                    ? `INTENT (highest priority — override behavior rules if needed): ${enhancedPrompt}\n`
                    : '') +

                // 3. HARD CONSTRAINTS (always apply, no exceptions)
                `CFG: key=${key} scale=${scale} bpm=${bpm} style=${style} mood=${mood} time=${timeSignature} bars=${bars} beats=${totalBeats} complexity=${complexity}\n` +
                `SCALE_NOTES:[${scaleNotes}]\n` +
                `CONSTRAINTS:\n` +
                `- Pitches: use ONLY pitch classes from SCALE_NOTES. Every note must pass this check.\n` +
                `- Bass register: MIDI 36-52 hard ceiling. Never exceed 52.\n` +
                `- Timing: beat and dur must be multiples of 0.25. No note starts at or after beat ${totalBeats}. Last note ends by beat ${totalBeats - 0.25}.\n` +
                `- Harmony: all tracks imply the same chord per bar. No clashing intervals.\n` +

                // 4. BEHAVIOR (genre-specific, single authoritative source)
                `BEHAVIOR for ${style}:\n` +
                `${behavior}\n` +
                `Velocity: downbeats 8-9, strong beats 6-7, offbeats 4-6, ghost notes 1-3. Use minimum 4 distinct velocity values per track.\n` +
                `Duration: mix note lengths within each track. Avoid using only one duration value throughout.\n` +

                // 5. STRUCTURE
                `STRUCTURE: ${structuralGuidance}\n` +
                `VARIANTS: Each repeated section must differ from the previous — alter 1-2 pitches, shift a rhythm by 0.25 beats, or change velocity on a downbeat.\n` +

                // 6. OUTPUT FORMAT
                `TRACKS: ${trackList}\n` +
                `FORMAT: pitch:beat:dur:vel|... (pitch=MIDI int, beat/dur=0.25 multiples, vel=1-9)\n` +
                `OUTPUT: {"title":"","desc":"max 20 words","tracks":{${trackSchema}}}`;

            console.log('[PromptBuilder] Generated prompt');
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
            { role: 'system', content: 'You are an expert MIDI composer and music theory specialist. You produce tight, professional, genre-accurate MIDI arrangements. You output ONLY valid JSON — no markdown, no explanation, no preamble, no trailing text. Every note you write is musically justified: correct scale, correct register, correct rhythm for the genre. You never output notes outside the given scale or beat range.' },
            { role: 'user', content: prompt }
        ],
        model: model || 'midijourney',
        temperature: 0.75,
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
