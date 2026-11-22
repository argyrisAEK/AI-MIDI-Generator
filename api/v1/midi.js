/**
 * api/v1/midi.js
 * POST /api/v1/midi             → streaming JSON
 * POST /api/v1/midi?format=midi → binary .mid file
 */

// ── Inlined key management ────────────────────────────────────────────
const FREE_MONTHLY_LIMIT = 50;

async function hashKey(plainKey) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plainKey));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return 'mgk_' + Array.from(bytes).map(b => chars[b % chars.length]).join('');
}
const kv = {
    async get(key) {
        const { url, token } = kvCreds();
        if (!url) return null;
        const res = await fetch(`${url}/get/${enc(key)}`, { headers: kvAuth(token) });
        const d   = await res.json();
        return d.result ? JSON.parse(d.result) : null;
    },
    async set(key, value, exSeconds) {
        const { url, token } = kvCreds();
        if (!url) return;
        const ex = exSeconds ? `/ex/${exSeconds}` : '';
        await fetch(`${url}/set/${enc(key)}/${enc(JSON.stringify(value))}${ex}`, { headers: kvAuth(token) });
    },
    async incr(key) {
        const { url, token } = kvCreds();
        if (!url) return 1;
        const res = await fetch(`${url}/incr/${enc(key)}`, { headers: kvAuth(token) });
        const d   = await res.json();
        return d.result || 1;
    },
    async expire(key, seconds) {
        const { url, token } = kvCreds();
        if (!url) return;
        await fetch(`${url}/expire/${enc(key)}/${seconds}`, { headers: kvAuth(token) });
    }
};
function kvCreds() {
    return { url: process.env.UPSTASH_REDIS_REST_URL || '', token: process.env.UPSTASH_REDIS_REST_TOKEN || '' };
}
const enc    = encodeURIComponent;
const kvAuth = (t) => ({ Authorization: `Bearer ${t}` });

function usagePeriod(keyHash) {
    const now   = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return {
        usageKey: `apikey:usage:${keyHash}:${month}`,
        resetAt:  new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
    };
}
async function validateAndUseKey(plainKey) {
    if (!plainKey?.startsWith('mgk_')) return { valid: false, reason: 'Invalid key format — keys start with mgk_' };
    const keyHash = await hashKey(plainKey);
    const meta    = await kv.get(`apikey:hash:${keyHash}`);
    if (!meta)        return { valid: false, reason: 'API key not found' };
    if (!meta.active) return { valid: false, reason: 'API key deactivated' };
    const { usageKey, resetAt } = usagePeriod(keyHash);
    const count = await kv.incr(usageKey);
    if (count === 1) await kv.expire(usageKey, 2764800);
    const limit = meta.monthlyLimit ?? FREE_MONTHLY_LIMIT;
    if (count > limit) return { valid: false, reason: `Monthly limit of ${limit} calls reached`, remaining: 0, resetAt };
    meta.lastUsedAt = new Date().toISOString();
    await kv.set(`apikey:hash:${keyHash}`, meta, 86400 * 730);
    return { valid: true, meta, used: count, remaining: limit - count, resetAt };
}

// ── Constants ─────────────────────────────────────────────────────────
const SCALE_INTERVALS = {
    major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10],
    aeolian:[0,2,3,5,7,8,10], dorian:[0,2,3,5,7,9,10],
    phrygian:[0,1,3,5,7,8,10], pentatonic:[0,2,4,7,9],
    blues:[0,3,5,6,7,10],
};
const NOTE_NAMES = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
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

