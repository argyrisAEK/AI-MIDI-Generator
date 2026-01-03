// Track-specific instructions (loaded only when that track is selected)
// ============================
// Compact Track DSL
// ============================

const TRACK_DSL = {
    bassline: '31-55:r@1',
    chord: '48-72:3-4n',
    melody: '60-84:m',
    arpeggio: '48-84:roll',
    lead: '60-96:hiV',
    plucks: '60-84:stac',
    strings: '48-84:leg',
    keys: '48-72:harm',
    guitar: '40-76:str',
    'pad-textures': '36-72:drn',
    brass: '40-80:punch',
    percs: '36-60:rhy'
};

const TRACK_ABBR = {
    bassline: 'bass',
    chord: 'chd',
    melody: 'mel',
    arpeggio: 'arp',
    lead: 'lead',
    plucks: 'plk',
    strings: 'str',
    keys: 'key',
    guitar: 'gtr',
    'pad-textures': 'pad',
    brass: 'brs',
    percs: 'prc'
};

// ============================
// Prompt Builder
// ============================

export class PromptBuilder {

    constructMultiTrackPrompt(p = {}) {
        try {
            // -------- Core params --------
            const key   = p.key || 'C';
            const bpm   = clamp(p.tempo, 40, 300, 120);
            const bars  = clamp(p.duration, 1, 64, 4);
            const style = p.style || 'house';
            const mood  = p.mood || 'neutral';
            const time  = p.timeSignature || '4/4';
            const cmp   = (p.rhythmicComplexity || 'medium')[0].toUpperCase();

            // -------- Timing --------
            const beats = parseInt(time) || 4;
            const total = beats * bars;

            // -------- Tracks --------
            const valid = Object.keys(TRACK_DSL);
            const sel   = Array.isArray(p.trackTypes)
                ? p.trackTypes.filter(t => valid.includes(t))
                : [];

            const tracks = sel.length ? sel : ['melody', 'bassline'];

            const trkLine = tracks
                .map(t => `${TRACK_ABBR[t]}(${TRACK_DSL[t]})`)
                .join(' ');

            const outKeys = tracks.map(t => TRACK_ABBR[t]).join('","');

            // -------- Rules DSL --------
            const RULES =
                `TIME:u=beat,f,bar=${beats},start∈[0,${total})` +
                `|REP:m12>rv34,bass@1-2,!rnd` +
                `|INT:mel=on→chd=simple,mel=off→bass=fill`;

            // -------- Optional context --------
            const ctx = p.enhancedContext ? ` CTX:${p.enhancedContext}` : '';

            // -------- Final prompt --------
            return (
`CFG:key=${key},bpm=${bpm},style=${style},mood=${mood},time=${time},bars=${bars},cmp=${cmp}${ctx}
RULES:${RULES}
TRK:${trkLine}
FMT:pitch,beat,dur,vel #trk
OUT:{"t":"","d":"≤20w","trk":{"${outKeys}":"p,b,d,v\\n"}}`
            );

        } catch {
            // -------- Hard fallback --------
            return (
`CFG:key=C,bpm=120,style=house,time=4/4,bars=4,cmp=M
RULES:TIME:u=beat,bar=4,start∈[0,16)|REP:m12>rv34,bass@1-2,!rnd|INT:mel=on→chd=simple
TRK:mel(60-84:m) bass(31-55:r@1)
FMT:pitch,beat,dur,vel #trk
OUT:{"t":"","d":"≤20w","trk":{"mel":"","bass":""}}`
            );
        }
    }
}

// ============================
// Utils
// ============================

function clamp(v, min, max, d) {
    v = parseInt(v);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
}
