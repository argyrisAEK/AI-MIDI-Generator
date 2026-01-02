// Track-specific instructions (loaded only when that track is selected)
const trackInstructions = {
    bassline: "31-55,root,1.0",
    chord: "48-72,3-4notes",
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
     * FIXED: Ultra-compact prompt with aggressive token reduction
     * Removed styleAdjectives - LLM knows style traits inherently
     * Minimal, focused instruction set
     */
    constructMultiTrackPrompt(params) {
        try {
            // Extract parameters with minimal validation
            const key = params.key || 'C';
            const bpm = Math.max(40, Math.min(300, parseInt(params.tempo) || 120));
            const bars = Math.max(1, Math.min(64, parseInt(params.duration) || 4));
            const style = params.style || 'house';
            const mood = params.mood || 'neutral';
            const trackTypes = Array.isArray(params.trackTypes) ? params.trackTypes : [];
            const complexity = (params.rhythmicComplexity || 'medium').charAt(0).toUpperCase(); // S/M/C
            const timeSignature = params.timeSignature || '4/4';

            // Validate track types
            const validTracks = Object.keys(trackInstructions);
            const tracks = trackTypes.filter(t => validTracks.includes(t));
            
            if (tracks.length === 0) {
                tracks.push('melody', 'bassline');
            }

            // Build ultra-compact track instructions
            const trackList = tracks
                .map(t => `${trackAbbreviations[t]}(${trackInstructions[t]})`)
                .join(' ');

            // Build compact JSON output format
            const trackAbbrList = tracks.map(t => trackAbbreviations[t]).join('","');

            // Add enhanced context if available (already truncated by analyzer)
            const enhancedCtx = params.enhancedContext ? ` CTX:${params.enhancedContext}` : '';

            // Ultra-minimal prompt
            const prompt = `KEY:${key} BPM:${bpm} STYLE:${style} MOOD:${mood} TIME:${timeSignature} BARS:${bars} COMP:${complexity}${enhancedCtx}
TRACKS: ${trackList}
FORMAT: pitch,beat,dur,vel #track
OUT: {"title":"","desc":"","tracks":{"${trackAbbrList}":"note,beat,dur,vel\\n"}}`;

            console.log(`[Prompt] ${tracks.length}T ${style} ${key} ${bpm}bpm`);
            return prompt;

        } catch (error) {
            console.error('Prompt construction error:', error);
            // Minimal fallback
            return `KEY:C BPM:120 STYLE:house TIME:4/4 BARS:4 COMP:M
TRACKS: mel(60-84,motif) bass(31-55,root,1.0)
FORMAT: pitch,beat,dur,vel #track
OUT: {"title":"","desc":"","tracks":{"mel":"note,beat,dur,vel\\n","bass":"note,beat,dur,vel\\n"}}`;
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
