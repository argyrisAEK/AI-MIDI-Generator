// Συμπιεσμένα Style Adjectives (Keywords only)
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

// Συμπιεσμένες Track Instructions (Shorthand notation)
const trackInstructions = {
    bassline: "M31-55. Dur: 1.0/0.5. No overlaps. Max leap: P5. Root-focused.",
    chord: "M48-72. Syncopated. 3-4 notes/chord. Rhythm: 2.0/4.0.",
    melody: "M60-84. Call/Response. Motif-based. Use rests. Max leap: Octave.",
    arpeggio: "M48-84. 16th notes. Rolling patterns. Use scale tones.",
    lead: "M60-96. Soaring, high velocity, vibrato-style timing.",
    plucks: "M60-84. Short (0.25). Staccato. Pentatonic leaning.",
    strings: "M48-84. Legato. Long (4.0+). Smooth transitions.",
    keys: "M48-72. Humanized velocity. Harmonic support.",
    guitar: "M40-76. Strum-like timing offset. Rhythmic.",
    'pad-textures': "M36-72. Drone-like. Very long durations.",
    brass: "M40-80. Punchy. Accents on beats 1 and 3.",
    percs: "M36-60. Non-tonal logic. Rhythmic spice."
};

export class PromptBuilder {
    static build(params) {
        const { key, bpm, duration_bars, style, mood, trackTypes, rhythmicComplexity, timeSignature, structure } = params;
        
        const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
        const totalBeats = duration_bars * beatsPerBar;

        // ΣΥΜΠΙΕΣΜΕΝΟ SYSTEM PROMPT
        return `Task: MIDI GEN. Key: ${key}. BPM: ${bpm}. Style: ${style} (${styleAdjectives[style] || ''}). Mood: ${mood}.
Structure: ${structure || 'cohesive'}. Bars: ${duration_bars} (${totalBeats} beats).
Complexity: ${rhythmicComplexity}.

RULES:
1. MOTIF: Bars 1-2 establish theme. Bars 3-4 repeat with A' variation.
2. INTERPLAY: If Melody plays, Chords simplify. If Melody rests, Bass fills.
3. HUMAN: Velocity ±0.1. Timing ±0.05. No mechanical grids.
4. FORMAT: pitch,start_beat,duration_beats,velocity # track_name

TRACKS TO GENERATE:
${trackTypes.map(t => `- ${t.toUpperCase()}: ${trackInstructions[t] || ''}`).join('\n')}

Output ONLY raw JSON: {"title": "...", "description": "...", "tracks": {"track_name": "pitch,start,dur,vel\\n..."}}`;
    }
}
