// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Preset Resolver
//
//   Genre + Track type  ──►  deterministic preset (oscillator, ADSR, filter, FX, volume)
//                       ──►  LLM picks bounded "knob" values / an oscillator choice (creative variation)
//                       ──►  finalizePatch(): merge + clamp + mix rules  ──►  complete patch JSON
//
// The output is the exact patch shape the audio renderer already consumes
// (instrumentType, oscillator, envelope, filterEnvelope, filter, portamento, pan, effects, volume, designRationale).
// If the LLM fails, the preset alone is still a valid, balanced patch.
//
// Layers:  FAMILIES (shared base per genre family)  →  GENRES (per-genre overrides, opt-in)
// A genre is only served by this pipeline when it has an explicit GENRES entry for that track
// (level 'genre'). Everything else keeps using the full-LLM path until presets are tuned for it.
//
// Pure ES module, no dependencies: it can run in the Edge function and in Node tests.
// ─────────────────────────────────────────────────────────────────────────────

/** Enable curated genre overrides first, then the shared family base where no genre override exists. */
export const PRESET_PIPELINE_LEVELS = new Set(['genre', 'family']);

// ── helpers ──────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

function deepMerge(base, over) {
    if (over === undefined) return clone(base);
    if (!isObj(base) || !isObj(over)) return clone(over);
    const out = clone(base);
    for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v);
    return out;
}

function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!isObj(o[keys[i]])) o[keys[i]] = {};
        o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
}

const round = (v, d = 3) => { const f = 10 ** d; return Math.round(v * f) / f; };

// ── naming ───────────────────────────────────────────────────────────────────
const GENRE_ALIASES = {
    'prog-rock': 'progressive-rock', prog: 'progressive-rock', 'progressive-rock': 'progressive-rock',
    'drum-and-bass': 'drum-and-bass', dnb: 'drum-and-bass', 'hip-hop': 'hip-hop', hiphop: 'hip-hop'
};
export function normalizeGenre(g) {
    const k = String(g || '').trim().toLowerCase().replace(/&/g, 'and').replace(/\s+/g, '-');
    return GENRE_ALIASES[k] || k;
}
const TRACK_ALIASES = { pad: 'pad-textures', pads: 'pad-textures', 'pad-texture': 'pad-textures', padtextures: 'pad-textures', pluck: 'plucks', arp: 'arpeggio', bass: 'bassline' };
export function normalizeTrack(t) {
    const k = String(t || '').trim().toLowerCase().replace(/\s+/g, '-');
    return TRACK_ALIASES[k] || k;
}

export const GENRE_FAMILY = {
    techno: 'club', house: 'club', trance: 'club', 'drum-and-bass': 'club', synthwave: 'club',
    rock: 'band', 'progressive-rock': 'band',
    ambient: 'ambient', cinematic: 'cinematic', electronic: 'electronic',
    trap: 'urban', 'hip-hop': 'urban', funk: 'groove', disco: 'groove', reggae: 'roots',
    jazz: 'jazz', classical: 'orchestral', pop: 'pop', downtempo: 'downtempo'
};

// ── deterministic mix rules (code, not prompt) ───────────────────────────────
// vol = pre-FX target range in dB; pan = allowed stereo range. Compensation may go up to 6 dB below the range.
export const TRACK_RULES = {
    bassline: { vol: [-10, -6], pan: [0, 0] },
    lead: { vol: [-12, -9], pan: [-0.1, 0.1] },
    percs: { vol: [-14, -10], pan: [0, 0] },
    melody: { vol: [-14, -10], pan: [-0.1, 0.1] },
    brass: { vol: [-14, -10], pan: [-0.3, 0.3] },
    chord: { vol: [-20, -16], pan: [-0.4, 0.4] },
    keys: { vol: [-18, -14], pan: [-0.3, 0.3] },
    guitar: { vol: [-18, -14], pan: [-0.4, 0.4] },
    plucks: { vol: [-18, -14], pan: [-0.3, 0.3] },
    arpeggio: { vol: [-18, -14], pan: [-0.2, 0.2] },
    strings: { vol: [-20, -16], pan: [-0.5, 0.5] },
    'pad-textures': { vol: [-16, -12], pan: [-0.3, 0.3] }
};
export const FAMILY_RULES = {
    club: { forbidFx: [], maxReverbWet: 0.5 },
    band: { forbidFx: ['AutoFilter', 'BitCrusher'], maxReverbWet: 0.3 }, // no EDM FX in band genres
    ambient: { forbidFx: ['Distortion', 'Chebyshev', 'BitCrusher', 'AutoFilter'], maxReverbWet: 0.7 },
    cinematic: { forbidFx: ['BitCrusher', 'AutoFilter'], maxReverbWet: 0.65 },
    electronic: { forbidFx: [], maxReverbWet: 0.5 },
    urban: { forbidFx: ['AutoFilter', 'BitCrusher'], maxReverbWet: 0.35 },
    groove: { forbidFx: ['BitCrusher', 'AutoFilter'], maxReverbWet: 0.3 },
    roots: { forbidFx: ['Distortion', 'Chebyshev', 'BitCrusher', 'AutoFilter'], maxReverbWet: 0.3 },
    jazz: { forbidFx: ['Distortion', 'Chebyshev', 'BitCrusher', 'AutoFilter'], maxReverbWet: 0.3 },
    orchestral: { forbidFx: ['Distortion', 'Chebyshev', 'BitCrusher', 'AutoFilter'], maxReverbWet: 0.7 },
    pop: { forbidFx: ['BitCrusher', 'AutoFilter'], maxReverbWet: 0.4 },
    downtempo: { forbidFx: ['Distortion', 'Chebyshev', 'BitCrusher', 'AutoFilter'], maxReverbWet: 0.55 }
};

const FX_ORDER = ['Distortion', 'Chebyshev', 'BitCrusher', 'AutoFilter', 'Chorus', 'Phaser', 'Tremolo', 'PingPongDelay', 'Delay', 'Reverb'];
const FX_WET_MAX = { Distortion: 0.5, Chebyshev: 0.3, BitCrusher: 0.3, AutoFilter: 0.6, Chorus: 0.5, Phaser: 0.5, Tremolo: 0.5, PingPongDelay: 0.4, Delay: 0.4, Reverb: 0.7 };
const VALID_OSC = ['sine', 'square', 'triangle', 'sawtooth', 'fatsine', 'fatsquare', 'fatsawtooth', 'pwm', 'fmsine', 'fmsquare', 'fmsawtooth'];
const VALID_INSTRUMENTS = ['MonoSynth', 'PolySynth', 'FMSynth', 'AMSynth', 'MembraneSynth', 'MetalSynth', 'PluckSynth'];

// ── knob factories (the only things the LLM may touch) ───────────────────────
// A knob value is a number 0..1 mapped onto [min, max] (log scale for frequencies).
const K = {
    brightness: (min, max) => ({ label: 'filter cutoff', unit: 'Hz', path: 'filter.frequency', min, max, log: true }),
    resonance: (min, max) => ({ label: 'filter resonance Q', path: 'filter.Q', min, max }),
    pluckDampening: (min, max) => ({ label: 'string dampening', unit: 'Hz', path: 'pluck.dampening', min, max, log: true }),
    pluckResonance: (min, max) => ({ label: 'string resonance', path: 'pluck.resonance', min, max }),
    pluckAttackNoise: (min, max) => ({ label: 'pluck attack noise', path: 'pluck.attackNoise', min, max }),
    punch: (min, max) => ({ label: 'envelope decay', unit: 's', path: 'envelope.decay', min, max, log: true }),
    swell: (min, max) => ({ label: 'envelope attack', unit: 's', path: 'envelope.attack', min, max, log: true }),
    release: (min, max) => ({ label: 'envelope release', unit: 's', path: 'envelope.release', min, max, log: true }),
    sustain: (min, max) => ({ label: 'envelope sustain', path: 'envelope.sustain', min, max }),
    glide: (min, max) => ({ label: 'portamento', unit: 's', path: 'portamento', min, max }),
    width: (min, max) => ({ label: 'oscillator spread', unit: 'cents', path: 'oscillator.spread', min, max }),
    level: (min, max) => ({ label: 'pre-FX volume', unit: 'dB', path: 'volume', min, max }),
    drive: (min, max) => ({ label: 'distortion wet', fx: 'Distortion', param: 'wet', min, max }),
    echo: (min, max, delayTime = '8n') => ({ label: 'delay wet', fx: 'PingPongDelay', param: 'wet', min, max, add: { type: 'PingPongDelay', delayTime, feedback: 0.25, wet: min } }),
    chorus: (min, max) => ({ label: 'chorus wet', fx: 'Chorus', param: 'wet', min, max, add: { type: 'Chorus', frequency: 2, depth: 0.5, wet: min } }),
    motion: (min, max) => ({ label: 'auto-filter wet', fx: 'AutoFilter', param: 'wet', min, max, add: { type: 'AutoFilter', frequency: 0.15, baseFrequency: 500, octaves: 3, wet: min } }),
    space: (wMin, wMax, dMin, dMax) => ({
        label: 'reverb wet and decay', targets: [
            { fx: 'Reverb', param: 'wet', min: wMin, max: wMax, add: { type: 'Reverb', decay: dMin, wet: wMin, preDelay: 0.02 } },
            { fx: 'Reverb', param: 'decay', min: dMin, max: dMax }
        ]
    }),
    osc: (options) => ({ label: 'oscillator type', choice: 'oscillator.type', options })
};

const P = (patch, vary, rationale) => ({ patch, vary, rationale });