// ── Text prompt parser ────────────────────────────────────────────────
// Extracts musical params from free-text when structured fields are absent.
// e.g. "dark techno at 132 BPM in F minor, 8 bars, bassline and pads"
function parseTextPrompt(text) {
    if (!text || typeof text !== 'string') return {};
    const t = text.toLowerCase();
    const out = {};

    // BPM — "at 132 bpm", "132bpm", "132 bpm"
    const bpmMatch = t.match(/\b(\d{2,3})\s*bpm\b/);
    if (bpmMatch) out.bpm = parseInt(bpmMatch[1]);

    // Bars — "8 bars", "4-bar", "4 bar loop"
    const barMatch = t.match(/\b(\d{1,2})\s*-?\s*bar/);
    if (barMatch) out.bars = parseInt(barMatch[1]);

    // Key + scale — "F minor", "A# major", "G dorian", "Bb phrygian"
    const keyMatch = text.match(/\b([A-G][#b]?)\s*(major|minor|dorian|phrygian|aeolian|lydian|mixolydian|pentatonic|blues)\b/i);
    if (keyMatch) {
        // Normalize key: 'f' -> 'F', 'bb' -> 'Bb'
        const raw = keyMatch[1];
        out.key   = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase().replace('b', 'b').replace('#', '#');
        out.scale = keyMatch[2].toLowerCase();
    } else {
        // Try key without scale — "in F", "key of C"
        const keyOnly = text.match(/\b(?:in|key of)\s+([A-G][#b]?)\b/i);
        if (keyOnly) out.key = keyOnly[1].charAt(0).toUpperCase() + keyOnly[1].slice(1);
    }

    // Style/genre
    const styleMap = {
        'techno':1, 'house':1, 'trance':1, 'hip-hop':1, 'hiphop':1, 'jazz':1,
        'cinematic':1, 'ambient':1, 'rock':1, 'synthwave':1, 'disco':1,
        'afrobeats':1, 'pop':1, 'latin':1, 'drum and bass':1, 'drum-and-bass':1, 'dnb':1
    };
    const styleAlias = { 'hiphop': 'hip-hop', 'dnb': 'drum-and-bass', 'drum and bass': 'drum-and-bass' };
    for (const [word, _] of Object.entries(styleMap)) {
        if (t.includes(word)) { out.style = styleAlias[word] || word; break; }
    }

    // Mood
    const moods = ['dark','dreamy','uplifting','mysterious','groovy','energetic','melancholic','peaceful','aggressive','romantic'];
    for (const m of moods) { if (t.includes(m)) { out.mood = m; break; } }

    // Complexity
    if (t.includes('simple') || t.includes('minimal') || t.includes('sparse')) out.complexity = 'simple';
    else if (t.includes('complex') || t.includes('intricate') || t.includes('dense')) out.complexity = 'complex';

    // Track types mentioned
    const trackKeywords = {
        'bass':         'bassline', 'bassline': 'bassline',
        'chord':        'chord',    'chords':   'chord',
        'melody':       'melody',   'melodic':  'melody',
        'arpeggio':     'arpeggio', 'arpeggios':'arpeggio', 'arp': 'arpeggio',
        'lead':         'lead',
        'pluck':        'plucks',   'plucks':   'plucks',
        'strings':      'strings',  'string':   'strings',
        'keys':         'keys',     'piano':    'keys',     'electric piano':'keys',
        'pad':          'pad-textures', 'pads': 'pad-textures', 'texture':'pad-textures',
        'brass':        'brass',    'horn':     'brass',
        'percussion':   'percs',    'percs':    'percs',    'drums':'percs',
        'guitar':       'guitar',
    };
    const foundTracks = new Set();
    for (const [kw, track] of Object.entries(trackKeywords)) {
        if (t.includes(kw)) foundTracks.add(track);
    }
    if (foundTracks.size > 0) out.trackTypes = [...foundTracks].slice(0, 6);

    return out;
}


function sanitizePrompt(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.replace(/<[^>]*>/g, '').replace(/[^\w\s.,\-'!?:()]/g, '').trim().slice(0, 300);
}
function validateParams(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return ['promptParams must be a JSON object'];
    if (p.bpm !== undefined) {
        const v = Number(p.bpm);
        if (!Number.isFinite(v) || v < 40 || v > 220) errors.push('bpm must be 40–220');
    }
    if (p.bars !== undefined) {
        const v = Number(p.bars);
        if (!Number.isInteger(v) || v < 1 || v > 16) errors.push('bars must be an integer 1–16');
    }
    if (p.scale && !SCALE_INTERVALS[p.scale]) errors.push(`scale must be one of: ${Object.keys(SCALE_INTERVALS).join(', ')}`);
    if (p.key   && !Object.hasOwn(NOTE_NAMES, p.key)) errors.push(`key must be one of: ${Object.keys(NOTE_NAMES).join(', ')}`);
    if (p.style && !VALID_STYLES.includes(p.style))   errors.push(`style must be one of: ${VALID_STYLES.join(', ')}`);
    if (p.mood  && !VALID_MOODS.includes(p.mood))     errors.push(`mood must be one of: ${VALID_MOODS.join(', ')}`);
    if (p.timeSignature && !VALID_TIMESIG.includes(p.timeSignature)) errors.push(`timeSignature must be one of: ${VALID_TIMESIG.join(', ')}`);
    if (p.complexity && !['simple','moderate','complex'].includes(p.complexity)) errors.push('complexity must be simple, moderate, or complex');
    if (p.trackTypes !== undefined) {
        if (!Array.isArray(p.trackTypes)) { errors.push('trackTypes must be an array'); }
        else {
            if (p.trackTypes.length > 6) errors.push('Maximum 6 trackTypes');
            const bad = p.trackTypes.filter(t => !VALID_TRACKS.includes(t));
            if (bad.length) errors.push(`Unknown trackTypes: ${bad.join(', ')}`);
        }
    }
    if (p.prompt && p.prompt.length > 500) errors.push('prompt must be under 500 characters');
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
    let tracks = Array.isArray(p.trackTypes) ? p.trackTypes.filter(t => VALID_TRACKS.includes(t)) : [];
    if (tracks.length === 0) tracks = [...DEFAULT_TRACKS];
    const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4;
    const totalBeats  = beatsPerBar * bars;
    const root        = NOTE_NAMES[key] ?? 0;
    const scaleNotes  = (SCALE_INTERVALS[scale] || SCALE_INTERVALS.minor).map(i => (root + i) % 12).join(',');
    const trackList   = tracks.map(t => `${TRACK_ABBR[t]}(${TRACK_INSTRUCTIONS[t]})`).join(' ');
    const trackSchema = tracks.map(t => `"${TRACK_ABBR[t]}":""`).join(',');
    const cleanPrompt = sanitizePrompt(p.prompt);
    const structural  = bars === 8
        ? `A(bars1-2)->A'(bars3-4)->B(bars5-6)->A''(bars7-8). Bars5-6:high contrast. LOOP_GAP:nothing after beat ${totalBeats - 0.25}.`
        : `Call(bars1-2)->Response(bars3-4). Resolve by beat ${totalBeats - 1}. LOOP_GAP:empty final 0.25 beats.`;
    return [
        `CFG:key=${key},scale=${scale},bpm=${bpm},style=${style},mood=${mood},time=${timeSig},bars=${bars},beats=${totalBeats},cmp=${cmp}`,
        cleanPrompt ? `CONTEXT:${cleanPrompt}` : '',
        `SCALE_NOTES:[${scaleNotes}] TASK:Compose a loopable multitrack MIDI arrangement. Output ONLY valid JSON.`,
        `1.HARMONY:ONLY pitches from SCALE_NOTES. Bass NEVER above MIDI 52.`,
        `2.BREATHING:Melody MUST rest >=1 beat per 2 bars.`,
        `3.COUNTERPOINT:Fast melody->slow chords. Busy bass->simple melody.`,
        `4.VELOCITY:Downbeats 7-9, offbeats 3-6, ghosts 1-2.`,
        `5.STRUCTURE:${structural}`,
        `TRACKS:${trackList}`,
        `FORMAT:pitch:beat:dur:vel|... (pitch=MIDI int, beat/dur=multiples of 0.25, vel=1-9)`,
        `RETURN ONLY:{"title":"","desc":"","tracks":{${trackSchema}}}`
    ].filter(Boolean).join('\n');
}

// ── MIDI binary builder ────────────────────────────────────────────────
function buildMidiFile(tracksJson, bpmValue) {
    const bpm          = Math.max(40, Math.min(300, bpmValue || 120));
    const ticksPerBeat = 480;
    const tempo        = Math.round(60_000_000 / bpm); // µs per beat
    function varLen(n) {
        const buf = [n & 0x7F]; n >>= 7;
        while (n > 0) { buf.unshift((n & 0x7F) | 0x80); n >>= 7; }
        return buf;
    }
    const u32 = n => [(n>>24)&0xFF,(n>>16)&0xFF,(n>>8)&0xFF,n&0xFF];
    const u16 = n => [(n>>8)&0xFF,n&0xFF];
    const CHAN = { bass:0,chd:1,mel:2,arp:3,lead:4,plk:5,str:6,keys:7,pad:8,brss:9,perc:10,gtr:11 };
    const allTracks = [];
    // Track 0: tempo
    allTracks.push([0x00,0xFF,0x51,0x03,(tempo>>16)&0xFF,(tempo>>8)&0xFF,tempo&0xFF,0x00,0xFF,0x2F,0x00]);
    for (const [abbr, notesStr] of Object.entries(tracksJson)) {
        if (!notesStr || typeof notesStr !== 'string') continue;
        const ch = CHAN[abbr] ?? 0;
        const events = [];
        for (const raw of notesStr.split('|')) {
            const parts = raw.trim().split(':');
            if (parts.length < 4) continue;
            const pitch = parseInt(parts[0]), beatOn = parseFloat(parts[1]),
                  beatDur = parseFloat(parts[2]), velRaw = parseInt(parts[3]);
            if (!Number.isFinite(pitch + beatOn + beatDur + velRaw)) continue;
            const vel = Math.max(1, Math.min(127, Math.round(velRaw / 9 * 127)));
            events.push({ tick: Math.round(beatOn * ticksPerBeat),  type:'on',  pitch, vel, ch });
            events.push({ tick: Math.round((beatOn + beatDur) * ticksPerBeat), type:'off', pitch, ch });
        }
        events.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));
        const bytes = []; let lastTick = 0;
        for (const ev of events) {
            const delta = Math.max(0, ev.tick - lastTick); lastTick = ev.tick;
            bytes.push(...varLen(delta));
            bytes.push(ev.type === 'on' ? (0x90 | ev.ch) : (0x80 | ev.ch), ev.pitch, ev.type === 'on' ? ev.vel : 0);
        }
        bytes.push(0x00,0xFF,0x2F,0x00);
        allTracks.push(bytes);
    }
    const header = [0x4D,0x54,0x68,0x64,...u32(6),...u16(1),...u16(allTracks.length),...u16(ticksPerBeat)];
    const body   = allTracks.flatMap(t => [0x4D,0x54,0x72,0x6B,...u32(t.length),...t]);
    return new Uint8Array([...header, ...body]);
}

// ── Main handler ───────────────────────────────────────────────────────
export const config = { runtime: 'edge' };

export default async function handler(req) {
    const reqUrl   = new URL(req.url);
    const wantMidi = reqUrl.searchParams.get('format') === 'midi';
    const reqId    = crypto.randomUUID().slice(0, 8);

    if (req.method === 'OPTIONS') return openCors(new Response(null, { status: 204 }));
    if (req.method !== 'POST')   return openCors(jsonErr('Method Not Allowed', 405));

    const apiKey = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!apiKey) return openCors(jsonErr('Missing Authorization header. Register at /api/keys/register', 401));

    // Require BYOP before consuming the platform API request quota.
    const pollKey = (req.headers.get('x-pollinations-key') || '').trim();
    if (!pollKey || pollKey.length > 4096) {
        return openCors(jsonErr('Missing or invalid X-Pollinations-Key header. Provide your own Pollinations API key.', 400));
    }

    const auth = await validateAndUseKey(apiKey);
    if (!auth.valid) {
        const isLimit = auth.reason?.includes('limit');
        const status  = isLimit ? 429 : 401;
        const resH    = { 'Content-Type': 'application/json' };
        if (isLimit) resH['Retry-After'] = String(Math.max(0, Math.ceil((new Date(auth.resetAt) - Date.now()) / 1000)));
        console.warn(`[midi/v1][${reqId}] auth_fail reason="${auth.reason}"`);
        return openCors(new Response(JSON.stringify({ error: auth.reason, remaining: auth.remaining ?? null, ...(isLimit ? { resetAt: auth.resetAt } : {}) }), { status, headers: resH }));
    }

    let body;
    try { body = await req.json(); }
    catch { return openCors(jsonErr('Invalid JSON body', 400)); }

    const raw = body.promptParams || body;

    // ── Text-prompt mode ─────────────────────────────────────────────
    // If caller sends only { prompt: "dark techno 132bpm F minor..." },
    // extract params from the text and merge with any explicit fields.
    let params = { ...raw };
    if (raw.prompt && typeof raw.prompt === 'string') {
        const extracted = parseTextPrompt(raw.prompt);
        // Explicit fields win over extracted ones
        params = { ...extracted, ...raw };
        console.log(`[midi/v1][${reqId}] text_mode extracted=`, JSON.stringify(extracted));
    }

    const errors = validateParams(params);
    if (errors.length) {
        console.warn(`[midi/v1][${reqId}] validation_fail`, errors);
        return openCors(new Response(JSON.stringify({ error: 'Validation failed', details: errors }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    }

    const prompt = buildPrompt(params);
    const ctrl      = new AbortController();
    const timerId   = setTimeout(() => ctrl.abort(), 25_000);
    const rateH     = { 'X-RateLimit-Remaining': String(auth.remaining), 'X-RateLimit-Reset': auth.resetAt, 'X-RateLimit-Limit': String(auth.meta.monthlyLimit) };

    console.log(`[midi/v1][${reqId}] gen_start style=${params.style} bars=${params.bars}`);

    try {
        const llmRes = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST', signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'MIDIGeneratorAPI/1.1', ...(pollKey ? { Authorization: `Bearer ${pollKey}` } : {}) },
            body: JSON.stringify({ messages: [
                { role: 'system', content: 'You are an expert MIDI composer. Output ONLY valid JSON — no markdown, no explanation.' },
                { role: 'user',   content: prompt }
            ], model: 'midijourney', temperature: 0.75, max_tokens: 5000, stream: !wantMidi })
        });

        clearTimeout(timerId);
        if (!llmRes.ok) {
            const upstreamStatus = llmRes.status;
            console.error(`[midi/v1][${reqId}] llm_error=${upstreamStatus}`);
            const mappedStatus = [401, 403, 402, 429].includes(upstreamStatus) ? upstreamStatus : 502;
            const messages = {
                401: 'Pollinations rejected your API key. Check that X-Pollinations-Key contains a valid key.',
                403: 'Your Pollinations API key does not have permission to use this model or endpoint.',
                402: 'Pollinations reports insufficient balance or payment is required. Check your Pollen balance.',
                429: 'Pollinations rate limit reached. Wait before retrying.'
            };
            return openCors(jsonErr(messages[upstreamStatus] || 'Pollinations generation service failed. Please retry later.', mappedStatus));
        }

        if (wantMidi) {
            const jsonData = await llmRes.json();
            let content = (jsonData?.choices?.[0]?.message?.content || '').replace(/```json|```/g,'').trim();
            let parsed;
            try { parsed = JSON.parse(content); } catch {
                return openCors(new Response(JSON.stringify({ error: 'AI returned invalid JSON — retry' }), { status: 502, headers: { 'Content-Type':'application/json','Retry-After':'5' } }));
            }
            const buf   = buildMidiFile(parsed.tracks || {}, parseInt(params.bpm) || 120);
            const title = (parsed.title || 'composition').replace(/[^a-z0-9\-_]/gi, '_');
            console.log(`[midi/v1][${reqId}] gen_ok format=midi title="${title}"`);
            return openCors(new Response(buf, { status: 200, headers: { ...rateH, 'Content-Type':'audio/midi', 'Content-Disposition':`attachment; filename="${title}.mid"`, 'Access-Control-Allow-Origin':'*' } }));
        }

        const isSSE = (llmRes.headers.get('content-type') || '').includes('text/event-stream');
        const streamH = { ...rateH, 'Content-Type':'text/plain;charset=utf-8', 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no', 'Access-Control-Allow-Origin':'*' };

        if (isSSE) {
            let buf = '';
            const { readable, writable } = new TransformStream({
                transform(chunk, ctrl) {
                    buf += new TextDecoder().decode(chunk);
                    const lines = buf.split('\n'); buf = lines.pop();
                    for (const line of lines) {
                        if (!line.trim().startsWith('data:')) continue;
                        const data = line.trim().slice(5).trim();
                        if (data === '[DONE]') return;
                        try { const d = JSON.parse(data)?.choices?.[0]?.delta?.content; if (d) ctrl.enqueue(new TextEncoder().encode(d)); } catch { /* partial */ }
                    }
                }
            });
            llmRes.body.pipeTo(writable).then(() => console.log(`[midi/v1][${reqId}] gen_ok format=json`)).catch(() => {});
            return new Response(readable, { status: 200, headers: streamH });
        }

        const json    = await llmRes.json();
        const content = json?.choices?.[0]?.message?.content || '';
        console.log(`[midi/v1][${reqId}] gen_ok format=json non-stream`);
        return new Response(content, { status: 200, headers: streamH });

    } catch (e) {
        clearTimeout(timerId);
        if (e.name === 'AbortError') {
            return openCors(new Response(JSON.stringify({ error: 'Generation timed out. Try fewer bars or tracks.' }), { status: 504, headers: { 'Content-Type':'application/json','Retry-After':'10' } }));
        }
        console.error(`[midi/v1][${reqId}] fatal`, e.message);
        return openCors(jsonErr(e.message, 500));
    }
}

function jsonErr(msg, status = 400) {
    return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
function openCors(res) {
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Pollinations-Key, Idempotency-Key');
    return new Response(res.body, { status: res.status, headers: h });
}
