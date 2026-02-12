// Track-specific instructions with note ranges
const trackInstructions = {
    bassline: "C1-D#3",
    chord: "C3-C5",
    melody: "C4-C6",
    arpeggio: "C3-C6",
    lead: "C4-C7",
    plucks: "C4-C6",
    strings: "C3-C6",
    keys: "C3-C5",
    guitar: "E2-E5",
    'pad-textures': "C2-C5",
    brass: "E2-G5",
    percs: "C2-C4"
};

// Track abbreviations - SHORTER for tokens
const trackAbbreviations = {
    bassline: 'bass',
    chord: 'pad',      // shorter than 'chd'
    melody: 'lead',    // unified with lead
    arpeggio: 'arp',
    lead: 'lead',
    plucks: 'pluck',
    strings: 'str',
    keys: 'keys',      // FIXED: was 'key'
    guitar: 'gtr',
    'pad-textures': 'pad',
    brass: 'brs',
    percs: 'perc'
};

// Note name to MIDI helpers for the AI
const noteRangeExamples = {
    bassline: "C2,F2,G2,C3",
    chord: "C3,E3,G3,C4",
    melody: "C4,E4,G4,C5",
    arpeggio: "C3,E3,G3,C4,E4",
    lead: "G4,C5,E5,G5",
    plucks: "C4,E4,G4",
    strings: "G3,C4,E4,G4",
    keys: "C3,E3,G3,C4",
    guitar: "E3,G3,B3,E4",
    'pad-textures': "C3,G3,C4",
    brass: "C3,E3,G3,C4",
    percs: "C2,D2"
};

export class PromptBuilder {

    /**
     * IDEAL: Hybrid Compact Notation
     * Format: note:bar.beat:dur:vel|note:bar.beat:dur:vel...
     * 
     * Optimizations:
     * - Note names (not MIDI) for readability
     * - bar.beat notation (0.0, 0.5, 1.25) - compact & clear
     * - Chords with comma: C3,Eb3,G3
     * - Rest with _
     * - 40% fewer tokens than verbose JSON
     */
    constructMultiTrackPrompt(params = {}) {
        try {
            const key = params.key || 'C';
            const scale = params.scale || 'major';
            const bpm = Math.max(40, Math.min(300, parseInt(params.bpm || params.tempo) || 120));
            const bars = Math.max(1, Math.min(32, parseInt(params.duration_bars || params.duration) || 4));
            const style = params.style || 'house';
            const mood = params.mood || 'neutral';
            const trackTypes = Array.isArray(params.trackTypes) ? params.trackTypes : [];
            const complexity = (params.rhythmicComplexity || 'medium').charAt(0).toUpperCase();
            const timeSignature = params.timeSignature || '4/4';
            const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
            const enhancedPrompt = params.enhancedPrompt || '';

            // Validate and limit tracks for quality
            const validTracks = Object.keys(trackInstructions);
            let tracks = trackTypes.filter(t => validTracks.includes(t));
            
            // Limit to 4 tracks max for quality (prevent truncation)
            if (tracks.length === 0) {
                tracks = ['bassline', 'chord'];
            } else if (tracks.length > 4) {
                console.warn(`[PromptBuilder] Limiting ${tracks.length} tracks to 4 for quality`);
                tracks = tracks.slice(0, 4);
            }

            // Build track list with examples
            const trackList = tracks.map(t => {
                const abbr = trackAbbreviations[t];
                const range = trackInstructions[t];
                const examples = noteRangeExamples[t];
                return `${abbr}[${range},eg:${examples}]`;
            }).join(' ');

            const trackAbbrList = tracks.map(t => `"${trackAbbreviations[t]}":""`).join(',');

            // Musical context for AI
            const prog = this.getChordProgression(key, scale, bars);
            const scaleNotes = this.getScaleNotes(key, scale);

            const prompt =
`CFG:k=${key}${scale==='minor'?'m':''},bpm=${bpm},ts=${timeSignature},bars=${bars},cmp=${complexity},sty=${style}
SCALE:${scaleNotes}
PROG:${prog}
NOTATE:note:bar.beat:dur:vel|...
-note:C2-C7 names, chords:C3,Eb3,G3, rest:_, tie:~
-time:bar.beat 0.0=bar0beat0, 0.5=beat2, 1.75=beat3+3/4
-dur:2=1/2,.5=8th,.25=16th,1.5=1/4+8th,3=3/4
-vel:1-9 ppp-ffff (5=mf)
${trackList}
OUT:{"t":"","d":"","trks":{${trackAbbrList}}}
${enhancedPrompt ? `CTX:${enhancedPrompt.slice(0, 200)}` : ''}`;

            console.log('[PromptBuilder] Ideal prompt:', prompt.length, 'chars');
            return prompt;

        } catch (error) {
            console.error('[PromptBuilder] Error:', error);
            return this.getFallbackPrompt();
        }
    }

    getChordProgression(key, scale, bars) {
        // Common progressions by bar count
        const progs = {
            4: scale === 'minor' ? 'i-VI-III-VII' : 'I-V-vi-IV',
            8: scale === 'minor' ? 'i-VI-III-VII-i-iv-VI-VII' : 'I-V-vi-IV-I-V-vi-V',
            16: scale === 'minor' ? 'i-VI-III-VII-i-iv-V-VI-i-VI-iv-VII-i-VI-III-VII' : 'I-V-vi-IV-I-V-vi-V-I-V-vi-IV-I-V-I-IV'
        };
        return progs[Math.min(bars, 16)] || progs[4];
    }

    getScaleNotes(key, scale) {
        const major = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const minor = ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb'];
        const base = scale === 'minor' ? minor : major;
        
        // Transpose to key
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const rootIdx = notes.indexOf(key);
        if (rootIdx === -1) return base.join(',');
        
        return base.map((n, i) => {
            const idx = (notes.indexOf(n) + rootIdx) % 12;
            return notes[idx];
        }).join(',');
    }

    getFallbackPrompt() {
        return `CFG:k=C,bpm=120,ts=4/4,bars=4,cmp=M,sty=house
SCALE:C,D,E,F,G,A,B
PROG:I-V-vi-IV
NOTATE:note:bar.beat:dur:vel|...
-note:C2-C7, chords:C3,Eb3,G3, rest:_
-time:0.0=bar0beat0, dur:2=half,.5=8th, vel:1-9
bass[C1-D#3,eg:C2,F2,G2] pad[C3-C5,eg:C3,E3,G3]
OUT:{"t":"","d":"","trks":{"bass":"","pad":""}}`;
    }

    getTrackInstruction(trackType) {
        return trackInstructions[trackType] || 'C3-C5';
    }

    getTrackAbbreviation(trackType) {
        return trackAbbreviations[trackType] || trackType;
    }
}

export { trackAbbreviations };