// ── FAMILY bases ─────────────────────────────────────────────────────────────
const FAMILIES = {
    club: {
        bassline: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.006, decay: 0.2, sustain: 0.45, release: 0.15 },
            filterEnvelope: { attack: 0.003, decay: 0.15, sustain: 0.15, release: 0.15, baseFrequency: 90, octaves: 3, exponent: 2 },
            filter: { type: 'lowpass', frequency: 420, Q: 1.8, rolloff: -24 }, portamento: 0.03, pan: 0,
            effects: [{ type: 'Distortion', distortion: 0.2, wet: 0.06 }], volume: -8
        }, {
            brightness: K.brightness(220, 800), resonance: K.resonance(0.8, 3.5), punch: K.punch(0.12, 0.4),
            drive: K.drive(0, 0.15), glide: K.glide(0, 0.08), level: K.level(-10, -6)
        }, 'Tight mono saw bass: short filter-envelope bite, light saturation, almost dry for a clean club low end.'),
        plucks: P({
            instrumentType: 'PolySynth', oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.008, decay: 0.24, sustain: 0.02, release: 0.12 },
            filter: { type: 'lowpass', frequency: 5200, Q: 1.6, rolloff: -24 }, pan: -0.15,
            effects: [{ type: 'PingPongDelay', delayTime: '8n', feedback: 0.3, wet: 0.16 }, { type: 'Reverb', decay: 2.2, wet: 0.12, preDelay: 0.01 }], volume: -16
        }, {
            brightness: K.brightness(3500, 8000), punch: K.punch(0.18, 0.3), echo: K.echo(0, 0.25), space: K.space(0, 0.22, 1.2, 3.5),
            osc: K.osc(['sawtooth', 'square', 'pwm']), level: K.level(-18, -14)
        }, 'Short articulate saw plucks with a sharp transient, rhythmic echo and a small room.'),
        'pad-textures': P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsawtooth', count: 3, spread: 22, detune: 6 },
            envelope: { attack: 0.22, decay: 0.9, sustain: 0.5, release: 1.1 },
            filter: { type: 'lowpass', frequency: 2400, Q: 0.6, rolloff: -24 }, pan: 0.22,
            effects: [{ type: 'AutoFilter', frequency: 0.15, baseFrequency: 500, octaves: 3, wet: 0.25 }, { type: 'Chorus', frequency: 2.5, depth: 0.5, wet: 0.2 }, { type: 'Reverb', decay: 5, wet: 0.38, preDelay: 0.03 }], volume: -14
        }, {
            brightness: K.brightness(1400, 4200), swell: K.swell(0.12, 0.35), release: K.release(0.6, 1.5), width: K.width(12, 35),
            motion: K.motion(0, 0.45), space: K.space(0.2, 0.5, 3, 8), level: K.level(-16, -12)
        }, 'Sustained evolving triad layer: detuned saws, slow filter motion, chorus and a wide reverb tail.'),
        lead: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'fatsawtooth', count: 2, spread: 14, detune: 4 },
            envelope: { attack: 0.01, decay: 0.3, sustain: 0.45, release: 0.25 },
            filterEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.3, release: 0.25, baseFrequency: 400, octaves: 3, exponent: 2 },
            filter: { type: 'lowpass', frequency: 3800, Q: 2.4, rolloff: -24 }, portamento: 0.05, pan: 0.05,
            effects: [{ type: 'PingPongDelay', delayTime: '8n', feedback: 0.3, wet: 0.14 }, { type: 'Reverb', decay: 3, wet: 0.18, preDelay: 0.02 }], volume: -11
        }, {
            brightness: K.brightness(2200, 6500), resonance: K.resonance(1, 5), glide: K.glide(0, 0.12), echo: K.echo(0, 0.28),
            space: K.space(0.08, 0.3, 1.5, 4.5), osc: K.osc(['fatsawtooth', 'sawtooth', 'pwm']), level: K.level(-12, -9)
        }, 'Detuned saw mono lead with a resonant filter sweep, short glide, rhythmic echo and moderate space.'),
        arpeggio: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.004, decay: 0.13, sustain: 0.05, release: 0.1 },
            filterEnvelope: { attack: 0.002, decay: 0.12, sustain: 0.1, release: 0.12, baseFrequency: 300, octaves: 3, exponent: 2 },
            filter: { type: 'lowpass', frequency: 2400, Q: 2.2, rolloff: -24 }, portamento: 0.005, pan: 0.15,
            effects: [{ type: 'PingPongDelay', delayTime: '8n', feedback: 0.28, wet: 0.14 }, { type: 'Reverb', decay: 2, wet: 0.1, preDelay: 0.01 }], volume: -16
        }, {
            brightness: K.brightness(1200, 4200), resonance: K.resonance(0.8, 4), punch: K.punch(0.09, 0.2), echo: K.echo(0, 0.25),
            space: K.space(0.04, 0.2, 1, 3), level: K.level(-18, -14)
        }, 'Short resonant saw arpeggio with fast decay, dark filtering and subtle echo so it stays behind the lead.'),
        strings: P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsawtooth', count: 3, spread: 24, detune: 6 },
            envelope: { attack: 0.75, decay: 1.4, sustain: 0.78, release: 2.6 },
            filter: { type: 'lowpass', frequency: 1850, Q: 0.7, rolloff: -24 }, pan: 0.42,
            effects: [{ type: 'Chorus', frequency: 2, depth: 0.55, wet: 0.3 }, { type: 'Reverb', decay: 5.5, wet: 0.34, preDelay: 0.03 }], volume: -20
        }, {
            brightness: K.brightness(1200, 2600), swell: K.swell(0.45, 1.1),
            release: K.release(1.8, 3.5), width: K.width(14, 36)
        }, 'Detuned polyphonic strings bloom into nostalgic sustained harmony; soft filtering, restrained chorus and spacious reverb keep the layer behind the lead.')
    },

    band: {
        bassline: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.008, decay: 0.3, sustain: 0.7, release: 0.25 },
            filterEnvelope: { attack: 0.004, decay: 0.22, sustain: 0.4, release: 0.25, baseFrequency: 160, octaves: 2.5, exponent: 2 },
            filter: { type: 'lowpass', frequency: 800, Q: 1.1, rolloff: -24 }, portamento: 0.015, pan: 0,
            effects: [{ type: 'Distortion', distortion: 0.22, wet: 0.15 }], volume: -8
        }, {
            brightness: K.brightness(450, 1400), drive: K.drive(0, 0.25), punch: K.punch(0.2, 0.45), sustain: K.sustain(0.4, 0.85),
            glide: K.glide(0, 0.05), level: K.level(-10, -6)
        }, 'Round picked-bass feel: saw with a gentle filter envelope, long sustain and light overdrive for bite. Mono and dry.'),
        lead: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.02, decay: 0.4, sustain: 0.65, release: 0.35 },
            filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.3, baseFrequency: 600, octaves: 2.2, exponent: 2 },
            filter: { type: 'lowpass', frequency: 3600, Q: 1.4, rolloff: -24 }, portamento: 0.06, pan: 0.05,
            effects: [{ type: 'Distortion', distortion: 0.3, wet: 0.25 }, { type: 'PingPongDelay', delayTime: '4n', feedback: 0.22, wet: 0.1 }, { type: 'Reverb', decay: 1.8, wet: 0.14, preDelay: 0.02 }], volume: -11
        }, {
            brightness: K.brightness(2200, 5500), drive: K.drive(0.1, 0.4), glide: K.glide(0.02, 0.12), echo: K.echo(0, 0.2, '4n'),
            space: K.space(0.06, 0.22, 1, 3), osc: K.osc(['sawtooth', 'square', 'pwm', 'fatsawtooth']), level: K.level(-12, -9)
        }, 'Overdriven expressive saw lead: sustained, with legato glide, light echo and a short natural room.'),
        arpeggio: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.004, decay: 0.18, sustain: 0.06, release: 0.14 },
            filterEnvelope: { attack: 0.002, decay: 0.15, sustain: 0.1, release: 0.15, baseFrequency: 500, octaves: 2.5, exponent: 2 },
            filter: { type: 'lowpass', frequency: 3000, Q: 1, rolloff: -24 }, portamento: 0, pan: 0.15,
            effects: [{ type: 'Chorus', frequency: 2, depth: 0.4, wet: 0.12 }, { type: 'PingPongDelay', delayTime: '8n', feedback: 0.25, wet: 0.1 }, { type: 'Reverb', decay: 1.6, wet: 0.12, preDelay: 0.01 }], volume: -16
        }, {
            brightness: K.brightness(1600, 4500), punch: K.punch(0.1, 0.28), chorus: K.chorus(0, 0.3), echo: K.echo(0, 0.2),
            space: K.space(0.06, 0.22, 1, 2.6), level: K.level(-18, -14)
        }, 'Picked, guitar-like arpeggio: fast decay, mellow filter, slight chorus and a small room.'),
        plucks: P({
            instrumentType: 'PolySynth', oscillator: { type: 'square' },
            envelope: { attack: 0.005, decay: 0.28, sustain: 0.05, release: 0.2 },
            filter: { type: 'lowpass', frequency: 3200, Q: 1, rolloff: -24 }, pan: -0.2,
            effects: [{ type: 'Chorus', frequency: 2, depth: 0.45, wet: 0.18 }, { type: 'Reverb', decay: 1.5, wet: 0.12, preDelay: 0.01 }], volume: -16
        }, {
            brightness: K.brightness(2000, 5500), punch: K.punch(0.15, 0.4), chorus: K.chorus(0, 0.35), space: K.space(0.04, 0.2, 1, 2.6),
            osc: K.osc(['square', 'sawtooth', 'pwm']), level: K.level(-18, -14)
        }, 'Warm square-wave plucks with a short decay, light chorus and a natural room.'),
        'pad-textures': P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsquare', count: 2, spread: 8 },
            envelope: { attack: 0.14, decay: 0.8, sustain: 0.55, release: 1 },
            filter: { type: 'lowpass', frequency: 2800, Q: 0.7, rolloff: -24 }, pan: -0.22,
            effects: [{ type: 'Chorus', frequency: 1.8, depth: 0.6, wet: 0.3 }, { type: 'Reverb', decay: 2.2, wet: 0.22, preDelay: 0.02 }], volume: -15
        }, {
            brightness: K.brightness(1400, 4200), swell: K.swell(0.12, 0.35), release: K.release(0.6, 1.5), chorus: K.chorus(0.1, 0.4),
            space: K.space(0.1, 0.28, 1.4, 3.2), osc: K.osc(['fatsquare', 'fatsawtooth', 'fatsine']), level: K.level(-16, -12)
        }, 'Organ-like sustained layer: two detuned square voices, slow chorus swirl and a short natural room.'),
        strings: P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsawtooth', count: 3, spread: 24, detune: 6 },
            envelope: { attack: 0.75, decay: 1.4, sustain: 0.78, release: 2.6 },
            filter: { type: 'lowpass', frequency: 1850, Q: 0.7, rolloff: -24 }, pan: 0.42,
            effects: [{ type: 'Chorus', frequency: 2, depth: 0.55, wet: 0.3 }, { type: 'Reverb', decay: 5.5, wet: 0.34, preDelay: 0.03 }], volume: -20
        }, {
            brightness: K.brightness(1200, 2600), swell: K.swell(0.45, 1.1),
            release: K.release(1.8, 3.5), width: K.width(14, 36)
        }, 'Wide sustained string harmony with slow bloom, warm low-pass filtering and restrained modulation for a natural band-style backdrop.')
    },
    ambient: {
        bassline: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'triangle' },
            envelope: { attack: 0.04, decay: 0.5, sustain: 0.72, release: 0.7 },
            filterEnvelope: { attack: 0.03, decay: 0.4, sustain: 0.35, release: 0.6, baseFrequency: 70, octaves: 1.8, exponent: 2 },
            filter: { type: 'lowpass', frequency: 260, Q: 0.7, rolloff: -24 }, portamento: 0.04, pan: 0,
            effects: [{ type: 'Reverb', decay: 3.5, wet: 0.08, preDelay: 0.02 }], volume: -8
        }, {
            brightness: K.brightness(160, 420), sustain: K.sustain(0.55, 0.9), release: K.release(0.4, 1.2), glide: K.glide(0, 0.1)
        }, 'Soft triangle sub-bass with a slow, stable body and minimal ambience; supports the harmony without masking low frequencies.'),
        lead: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'fmsine' },
            envelope: { attack: 0.08, decay: 0.65, sustain: 0.5, release: 1.1 },
            filterEnvelope: { attack: 0.06, decay: 0.5, sustain: 0.25, release: 0.9, baseFrequency: 500, octaves: 1.5, exponent: 2 },
            filter: { type: 'lowpass', frequency: 2600, Q: 0.7, rolloff: -24 }, portamento: 0.06, pan: 0,
            effects: [{ type: 'Chorus', frequency: 0.7, depth: 0.35, wet: 0.16 }, { type: 'Reverb', decay: 6, wet: 0.3, preDelay: 0.04 }], volume: -11
        }, {
            brightness: K.brightness(1400, 4200), swell: K.swell(0.04, 0.22), release: K.release(0.7, 1.8), space: K.space(0.2, 0.42, 4, 8)
        }, 'Breathy FM sine lead with a gentle onset, restrained chorus and a long diffuse tail for sparse melodic phrases.'),
        arpeggio: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'triangle' },
            envelope: { attack: 0.012, decay: 0.28, sustain: 0.08, release: 0.35 },
            filterEnvelope: { attack: 0.008, decay: 0.24, sustain: 0.08, release: 0.3, baseFrequency: 450, octaves: 1.8, exponent: 2 },
            filter: { type: 'lowpass', frequency: 2100, Q: 0.7, rolloff: -24 }, portamento: 0, pan: 0.12,
            effects: [{ type: 'PingPongDelay', delayTime: '8n', feedback: 0.2, wet: 0.16 }, { type: 'Reverb', decay: 5, wet: 0.24, preDelay: 0.03 }], volume: -16
        }, {
            brightness: K.brightness(1000, 3200), punch: K.punch(0.18, 0.42), echo: K.echo(0.08, 0.24), space: K.space(0.12, 0.32, 3, 7)
        }, 'Rounded triangle arpeggio with softened transients and overlapping delay trails; favors spacious patterns over rhythmic attack.'),
        plucks: P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsine', count: 2, spread: 12, detune: 2 },
            envelope: { attack: 0.018, decay: 0.42, sustain: 0.04, release: 0.5 },
            filter: { type: 'lowpass', frequency: 3600, Q: 0.6, rolloff: -24 }, pan: -0.16,
            effects: [{ type: 'Chorus', frequency: 0.8, depth: 0.3, wet: 0.14 }, { type: 'Reverb', decay: 4.5, wet: 0.22, preDelay: 0.03 }], volume: -16
        }, {
            brightness: K.brightness(1800, 5200), punch: K.punch(0.25, 0.6), width: K.width(10, 24), space: K.space(0.12, 0.3, 2.5, 6)
        }, 'Delicate, rounded polyphonic plucks with a soft attack and lingering natural space; avoids sharp percussive brightness.'),
        'pad-textures': P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsine', count: 3, spread: 28, detune: 4 },
            envelope: { attack: 0.85, decay: 2.2, sustain: 0.78, release: 4.2 },
            filter: { type: 'lowpass', frequency: 1900, Q: 0.55, rolloff: -24 }, pan: 0.24,
            effects: [{ type: 'Chorus', frequency: 0.45, depth: 0.45, wet: 0.28 }, { type: 'Reverb', decay: 8, wet: 0.58, preDelay: 0.06 }], volume: -14
        }, {
            brightness: K.brightness(900, 2800), swell: K.swell(0.55, 1.2), release: K.release(3, 5), width: K.width(18, 42),
            space: K.space(0.42, 0.68, 6, 10)
        }, 'Slow-blooming sine-based harmonic bed with long release, subtle movement and a diffuse tail; the defining ambient layer.'),
        strings: P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsine', count: 3, spread: 20, detune: 3 },
            envelope: { attack: 1.1, decay: 1.8, sustain: 0.8, release: 4.5 },
            filter: { type: 'lowpass', frequency: 2400, Q: 0.55, rolloff: -24 }, pan: -0.3,
            effects: [{ type: 'Chorus', frequency: 0.55, depth: 0.4, wet: 0.24 }, { type: 'Reverb', decay: 8, wet: 0.52, preDelay: 0.05 }], volume: -18
        }, {
            brightness: K.brightness(1200, 3400), swell: K.swell(0.8, 1.5), release: K.release(3, 5), width: K.width(14, 36)
        }, 'Airy sustained string layer with a very gradual bloom, restrained modulation and long natural decay.'),
    },

    cinematic: {
        bassline: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'triangle' },
            envelope: { attack: 0.025, decay: 0.55, sustain: 0.78, release: 0.8 },
            filterEnvelope: { attack: 0.02, decay: 0.4, sustain: 0.45, release: 0.7, baseFrequency: 65, octaves: 2, exponent: 2 },
            filter: { type: 'lowpass', frequency: 320, Q: 0.8, rolloff: -24 }, portamento: 0.03, pan: 0,
            effects: [{ type: 'Reverb', decay: 2.5, wet: 0.08, preDelay: 0.02 }], volume: -8
        }, {
            brightness: K.brightness(180, 520), sustain: K.sustain(0.6, 0.9), release: K.release(0.5, 1.4), glide: K.glide(0, 0.08)
        }, 'Deep, controlled triangle foundation with a sustained cinematic weight while keeping the sub range centered and nearly dry.'),
        lead: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'fatsawtooth', count: 2, spread: 12, detune: 3 },
            envelope: { attack: 0.12, decay: 0.8, sustain: 0.62, release: 1.8 },
            filterEnvelope: { attack: 0.08, decay: 0.7, sustain: 0.45, release: 1.5, baseFrequency: 420, octaves: 2.5, exponent: 2 },
            filter: { type: 'lowpass', frequency: 3200, Q: 1.1, rolloff: -24 }, portamento: 0.05, pan: 0,
            effects: [{ type: 'Chorus', frequency: 0.8, depth: 0.3, wet: 0.12 }, { type: 'Reverb', decay: 6.5, wet: 0.34, preDelay: 0.05 }], volume: -11
        }, {
            brightness: K.brightness(1600, 5200), swell: K.swell(0.06, 0.28), release: K.release(1, 2.6), width: K.width(8, 24)
        }, 'Expressive sustained mono lead with a restrained detuned edge and a long cinematic room for broad melodic statements.'),
        arpeggio: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'fmsine' },
            envelope: { attack: 0.008, decay: 0.3, sustain: 0.08, release: 0.38 },
            filterEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.12, release: 0.32, baseFrequency: 500, octaves: 2, exponent: 2 },
            filter: { type: 'lowpass', frequency: 2600, Q: 0.8, rolloff: -24 }, portamento: 0, pan: 0.14,
            effects: [{ type: 'PingPongDelay', delayTime: '8n', feedback: 0.22, wet: 0.14 }, { type: 'Reverb', decay: 4.5, wet: 0.22, preDelay: 0.04 }], volume: -16
        }, {
            brightness: K.brightness(1200, 4200), punch: K.punch(0.18, 0.45), echo: K.echo(0.06, 0.22), space: K.space(0.1, 0.3, 2.5, 6)
        }, 'Measured FM arpeggio with a rounded attack and controlled repeats, suitable for building tension without sounding club-oriented.'),
        plucks: P({
            instrumentType: 'PolySynth', oscillator: { type: 'triangle' },
            envelope: { attack: 0.01, decay: 0.38, sustain: 0.03, release: 0.3 },
            filter: { type: 'lowpass', frequency: 4200, Q: 0.8, rolloff: -24 }, pan: -0.18,
            effects: [{ type: 'Reverb', decay: 4, wet: 0.2, preDelay: 0.04 }], volume: -16
        }, {
            brightness: K.brightness(2200, 6000), punch: K.punch(0.22, 0.5), space: K.space(0.1, 0.28, 2, 5)
        }, 'Clear triangle plucks with a controlled transient and a long but quiet tail for isolated cinematic motifs.'),
        'pad-textures': P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsawtooth', count: 3, spread: 30, detune: 5 },
            envelope: { attack: 0.65, decay: 1.8, sustain: 0.72, release: 3.6 },
            filter: { type: 'lowpass', frequency: 2200, Q: 0.6, rolloff: -24 }, pan: 0.25,
            effects: [{ type: 'Chorus', frequency: 0.65, depth: 0.42, wet: 0.24 }, { type: 'Reverb', decay: 7, wet: 0.48, preDelay: 0.05 }], volume: -14
        }, {
            brightness: K.brightness(1100, 3200), swell: K.swell(0.4, 1), release: K.release(2.5, 4.8), width: K.width(18, 44),
            space: K.space(0.34, 0.62, 5, 9)
        }, 'Wide sustained harmonic bed with a gradual swell and large controlled space for scene-setting chords.'),
        strings: P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsawtooth', count: 3, spread: 26, detune: 4 },
            envelope: { attack: 0.9, decay: 1.6, sustain: 0.82, release: 4 },
            filter: { type: 'lowpass', frequency: 2600, Q: 0.65, rolloff: -24 }, pan: -0.32,
            effects: [{ type: 'Chorus', frequency: 0.7, depth: 0.35, wet: 0.2 }, { type: 'Reverb', decay: 7.5, wet: 0.5, preDelay: 0.05 }], volume: -18
        }, {
            brightness: K.brightness(1400, 3800), swell: K.swell(0.65, 1.4), release: K.release(2.8, 5), width: K.width(16, 40)
        }, 'Broad sustained string voices with a slow attack, restrained modulation and long hall-like decay for dramatic harmonic arcs.'),
    },

    electronic: {
        bassline: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'square' },
            envelope: { attack: 0.006, decay: 0.24, sustain: 0.52, release: 0.18 },
            filterEnvelope: { attack: 0.003, decay: 0.2, sustain: 0.2, release: 0.16, baseFrequency: 75, octaves: 2.8, exponent: 2 },
            filter: { type: 'lowpass', frequency: 520, Q: 1.4, rolloff: -24 }, portamento: 0.025, pan: 0,
            effects: [{ type: 'Distortion', distortion: 0.16, wet: 0.08 }], volume: -8
        }, {
            brightness: K.brightness(260, 900), resonance: K.resonance(0.7, 2.8), punch: K.punch(0.14, 0.38), drive: K.drive(0, 0.18), glide: K.glide(0, 0.08)
        }, 'Focused square-wave mono bass with a controlled filter bite and modest saturation; versatile without assuming a specific club subgenre.'),
        lead: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'fmsawtooth' },
            envelope: { attack: 0.015, decay: 0.42, sustain: 0.5, release: 0.38 },
            filterEnvelope: { attack: 0.008, decay: 0.3, sustain: 0.35, release: 0.32, baseFrequency: 450, octaves: 2.8, exponent: 2 },
            filter: { type: 'lowpass', frequency: 4200, Q: 1.6, rolloff: -24 }, portamento: 0.035, pan: 0.05,
            effects: [{ type: 'Chorus', frequency: 1.2, depth: 0.35, wet: 0.16 }, { type: 'Delay', delayTime: '8n', feedback: 0.2, wet: 0.12 }], volume: -11
        }, {
            brightness: K.brightness(2200, 7000), resonance: K.resonance(0.8, 3.5), glide: K.glide(0, 0.1), chorus: K.chorus(0.05, 0.28), level: K.level(-12, -9)
        }, 'Flexible FM saw lead with moderate harmonic detail, subtle stereo modulation and a controlled rhythmic echo.'),
        arpeggio: P({
            instrumentType: 'MonoSynth', oscillator: { type: 'square' },
            envelope: { attack: 0.004, decay: 0.18, sustain: 0.04, release: 0.16 },
            filterEnvelope: { attack: 0.002, decay: 0.14, sustain: 0.08, release: 0.14, baseFrequency: 360, octaves: 2.5, exponent: 2 },
            filter: { type: 'lowpass', frequency: 2800, Q: 1.3, rolloff: -24 }, portamento: 0.005, pan: 0.16,
            effects: [{ type: 'PingPongDelay', delayTime: '8n', feedback: 0.25, wet: 0.16 }, { type: 'Reverb', decay: 2.8, wet: 0.14, preDelay: 0.02 }], volume: -16
        }, {
            brightness: K.brightness(1400, 4800), punch: K.punch(0.1, 0.26), echo: K.echo(0.04, 0.26), space: K.space(0.05, 0.24, 1.5, 4)
        }, 'Articulate square-wave sequence with a compact envelope and tempo-aware echo; designed to remain distinct from the lead.'),
        plucks: P({
            instrumentType: 'PolySynth', oscillator: { type: 'pwm', modulationFrequency: 0.8 },
            envelope: { attack: 0.006, decay: 0.26, sustain: 0.03, release: 0.18 },
            filter: { type: 'lowpass', frequency: 4800, Q: 1.2, rolloff: -24 }, pan: -0.18,
            effects: [{ type: 'Chorus', frequency: 1.6, depth: 0.4, wet: 0.16 }, { type: 'Reverb', decay: 2.8, wet: 0.16, preDelay: 0.02 }], volume: -16
        }, {
            brightness: K.brightness(2600, 7200), punch: K.punch(0.16, 0.36), chorus: K.chorus(0.04, 0.3), space: K.space(0.05, 0.22, 1.5, 4)
        }, 'Bright PWM poly plucks with a concise decay and light modulation; adds definition without dictating a dance arrangement.'),
        'pad-textures': P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsawtooth', count: 3, spread: 22, detune: 4 },
            envelope: { attack: 0.28, decay: 1.1, sustain: 0.58, release: 1.8 },
            filter: { type: 'lowpass', frequency: 2500, Q: 0.65, rolloff: -24 }, pan: 0.24,
            effects: [{ type: 'Chorus', frequency: 1.1, depth: 0.45, wet: 0.24 }, { type: 'Reverb', decay: 4.8, wet: 0.34, preDelay: 0.03 }], volume: -14
        }, {
            brightness: K.brightness(1400, 4200), swell: K.swell(0.18, 0.48), release: K.release(1.1, 2.4), width: K.width(14, 34),
            space: K.space(0.2, 0.44, 3, 6)
        }, 'Detuned analog-style sustained layer with moderate movement and width; more versatile and less overtly club-focused than the club family.'),
        strings: P({
            instrumentType: 'PolySynth', oscillator: { type: 'fatsquare', count: 2, spread: 16, detune: 3 },
            envelope: { attack: 0.48, decay: 1.2, sustain: 0.72, release: 2.4 },
            filter: { type: 'lowpass', frequency: 2300, Q: 0.7, rolloff: -24 }, pan: -0.28,
            effects: [{ type: 'Chorus', frequency: 1.1, depth: 0.45, wet: 0.24 }, { type: 'Reverb', decay: 4.8, wet: 0.32, preDelay: 0.03 }], volume: -18
        }, {
            brightness: K.brightness(1200, 3600), swell: K.swell(0.3, 0.8), release: K.release(1.6, 3.2), width: K.width(12, 30)
        }, 'Synth-string ensemble with a gradual attack, square-wave body and moderate stereo spread for electronic harmonic support.')
    },

};


