/**
 * api/v1/midi.js
 * POST /api/v1/midi              → streaming JSON
 * POST /api/v1/midi?format=midi  → binary .mid file
 *
 * Improvements over v0:
 *  - /v1/ versioned path
 *  - Prompt sanitization (XSS strip, length cap)
 *  - Idempotency-Key header support
 *  - Retry-After header on 429/504
 *  - Structured request logging
 *  - trackTypes empty array → sane default
 *  - Commented MIDI builder
 */

import { validateAndUseKey } from '../_lib/api-keys.js';

export const config = { runtime: 'edge' };

// ── Constants ──────────────────────────────────────────────────────────
const SCALE_INTERVALS = {
    major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10],
    aeolian:[0,2,3,5,7,8,10], dorian:[0,2,3,5,7,9,10],
    phrygian:[0,1,3,5,7,8,10], pentatonic:[0,2,4,7,9],
    blues:[0,3,5,6,7,10],
};
const NOTE_NAMES = {
    C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,
    G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11
};
const VALID_STYLES  = ['house','techno','trance','hip-hop','jazz','cinematic','ambient','rock','synthwave','disco','afrobeats','pop','latin','drum-and-bass'];
const VALID_MOODS   = ['dark','dreamy','uplifting','mysterious','groovy','energetic','melancholic','peaceful','aggressive','romantic','neutral'];
const VALID_TRACKS  = ['bassline','chord','melody','arpeggio','lead','plucks','strings','keys','pad-textures','guitar','brass','percs'];
const VALID_TIMESIG = ['4/4','3/4','6/8','2/4'];
const DEFAULT_TRACKS = ['melody','bassline'];

const TRACK_INSTRUCTIONS = {
    bassline:'MIDI:36-52,HARD-CEILING:52,monophonic,roots-and-fifths,dur:0.5-2.0,vel:7-9',
    chord:'MIDI:48-72,polyphonic(2-4notes),voice-led,comping,vel:4-7',
    melody:'MIDI:60-84,monophonic,clear-motifs,RESTS-MANDATORY,vel:6-9',
    arpeggio:'MIDI:55-79,16th-or-8th-notes,chord-tones,vel:4-6',
    lead:'MIDI:62-88,monophonic,legato,soaring-phrases,vel:7-9',
    plucks:'MIDI:60-84,staccato,dur:0.25-0.5,sparse,vel:5-8',
    strings:'MIDI:48-79,polyphonic,sustained-dur:2.0+,background,vel:2-5',
    keys:'MIDI:48-76,rhythmic-comping,syncopated,vel:4-7',
    'pad-textures':'MIDI:45-72,ultra-long-dur:4.0+,static-harmony,vel:2-4',
    brass:'MIDI:42-75,punchy-stabs,syncopated,vel:7-9',
    percs:'MIDI:60-72,non-tonal,rhythmic-fills,vel:1-9',
    guitar:'MIDI:40-76,strummed-or-picked,organic,vel:5-7',
};
const TRACK_ABBR = {
    bassline:'bass', chord:'chd', melody:'mel', arpeggio:'arp', lead:'lead',
    plucks:'plk', strings:'str', keys:'keys', 'pad-textures':'pad',
    brass:'brss', percs:'perc', guitar:'gtr'
};

