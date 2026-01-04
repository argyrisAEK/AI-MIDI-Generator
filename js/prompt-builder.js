// Track-specific instructions (loaded only when that track is selected)
const trackInstructions = {
    bassline: "31-55,root,1.0",
    chord: "48-72,3notes",
    melody: "60-84,motif",
    arpeggio: "48-84,rolling",
    lead: "60-96,highvel",
    plucks: "60-84,staccato",
    strings: "48-84,legato",
    keys: "48-72,harmonic",
    guitar: "40-76,strum",
    'pad-textures': "36-72,drone",
    brass: "40-80,punchy",
    percs: "36-60,rhythm"
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
    keys: 'key',
    guitar: 'gtr',
    'pad-textures': 'pad',
    brass: 'brss',
    percs: 'perc'
};

export class PromptBuilder {

    /**
     * Ultra-compact prompt with preserved semantics.
     * Token-optimized, deterministic, drop-in compatible.
     */
    constructMultiTrackPrompt(params) {
        try {
            // -------- Core parameters --------
            const key = params.key || 'C';
            const bpm = Math.max(40, Math.min(300, parseInt(params.tempo) || 120));
            const bars = Math.max(1, Math.min(64, parseInt(params.duration) || 4));
            const style = params.style || 'house';
            const mood = params.mood || 'neutral';
            const trackTypes = Array.isArray(params.trackTypes) ? params.trackTypes : [];
            const complexity = (params.rhythmicComplexity || 'medium')
                .charAt(0)
                .toUpperCase(); // S/M/C
            const timeSignature = params.timeSignature || '4/4';

            // -------- Tracks validation --------
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

            // -------- Compact rules (semantic equivalent) --------
            const rules =
                `TIME:u=beat,f,bar=${beatsPerBar},start∈[0,${totalBeats})` +
                `|REP:m12>rv34,bass@1-2,!rnd` +
                `|INT:mel=on→chd=simple,mel=off→bass=fill`;

            // -------- Optional enhanced context --------
            const enhancedCtx = params.enhancedContext
                ? ` CTX:${params.enhancedContext}`
                : '';

            // -------- Final prompt --------
            const prompt =
`CFG:key=${key},bpm=${bpm},style=${style},mood=${mood},time=${timeSignature},bars=${bars},cmp=${complexity}${enhancedCtx}
RULES:${rules}
TRACKS:${trackList}
FORMAT:pitch,beat,dur,vel #track
OUT:{"title":"","desc":"≤20w","tracks":{"${trackAbbrList}":"pitch,beat,dur,vel\\n"}}`;

            console.log(
                `[Prompt] ${tracks.length}T ${style} ${key} ${bpm}bpm ${bars}bars`
            );

            return prompt;

        } catch (error) {
            console.error('Prompt construction error:', error);

            // -------- Minimal compatible fallback --------
            return
`CFG:key=C,bpm=120,style=house,time=4/4,bars=4,cmp=M
RULES:TIME:u=beat,bar=4,start∈[0,16)|REP:m12>rv34,bass@1-2,!rnd|INT:mel=on→chd=simple
TRACKS:mel(60-84,motif) bass(31-55,root,1.0)
FORMAT:pitch,beat,dur,vel #track
OUT:{"title":"","desc":"≤20w","tracks":{"mel":"","bass":""}}`;
        }
    }

    /**
     * Get instruction for a specific track
     */
    getTrackInstruction(trackType) {
        return trackInstructions[trackType] || 'default';
    }

    /**
     * Get abbreviation for a specific track
     */
    getTrackAbbreviation(trackType) {
        return trackAbbreviations[trackType] || trackType;
    }
}

export { trackAbbreviations };
