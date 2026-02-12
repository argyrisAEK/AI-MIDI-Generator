// Track-specific instructions (loaded only when that track is selected)
const trackInstructions = {
    bassline: "MIDI RANGE:31-55",
    chord: "MIDI RANGE:48-72",
    melody: "MIDI RANGE:60-84",
    arpeggio: "MIDI RANGE:48-84",
    lead: "MIDI RANGE:60-96",
    plucks: "MIDI RANGE:60-84",
    strings: "MIDI RANGE:48-84",
    keys: "MIDI RANGE:48-72",
    guitar: "MIDI RANGE:40-76",
    'pad-textures': "MIDI RANGE:36-72",
    brass: "MIDI RANGE:40-80",
    percs: "MIDI RANGE:36-60"
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
    keys: 'keys',
    guitar: 'gtr',
    'pad-textures': 'pad',
    brass: 'brss',
    percs: 'perc'
};

export class PromptBuilder {

    /**
     * Ultra-compact prompt with token optimization.
     * Format: pitch:beat:dur:vel|pitch:beat:dur:vel...
     * Velocity is stored as 1-9 (10% increments)
     * 
     * Benefits:
     * - 40% fewer tokens
     * - Better focus for AI on musical relationships
     * - Reduced hallucination and formatting errors
     * - Single-character separator (|) instead of \n in JSON
     */
    constructMultiTrackPrompt(params = {}) {
        try {
            // -------- Analyzer-compatible normalization --------
            const key = params.key || 'C';
            const bpm = Math.max(
                40,
                Math.min(300, parseInt(params.bpm || params.tempo) || 120)
            );

            const bars = Math.max(
                1,
                Math.min(64, parseInt(params.duration_bars || params.duration) || 4)
            );

            const style = params.style || 'house';
            const mood = params.mood || 'neutral';
            const trackTypes = Array.isArray(params.trackTypes) ? params.trackTypes : [];
            const complexity = (params.rhythmicComplexity || 'medium')
                .charAt(0)
                .toUpperCase(); // S / M / C

            const timeSignature = params.timeSignature || '4/4';
            const enhancedPrompt = params.enhancedPrompt || '';

            // -------- Track validation --------
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

            // -------- Compact rules --------
           const rules =
    `TIME:u=beat,bar=${beatsPerBar},start∈[0,${totalBeats})` +
    `|REP:m12>rv34,bass@1-2,!rnd` +
    `|INT:mel→chd=simple,mel→bass=fill` +
    `|HUM:dens<.65,rep<.45,rest≥1/4bar,vel±2`;

            // -------- Final prompt with COMPACT FORMAT --------
            // Ultra-Compact Format Explanation:
            // - Separator for notes: : (pitch:beat:dur:vel)
            // - Separator between notes: | (instead of \n, saves JSON escaping)
            // - Velocity: integer 1-9 (represents 10%-90% intensity)
            // - Decimals: .5 instead of 0.5 (no leading zero)
            const prompt =
`CFG:key=${key},bpm=${bpm},style=${style},mood=${mood},time=${timeSignature},bars=${bars},cmp=${complexity}
RULES:${rules}
TRACKS:${trackList}
FORMAT:pitch:beat:dur:vel|pitch:beat:dur:vel... (velocity: 1-9 = 10%-90%, decimals as .5)
OUT:{"title":"","desc":"≤20w","tracks":{"${trackAbbrList}":"pitch:beat:dur:vel|pitch:beat:dur:vel"}}
${enhancedPrompt ? `CONTEXT:${enhancedPrompt}` : ''}`;

            console.log('[PromptBuilder] Generated ultra-compact prompt');
            return prompt;

        } catch (error) {
            console.error('PromptBuilder error:', error);

            // -------- Safe fallback with compact format --------
            return (
`CFG:key=C,bpm=120,style=house,time=4/4,bars=4,cmp=M
RULES:TIME:u=beat,bar=4,start∈[0,16)|REP:m12>rv34,bass@1-2,!rnd
TRACKS:mel(60-84,motif) bass(31-55,root,1.0)
FORMAT:pitch:beat:dur:vel|pitch:beat:dur:vel...
OUT:{"title":"","desc":"","tracks":{"mel":"pitch:beat:dur:vel|","bass":"pitch:beat:dur:vel|"}}`
            );
        }
    }

    getTrackInstruction(trackType) {
        return trackInstructions[trackType] || 'default';
    }

    getTrackAbbreviation(trackType) {
        return trackAbbreviations[trackType] || trackType;
    }
}

export { trackAbbreviations };