// Additional families are generated from compact, explicit sound-design profiles.
// Each profile produces six complete patches; the LLM can still change only the
// bounded knobs declared below. This avoids copy/paste drift between related roles.
function makeFamilyPresets(profile) {
    const oscillator = (type, count = 2, spread = 16, detune = 3) => type.startsWith('fat')
        ? { type, count, spread, detune }
        : { type };
    const reverb = (role) => ({ type: 'Reverb', decay: profile.reverbDecay, wet: role === 'bassline' ? Math.min(0.08, profile.reverbWet) : profile.reverbWet, preDelay: profile.preDelay ?? 0.025 });
    const chorus = (wet = profile.chorusWet) => ({ type: 'Chorus', frequency: profile.chorusRate ?? 1.4, depth: 0.45, wet });
    const delay = (wet = profile.delayWet) => ({ type: 'PingPongDelay', delayTime: profile.delayTime ?? '8n', feedback: 0.22, wet });
    const filter = (frequency, q = 0.8) => ({ type: 'lowpass', frequency, Q: q, rolloff: -24 });
    const fx = (role) => {
        const out = [];
        if (role === 'bassline' && profile.drive > 0) out.push({ type: 'Distortion', distortion: profile.drive, wet: Math.min(0.18, profile.drive) });
        if (['lead', 'arpeggio'].includes(role) && profile.delayWet > 0) out.push(delay());
        if (['plucks', 'pad-textures', 'strings'].includes(role) && profile.chorusWet > 0) out.push(chorus());
        if (role !== 'bassline' || profile.bassReverb) out.push(reverb(role));
        return out;
    };

    return {
        bassline: P({
            instrumentType: 'MonoSynth', oscillator: oscillator(profile.bass),
            envelope: { attack: 0.008, decay: 0.28, sustain: profile.bassSustain ?? 0.62, release: 0.24 },
            filterEnvelope: { attack: 0.004, decay: 0.22, sustain: 0.3, release: 0.22, baseFrequency: profile.bassCutoff * 0.22, octaves: 2.2, exponent: 2 },
            filter: filter(profile.bassCutoff, 0.9), portamento: 0.015, pan: 0,
            effects: fx('bassline'), volume: -8
        }, {
            brightness: K.brightness(Math.max(120, profile.bassCutoff * 0.55), profile.bassCutoff),
            sustain: K.sustain(0.4, 0.85), punch: K.punch(0.16, 0.42), glide: K.glide(0, 0.08)
        }, profile.rationales.bassline),

        lead: P({
            instrumentType: 'MonoSynth', oscillator: oscillator(profile.lead, 3, 18, 4),
            envelope: { attack: profile.leadAttack ?? 0.015, decay: 0.38, sustain: 0.58, release: profile.leadRelease ?? 0.42 },
            filterEnvelope: { attack: 0.006, decay: 0.3, sustain: 0.35, release: 0.35, baseFrequency: 380, octaves: 2.4, exponent: 2 },
            filter: filter(profile.leadCutoff, 1.2), portamento: 0.045, pan: 0.04,
            effects: fx('lead'), volume: -11
        }, {
            brightness: K.brightness(Math.max(1000, profile.leadCutoff * 0.55), profile.leadCutoff),
            resonance: K.resonance(0.7, 3), glide: K.glide(0, 0.12), space: K.space(0.06, Math.min(0.68, profile.reverbWet + 0.12), 1.5, profile.reverbDecay)
        }, profile.rationales.lead),

        arpeggio: P({
            instrumentType: 'MonoSynth', oscillator: oscillator(profile.arp),
            envelope: { attack: 0.006, decay: profile.arpDecay ?? 0.22, sustain: 0.06, release: 0.22 },
            filterEnvelope: { attack: 0.003, decay: 0.18, sustain: 0.08, release: 0.2, baseFrequency: 420, octaves: 2, exponent: 2 },
            filter: filter(profile.arpCutoff, 0.9), portamento: 0, pan: 0.12,
            effects: fx('arpeggio'), volume: -16
        }, {
            brightness: K.brightness(1000, profile.arpCutoff), punch: K.punch(0.12, 0.38),
            echo: K.echo(0.04, Math.max(0.08, profile.delayWet + 0.08)), space: K.space(0.06, Math.min(0.68, profile.reverbWet + 0.12), 1.5, profile.reverbDecay)
        }, profile.rationales.arpeggio),

        plucks: P({
            instrumentType: 'PolySynth', oscillator: oscillator(profile.pluck),
            envelope: { attack: 0.006, decay: profile.pluckDecay ?? 0.28, sustain: 0.04, release: 0.2 },
            filter: filter(profile.pluckCutoff, 0.9), pan: -0.16,
            effects: fx('plucks'), volume: -16
        }, {
            brightness: K.brightness(1800, profile.pluckCutoff), punch: K.punch(0.14, 0.42),
            chorus: K.chorus(0, Math.max(0.2, profile.chorusWet + 0.08)), space: K.space(0.04, Math.min(0.68, profile.reverbWet + 0.12), 1.2, profile.reverbDecay)
        }, profile.rationales.plucks),

        'pad-textures': P({
            instrumentType: 'PolySynth', oscillator: oscillator(profile.pad, 3, 26, 4),
            envelope: { attack: profile.padAttack, decay: profile.padDecay ?? 1.1, sustain: 0.62, release: profile.padRelease },
            filter: filter(profile.padCutoff, 0.6), pan: 0.22,
            effects: fx('pad-textures'), volume: -14
        }, {
            brightness: K.brightness(900, profile.padCutoff), swell: K.swell(Math.max(0.08, profile.padAttack * 0.7), Math.min(1.5, profile.padAttack * 1.5)),
            release: K.release(Math.max(0.5, profile.padRelease * 0.7), Math.min(5, profile.padRelease * 1.25)),
            space: K.space(Math.max(0.08, profile.reverbWet - 0.08), Math.min(0.68, profile.reverbWet + 0.12), Math.max(1.5, profile.reverbDecay - 1), Math.min(10, profile.reverbDecay + 2))
        }, profile.rationales.pad),

        strings: P({
            instrumentType: 'PolySynth', oscillator: oscillator(profile.strings, 3, 28, 4),
            envelope: { attack: profile.stringAttack, decay: 1.5, sustain: 0.78, release: profile.stringRelease },
            filter: filter(profile.stringCutoff, 0.65), pan: -0.3,
            effects: fx('strings'), volume: -18
        }, {
            brightness: K.brightness(1000, profile.stringCutoff), swell: K.swell(Math.max(0.2, profile.stringAttack * 0.7), Math.min(1.6, profile.stringAttack * 1.35)),
            release: K.release(Math.max(1, profile.stringRelease * 0.7), Math.min(5, profile.stringRelease * 1.2)), width: K.width(12, 36)
        }, profile.rationales.strings)
    };
}

