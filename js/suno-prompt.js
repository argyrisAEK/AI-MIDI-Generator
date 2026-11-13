// ─────────────────────────────────────────────────────────────────────────────
// Suno Prompt Studio
// Turns the generated MIDI (+ optional rendered WAV) and the app metadata into
// ready-to-paste Suno fields: Title, Style of music, Exclude styles, Tags, Lyrics.
//
//  • analyzeMidi()        – note statistics, per-track feel, chord progression
//  • analyzeAudioBuffer() – loudness, brightness, low-end share, stereo width (WAV/MP3)
//  • buildLocalPrompt()   – free, instant, deterministic builder (no API call)
//  • SunoStudio           – modal UI; optional "Generate with AI" via /api/suno (Pollinations Pay)
// ─────────────────────────────────────────────────────────────────────────────
import { getByopKey } from './byop-session.js';

const SUNO_CREATE_URL = 'https://suno.com/create';
const AI_FALLBACK_MODELS = ['openai/gpt-6-luna', 'community/vendouple/gemini-3.8-flash'];
const CATALOG_URL = 'https://gen.pollinations.ai/text/models';

// Curated shortlist (edit freely). Anything else the live Pollinations catalog offers is added under "More models".
const SUNO_MODEL_GROUPS = [
    { label: 'Standard', pro: false, models: [
        ['openai/gpt-6-luna', 'GPT-6 Luna (default)'],
        ['google/gemini-3.8-flash', 'Gemini 3.8 Flash'],
        ['deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'],
        ['qwen/qwen3.8-flash', 'Qwen 3.8 Flash'],
        ['z-ai/glm-5.3-flash', 'GLM 5.3 Flash']
    ] },
    { label: 'Pro · higher quality, more Pollen', pro: true, models: [
        ['anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5'],
        ['anthropic/claude-opus-5.5', 'Claude Opus 5.5'],
        ['google/gemini-4-argon', 'Gemini 4 Argon'],
        ['openai/gpt-6-sol', 'GPT-6 Sol'],
        ['x-ai/grok-4.7', 'Grok 4.7'],
        ['moonshotai/kimi-k3.1-pro', 'Kimi K3.1 Pro']
    ] }
];
// Models that are not meant for writing text prompts
const CATALOG_EXCLUDE = /midijourney|guard|decision|audio|realtime|transcribe|embed|tts|vision|vl\b|search|stealth|perplexity|jev|systemone/i;
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ═════════════════════════════════════════════════════════════════════════════
// Small helpers
// ═════════════════════════════════════════════════════════════════════════════
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const round = (n, d = 1) => { const f = 10 ** d; return Math.round(n * f) / f; };
const median = (sorted) => (sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function beatsPerBarOf(timeSignature) {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(timeSignature || '4/4');
    return m ? Number(m[1]) * (4 / Number(m[2])) : 4;
}

function formatKey(rawKey, rawScale) {
    let root = String(rawKey || '').trim();
    let scale = String(rawScale || '').trim().toLowerCase();
    const m = /^([A-Ga-g][#b♯♭]?)(m|min|minor)?$/.exec(root);
    if (m) {
        root = m[1][0].toUpperCase() + m[1].slice(1);
        if (m[2] && !scale) scale = 'minor';
    }
    if (!root) return '';
    return scale ? `${root} ${scale}` : root;
}

/** Fit comma-separated parts into a character limit, dropping the least important (last) parts first. */
export function fitParts(parts, limit) {
    const out = [];
    let len = 0;
    for (const p of parts.filter(Boolean)) {
        const add = (out.length ? 2 : 0) + p.length;
        if (len + add > limit) continue;
        out.push(p);
        len += add;
    }
    return out.join(', ');
}

// The uploaded MIDI/sample is the musical foundation by default, not automatically the intro.
export function detectSampleRole(text) {
    const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!t.trim()) return 'base';
    if (/(?:do not|don't|never|not)\s+(?:use|make|play|start)[^.\n]{0,70}(?:sample|loop|riff|midi|clip)[^.\n]{0,35}intro|(?:μη|χωρις)[^.\n]{0,65}(?:sample|δειγμα|loop|riff|midi)[^.\n]{0,35}(?:intro|εισαγωγ)/.test(t)) return 'base';
    if (/\b(?:use|make|put|play|start)\b[^.\n]{0,55}\b(?:sample|loop|riff|midi|clip|this)\b[^.\n]{0,35}\b(?:as|for)\s+(?:the\s+|an?\s+|my\s+)?intro\b|\b(?:sample|loop|riff|midi|clip)\b[^.\n]{0,45}\b(?:is|will be|should be)\s+(?:the\s+)?intro\b|(?:ως|για|χρησιμοποιησε|χρησιμοποιησω|βαλε|παιξε)[^.\n]{0,55}(?:sample|δειγμα|loop|riff|midi)[^.\n]{0,40}(?:intro|εισαγωγ)/.test(t)) return 'intro';
    const m = /(?:this|sample|loop|riff|midi|it|clip)\b[^.\n]{0,50}?\b(?:as|for|is|be|will be|should be)\s+(?:the\s+|an?\s+|my\s+)?(drop|chorus|verse|bridge|outro)\b/.exec(t);
    return m ? m[1] : 'base';
}
// ═════════════════════════════════════════════════════════════════════════════
// Gather everything the app knows about the current composition
// ═════════════════════════════════════════════════════════════════════════════
export function collectSource(app) {
    const ctx = app.musicalContextManager?.getContext?.() || {};
    const val = (id) => document.getElementById(id)?.value || '';

    const tracks = [];
    app.generatedTracks?.forEach?.((data, type) => {
        const notes = data?.midi?.tracks?.[0]?.notes || [];
        if (notes.length) {
            tracks.push({
                type,
                notes: notes.map(n => ({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity }))
            });
        }
    });

    return {
        title: (app.compositionTitle || '').trim(),
        description: (app.compositionDescription || '').trim(),
        userPrompt: (app.lastUserPrompt || val('text-prompt') || '').trim(),
        enhancedPrompt: (app.lastEnhancedPrompt || ctx.enhancedPrompt || '').trim(),
        sampleRole: detectSampleRole(app.lastUserPrompt || val('text-prompt') || ''),
        bpm: Number(ctx.tempo) || Number(val('bpm')) || 120,
        style: String(ctx.style || val('style') || '').trim(),
        mood: String(ctx.mood || val('mood') || '').trim(),
        key: formatKey(ctx.key || val('key'), ctx.scale || val('scale-type')),
        timeSignature: ctx.timeSignature || val('time-signature') || '4/4',
        tracks
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// MIDI analysis
// ═════════════════════════════════════════════════════════════════════════════
const HARMONIC_PRIORITY = ['chord', 'keys', 'strings', 'pad-textures', 'plucks', 'guitar'];
const TRIADS = [
    { suffix: '', iv: [0, 4, 7] },
    { suffix: 'm', iv: [0, 3, 7] },
    { suffix: 'dim', iv: [0, 3, 6] },
    { suffix: 'sus4', iv: [0, 5, 7] }
];

function detectChords(source, bpbar) {
    const spb = 60 / source.bpm;
    const harmonic = HARMONIC_PRIORITY.map(t => source.tracks.find(x => x.type === t)).find(Boolean);
    if (!harmonic) return null;
    const bass = source.tracks.find(t => t.type === 'bassline');

    let endBeat = 0;
    for (const t of source.tracks) for (const n of t.notes) endBeat = Math.max(endBeat, (n.time + n.duration) / spb);
    const bars = clamp(Math.ceil(endBeat / bpbar - 0.01), 1, 16);

    const seq = [];
    for (let b = 0; b < bars; b++) {
        const from = b * bpbar, to = from + bpbar;
        const w = new Array(12).fill(0);
        const add = (notes, gain) => {
            for (const n of notes) {
                const s = n.time / spb, e = s + n.duration / spb;
                const overlap = Math.min(e, to) - Math.max(s, from);
                if (overlap > 0) w[n.midi % 12] += overlap * (0.3 + n.velocity) * gain;
            }
        };
        add(harmonic.notes, 1);
        if (bass) add(bass.notes, 0.6);
        if (w.reduce((a, c) => a + c, 0) < 0.05) continue;

        let best = null;
        for (let r = 0; r < 12; r++) {
            for (const t of TRIADS) {
                const tones = t.iv.map(i => (r + i) % 12);
                const inside = tones.reduce((a, pc) => a + w[pc], 0);
                const total = w.reduce((a, c) => a + c, 0);
                const score = inside - 0.5 * (total - inside) + (w[r] * 0.15);
                if (!best || score > best.score) best = { score, name: PC_NAMES[r] + t.suffix };
            }
        }
        seq.push(best.name);
    }

    // collapse consecutive duplicates, then a repeating cycle (Em C G D Em C G D → Em C G D)
    let comp = seq.filter((c, i) => i === 0 || c !== seq[i - 1]);
    for (let p = 1; p <= Math.floor(comp.length / 2); p++) {
        if (comp.length % p === 0 && comp.every((c, i) => c === comp[i % p])) { comp = comp.slice(0, p); break; }
    }
    comp = comp.slice(0, 8);
    return comp.length ? { progression: comp, text: comp.join(' – ') } : null;
}

const TRACK_ORDER = ['bassline', 'lead', 'melody', 'arpeggio', 'chord', 'keys', 'plucks', 'pad-textures', 'strings', 'brass', 'guitar', 'percs'];

function trackDescriptor(type, st) {
    const sync = st.syncopation > 0.55;
    switch (type) {
        case 'bassline':
            if (st.median < 42) return st.density < 0.9 ? 'deep pulsing sub bass' : 'rolling sub bass';
            return sync ? 'syncopated bassline' : (st.density < 0.9 ? 'warm bassline' : 'driving bassline');
        case 'chord': return st.avgDurBeats < 0.75 ? 'punchy chord stabs' : 'lush sustained chords';
        case 'melody': return st.median > 76 ? 'bright expressive melody' : 'emotive melody';
        case 'arpeggio': return st.density >= 1.5 ? (st.median > 70 ? 'glassy fast arpeggios' : 'rolling fast arpeggios') : 'flowing arpeggios';
        case 'lead': return 'soaring synth lead';
        case 'plucks': return 'crisp plucked synths';
        case 'strings': return 'cinematic strings';
        case 'keys': return sync ? 'soulful syncopated keys' : 'warm keys';
        case 'guitar': return 'clean guitar';
        case 'pad-textures': return 'evolving ambient pads';
        case 'brass': return 'punchy brass stabs';
        case 'percs': return 'tight percussion';
        default: return type;
    }
}

export function analyzeMidi(source) {
    const spb = 60 / source.bpm;
    const bpbar = beatsPerBarOf(source.timeSignature);
    let endBeat = 0;
    for (const t of source.tracks) for (const n of t.notes) endBeat = Math.max(endBeat, (n.time + n.duration) / spb);
    endBeat = Math.max(endBeat, bpbar);

    const tracks = source.tracks.map(({ type, notes }) => {
        const starts = notes.map(n => n.time / spb);
        const pitches = notes.map(n => n.midi).sort((a, b) => a - b);
        const vels = notes.map(n => n.velocity);
        const avgVel = vels.reduce((a, c) => a + c, 0) / vels.length;
        const velSpread = Math.sqrt(vels.reduce((a, c) => a + (c - avgVel) ** 2, 0) / vels.length);

        let offW = 0, allW = 0;
        for (let i = 0; i < starts.length; i++) {
            const frac = starts[i] - Math.floor(starts[i] + 1e-6);
            allW += vels[i];
            if (Math.min(frac, 1 - frac) > 0.12) offW += vels[i];
        }

        const groups = new Map();
        for (const s of starts) { const k = Math.round(s * 20); groups.set(k, (groups.get(k) || 0) + 1); }

        const st = {
            type,
            count: notes.length,
            density: round(notes.length / endBeat, 2),
            avgDurBeats: round(notes.reduce((a, n) => a + n.duration / spb, 0) / notes.length, 2),
            avgVel: round(avgVel, 2),
            velSpread: round(velSpread, 2),
            low: pitches[0],
            high: pitches[pitches.length - 1],
            median: median(pitches),
            syncopation: round(allW ? offW / allW : 0, 2),
            polyphony: round(notes.length / groups.size, 1)
        };
        st.descriptor = trackDescriptor(type, st);
        return st;
    }).sort((a, b) => TRACK_ORDER.indexOf(a.type) - TRACK_ORDER.indexOf(b.type));

    const melodicDensity = tracks.filter(t => t.type !== 'percs').reduce((a, t) => a + t.density, 0);
    const bars = Math.max(1, Math.round(endBeat / bpbar));
    return {
        bpm: source.bpm,
        bars,
        seconds: round(endBeat * spb, 1),
        tracks,
        chords: detectChords(source, bpbar),
        energy: melodicDensity < 2 ? 'sparse' : melodicDensity < 5 ? 'moderate' : 'dense',
        humanFeel: tracks.length ? tracks.reduce((a, t) => a + t.velSpread, 0) / tracks.length > 0.16 : false
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// Audio (WAV / MP3) analysis – everything runs locally in the browser
// ═════════════════════════════════════════════════════════════════════════════
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < half; k++) {
                const a = i + k, b = a + half;
                const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
                re[b] = re[a] - vr; im[b] = im[a] - vi;
                re[a] += vr; im[a] += vi;
                const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
            }
        }
    }
}

export function analyzeAudioBuffer(buf) {
    const sr = buf.sampleRate, len = buf.length;
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;

    let peak = 0, sumSq = 0, midSq = 0, sideSq = 0;
    for (let i = 0; i < len; i++) {
        const l = L[i], r = R[i], m = (l + r) / 2, s = (l - r) / 2;
        const a = Math.max(Math.abs(l), Math.abs(r));
        if (a > peak) peak = a;
        sumSq += m * m; midSq += m * m; sideSq += s * s;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, len));
    const peakDb = 20 * Math.log10(peak + 1e-9);
    const rmsDb = 20 * Math.log10(rms + 1e-9);
    const width = Math.sqrt(sideSq / (midSq + 1e-12));

    // Spectral features on up to 48 evenly spaced frames
    const N = 4096;
    const hann = new Float64Array(N);
    for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const edges = [20, 120, 500, 2000, 6000, 20000];
    const band = [0, 0, 0, 0, 0];
    let centroidSum = 0, centroidFrames = 0;
    const frames = Math.min(48, Math.floor(len / N));
    for (let f = 0; f < frames; f++) {
        const start = Math.floor((f * (len - N)) / Math.max(1, frames - 1));
        const re = new Float64Array(N), im = new Float64Array(N);
        let e = 0;
        for (let i = 0; i < N; i++) { const v = (L[start + i] + R[start + i]) / 2; re[i] = v * hann[i]; e += v * v; }
        if (Math.sqrt(e / N) < 1e-4) continue; // skip silence
        fft(re, im);
        let mSum = 0, fmSum = 0;
        for (let k = 1; k < N / 2; k++) {
            const freq = (k * sr) / N;
            if (freq < 20) continue;
            const mag = Math.hypot(re[k], im[k]);
            mSum += mag; fmSum += mag * freq;
            const p = mag * mag;
            for (let b = 0; b < 5; b++) if (freq >= edges[b] && freq < edges[b + 1]) { band[b] += p; break; }
        }
        if (mSum > 0) { centroidSum += fmSum / mSum; centroidFrames++; }
    }
    const bandTotal = band.reduce((a, c) => a + c, 0) || 1;
    const [sub, low, mid, himid, air] = band.map(b => b / bandTotal);

    return {
        duration: round(len / sr, 1),
        channels: buf.numberOfChannels,
        peakDb: round(peakDb, 1),
        rmsDb: round(rmsDb, 1),
        crestDb: round(peakDb - rmsDb, 1),
        width: round(width, 2),
        centroid: centroidFrames ? Math.round(centroidSum / centroidFrames) : 0,
        bands: { sub: round(sub, 2), low: round(low, 2), mid: round(mid, 2), himid: round(himid, 2), air: round(air, 2) }
    };
}

export function describeAudio(a) {
    if (!a) return [];
    const out = [];
    out.push(a.centroid < 900 ? 'dark' : a.centroid < 2000 ? 'warm' : a.centroid < 3500 ? 'balanced' : 'bright');
    if (a.bands.sub + a.bands.low > 0.7) out.push('sub-heavy');
    if (a.bands.air + a.bands.himid > 0.3) out.push('airy highs');
    out.push(a.crestDb > 14 ? 'punchy, dynamic' : a.crestDb < 8 ? 'dense, compressed' : 'polished');
    if (a.channels > 1) out.push(a.width > 0.5 ? 'wide stereo' : a.width < 0.15 ? 'centered, mono-compatible' : 'moderate stereo width');
    return out;
}

async function decodeAudio(blobOrFile) {
    const bytes = await blobOrFile.arrayBuffer();
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) throw new Error('This browser cannot decode audio for analysis.');
    return new Ctx(2, 1, 44100).decodeAudioData(bytes);
}

// ═════════════════════════════════════════════════════════════════════════════
// Local (deterministic) prompt builder – free, instant
// ═════════════════════════════════════════════════════════════════════════════
const GENRE_MAP = {
    house: 'house', techno: 'techno', trance: 'trance', trap: 'trap', 'hip-hop': 'hip hop', rock: 'rock', pop: 'pop',
    funk: 'funk', reggae: 'reggae', jazz: 'jazz', disco: 'disco', classical: 'classical', ambient: 'ambient',
    'drum-and-bass': 'drum and bass', synthwave: 'synthwave', downtempo: 'downtempo',
    'progressive-rock': 'progressive rock', cinematic: 'cinematic orchestral'
};
const SUBGENRES = [
    'deep house', 'melodic techno', 'dark techno', 'progressive house', 'tech house', 'minimal techno', 'acid techno',
    'organic house', 'afro house', 'melodic house', 'future bass', 'lo-fi hip hop', 'dream pop', 'synth-pop',
    'dark ambient', 'neo-soul', 'ambient techno', 'hypnotic techno', 'industrial techno', 'uplifting trance',
    'psytrance', 'liquid drum and bass', 'neurofunk', 'trip hop', 'chillwave', 'vaporwave', 'darkwave', 'italo disco'
];
const MOOD_TAGS = {
    peaceful: ['calm', 'serene'], energetic: ['energetic', 'uplifting'], melancholic: ['melancholic', 'emotional'],
    happy: ['joyful', 'bright'], dark: ['dark', 'brooding'], mysterious: ['mysterious', 'hypnotic'],
    dreamy: ['dreamy', 'atmospheric'], intense: ['intense', 'driving'], ethereal: ['ethereal', 'atmospheric'],
    groovy: ['groovy', 'swinging']
};

function pickGenre(source) {
    const text = `${source.title} ${source.description} ${source.userPrompt} ${source.enhancedPrompt}`
        .toLowerCase().replace(/-/g, ' ');
    const found = SUBGENRES.find(g => text.includes(g.replace(/-/g, ' ')));
    if (found) return found;
    const base = GENRE_MAP[source.style] || source.style || '';
    const mood = source.mood;
    if (base === 'techno') return ['dark', 'mysterious', 'intense'].includes(mood) ? 'dark techno' : 'melodic techno';
    if (base === 'house' && ['ethereal', 'dreamy', 'peaceful', 'melancholic'].includes(mood)) return 'deep house';
    return base;
}

export function buildLocalPrompt(source, midi, audio, opts) {
    const mode = opts.mode, limit = opts.limit;
    const lengthTags = opts.length === 'extended' ? ['extended full-length DJ mix', 'long evolving arrangement', 'extended intro and outro'] : ['complete full-length track', 'full song arrangement', 'evolving arrangement'];
    const vocalTag = { male: 'male vocals', female: 'female vocals', duet: 'male and female vocals', choir: 'choir vocals', whisper: 'whispered vocals', spoken: 'spoken word vocals' }[opts.vocal] || 'expressive vocals';
    const genre = pickGenre(source);
    const moodTags = MOOD_TAGS[source.mood] || (source.mood ? [source.mood] : []);
    const key = source.key ? source.key.toLowerCase() : '';
    const instruments = midi.tracks.map(t => t.descriptor);
    const audioTags = describeAudio(audio);
    const energyTag = midi.energy === 'sparse' ? 'minimal, spacious' : midi.energy === 'dense' ? 'driving, layered' : '';
    const feel = midi.humanFeel ? 'human feel' : '';
    const parts = uniq([genre, moodTags[0], source.bpm + ' bpm', key, ...lengthTags, ...instruments.slice(0, 4), moodTags[1], ...audioTags.slice(0, 3), energyTag, ...instruments.slice(4), feel, mode === 'instrumental' ? 'instrumental' : vocalTag, 'studio quality']);
    const style = fitParts(parts, limit);
    const tags = uniq([genre, ...moodTags, source.bpm + ' bpm', key, mode === 'instrumental' ? 'instrumental' : 'vocals', ...instruments.slice(0, 3).map(s => s.split(' ').slice(-2).join(' '))]).slice(0, 10);
    const exclude = mode === 'instrumental' ? 'vocals, singing, spoken word, choir' : 'instrumental only';
    const title = (source.title || 'Untitled').slice(0, 80);
    return { title, style, exclude, tags, lyrics: buildStructure(source, midi, opts) };
}

const CLUB_RE = /house|techno|trance|drum|synthwave|disco|garage|electro|dubstep|edm|dance|trap/i;
const JOURNEY_RE = /ambient|cinematic|classical|downtempo|orchestral|chill|drone/i;
const STRUCTURES = {
    song: { full: ['intro','verse','pre','chorus','verse','pre','chorus','bridge','solo','chorus','outro'], extended: ['intro','verse','pre','chorus','break','verse','pre','chorus','bridge','build','chorus','solo','chorus','outro'] },
    club: { full: ['intro','build','drop','break','build','drop','outro'], extended: ['intro','intro','build','drop','break','build','drop','break','build','drop','outro'] },
    journey: { full: ['intro','theme','build','climax','break','build','climax','outro'], extended: ['intro','theme','break','build','climax','break','theme','build','climax','silence','outro'] }
};
function buildStructure(source, midi, opts) {
    const text = [source.style, source.title, source.description, source.userPrompt].join(' ');
    const preset = opts.structure && opts.structure !== 'auto' ? opts.structure : JOURNEY_RE.test(text) ? 'journey' : CLUB_RE.test(text) ? 'club' : 'song';
    const length = opts.length === 'extended' ? 'extended' : 'full';
    const sections = STRUCTURES[preset][length];
    const role = source.sampleRole || 'base';
    const tracks = type => midi.tracks.filter(t => type.includes(t.type)).map(t => t.descriptor);
    const bass = tracks(['bassline','percs']), leads = tracks(['lead','melody','arpeggio','keys','plucks']), pads = tracks(['pad-textures','strings']), harmony = tracks(['chord']);
    const pick = (a, fallback) => a.slice(0, 2).join(', ') || fallback;
    const vocalKinds = new Set(['verse','pre','chorus','bridge']);
    const counts = {};
    return sections.map((kind, i) => {
        const n = counts[kind] = (counts[kind] || 0) + 1;
        const sampleUsed = role === 'base' ? ['drop','chorus','theme','climax'].includes(kind) : (role === kind || (role === 'drop' && kind === 'chorus') || (role === 'chorus' && kind === 'drop'));
        let label = ({intro:'Intro',verse:'Verse ' + n,pre:'Pre-Chorus',chorus:'Chorus',bridge:'Bridge',break:'Instrumental Break',build:'Build up',drop:'Beat Drop',outro:'Outro',theme:'Main Theme',climax:'Climax',silence:'Silence',solo:'Instrumental Solo'})[kind] || 'Instrumental Break';
        let cue = '';
        if (kind === 'intro') cue = role === 'intro' ? 'use the supplied sample as the actual intro' : 'create a new spacious opening inspired by the sample; do not replay the sample as the opening';
        else if (kind === 'verse') cue = 'stripped-back groove, ' + pick(bass, 'subtle rhythm') + ', ' + pick(leads, 'main motif');
        else if (kind === 'pre') cue = 'rising tension, filter opens, drums thin out';
        else if (kind === 'chorus' || kind === 'drop') cue = (sampleUsed ? 'full arrangement developed from the supplied sample: ' : 'full-energy arrangement: ') + pick([...bass, ...leads, ...harmony], 'main musical motif');
        else if (kind === 'theme') cue = sampleUsed ? 'develop the sample motif and harmony' : 'introduce a new evolving theme';
        else if (kind === 'climax') cue = 'all layers at full intensity, emotional peak';
        else if (kind === 'build') cue = 'riser, filter sweep, layers gradually stack';
        else if (kind === 'break') cue = 'strip back to ' + pick(pads, 'atmospheric textures') + ', remove drums';
        else if (kind === 'bridge') cue = 'new harmonic color, emotional shift, drums drop out';
        else if (kind === 'solo') cue = 'featured instrumental solo';
        else if (kind === 'silence') cue = 'brief near-silence before the final peak';
        else if (kind === 'outro') cue = preset === 'club' && length === 'extended' ? 'long DJ-friendly outro, elements fall away gradually' : 'resolve naturally, elements fall away';
        const lines = [];
        if (kind === 'drop') lines.push('[Beat Drop]');
        lines.push('[' + label + ']');
        if (mode === 'lyrics' && vocalKinds.has(kind)) {
            const v = opts.vocal || 'auto';
            const voice = v === 'male' ? '[Male Vocal]' : v === 'female' ? '[Female Vocal]' : v === 'choir' && kind === 'chorus' ? '[Choir]' : v === 'whisper' && (kind === 'verse' || kind === 'pre') ? '[Whisper]' : v === 'spoken' && kind === 'verse' ? '[Spoken Word]' : v === 'duet' && kind === 'verse' ? (n % 2 ? '[Male Vocal]' : '[Female Vocal]') : '';
            if (voice) lines.push(voice);
        } else if (cue) lines.push('[' + cue + ']');
        return lines.join('\n');
    }).join('\n\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// Studio UI controller
// ═════════════════════════════════════════════════════════════════════════════
/** Fingerprint of the current notes, used to detect that tracks changed after the WAV was rendered. */
export function tracksSignature(app) {
    let h = 2166136261;
    const mix = (n) => { h ^= (n | 0); h = Math.imul(h, 16777619) >>> 0; };
    const types = [...(app.generatedTracks?.keys?.() || [])].sort();
    for (const type of types) {
        for (const ch of type) mix(ch.charCodeAt(0));
        const notes = app.generatedTracks.get(type)?.midi?.tracks?.[0]?.notes || [];
        mix(notes.length);
        for (const n of notes) {
            mix(n.midi);
            mix(Math.round(n.time * 1000));
            mix(Math.round(n.duration * 1000));
            mix(Math.round(n.velocity * 100));
        }
    }
    return `${h.toString(16)}:${types.join(',')}`;
}

const $ = (id) => document.getElementById(id);

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { /* ignore */ }
        ta.remove();
        return ok;
    }
}

export class SunoStudio {
    constructor(app) {
        this.app = app;
        this.mode = 'instrumental';
        this.limit = 1000;
        this.length = 'extended';
        this.wav = null;           // { name, analysis, status }
        this.wavBlob = null;       // the app's own rendered Full Mix WAV (for the download pack)
        this.wavName = '';
        this.wavSig = '';          // tracksSignature() at the time the WAV was rendered
        this.wavStale = false;     // true when tracks changed after the WAV export
        this.pro = localStorage.getItem('suno_pro') === '1'; // UI preference only
        this.model = localStorage.getItem('suno_model') || 'auto'; // UI preference only
        this.catalogLoaded = false;
        this.source = null;
        this.midi = null;
        this.origin = 'local';     // 'local' | 'ai'
        this.busy = false;
        this.mounted = false;
    }

    mount() {
        this.btn = $('open-suno-studio');
        this.modal = $('suno-studio-modal');
        if (!this.btn || !this.modal || this.mounted) return;
        this.mounted = true;

        // Keep the button enabled/disabled exactly like "Export MIDI" (works for generated, imported and demo tracks)
        const dl = $('download');
        if (dl) {
            const sync = () => { this.btn.disabled = dl.disabled; };
            sync();
            new MutationObserver(sync).observe(dl, { attributes: true, attributeFilter: ['disabled'] });
        }

        this.btn.addEventListener('click', () => this.open());
        this.modal.querySelector('.close-button')?.addEventListener('click', () => this.close());
        this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen()) this.close(); });

        this.bindSegmented('suno-mode', (v) => { this.mode = v; this.syncModeUi(); this.rebuildLocal('Switched mode – fields rebuilt.'); });
        this.bindSegmented('suno-length', (v) => { this.length = v; this.rebuildLocal('Song length changed – structure rebuilt.'); });
        $('suno-structure')?.addEventListener('change', () => this.rebuildLocal('Structure changed – rebuilt.'));
        $('suno-vocal')?.addEventListener('change', () => this.rebuildLocal('Vocal style changed – rebuilt.'));
        this.bindSegmented('suno-limit', (v) => { this.limit = Number(v); this.rebuildLocal('Style limit changed – style refitted.'); });

        $('suno-local-btn')?.addEventListener('click', () => this.rebuildLocal('Rebuilt from your MIDI & metadata.'));
        $('suno-ai-btn')?.addEventListener('click', () => this.generateWithAI());
        $('suno-copy-all')?.addEventListener('click', (e) => this.copy(this.allText(), e.currentTarget));
        $('suno-download-pack')?.addEventListener('click', () => this.downloadPack());
        const pro = $('suno-pro');
        if (pro) {
            pro.checked = this.pro;
            pro.addEventListener('change', () => {
                this.pro = pro.checked;
                try { localStorage.setItem('suno_pro', this.pro ? '1' : '0'); } catch { /* ignore */ }
                this.updatePackUi();
            });
        }
        $('suno-open')?.addEventListener('click', () => window.open(SUNO_CREATE_URL, '_blank', 'noopener'));
        this.modal.querySelectorAll('[data-copy]').forEach((b) =>
            b.addEventListener('click', () => this.copy(this.fieldText(b.dataset.copy), b)));
        this.buildModelSelect();
        const sel = $('suno-model');
        sel?.addEventListener('change', () => {
            this.model = sel.value;
            try { localStorage.setItem('suno_model', this.model); } catch { /* ignore */ }
            this.updateModelNote();
        });
        $('suno-style')?.addEventListener('input', () => this.updateCounters());
        $('suno-lyrics')?.addEventListener('input', () => this.updateCounters());

        $('suno-wav-pick')?.addEventListener('click', () => $('suno-wav-file')?.click());
        $('suno-wav-file')?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) this.analyzeFile(f);
        });
        $('suno-wav-clear')?.addEventListener('click', () => { this.wav = null; this.renderWav(); this.rebuildLocal('Sound analysis removed.'); });
    }

    isOpen() { return this.modal?.classList.contains('active'); }

    reset() { this.wav = null; this.wavBlob = null; this.wavName = ''; this.wavSig = ''; this.wavStale = false; this.origin = 'local'; if (this.isOpen()) this.close(); }

    // Called from json-variations.js right after the full-mix WAV was rendered
    async registerWav({ blob, filename }) {
        this.wavBlob = blob;
        this.wavName = filename || '';
        this.wavSig = tracksSignature(this.app);
        this.wavStale = false;
        this.updatePackUi();
        this.wav = { name: filename || 'full mix', analysis: null, status: 'analyzing', fromApp: true };
        this.renderWav();
        try {
            const buf = await decodeAudio(blob);
            this.wav = { name: filename || 'full mix', analysis: analyzeAudioBuffer(buf), status: 'ready', fromApp: true };
        } catch (e) {
            console.warn('[Suno] WAV analysis failed:', e);
            this.wav = null;
        }
        this.renderWav();
        if (this.isOpen() && this.origin === 'local') this.rebuildLocal('Sound analysis added.');
    }

    async analyzeFile(file) {
        if (file.size > 80 * 1024 * 1024) { this.setStatus('File is larger than 80 MB.', 'error'); return; }
        this.wav = { name: file.name, analysis: null, status: 'analyzing' };
        this.renderWav();
        try {
            this.wav = { name: file.name, analysis: analyzeAudioBuffer(await decodeAudio(file)), status: 'ready' };
            this.renderWav();
            this.rebuildLocal('Sound analysis added.');
        } catch (e) {
            console.warn('[Suno] file analysis failed:', e);
            this.wav = null;
            this.renderWav();
            this.setStatus('Could not read that audio file.', 'error');
        }
    }

    // If the tracks were edited after the Full Mix export, the rendered WAV (and its analysis) no longer matches.
    checkStale() {
        if (!this.wavBlob || this.wavSig === tracksSignature(this.app)) return;
        this.wavBlob = null;
        this.wavName = '';
        this.wavStale = true;
        if (this.wav?.fromApp) this.wav = null;
    }

    // ── open / close ──────────────────────────────────────────────────────
    open() {
        if (!this.app.generatedTracks?.size) {
            this.app.ui?.showMessage?.('Generate or load a track first.', 'warning');
            return;
        }
        this.checkStale();
        this.source = collectSource(this.app);
        this.midi = analyzeMidi(this.source);
        this.syncModeUi();
        this.renderWav();
        this.updatePackUi();
        this.rebuildLocal('');
        this.modal.classList.add('active');
        document.body.classList.add('no-scroll');
        this.loadCatalog();
    }

    close() {
        this.modal.classList.remove('active');
        document.body.classList.remove('no-scroll');
    }

    // ── segmented controls / mode UI ──────────────────────────────────────
    bindSegmented(id, onChange) {
        const seg = $(id);
        if (!seg) return;
        seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
            seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            onChange(b.dataset.value);
        }));
    }

    syncModeUi() {
        const opts = $('suno-lyrics-opts');
        if (opts) opts.hidden = this.mode !== 'lyrics';
        const label = $('suno-lyrics-label');
        if (label) label.textContent = this.mode === 'lyrics' ? 'Lyrics' : 'Structure tags (optional)';
        const ai = $('suno-ai-label');
        if (ai) ai.textContent = this.mode === 'lyrics' ? 'Write lyrics & polish with AI' : 'Polish with AI';
    }

    // ── build / render ────────────────────────────────────────────────────
    options() {
        return {
            mode: this.mode,
            limit: this.limit,
            length: this.length,
            structure: $('suno-structure')?.value || 'auto',
            vocal: $('suno-vocal')?.value || 'auto',
            lyricsTheme: ($('suno-theme')?.value || '').trim().slice(0, 300),
            lyricsLanguage: ($('suno-language')?.value || '').trim().slice(0, 40) || 'English'
        };
    }

    rebuildLocal(message) {
        if (!this.source) return;
        const result = buildLocalPrompt(this.source, this.midi, this.wav?.analysis || null, this.options());
        this.origin = 'local';
        this.fill(result);
        this.renderSource();
        this.setStatus(message || '', 'info');
    }

    fill(r) {
        $('suno-title').value = r.title || '';
        $('suno-style').value = r.style || '';
        $('suno-exclude').value = r.exclude || '';
        $('suno-lyrics').value = r.lyrics || '';
        this.renderTags(r.tags || []);
        this.updateCounters();
    }

    renderTags(tags) {
        const box = $('suno-tags');
        if (!box) return;
        box.replaceChildren();
        for (const t of tags) {
            const chip = document.createElement('span');
            chip.className = 'suno-chip suno-chip-tag';
            chip.textContent = t;
            box.appendChild(chip);
        }
        this.tags = tags;
    }

    renderSource() {
        const box = $('suno-source-chips');
        if (!box || !this.source) return;
        box.replaceChildren();
        const s = this.source, m = this.midi;
        const chips = [
            s.title && `“${s.title}”`,
            `${s.bpm} BPM`, s.key, s.timeSignature !== '4/4' && s.timeSignature,
            `${m.tracks.length} track${m.tracks.length === 1 ? '' : 's'}`, `${m.bars} bars`,
            m.chords && `chords ≈ ${m.chords.text}`,
            (s.userPrompt || s.enhancedPrompt) && 'your prompt',
            this.wav?.analysis && `WAV ${fmtTime(this.wav.analysis.duration)}`
        ].filter(Boolean);
        for (const c of chips) {
            const el = document.createElement('span');
            el.className = 'suno-chip';
            el.textContent = c;
            box.appendChild(el);
        }
    }

    renderWav() {
        const card = $('suno-wav-text');
        const clear = $('suno-wav-clear');
        if (!card) return;
        if (!this.wav) {
            card.textContent = 'No audio yet. Export the Full Mix WAV (Edit Tracks → Export as Audio) or analyze a file to describe the actual sound.';
            if (clear) clear.hidden = true;
            return;
        }
        if (this.wav.status === 'analyzing') {
            card.textContent = `Analyzing ${this.wav.name}…`;
            if (clear) clear.hidden = true;
            return;
        }
        const a = this.wav.analysis;
        card.textContent = `${this.wav.name} · ${fmtTime(a.duration)} · ${describeAudio(a).join(', ')} · ${a.rmsDb} dB RMS`;
        if (clear) clear.hidden = false;
    }

    updateCounters() {
        const style = $('suno-style')?.value || '';
        const c = $('suno-style-count');
        if (c) {
            c.textContent = `${style.length} / ${this.limit}`;
            c.classList.toggle('over', style.length > this.limit);
        }
        const lc = $('suno-lyrics-count');
        if (lc) lc.textContent = `${($('suno-lyrics')?.value || '').length} chars`;
    }

    setStatus(text, kind = 'info') {
        const el = $('suno-status');
        if (!el) return;
        el.textContent = text;
        el.dataset.kind = kind;
        el.hidden = !text;
    }

    // ── copy / export ─────────────────────────────────────────────────────
    fieldText(name) {
        switch (name) {
            case 'title': return $('suno-title').value.trim();
            case 'style': return $('suno-style').value.trim();
            case 'exclude': return $('suno-exclude').value.trim();
            case 'tags': return (this.tags || []).join(', ');
            case 'lyrics': return $('suno-lyrics').value.trim();
            default: return '';
        }
    }

    allText() {
        const parts = [`Title: ${this.fieldText('title')}`, `Style: ${this.fieldText('style')}`];
        if (this.fieldText('exclude')) parts.push(`Exclude styles: ${this.fieldText('exclude')}`);
        parts.push(`Tags: ${this.fieldText('tags')}`);
        if (this.fieldText('lyrics')) parts.push('', 'Lyrics:', this.fieldText('lyrics'));
        return parts.join('\n');
    }

    async copy(text, btn) {
        const ok = await copyText(text);
        if (!btn) return;
        const prev = btn.dataset.label || btn.textContent;
        btn.dataset.label = prev;
        btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
        clearTimeout(btn._t);
        btn._t = setTimeout(() => { btn.textContent = prev; }, 1400);
    }

    // What the download button will contain:
    //   • app WAV exists          → zip: WAV + prompt (works for free Suno accounts)
    //   • no WAV, Suno Pro        → zip: multitrack MIDI + prompt
    //   • no WAV, free account    → prompt .txt only
    packPlan() {
        if (this.wavBlob) {
            return { kind: 'wav', label: 'Download pack (WAV + prompt)', note: 'Zip with your Full Mix WAV and the Suno text. Upload the WAV in Suno, then paste the text.' };
        }
        const stale = this.wavStale ? 'Your tracks changed after the WAV export, so the old WAV was left out. ' : '';
        if (this.pro) {
            return { kind: 'midi', label: 'Download pack (MIDI + prompt)', note: `${stale}Zip with the multitrack MIDI and the Suno text. Upload the MIDI in Suno’s Create mode (Pro).` };
        }
        return { kind: 'txt', label: 'Download prompt (.txt)', note: stale ? `${stale}Export the Full Mix WAV again to include audio in the pack.` : 'Tip: export the Full Mix WAV (Edit Tracks → Export as Audio) and the pack will include it.' };
    }

    updatePackUi() {
        const plan = this.packPlan();
        const label = $('suno-pack-label');
        const note = $('suno-pack-note');
        if (label) label.textContent = plan.label;
        if (note) note.textContent = plan.note;
    }

    saveBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async downloadPack() {
        const base = (this.fieldText('title') || 'suno-prompt').replace(/[^a-z0-9\-_. ]/gi, '_').trim() || 'suno-prompt';
        const text = this.allText();
        const plan = this.packPlan();

        if (plan.kind === 'txt') {
            this.saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${base}-suno.txt`);
            return;
        }

        try {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            zip.file('suno-prompt.txt', text);

            if (plan.kind === 'wav') {
                zip.file(this.wavName || `${base}-fullmix.wav`, this.wavBlob);
            } else {
                const mid = this.app.getMultitrackMidiBlob?.();
                if (!mid) throw new Error('No MIDI available to export.');
                zip.file(`${base}.mid`, mid);
            }

            this.saveBlob(await zip.generateAsync({ type: 'blob' }), `${base}-suno-pack.zip`);
            this.setStatus('Pack downloaded. Upload the audio/MIDI in Suno and paste the fields from suno-prompt.txt.', 'success');
        } catch (e) {
            console.error('[Suno] pack failed:', e);
            this.setStatus(`Could not create the pack: ${e.message}`, 'error');
        }
    }

    // ── AI model picker ───────────────────────────────────────────────────
    buildModelSelect(extra = []) {
        const sel = $('suno-model');
        if (!sel) return;
        const current = sel.value || this.model;
        sel.replaceChildren();

        const add = (parent, id, text) => {
            const o = document.createElement('option');
            o.value = id; o.textContent = text;
            parent.appendChild(o);
        };
        add(sel, 'auto', 'Auto (recommended)');
        const known = new Set(['auto']);
        for (const g of SUNO_MODEL_GROUPS) {
            const og = document.createElement('optgroup');
            og.label = g.label;
            for (const [id, label] of g.models) { add(og, id, label); known.add(id); }
            sel.appendChild(og);
        }
        const more = extra.filter(m => !known.has(m.id));
        if (more.length) {
            const og = document.createElement('optgroup');
            og.label = 'More models (live catalog)';
            for (const m of more) { add(og, m.id, m.paid ? `${m.id} · paid Pollen` : m.id); known.add(m.id); }
            sel.appendChild(og);
        }
        // keep a saved choice even if it is not in the lists (e.g. catalog could not be loaded)
        if (current && !known.has(current) && /^[a-zA-Z0-9][\w./:-]{0,100}$/.test(current)) {
            const og = document.createElement('optgroup');
            og.label = 'Saved';
            add(og, current, current);
            sel.appendChild(og);
            known.add(current);
        }
        sel.value = known.has(current) ? current : 'auto';
        this.model = sel.value;
        this.updateModelNote();
    }

    updateModelNote() {
        const note = $('suno-model-note');
        if (!note) return;
        const pro = SUNO_MODEL_GROUPS.find(g => g.pro)?.models.some(([id]) => id === this.model);
        if (this.model === 'auto') note.textContent = 'Starts with GPT-6 Luna and falls back to a backup model if needed.';
        else if (pro) note.textContent = 'Pro model: best quality, but uses more of your Pollen and may need purchased Pollen.';
        else note.textContent = 'Uses this model with your Pollen. If it fails, GPT-6 Luna is tried as a backup.';
    }

    // Live catalog (public, no auth). Failure is harmless: the curated list still works.
    async loadCatalog() {
        if (this.catalogLoaded) return;
        this.catalogLoaded = true;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000);
            const res = await fetch(CATALOG_URL, { signal: ctrl.signal });
            clearTimeout(t);
            if (!res.ok) return;
            const json = await res.json();
            const list = Array.isArray(json) ? json : (json.data || json.models || []);
            const extra = list.map((m) => ({
                id: typeof m === 'string' ? m : (m.id || m.name),
                paid: !!(m.paid_only ?? m.paidOnly)
            })).filter(m => typeof m.id === 'string' && /^[a-zA-Z0-9][\w./:-]{0,100}$/.test(m.id) && !CATALOG_EXCLUDE.test(m.id))
              .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 80);
            if (extra.length) this.buildModelSelect(extra);
        } catch { /* offline / CORS: keep curated list */ }
    }

    // ── AI (Pollinations Pay – the user's own Pollen) ──────────────────────
    aiPayload() {
        const s = this.source, m = this.midi, local = buildLocalPrompt(s, m, this.wav?.analysis || null, this.options());
        const a = this.wav?.analysis;
        return {
            composition: {
                title: s.title, description: s.description,
                userPrompt: s.userPrompt, enhancedPrompt: s.enhancedPrompt,
                sampleRole: s.sampleRole, bpm: s.bpm, key: s.key, timeSignature: s.timeSignature, genre: s.style, mood: s.mood,
                bars: m.bars, seconds: m.seconds, energy: m.energy, chords: m.chords?.text || '',
                tracks: m.tracks.map(t => ({
                    type: t.type, feel: t.descriptor, notesPerBeat: t.density, range: `${t.low}-${t.high}`,
                    syncopation: t.syncopation
                })),
                audio: a ? { traits: describeAudio(a), rmsDb: a.rmsDb, centroidHz: a.centroid, seconds: a.duration } : null,
                localDraft: { style: local.style, tags: local.tags }
            },
            options: this.options()
        };
    }

    async generateWithAI() {
        if (this.busy || !this.source) return;
        const key = getByopKey();
        if (!key) { this.close(); this.app.showByopModal?.('connect'); return; }

        this.busy = true;
        const btn = $('suno-ai-btn');
        btn?.setAttribute('disabled', '');
        btn?.classList.add('is-loading');
        this.setStatus('Writing your Suno prompt with AI…', 'info');

        const explicit = this.model !== 'auto';
        const models = explicit
            ? uniq([this.model, AI_FALLBACK_MODELS[0]])
            : uniq([...AI_FALLBACK_MODELS]);
        const payload = this.aiPayload();
        let lastErr = null;

        try {
            for (const [index, model] of models.entries()) {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), explicit && index === 0 ? 100000 : 60000);
                try {
                    const res = await fetch('/api/suno', {
                        method: 'POST', signal: ctrl.signal,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...payload, model, userApiKey: key })
                    });
                    if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        const err = new Error(data.message || data.error || `Server error ${res.status}`);
                        err.status = res.status;
                        throw err;
                    }
                    const out = await res.json();
                    // The server keeps the connection alive while slow models think, so errors can arrive in the body.
                    if (out.error) throw Object.assign(new Error(out.message || out.error), { status: out.status || 502 });
                    if (!out.style) throw new Error('Empty AI response');
                    this.origin = 'ai';
                    this.fill({
                        title: out.title || this.source.title,
                        style: fitParts(String(out.style).split(/\s*,\s*/), this.limit),
                        exclude: out.exclude || '',
                        tags: Array.isArray(out.tags) ? out.tags : [],
                        lyrics: out.lyrics || ''
                    });
                    this.setStatus(`Done — written by ${model}. Edit anything before copying.`, 'success');
                    this.app.refreshByopBalance?.();
                    return;
                } catch (e) {
                    lastErr = e.name === 'AbortError' ? Object.assign(new Error('AI request timed out'), { status: 504 }) : e;
                    if (lastErr.status === 401) throw Object.assign(lastErr, { reauth: true });
                    if (lastErr.status === 402) throw Object.assign(lastErr, { noPollen: true, model });
                    if (lastErr.status && lastErr.status >= 400 && lastErr.status < 500 && ![408, 429].includes(lastErr.status)) throw lastErr;
                } finally {
                    clearTimeout(timer);
                }
            }
            throw lastErr || new Error('AI generation failed');
        } catch (e) {
            if (e.reauth) { this.close(); this.app.showByopModal?.('expired'); }
            else if (e.noPollen && explicit) {
                // A specific (often Pro) model was refused: keep the studio open so the user can pick another model.
                this.setStatus(`${e.model || 'This model'} could not be used with your Pollinations key (not enough Pollen, or it needs purchased Pollen). Pick another model or top up at enter.pollinations.ai.`, 'error');
            }
            else if (e.noPollen) { this.close(); this.app.showByopModal?.('balance'); }
            else this.setStatus(`AI generation failed: ${e.message}. The local draft is still available.`, 'error');
        } finally {
            this.busy = false;
            btn?.removeAttribute('disabled');
            btn?.classList.remove('is-loading');
        }
    }
}