// ── Input sanitization ────────────────────────────────────────────────
function sanitizePrompt(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .replace(/<[^>]*>/g, '')       // strip HTML tags (XSS)
        .replace(/[^\w\s.,\-'!?:()]/g, '') // allow only safe chars
        .trim()
        .slice(0, 300);                // hard cap
}

// ── Validation ────────────────────────────────────────────────────────
function validateParams(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return ['promptParams must be a JSON object'];

    if (p.bpm !== undefined) {
        const v = Number(p.bpm);
        if (!Number.isFinite(v) || v < 40 || v > 220)
            errors.push('bpm must be a number 40–220');
    }
    if (p.bars !== undefined) {
        const v = Number(p.bars);
        if (!Number.isInteger(v) || v < 1 || v > 16)
            errors.push('bars must be an integer 1–16');
    }
    if (p.scale      && !SCALE_INTERVALS[p.scale])   errors.push(`scale must be one of: ${Object.keys(SCALE_INTERVALS).join(', ')}`);
    if (p.key        && !Object.hasOwn(NOTE_NAMES, p.key)) errors.push(`key must be one of: ${Object.keys(NOTE_NAMES).join(', ')}`);
    if (p.style      && !VALID_STYLES.includes(p.style))   errors.push(`style must be one of: ${VALID_STYLES.join(', ')}`);
    if (p.mood       && !VALID_MOODS.includes(p.mood))     errors.push(`mood must be one of: ${VALID_MOODS.join(', ')}`);
    if (p.timeSignature && !VALID_TIMESIG.includes(p.timeSignature)) errors.push(`timeSignature must be one of: ${VALID_TIMESIG.join(', ')}`);
    if (p.complexity && !['simple','moderate','complex'].includes(p.complexity)) errors.push('complexity must be simple, moderate, or complex');

    if (p.trackTypes !== undefined) {
        if (!Array.isArray(p.trackTypes)) {
            errors.push('trackTypes must be an array');
        } else {
            if (p.trackTypes.length > 6) errors.push('Maximum 6 trackTypes');
            const invalid = p.trackTypes.filter(t => !VALID_TRACKS.includes(t));
            if (invalid.length) errors.push(`Unknown trackTypes: ${invalid.join(', ')}`);
        }
    }
    return errors;
}

// ── Prompt builder ─────────────────────────────────────────────────────
function buildPrompt(p) {
    const key     = p.key   || 'C';
    const scale   = p.scale || 'minor';
    const bpm     = Math.max(40, Math.min(220, parseInt(p.bpm)  || 120));
    const bars    = Math.max(1,  Math.min(16,  parseInt(p.bars) || 4));
    const style   = p.style || 'house';
    const mood    = p.mood  || 'neutral';
    const timeSig = p.timeSignature || '4/4';
    const cmp     = p.complexity || 'moderate';

    // Default to sane tracks if empty/missing
    let tracks = Array.isArray(p.trackTypes)
        ? p.trackTypes.filter(t => VALID_TRACKS.includes(t))
        : [];
    if (tracks.length === 0) tracks = [...DEFAULT_TRACKS];

    const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4;
    const totalBeats  = beatsPerBar * bars;
    const root        = NOTE_NAMES[key] ?? 0;
    const scaleNotes  = (SCALE_INTERVALS[scale] || SCALE_INTERVALS.minor)
        .map(i => (root + i) % 12).join(',');
    const trackList   = tracks.map(t => `${TRACK_ABBR[t]}(${TRACK_INSTRUCTIONS[t]})`).join(' ');
    const trackSchema = tracks.map(t => `"${TRACK_ABBR[t]}":""`).join(',');
    const cleanPrompt = sanitizePrompt(p.prompt);
    const structural  = bars === 8
        ? `A(bars1-2)->A'(bars3-4)->B(bars5-6)->A''(bars7-8). Bars5-6: high contrast. LOOP_GAP: nothing after beat ${totalBeats - 0.25}.`
        : `Call(bars1-2)->Response(bars3-4). Resolve by beat ${totalBeats - 1}. LOOP_GAP: empty final 0.25 beats.`;

    return [
        `CFG:key=${key},scale=${scale},bpm=${bpm},style=${style},mood=${mood},time=${timeSig},bars=${bars},beats=${totalBeats},cmp=${cmp}`,
        cleanPrompt ? `CONTEXT:${cleanPrompt}` : '',
        `SCALE_NOTES:[${scaleNotes}]`,
        `TASK:Compose a loopable multitrack MIDI arrangement. Output ONLY valid JSON.`,
        `1.HARMONY:ONLY pitches from SCALE_NOTES. Bass NEVER above MIDI 52.`,
        `2.BREATHING:Melody MUST rest ≥1 beat per 2 bars.`,
        `3.COUNTERPOINT:Fast melody→slow chords. Busy bass→simple melody.`,
        `4.VELOCITY:Downbeats 7-9, offbeats 3-6, ghosts 1-2.`,
        `5.STRUCTURE:${structural}`,
        `TRACKS:${trackList}`,
        `FORMAT:pitch:beat:dur:vel|... (pitch=MIDI int, beat/dur=multiples of 0.25, vel=1-9)`,
        `RETURN ONLY:{"title":"","desc":"","tracks":{${trackSchema}}}`
    ].filter(Boolean).join('\n');
}

// ── MIDI file builder ─────────────────────────────────────────────────
function buildMidiFile(tracksJson, bpmValue) {
    const bpm          = Math.max(40, Math.min(300, bpmValue || 120));
    const ticksPerBeat = 480;
    // MIDI tempo = microseconds per beat
    const tempo        = Math.round(60_000_000 / bpm);

    // Variable-length encoding (MIDI delta times)
    function varLen(n) {
        const buf = [n & 0x7F];
        n >>= 7;
        while (n > 0) { buf.unshift((n & 0x7F) | 0x80); n >>= 7; }
        return buf;
    }
    const u32 = n => [(n>>24)&0xFF, (n>>16)&0xFF, (n>>8)&0xFF, n&0xFF];
    const u16 = n => [(n>>8)&0xFF, n&0xFF];

    // Channel assignment per abbreviated track name
    const CHAN = { bass:0, chd:1, mel:2, arp:3, lead:4, plk:5, str:6, keys:7, pad:8, brss:9, perc:10, gtr:11 };

    const allTracks = [];

    // Track 0: tempo map
    allTracks.push([
        0x00, 0xFF, 0x51, 0x03,
        (tempo>>16)&0xFF, (tempo>>8)&0xFF, tempo&0xFF,
        0x00, 0xFF, 0x2F, 0x00  // end of track
    ]);

    // Track N: one per instrument
    for (const [abbr, notesStr] of Object.entries(tracksJson)) {
        if (!notesStr || typeof notesStr !== 'string') continue;
        const ch = CHAN[abbr] ?? 0;

        // Parse note events
        const events = [];
        for (const raw of notesStr.split('|')) {
            const parts = raw.trim().split(':');
            if (parts.length < 4) continue;
            const pitch   = parseInt(parts[0]);
            const beatOn  = parseFloat(parts[1]);
            const beatDur = parseFloat(parts[2]);
            const velRaw  = parseInt(parts[3]);
            if (!Number.isFinite(pitch + beatOn + beatDur + velRaw)) continue;
            // Convert 1-9 velocity scale → MIDI 1-127
            const vel    = Math.max(1, Math.min(127, Math.round(velRaw / 9 * 127)));
            const tickOn = Math.round(beatOn * ticksPerBeat);
            const tickOff= Math.round((beatOn + beatDur) * ticksPerBeat);
            events.push({ tick: tickOn,  type: 'on',  pitch, vel, ch });
            events.push({ tick: tickOff, type: 'off', pitch, ch });
        }

        // Sort by tick; note-offs before note-ons at same tick (avoids stuck notes)
        events.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));

        const bytes = [];
        let lastTick = 0;
        for (const ev of events) {
            const delta = Math.max(0, ev.tick - lastTick);
            lastTick = ev.tick;
            bytes.push(...varLen(delta));
            if (ev.type === 'on') {
                bytes.push(0x90 | ev.ch, ev.pitch, ev.vel);
            } else {
                bytes.push(0x80 | ev.ch, ev.pitch, 0x00);
            }
        }
        bytes.push(0x00, 0xFF, 0x2F, 0x00); // end of track
        allTracks.push(bytes);
    }

    // Assemble Standard MIDI File (SMF format 1)
    const header = [
        0x4D,0x54,0x68,0x64,    // "MThd"
        ...u32(6),               // header chunk length always 6
        ...u16(1),               // format 1 = multiple synchronous tracks
        ...u16(allTracks.length),
        ...u16(ticksPerBeat)
    ];
    const body = allTracks.flatMap(t => [0x4D,0x54,0x72,0x6B, ...u32(t.length), ...t]); // "MTrk" + length + data

    return new Uint8Array([...header, ...body]);
}