Object.assign(FAMILIES, {
    urban: makeFamilyPresets({
        bass: 'square', lead: 'fatsawtooth', arp: 'triangle', pluck: 'square', pad: 'fatsquare', strings: 'fatsawtooth',
        bassCutoff: 360, leadCutoff: 3400, arpCutoff: 2600, pluckCutoff: 4300, padCutoff: 2400, stringCutoff: 2500,
        reverbWet: 0.22, reverbDecay: 2.4, chorusWet: 0.12, delayWet: 0.13, drive: 0.16,
        padAttack: 0.2, padRelease: 1.3, stringAttack: 0.55, stringRelease: 2.8,
        rationales: {
            bassline: 'Focused square mono bass with a firm low-pass contour and restrained saturation for modern urban weight.',
            lead: 'Detuned saw lead with a compact filter contour and measured delay for melodic hooks without excessive wash.',
            arpeggio: 'Lean triangle arpeggio with a clear transient and short rhythmic repeats, leaving space for the vocal-like lead.',
            plucks: 'Compact square plucks with a defined attack and restrained room, suited to sparse syncopated motifs.',
            pad: 'Dark square-based harmonic bed with a controlled swell and modest width behind the foreground rhythm.',
            strings: 'Restrained saw-string layer with a gradual onset, narrow harmonic focus and supportive stereo width.'
        }
    }),
    groove: makeFamilyPresets({
        bass: 'sawtooth', lead: 'square', arp: 'triangle', pluck: 'square', pad: 'fatsquare', strings: 'fatsawtooth',
        bassCutoff: 620, leadCutoff: 4200, arpCutoff: 3400, pluckCutoff: 5200, padCutoff: 3000, stringCutoff: 3200,
        reverbWet: 0.18, reverbDecay: 1.8, chorusWet: 0.24, delayWet: 0.06, drive: 0.08,
        padAttack: 0.14, padRelease: 0.9, stringAttack: 0.42, stringRelease: 2.4,
        rationales: {
            bassline: 'Rubbery mono saw bass with a quick filter response and mild drive for a tight, articulated groove.',
            lead: 'Bright square lead with a punchy envelope and light space, keeping melodic phrases crisp and forward.',
            arpeggio: 'Short triangle arpeggio with quick decay and subtle movement to reinforce syncopated rhythmic figures.',
            plucks: 'Clavinet-like square plucks with a sharp transient, gentle chorus and a compact room.',
            pad: 'Compact sustained square pad that adds harmonic color without softening the rhythmic pocket.',
            strings: 'Bright ensemble strings with a moderate bloom and light chorus for rhythmic accents and lifted sections.'
        }
    }),
    roots: makeFamilyPresets({
        bass: 'triangle', lead: 'sine', arp: 'triangle', pluck: 'square', pad: 'fatsine', strings: 'fatsine',
        bassCutoff: 300, leadCutoff: 2800, arpCutoff: 2200, pluckCutoff: 3600, padCutoff: 2100, stringCutoff: 2500,
        reverbWet: 0.2, reverbDecay: 2.8, chorusWet: 0.1, delayWet: 0.14, drive: 0,
        padAttack: 0.24, padRelease: 1.5, stringAttack: 0.7, stringRelease: 3,
        rationales: {
            bassline: 'Round triangle bass with a stable low register and gentle articulation, keeping the foundation warm and centered.',
            lead: 'Soft sine lead with a smooth filter contour and restrained delay for melodic phrases that stay relaxed.',
            arpeggio: 'Rounded triangle arpeggio with gentle repeats and no sharp high-frequency edge.',
            plucks: 'Offbeat square-key plucks with a concise envelope and warm room, designed to leave rhythmic gaps clear.',
            pad: 'Soft sine harmonic layer with slow movement and modest reverb, supporting harmony without masking the groove.',
            strings: 'Warm sine-string ensemble with a slow bloom and natural space for subtle sustained support.'
        }
    }),
    jazz: makeFamilyPresets({
        bass: 'triangle', lead: 'fmsine', arp: 'fmsine', pluck: 'fmsine', pad: 'fatsine', strings: 'fatsine',
        bassCutoff: 340, leadCutoff: 4200, arpCutoff: 3600, pluckCutoff: 4800, padCutoff: 2800, stringCutoff: 3000,
        reverbWet: 0.18, reverbDecay: 2.6, chorusWet: 0.2, delayWet: 0.04, drive: 0,
        padAttack: 0.32, padRelease: 1.8, stringAttack: 0.65, stringRelease: 3.2,
        rationales: {
            bassline: 'Upright-inspired triangle mono bass with a rounded low-pass response and centered, nearly dry placement.',
            lead: 'Expressive FM sine lead with a mellow filter and subtle room, suited to fluid melodic phrasing.',
            arpeggio: 'Soft FM arpeggio with gentle note definition and restrained ambience rather than a bright sequenced pulse.',
            plucks: 'Electric-piano-like FM plucks with a rounded transient, gentle chorus and light room reverb.',
            pad: 'Sine-based harmonic cushion with slow attack and subtle chorus, preserving room for extended voicings.',
            strings: 'Soft sine-string ensemble with gradual bloom and restrained modulation for understated harmonic support.'
        }
    }),
    orchestral: makeFamilyPresets({
        bass: 'triangle', lead: 'fatsine', arp: 'sine', pluck: 'triangle', pad: 'fatsine', strings: 'fatsine',
        bassCutoff: 320, leadCutoff: 4800, arpCutoff: 3000, pluckCutoff: 4200, padCutoff: 3000, stringCutoff: 3400,
        reverbWet: 0.48, reverbDecay: 7, chorusWet: 0.16, delayWet: 0.08, drive: 0,
        padAttack: 0.8, padRelease: 4, stringAttack: 0.95, stringRelease: 4.4,
        rationales: {
            bassline: 'Centered triangle foundation with a measured sustain and restrained hall ambience beneath the orchestral harmony.',
            lead: 'Soft multi-voice sine lead with a gradual envelope and broad natural space for lyrical melodic statements.',
            arpeggio: 'Measured sine arpeggio with a rounded attack and controlled hall tail for delicate ostinato movement.',
            plucks: 'Clear triangle articulations with a gentle transient and quiet hall tail for orchestral motifs.',
            pad: 'Slow-blooming sine harmonic bed with long release and broad hall ambience for sustained orchestral harmony.',
            strings: 'Sustained sine-string ensemble with a gradual bloom and spacious hall tail, avoiding synthetic club modulation.'
        }
    }),
    pop: makeFamilyPresets({
        bass: 'sawtooth', lead: 'fatsawtooth', arp: 'square', pluck: 'sawtooth', pad: 'fatsawtooth', strings: 'fatsawtooth',
        bassCutoff: 520, leadCutoff: 5200, arpCutoff: 3800, pluckCutoff: 5600, padCutoff: 3400, stringCutoff: 3600,
        reverbWet: 0.25, reverbDecay: 2.8, chorusWet: 0.22, delayWet: 0.1, drive: 0.04,
        padAttack: 0.2, padRelease: 1.4, stringAttack: 0.62, stringRelease: 3,
        rationales: {
            bassline: 'Clean mono saw bass with a focused low-pass contour and light saturation for a polished pop foundation.',
            lead: 'Bright detuned saw lead with a smooth filter contour and moderate space for a clear melodic hook.',
            arpeggio: 'Bright square arpeggio with a concise envelope and subtle echo for forward motion between vocal phrases.',
            plucks: 'Polished saw plucks with a crisp transient, gentle chorus and a controlled room tail.',
            pad: 'Wide analog-style pad with a smooth swell and moderate chorus, filling harmony without crowding the lead.',
            strings: 'Bright sustained string layer with a gradual attack and polished width for lifted chorus sections.'
        }
    }),
    downtempo: makeFamilyPresets({
        bass: 'triangle', lead: 'fmsine', arp: 'triangle', pluck: 'fatsine', pad: 'fatsine', strings: 'fatsine',
        bassCutoff: 280, leadCutoff: 3600, arpCutoff: 2600, pluckCutoff: 4200, padCutoff: 2500, stringCutoff: 2800,
        reverbWet: 0.35, reverbDecay: 5, chorusWet: 0.2, delayWet: 0.18, drive: 0,
        padAttack: 0.48, padRelease: 2.2, stringAttack: 0.82, stringRelease: 3.8,
        rationales: {
            bassline: 'Soft triangle mono bass with a rounded contour and slow decay for an unhurried low-frequency foundation.',
            lead: 'Mellow FM lead with a soft onset, subtle delay and diffuse room for relaxed melodic phrases.',
            arpeggio: 'Rounded triangle arpeggio with softened transients and overlapping echoes for an unhurried sequence.',
            plucks: 'Gentle sine plucks with a soft transient, light chorus and lingering space rather than sharp attacks.',
            pad: 'Slow-evolving sine pad with a long release and diffuse reverb for a relaxed harmonic atmosphere.',
            strings: 'Airy sustained sine strings with a gradual bloom and diffuse tail, adding depth without a bright orchestral edge.'
        }
    })
});

