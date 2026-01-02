// Track-specific instructions (loaded only when that track is selected)
const trackInstructions = {
    bassline: "31-55,1.0/0.5,P5max,root",
    chord: "48-72,sync,3-4notes,2-4beat",
    melody: "60-84,call/response,motif,octavemax",
    arpeggio: "48-84,16th,rolling,scale",
    lead: "60-96,soaring,highvel",
    plucks: "60-84,0.25short,staccato",
    strings: "48-84,legato,4.0+ long",
    keys: "48-72,humanvel,harmonic",
    guitar: "40-76,strum,rhythm",
    'pad-textures': "36-72,drone,verylong",
    brass: "40-80,punchy,beat1+3",
    percs: "36-60,nontonal,rhythm"
};

// Style-specific adjectives (loaded only when that style is selected)
const styleAdjectives = {
    house: 'syncopated bass, groovy, warm',
    techno: 'hypnotic, minimal, dark',
    trance: 'uplifting, euphoric, soaring leads',
    'hip-hop': 'laid-back, swung, jazz-loops',
    rock: 'energetic, bold, harmonic motion',
    pop: 'catchy, hook-driven, clean',
    funk: 'syncopated, tight, rhythmic expressiveness',
    reggae: 'offbeat, warm, groovy bass',
    jazz: 'swing, 7th/9th chords, expressive',
    disco: 'lush, orchestral, 4/4 energy',
    classical: 'structured, voice-leading, orchestral',
    ambient: 'atmospheric, evolving, long sustains',
    'drum-and-bass': 'fast, agile melodic runs',
    synthwave: '80s analog, nostalgic, arps',
    downtempo: 'chill, smooth layers, mellow',
    'progressive-rock': 'complex, evolving, shifting ideas'
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
     * FIXED: Dynamic prompt construction based on user parameters
     * Only includes information for selected tracks, style, and features
     */
    constructMultiTrackPrompt(params) {
        try {
            // Validate and extract parameters with defaults
            const key = params.key || 'C';
            const bpm = Math.max(40, Math.min(300, parseInt(params.tempo) || 120));
            const duration_bars = Math.max(1, Math.min(64, parseInt(params.duration) || 4));
            const style = params.style || 'house';
            const mood = params.mood || 'neutral';
            const trackTypes = Array.isArray(params.trackTypes) ? params.trackTypes : [];
            const rhythmicComplexity = params.rhythmicComplexity || 'medium';
            const timeSignature = params.timeSignature || '4/4';

            // Validate track types
            const validTracks = Object.keys(trackInstructions);
            const filteredTracks = trackTypes.filter(t => validTracks.includes(t));
            
            if (filteredTracks.length === 0) {
                console.warn('No valid track types provided, defaulting to melody and bassline');
                filteredTracks.push('melody', 'bassline');
            }

            // Get style adjectives only for selected style
            const styleDesc = styleAdjectives[style] || 'expressive';

            // Build dynamic track instructions only for selected tracks
            const dynamicTrackInstructions = filteredTracks
                .map(t => {
                    const abbr = trackAbbreviations[t];
                    const instr = trackInstructions[t] || 'default';
                    return `${abbr}(${instr})`;
                })
                .join(' ');

            // Build dynamic JSON output format with only selected track abbreviations
            const trackAbbrList = filteredTracks.map(t => trackAbbreviations[t]).join('","');
            const jsonOutputFormat = `{"title":"...","description":"...","tracks":{"${trackAbbrList}":"pitch,start_beat,duration,velocity\\n..."}}`;

            // Calculate timing information (only needed once)
            const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
            const totalBeats = duration_bars * beatsPerBar;

            // Build the prompt dynamically
            const systemCore = `GEN MIDI: Key:${key} BPM:${bpm} Style:${style} (${styleDesc}) Mood:${mood} Bars:${duration_bars} Complexity:${rhythmicComplexity}

FORMAT: pitch,start_beat,duration,velocity #track

RULES:
1. Motif bars 1-2, repeat+variation bars 3-4
2. Melody-Chord interplay: when one plays, other simplifies
3. Human timing: ±0.05s, velocity ±0.1
4. Stay in ${key}, follow ${style} traits

TRACKS:
${dynamicTrackInstructions}

JSON OUTPUT: ${jsonOutputFormat}`;

            console.log(`Prompt Builder: Generated prompt for ${filteredTracks.length} track(s): ${filteredTracks.join(', ')}`);
            return systemCore;

        } catch (error) {
            console.error('Error constructing prompt:', error);
            // Fallback prompt
            return `GEN MIDI: Key:C BPM:120 Style:house Mood:neutral Bars:4 Complexity:medium

FORMAT: pitch,start_beat,duration,velocity #track

RULES:
1. Motif bars 1-2, repeat+variation bars 3-4
2. Melody-Chord interplay: when one plays, other simplifies
3. Human timing: ±0.05s, velocity ±0.1
4. Stay in C, follow house traits

TRACKS:
mel(60-84,call/response,motif,octavemax) bass(31-55,1.0/0.5,P5max,root)

JSON OUTPUT: {"title":"...","description":"...","tracks":{"mel":"pitch,start_beat,duration,velocity\\n...","bass":"pitch,start_beat,duration,velocity\\n..."}}`;
        }
    }

    /**
     * Get instruction for a specific track (used for analysis/debugging)
     */
    getTrackInstruction(trackType) {
        return trackInstructions[trackType] || 'default';
    }

    /**
     * Get description for a specific style (used for analysis/debugging)
     */
    getStyleDescription(style) {
        return styleAdjectives[style] || 'expressive';
    }

    /**
     * Get abbreviation for a specific track (used for analysis/debugging)
     */
    getTrackAbbreviation(trackType) {
        return trackAbbreviations[trackType] || trackType;
    }
}

export { trackAbbreviations };