// ── Main handler ──────────────────────────────────────────────────────
export default async function handler(req) {
    const reqUrl   = new URL(req.url);
    const wantMidi = reqUrl.searchParams.get('format') === 'midi';
    const reqId    = crypto.randomUUID().slice(0, 8);

    if (req.method === 'OPTIONS') return openCors(new Response(null, { status: 204 }));
    if (req.method !== 'POST')   return openCors(err('Method Not Allowed', 405));

    // ── Auth ─────────────────────────────────────────────────────────
    const apiKey = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim();
    if (!apiKey) return openCors(err('Missing Authorization header. Register at /api/v1/keys/register', 401));

    const auth = await validateAndUseKey(apiKey);
    if (!auth.valid) {
        const isLimit  = auth.reason?.includes('limit');
        const status   = isLimit ? 429 : 401;
        const resHeaders = { 'Content-Type': 'application/json' };
        if (isLimit) {
            // Retry-After: seconds until reset (helps clients back off correctly)
            const resetMs   = new Date(auth.resetAt).getTime();
            const retryAfter= Math.max(0, Math.ceil((resetMs - Date.now()) / 1000));
            resHeaders['Retry-After'] = String(retryAfter);
        }
        console.warn(`[midi/v1][${reqId}] auth_fail reason="${auth.reason}"`);
        return openCors(new Response(JSON.stringify({
            error: auth.reason, remaining: auth.remaining ?? null,
            ...(isLimit ? { resetAt: auth.resetAt } : {})
        }), { status, headers: resHeaders }));
    }

    // ── Idempotency ──────────────────────────────────────────────────
    // Clients can pass Idempotency-Key to avoid duplicate generations on retry
    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
        const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
        const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;
        if (kvUrl && kvToken) {
            const cached = await fetch(
                `${kvUrl}/get/${encodeURIComponent(`idempotent:${idempotencyKey}`)}`,
                { headers: { Authorization: `Bearer ${kvToken}` } }
            ).then(r => r.json());
            if (cached.result) {
                console.log(`[midi/v1][${reqId}] idempotency_hit key=${idempotencyKey}`);
                return openCors(new Response(JSON.parse(cached.result), {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain', 'X-Idempotency': 'hit', ...rateH(auth) }
                }));
            }
        }
    }

    // ── Parse & validate ─────────────────────────────────────────────
    let body;
    try { body = await req.json(); }
    catch { return openCors(err('Invalid JSON body', 400)); }

    const params = body.promptParams || body;
    const errors = validateParams(params);
    if (errors.length) {
        console.warn(`[midi/v1][${reqId}] validation_fail`, errors);
        return openCors(new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        }));
    }

    // ── Build prompt + call LLM ───────────────────────────────────────
    const prompt    = buildPrompt(params);
    const pollKey   = process.env.POLLINATIONS_GEN_KEY || '';
    const ctrl      = new AbortController();
    const timerId   = setTimeout(() => ctrl.abort(), 25_000);

    console.log(`[midi/v1][${reqId}] gen_start style=${params.style} bars=${params.bars} tracks=${params.trackTypes}`);

    try {
        const llmRes = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGeneratorAPI/1.1',
                ...(pollKey ? { Authorization: `Bearer ${pollKey}` } : {})
            },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: 'You are an expert MIDI composer. Output ONLY valid JSON — no markdown, no explanation.' },
                    { role: 'user',   content: prompt }
                ],
                model: 'midijourney', temperature: 0.75, max_tokens: 5000,
                stream: !wantMidi
            })
        });

        clearTimeout(timerId);

        if (!llmRes.ok) {
            console.error(`[midi/v1][${reqId}] llm_error status=${llmRes.status}`);
            return openCors(err(`Generation failed: ${llmRes.status}`, 502));
        }

        // ── MIDI binary mode ──────────────────────────────────────────
        if (wantMidi) {
            const jsonData = await llmRes.json();
            let content = (jsonData?.choices?.[0]?.message?.content || '').replace(/```json|```/g,'').trim();
            let parsed;
            try { parsed = JSON.parse(content); }
            catch {
                console.error(`[midi/v1][${reqId}] invalid_json_from_llm`);
                const retryAfter = 5;
                return openCors(new Response(JSON.stringify({ error: 'AI returned invalid JSON — retry' }), {
                    status: 502, headers: { 'Content-Type':'application/json', 'Retry-After': String(retryAfter) }
                }));
            }
            const bpmVal = parseInt(params.bpm) || 120;
            const buf    = buildMidiFile(parsed.tracks || {}, bpmVal);
            const title  = (parsed.title || 'composition').replace(/[^a-z0-9\-_]/gi, '_');
            console.log(`[midi/v1][${reqId}] gen_ok format=midi title="${title}"`);
            return openCors(new Response(buf, {
                status: 200,
                headers: {
                    ...rateH(auth),
                    'Content-Type':        'audio/midi',
                    'Content-Disposition': `attachment; filename="${title}.mid"`,
                }
            }));
        }

        // ── JSON streaming mode ───────────────────────────────────────
        const isSSE = (llmRes.headers.get('content-type') || '').includes('text/event-stream');
        const streamHeaders = { ...rateH(auth), 'Content-Type':'text/plain;charset=utf-8', 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no' };

        if (isSSE) {
            let buf = '';
            let fullText = '';
            const { readable, writable } = new TransformStream({
                transform(chunk, ctrl) {
                    buf += new TextDecoder().decode(chunk);
                    const lines = buf.split('\n');
                    buf = lines.pop();
                    for (const line of lines) {
                        if (!line.trim().startsWith('data:')) continue;
                        const data = line.trim().slice(5).trim();
                        if (data === '[DONE]') return;
                        try {
                            const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
                            if (delta) { ctrl.enqueue(new TextEncoder().encode(delta)); fullText += delta; }
                        } catch { /* partial SSE frame */ }
                    }
                }
            });
            llmRes.body.pipeTo(writable).then(() => {
                // Store idempotency result
                if (idempotencyKey && fullText) {
                    const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
                    const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;
                    if (kvUrl && kvToken) {
                        fetch(`${kvUrl}/set/${encodeURIComponent(`idempotent:${idempotencyKey}`)}/${encodeURIComponent(JSON.stringify(fullText))}/ex/86400`, {
                            headers: { Authorization: `Bearer ${kvToken}` }
                        }).catch(() => {});
                    }
                }
                console.log(`[midi/v1][${reqId}] gen_ok format=json streaming=true`);
            }).catch(() => {});
            return new Response(readable, { status: 200, headers: streamHeaders });
        }

        const json    = await llmRes.json();
        const content = json?.choices?.[0]?.message?.content || '';
        console.log(`[midi/v1][${reqId}] gen_ok format=json streaming=false`);
        return new Response(content, { status: 200, headers: streamHeaders });

    } catch (e) {
        clearTimeout(timerId);
        if (e.name === 'AbortError') {
            console.error(`[midi/v1][${reqId}] timeout`);
            return openCors(new Response(JSON.stringify({ error: 'Generation timed out. Try fewer bars or tracks.' }), {
                status: 504, headers: { 'Content-Type':'application/json', 'Retry-After': '10' }
            }));
        }
        console.error(`[midi/v1][${reqId}] fatal`, e.message);
        return openCors(err(e.message, 500));
    }
}

const rateH = auth => ({
    'X-RateLimit-Remaining': String(auth.remaining),
    'X-RateLimit-Reset':     auth.resetAt,
    'X-RateLimit-Limit':     String(auth.meta.monthlyLimit),
    'Access-Control-Allow-Origin': '*',
});

function err(msg, status) {
    return new Response(JSON.stringify({ error: msg }), {
        status, headers: { 'Content-Type': 'application/json' }
    });
}
function openCors(res) {
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin',  '*');
    h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    return new Response(res.body, { status: res.status, headers: h });
}