// ── GENRE overrides (opt-in: an entry, even `{}`, enables the pipeline for that genre + track) ───────
const GENRES = {
    techno: {
        bassline: { patch: { filter: { frequency: 360, Q: 2.2 }, envelope: { decay: 0.18, sustain: 0.35 }, filterEnvelope: { baseFrequency: 80, octaves: 3.2 }, portamento: 0.02 },
            rationale: 'Dark rolling techno bass: tight saw with a resonant, low filter bite, nearly dry and mono.' },
        plucks: { patch: { filter: { frequency: 4800 }, envelope: { decay: 0.22 } },
            rationale: 'Sharp techno plucks: transient first, short body, dub-style echo and a small room.' },
        'pad-textures': { patch: { filter: { frequency: 2200 } },
            rationale: 'Sustained evolving triads with slow filter motion; dark and wide, sitting behind the plucks.' },
        lead: { patch: { filter: { frequency: 3400 } }, rationale: 'Hypnotic detuned lead with a resonant sweep, short glide and rhythmic echo.' },
        arpeggio: {},
        strings: {}
    },
    'progressive-rock': {
        bassline: { patch: { filter: { frequency: 900 } }, rationale: 'Round, sustained bass with gentle overdrive; warm and punchy rather than club-tight.' },
        lead: { patch: { envelope: { sustain: 0.7 }, portamento: 0.07 }, rationale: 'Singing overdriven lead with long sustain and legato glides, short natural room.' },
        arpeggio: { patch: { filter: { frequency: 3200 } }, rationale: 'Picked guitar-like arpeggio: fast decay, mellow filter, light chorus.' },
        plucks: {},
        'pad-textures': {},
        strings: {}
    }
};

// Melody is a distinct polyphonic role, but most family profiles historically
// defined only a lead. Derive a restrained, family-aware melody voice from that
// family's lead palette rather than sending melody tracks through the legacy
// unconstrained LLM patch path. This adds no new oscillator/effect types.
function deriveMelodyPreset(lead, family) {
    if (!lead?.patch) return null;
    const patch = clone(lead.patch);
    patch.instrumentType = 'PolySynth';
    delete patch.filterEnvelope;
    delete patch.portamento;

    const longFormFamilies = ['ambient', 'cinematic', 'orchestral', 'downtempo'];
    const longForm = longFormFamilies.includes(family);
    const sourceEnv = patch.envelope || {};
    patch.envelope = {
        attack: longForm ? clamp(sourceEnv.attack ?? 0.1, 0.08, 0.3) : clamp(sourceEnv.attack ?? 0.02, 0.005, 0.08),
        decay: clamp(sourceEnv.decay ?? 0.3, 0.15, longForm ? 1.2 : 0.8),
        sustain: clamp(sourceEnv.sustain ?? 0.5, longForm ? 0.45 : 0.3, 0.78),
        release: longForm ? clamp(sourceEnv.release ?? 1, 0.8, 2.2) : clamp(sourceEnv.release ?? 0.3, 0.15, 0.65)
    };

    // Keep fat oscillators modest: the melody becomes polyphonic, so avoid
    // multiplying the lead's full oscillator stack across every simultaneous note.
    if (patch.oscillator?.type?.startsWith('fat')) {
        patch.oscillator.count = 2;
        patch.oscillator.spread = clamp(patch.oscillator.spread ?? 15, 10, 22);
        patch.oscillator.detune = clamp(patch.oscillator.detune ?? 3, 0, 8);
    }
    patch.effects = (patch.effects || []).map(effect => ({
        ...effect,
        ...(typeof effect.wet === 'number' ? { wet: round(effect.wet * 0.8) } : {})
    }));
    patch.volume = Math.min(-12, Number.isFinite(patch.volume) ? patch.volume : -11);
    patch.pan = 0;

    const vary = Object.fromEntries(Object.entries(lead.vary || {}).filter(([name]) => name !== 'glide'));
    return P(
        patch,
        vary,
        `Polyphonic ${family} melody derived from the family lead palette, with a gentler envelope, centered placement and restrained effects.`
    );
}


function deriveKeysPreset(plucks, family) {
    if (!plucks?.patch) return null;
    const patch = clone(plucks.patch);
    patch.instrumentType = 'PolySynth';
    delete patch.filterEnvelope;
    delete patch.portamento;

    const env = patch.envelope || {};
    patch.envelope = {
        attack: clamp(env.attack ?? 0.008, 0.002, 0.025),
        decay: clamp(env.decay ?? 0.28, 0.12, 0.45),
        sustain: clamp(env.sustain ?? 0.08, 0.02, 0.35),
        release: clamp(env.release ?? 0.18, 0.08, 0.3)
    };
    if (patch.oscillator?.type?.startsWith('fat')) {
        patch.oscillator.count = 2;
        patch.oscillator.spread = clamp(patch.oscillator.spread ?? 12, 10, 18);
        patch.oscillator.detune = clamp(patch.oscillator.detune ?? 2, 0, 6);
    }
    patch.effects = (patch.effects || []).map(effect => ({
        ...effect,
        ...(typeof effect.wet === 'number' ? { wet: round(effect.wet * 0.7) } : {})
    }));
    patch.volume = Math.min(-15, Number.isFinite(patch.volume) ? patch.volume : -16);
    patch.pan = 0;

    const vary = {
        brightness: K.brightness(1200, 6500),
        punch: K.punch(0.12, 0.42),
        level: K.level(-20, -14)
    };
    return P(
        patch,
        vary,
        `Articulate ${family} keys derived from the family pluck palette, with a compact polyphonic envelope and restrained effects.`
    );
}

function deriveChordPreset(pad, family) {
    if (!pad?.patch) return null;
    const patch = clone(pad.patch);
    patch.instrumentType = 'PolySynth';
    delete patch.filterEnvelope;
    delete patch.portamento;

    const longFormFamilies = ['ambient', 'cinematic', 'orchestral', 'downtempo'];
    const longForm = longFormFamilies.includes(family);
    const env = patch.envelope || {};
    patch.envelope = {
        attack: longForm ? clamp(env.attack ?? 0.45, 0.25, 0.65) : clamp(env.attack ?? 0.12, 0.06, 0.25),
        decay: clamp(env.decay ?? 0.9, 0.5, 1.4),
        sustain: clamp(env.sustain ?? 0.6, 0.45, 0.78),
        release: longForm ? clamp(env.release ?? 1.8, 1.2, 2.4) : clamp(env.release ?? 0.8, 0.4, 1.2)
    };
    if (patch.oscillator?.type?.startsWith('fat')) {
        patch.oscillator.count = 2;
        patch.oscillator.spread = clamp(patch.oscillator.spread ?? 18, 10, 20);
        patch.oscillator.detune = clamp(patch.oscillator.detune ?? 3, 0, 7);
    }
    patch.effects = (patch.effects || []).map(effect => ({
        ...effect,
        ...(typeof effect.wet === 'number' ? { wet: round(effect.wet * 0.75) } : {})
    }));
    patch.volume = Math.min(-17, Number.isFinite(patch.volume) ? patch.volume : -17);
    patch.pan = 0;

    return P(
        patch,
        {
            brightness: K.brightness(850, 4200),
            swell: K.swell(longForm ? 0.25 : 0.06, longForm ? 0.65 : 0.25),
            release: K.release(longForm ? 1.2 : 0.4, longForm ? 2.4 : 1.2)
        },
        `Balanced ${family} chord layer derived from the family pad palette, with controlled sustain, moderate width and a shorter effects tail.`
    );
}

// Guitar uses Tone.PluckSynth's Karplus–Strong string model rather than
// another subtractive PolySynth. Keep the physical-string controls bounded;
// the renderer supplies a small polyphonic voice pool for overlapping MIDI notes.
function deriveGuitarPreset(plucks, family) {
    if (!plucks?.patch) return null;
    const patch = clone(plucks.patch);
    patch.instrumentType = 'PluckSynth';
    delete patch.filterEnvelope;
    delete patch.portamento;
    delete patch.oscillator;
    delete patch.filter;

    const env = patch.envelope || {};
    patch.envelope = {
        attack: 0.001,
        decay: clamp(env.decay ?? 0.3, 0.12, 0.55),
        sustain: 0,
        release: clamp(env.release ?? 0.18, 0.08, 0.3)
    };
    const familyDampening = {
        band: 4200, jazz: 3400, roots: 3000, urban: 3600,
        groove: 5200, orchestral: 3000, ambient: 2800,
        cinematic: 3200, downtempo: 3200, pop: 4600,
        club: 5000, electronic: 4500
    };
    patch.pluck = {
        attackNoise: 1.2,
        dampening: familyDampening[family] || 4000,
        resonance: family === 'ambient' || family === 'cinematic' ? 0.88 : 0.78
    };
    patch.effects = (patch.effects || []).map(effect => ({
        ...effect,
        ...(typeof effect.wet === 'number' ? { wet: round(effect.wet * 0.55) } : {})
    }));
    patch.volume = Math.min(-15, Number.isFinite(patch.volume) ? patch.volume : -16);
    patch.pan = 0;

    return P(
        patch,
        {
            pluckDampening: K.pluckDampening(1800, 9000),
            pluckResonance: K.pluckResonance(0.55, 0.94),
            pluckAttackNoise: K.pluckAttackNoise(0.5, 2.5),
            level: K.level(-20, -14)
        },
        `Karplus–Strong ${family} guitar: plucked string excitation, family-tuned damping and resonance, with restrained spatial effects.`
    );
}

// Brass uses each family's lead timbre as its harmonic starting point, but
// reshapes it into a polyphonic, sustained section voice rather than a mono lead.
function deriveBrassPreset(lead, family) {
    if (!lead?.patch) return null;
    const patch = clone(lead.patch);
    patch.instrumentType = 'PolySynth';
    delete patch.filterEnvelope;
    delete patch.portamento;

    const longFormFamilies = ['ambient', 'cinematic', 'orchestral', 'downtempo'];
    const longForm = longFormFamilies.includes(family);
    const env = patch.envelope || {};
    patch.envelope = {
        attack: longForm ? clamp(env.attack ?? 0.08, 0.04, 0.18) : clamp(env.attack ?? 0.025, 0.008, 0.06),
        decay: clamp(env.decay ?? 0.45, 0.25, 0.9),
        sustain: clamp(env.sustain ?? 0.58, 0.4, 0.78),
        release: longForm ? clamp(env.release ?? 0.8, 0.55, 1.5) : clamp(env.release ?? 0.35, 0.2, 0.7)
    };
    if (patch.oscillator?.type?.startsWith('fat')) {
        patch.oscillator.count = 2;
        patch.oscillator.spread = clamp(patch.oscillator.spread ?? 16, 10, 20);
        patch.oscillator.detune = clamp(patch.oscillator.detune ?? 3, 0, 8);
    }
    if (patch.filter) {
        patch.filter.frequency = clamp(patch.filter.frequency ?? 3600, 1800, 7000);
        patch.filter.Q = clamp(patch.filter.Q ?? 1, 0.5, 1.8);
    }
    patch.effects = (patch.effects || []).map(effect => ({
        ...effect,
        ...(typeof effect.wet === 'number' ? { wet: round(effect.wet * 0.7) } : {})
    }));
    patch.volume = Math.min(-13, Number.isFinite(patch.volume) ? patch.volume : -14);
    patch.pan = 0;

    return P(
        patch,
        {
            brightness: K.brightness(1800, 7500),
            punch: K.punch(0.25, 0.8),
            level: K.level(-16, -10)
        },
        `Polyphonic ${family} brass derived from the family lead palette, with a firm ensemble attack, controlled sustain and restrained effects.`
    );
}

// ── resolver ─────────────────────────────────────────────────────────────────
/**
 * @returns {null | { id, genre, family, trackType, level, patch, vary, rationale }}
 * level 'genre' = explicit override exists; 'family' = only the family base exists.
 */
export function resolvePreset({ genre, trackType } = {}) {
    const g = normalizeGenre(genre);
    const t = normalizeTrack(trackType);
    const family = GENRE_FAMILY[g];
    const familyPresets = family && FAMILIES[family];
    const base = familyPresets?.[t] || (t === 'melody' ? deriveMelodyPreset(familyPresets?.lead, family) : t === 'keys' ? deriveKeysPreset(familyPresets?.plucks, family) : t === 'chord' ? deriveChordPreset(familyPresets?.['pad-textures'], family) : t === 'guitar' ? deriveGuitarPreset(familyPresets?.plucks, family) : t === 'brass' ? deriveBrassPreset(familyPresets?.lead, family) : null);
    if (!base) return null;
    const override = GENRES[g]?.[t];
    const merged = deepMerge(base, override || {});
    return {
        id: `${g}/${t}`, genre: g, family, trackType: t,
        level: override ? 'genre' : 'family',
        patch: merged.patch, vary: merged.vary, rationale: merged.rationale
    };
}

export function listPresets() {
    const out = [];
    for (const g of Object.keys(GENRE_FAMILY)) {
        for (const t of Object.keys(TRACK_RULES)) {
            const r = resolvePreset({ genre: g, trackType: t });
            if (r) out.push(r);
        }
    }
    return out;
}

// ── knob mapping ─────────────────────────────────────────────────────────────
function leafSpecs(spec) { return spec.targets ? spec.targets : [spec]; }

function posToValue(spec, pos) {
    const p = clamp(Number(pos), 0, 1);
    const v = spec.log ? Math.exp(Math.log(spec.min) + p * (Math.log(spec.max) - Math.log(spec.min))) : spec.min + p * (spec.max - spec.min);
    return round(v, v < 1 ? 3 : 1);
}
function valueToPos(spec, v) {
    if (!Number.isFinite(v)) return null;
    const p = spec.log ? (Math.log(v) - Math.log(spec.min)) / (Math.log(spec.max) - Math.log(spec.min)) : (v - spec.min) / (spec.max - spec.min);
    return round(clamp(p, 0, 1), 2);
}
function findFx(patch, type) { return (patch.effects || []).find((e) => e.type === type); }
function readSpecValue(patch, spec) {
    if (spec.fx) { const fx = findFx(patch, spec.fx); return fx ? fx[spec.param] : undefined; }
    return getPath(patch, spec.path);
}

/** Default knob positions (0..1) of a preset, plus whether the preset value is inside the allowed range. */
export function knobDefaults(preset) {
    const out = {};
    for (const [name, spec] of Object.entries(preset.vary)) {
        if (spec.choice) { out[name] = { choice: getPath(preset.patch, spec.choice), options: spec.options }; continue; }
        const first = leafSpecs(spec)[0];
        const raw = readSpecValue(preset.patch, first);
        out[name] = { pos: raw === undefined ? valueToPos(first, first.min) : valueToPos(first, raw), value: raw, inRange: raw === undefined || (raw >= first.min - 1e-9 && raw <= first.max + 1e-9) };
    }
    return out;
}

function applyLeaf(patch, spec, pos) {
    const value = posToValue(spec, pos);
    if (spec.fx) {
        let fx = findFx(patch, spec.fx);
        if (!fx && spec.add) { fx = clone(spec.add); patch.effects = [...(patch.effects || []), fx]; }
        if (fx) fx[spec.param] = value;
        return;
    }
    setPath(patch, spec.path, value);
}

function applyOscChoice(patch, type) {
    if (!VALID_OSC.includes(type)) return;
    patch.oscillator = patch.oscillator || {};
    patch.oscillator.type = type;
    if (type.startsWith('fat')) {
        patch.oscillator.count = patch.oscillator.count || 2;
        patch.oscillator.spread = patch.oscillator.spread || 15;
    } else {
        delete patch.oscillator.count; delete patch.oscillator.spread;
    }
    if (type === 'pwm') patch.oscillator.modulationFrequency = patch.oscillator.modulationFrequency || 0.8;
    else delete patch.oscillator.modulationFrequency;
}

/** Keep only known knobs, clamp to 0..1, restrict oscillator choices. Never throws. */
export function sanitizeVariation(preset, raw) {
    const out = { knobs: {}, choices: {}, rationale: '' };
    if (!isObj(raw)) return out;

    // Enforce the prompt's four-knob budget in code, not only through instructions.
    // Numeric positions are independently clamped to 0..1 and mapped into each
    // preset's explicit parameter range by applyVariation().
    let accepted = 0;
    for (const [name, spec] of Object.entries(preset.vary)) {
        if (!(name in raw) || accepted >= 4) continue;
        if (spec.choice) {
            const key = typeof raw[name] === 'string' ? raw[name].trim().toLowerCase() : '';
            if (spec.options.includes(key)) {
                out.choices[name] = key;
                accepted++;
            }
        } else {
            const n = Number(raw[name]);
            if (Number.isFinite(n)) {
                out.knobs[name] = clamp(n, 0, 1);
                accepted++;
            }
        }
    }
    if (typeof raw.rationale === 'string') out.rationale = raw.rationale.replace(/\s+/g, ' ').trim().split(' ').slice(0, 30).join(' ');
    return out;
}

export function applyVariation(preset, variation = {}) {
    const patch = clone(preset.patch);
    for (const [name, pos] of Object.entries(variation.knobs || {})) {
        const spec = preset.vary[name];
        if (!spec || spec.choice) continue;
        for (const leaf of leafSpecs(spec)) applyLeaf(patch, leaf, pos);
    }
    for (const [name, type] of Object.entries(variation.choices || {})) {
        const spec = preset.vary[name];
        if (spec?.choice) applyOscChoice(patch, type);
    }
    return patch;
}

// ── final merge + clamp + mix rules ──────────────────────────────────────────
/**
 * @returns {{ patch: object, warnings: string[] }}  a complete patch the renderer can use as-is
 */
export function finalizePatch({ preset, variation = {}, midi = null }) {
    const warnings = [];
    const patch = applyVariation(preset, variation);
    const t = preset.trackType;
    const rules = TRACK_RULES[t] || { vol: [-18, -10], pan: [-0.5, 0.5] };
    const fam = FAMILY_RULES[preset.family] || { forbidFx: [], maxReverbWet: 0.7 };
    const note = (m) => warnings.push(m);

    // instrument + oscillator consistency
    if (!VALID_INSTRUMENTS.includes(patch.instrumentType)) { patch.instrumentType = 'PolySynth'; note('invalid instrumentType → PolySynth'); }
    const isMono = patch.instrumentType === 'MonoSynth';
    if (!isMono) { if (patch.filterEnvelope) { delete patch.filterEnvelope; note('filterEnvelope removed (not MonoSynth)'); } if ('portamento' in patch) { delete patch.portamento; note('portamento removed (not MonoSynth)'); } }
    if (patch.oscillator) {
        if (!VALID_OSC.includes(patch.oscillator.type)) { patch.oscillator.type = 'sawtooth'; note('invalid oscillator → sawtooth'); }
        if (!patch.oscillator.type.startsWith('fat')) { delete patch.oscillator.count; delete patch.oscillator.spread; }
        else {
            patch.oscillator.count = clamp(Math.round(patch.oscillator.count || 2), 2, 4);
            patch.oscillator.spread = clamp(patch.oscillator.spread || 15, 10, 60);
        }
        if (patch.oscillator.detune != null) patch.oscillator.detune = clamp(patch.oscillator.detune, 0, 25);
    }

    if (patch.instrumentType === 'PluckSynth') {
        const pluck = patch.pluck || {};
        patch.pluck = {
            attackNoise: round(clamp(pluck.attackNoise ?? 1.2, 0.1, 4)),
            dampening: Math.round(clamp(pluck.dampening ?? 4000, 1000, 12000)),
            resonance: round(clamp(pluck.resonance ?? 0.78, 0.1, 0.98), 3)
        };
    }

    // numeric limits (schema ranges)
    const env = patch.envelope;
    if (env) {
        env.attack = clamp(env.attack, 0.001, 2); env.decay = clamp(env.decay, 0.01, 3);
        env.sustain = clamp(env.sustain, 0, 1); env.release = clamp(env.release, 0.01, 5);
        for (const k of Object.keys(env)) env[k] = round(env[k]);
    }
    const fe = patch.filterEnvelope;
    if (fe) {
        fe.attack = clamp(fe.attack, 0.001, 1); fe.decay = clamp(fe.decay, 0.1, 2); fe.sustain = clamp(fe.sustain, 0, 1);
        fe.release = clamp(fe.release, 0.1, 3); fe.baseFrequency = clamp(fe.baseFrequency, 20, 2000);
        fe.octaves = clamp(fe.octaves, 1, 8); fe.exponent = clamp(fe.exponent, 1, 3);
    }
    if (patch.filter) {
        patch.filter.frequency = clamp(patch.filter.frequency, 100, t === 'bassline' ? 1200 : 18000);
        patch.filter.Q = clamp(patch.filter.Q, 0.1, 10);
        patch.filter.frequency = Math.round(patch.filter.frequency);
        patch.filter.Q = round(patch.filter.Q, 2);
        if (t === 'bassline') patch.filter.type = 'lowpass';
    }
    if (typeof patch.portamento === 'number') patch.portamento = round(clamp(patch.portamento, 0, 0.3));

    // effects: per-family allow-list, track rules, clamps, order
    let fx = (patch.effects || []).filter((e) => e && typeof e.type === 'string');
    fx = fx.filter((e) => { if (fam.forbidFx.includes(e.type)) { note(`${e.type} removed (not used in ${preset.family} genres)`); return false; } return true; });
    if (t === 'bassline') fx = fx.filter((e) => { if (e.type === 'Chorus' || e.type === 'Phaser') { note(`${e.type} removed from bassline`); return false; } return true; });
    for (const e of fx) {
        const max = e.type === 'Reverb' ? Math.min(FX_WET_MAX.Reverb, t === 'bassline' ? 0.1 : fam.maxReverbWet) : FX_WET_MAX[e.type] ?? 0.5;
        if (typeof e.wet === 'number') e.wet = round(clamp(e.wet, 0, max));
        if (e.type === 'Distortion') e.distortion = round(clamp(e.distortion ?? 0.3, 0, 0.8));
        if (e.type === 'PingPongDelay') e.feedback = round(clamp(e.feedback ?? 0.25, 0, 0.5));
        if (e.type === 'Reverb') { e.decay = round(clamp(e.decay ?? 2, 0.5, 10)); e.preDelay = round(clamp(e.preDelay ?? 0.02, 0, 0.1)); }
    }
    fx = fx.filter((e) => (typeof e.wet === 'number' ? e.wet >= 0.01 : true));
    fx.sort((a, b) => FX_ORDER.indexOf(a.type) - FX_ORDER.indexOf(b.type));
    patch.effects = fx;

    // pan
    const [pMin, pMax] = rules.pan;
    patch.pan = round(clamp(typeof patch.pan === 'number' ? patch.pan : 0, pMin, pMax), 2);

    // volume: density + FX compensation, then clamp to [range − 6 dB, range max]
    let vol = typeof patch.volume === 'number' ? patch.volume : (rules.vol[0] + rules.vol[1]) / 2;
    const density = String(midi?.density || '');
    if (density.startsWith('high')) vol -= 3; else if (density.startsWith('sparse')) vol += 2;
    const reverb = findFx(patch, 'Reverb'), dist = findFx(patch, 'Distortion'), chorus = findFx(patch, 'Chorus');
    if (reverb && reverb.wet > 0.25) vol -= 2;
    if (dist && dist.distortion > 0.4) vol -= 3;
    if (chorus && chorus.wet > 0.4) vol -= 1;
    patch.volume = round(clamp(vol, rules.vol[0] - 6, rules.vol[1]), 1);

    patch.designRationale = (variation.rationale || preset.rationale || '').split(/\s+/).slice(0, 30).join(' ');
    return { patch, warnings };
}

// ── LLM prompt for the variation step ────────────────────────────────────────
function knobLine(name, spec, def) {
    if (spec.choice) return `- ${name}: one of ${spec.options.map((o) => `"${o}"`).join(', ')} (default "${def.choice}")`;
    const first = leafSpecs(spec)[0];
    const unit = spec.unit ? ` ${spec.unit}` : '';
    const range = spec.targets ? spec.targets.map((s) => `${s.param} ${s.min}–${s.max}`).join(', ') : `${spec.min}–${spec.max}${unit}`;
    return `- ${name}: ${spec.label} ${range} (default ${def.pos ?? valueToPos(first, first.min)})`;
}

/**
 * @param ctx { trackType, genre, mood, key, scale, briefText, midiText, direction, artist }
 */
export function buildVariationPrompt(preset, ctx = {}) {
    const defaults = knobDefaults(preset);
    const lines = Object.entries(preset.vary).map(([n, s]) => knobLine(n, s, defaults[n]));
    const system = `You are a sound designer giving a small creative variation to an existing synth preset.
The preset is already genre-correct, balanced and technically safe. You only add character that fits the creative brief.

Output RAW JSON only (no markdown, no explanation): an object that may contain ONLY these keys:
${lines.join('\n')}
- rationale: string, max 25 words, why these choices

RULES
- Every numeric knob is a number from 0 to 1 (0 = low end of its range, 1 = high end). Omit a knob to keep the preset value.
- Change at most 4 knobs. Keep numeric values near their listed defaults unless the creative brief clearly calls for a stronger change.
- Choice knobs must use one of the listed options.
- Never output other keys, units or text outside the JSON object.

GENRE DIRECTION
${ctx.direction || 'Follow the creative brief and the track role.'}

ARTIST SIGNATURE (only when explicitly requested)
${ctx.artist || 'None.'}`;
    const user = `${ctx.briefText || ''}Track: ${ctx.trackType || preset.trackType} | Genre: ${ctx.genre || preset.genre} | Mood: ${ctx.mood || 'neutral'} | Key: ${ctx.key || ''}${ctx.scale || ''}
Preset: ${preset.id} — ${preset.rationale}
${ctx.midiText || ''}
Return the JSON object only.`;
    return { system, user };
}