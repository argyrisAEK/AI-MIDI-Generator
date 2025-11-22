// Consolidated style-specific instructions with genre details integrated
const styleAdjectives = {
    house: 'groovy, warm, rhythmic with syncopated bass',
    techno: 'hypnotic, minimal, dark harmonic colors',
    trance: 'uplifting, euphoric, soaring leads',
    'hip-hop': 'laid-back, swung, jazz-influenced loops',
    rock: 'energetic, bold, with strong melodic and harmonic movement',
    pop: 'catchy, polished, and hook-driven with clean harmonies',
    funk: 'syncopated, tight, and rhythmically expressive through bass and chords',
    reggae: 'laid-back, groovy, with syncopated harmonic movement and warm tones',
    jazz: 'swingy, expressive, harmonically rich with 7ths, 9ths, and extended voicings',
    disco: 'uplifting, lush, orchestral with energetic harmonic movement',
    classical: 'structured, expressive, with careful voice leading and orchestral color',
    ambient: 'atmospheric, minimal, gentle motifs, evolving with long sustains and soft transitions',
    'drum-and-bass': 'fast, energetic harmonic motion with agile melodic runs',
    synthwave: 'nostalgic, 80s-inspired with warm analog pads and arpeggiated patterns',
    downtempo: 'chill, mellow, atmospheric with smooth melodic layers',
    'progressive-rock': 'complex, evolving, with shifting harmonic ideas and expressive melodies'
};

const trackInstructions = {
    bassline: `
Range: G0–G2 (MIDI 31–55).
Prefer Quarter (1.0) or Eighth (0.5) durations.
Avoid overlaps. Avoid leaps > P5 unless stylistically needed.
**STYLE RULE**: Use root/fifth only for electronic styles; use walking/chromatic lines for jazz/funk.
`,

    chord: `
Range: C2–C4 (MIDI 36–60).
Durations 2.0–4.0 beats only.
Change chords only on bar start or bar midpoint.
Keep voicings stable with minimal movement (<4 semitones).
**STYLE RULE**: Use triads for Pop/Rock; use 7ths/9ths for Jazz/Lo-Fi.
`,

    arpeggio: `
16th-note (0.25) flow.
Range: C3–C5 (MIDI 48–72).
Outline the current chord tones ONLY.
Prefer repeating 3–5-note looping figures.
Strict quantization, no random accents.
`,

    melody: `
Motif-driven line.
Range: G3–D5 (MIDI 55–74).
Phrases 2–4 beats with rests between motifs.
Repeat the main motif with small variations (±1–2 semitones, rhythm shifts).
Avoid dense note streams.
`,

    lead: `
Expressive monophonic hooks.
Range: A3–A5 (MIDI 57–81).
Phrase durations 0.5–1.5 beats.
Start phrases on off-beats (e.g. 0.5, 1.5, 2.5).
Use slides or stepwise movement. Avoid leaps > major 6th.
`,

    plucks: `
Short rhythmic stabs.
Range: C3–C4 (MIDI 48–60).
Duration always 0.25–0.50 beats.
Use syncopation (16th or off-beats).
Interact rhythmically with the bass; avoid linear constant patterns.
`,

    strings: `
Long legato lines.
Range: G3–G5 (MIDI 55–79).
Duration: long sustains 4.0–8.0 beats.
Prioritize smooth steps and voice-leading.
Avoid rhythmic accents or stabs.
`,

    keys: `
Sparse harmonic or comping patterns.
Range: C3–C5 (MIDI 48–72).
Use either sustained pads (2–4 beats) OR gentle rhythmic comping (0.5–1.0).
Never overlap with chord track voicings.
Leave space between gestures.
`,

brass: `
Punchy rhythmic stabs or sustained swells.
Range: F2–F4 (MIDI 41–65).
Use root and 5th for stabs, 3rds and 7ths for swells.
Keep phrases short and powerful.
Syncopated accents on off-beats.
`,    
    guitar: `
Strumming or muted plucks.
Range: E2–G4 (MIDI 40–67).
Strums should follow 8th-note patterns.
Muted plucks should be syncopated 16th-note accents.
Keep chords simple (2–3 notes per stroke).
`,

    'pad-textures': `
Atmospheric drones.
Range: C2–C4 (MIDI 36–60).
Duration: 4–8–16 beat sustained tones.
Low velocity (0.20–0.45).
Move very slowly (change every 4–8 bars).
No rhythmic patterns — only evolving textures.
`
};

function getTrackSpecificInstructions(trackType, context) {
    const style = (context.style || 'house').toLowerCase();
    let base = trackInstructions[trackType] || `Create a ${trackType} part fitting the groove.`;
    const adj = styleAdjectives[style] || '';

    // --- Dynamic Logic Overrides to fix genre conflicts ---
    
    // 1. Bass Logic: Relax rules for Funk/Jazz
    if (trackType === 'bassline') {
        if (['jazz', 'funk', 'disco', 'hip-hop', 'reggae'].includes(style)) {
            base = base.replace('Use root/fifth only for electronic styles', 'Use syncopation, octaves, and chromatic approach notes');
        } else {
            base = base.replace('Use root/fifth only for electronic styles', 'Strictly lock to Kick. Use primarily Root and Fifth degrees.');
        }
    }

    // 2. Chord Logic: Allow extensions for complex styles
    if (trackType === 'chord' || trackType === 'keys') {
        if (['jazz', 'lo-fi', 'neo-soul', 'ambient', 'progressive-rock'].includes(style)) {
             base = base.replace('Use triads for Pop/Rock', 'Use 7th, 9th extensions and open voicings');
        } else {
             base = base.replace('Use triads for Pop/Rock', 'Use Closed-voicing triads (Root-3rd-5th)');
        }
    }

    return `${base} \n   -> Stylistic Context: "${adj}"`;
}

// 3. The Builder Class
export class PromptBuilder {
    constructMultiTrackPrompt(context) {
        const activeTab = document.querySelector('.tab-panel.active');
        // This checks if we are in text mode, usually used for debugging or different view logic
        const isTextMode = activeTab && activeTab.id === 'text-panel';

        // Calculate total beats for clarity
        const beatsPerBar = parseInt(context.timeSignature.split('/')[0]);
        const totalBeats = context.duration * beatsPerBar;

        let prompt = `Act as a world-class Music Producer specializing in ${context.style}.
Generate a professional multi-track MIDI composition in strict JSON format.

The JSON object must have exactly these three keys:
{
  "title": "String - A creative title for the composition",
  "explanation": "String - One short sentence describing the musical piece, mood, and style",
  "notation": "String - All musical notes in a single string with escaped newlines (\\n)"
}

MUSICAL PARAMETERS:
- Key: ${context.key} ${context.scale}
- Tempo: ${context.tempo} BPM
- Total Length: ${context.duration} bars (${totalBeats} beats)
- Mood: ${context.mood}
- Structure: ${context.structure || 'A-B-A (Intro-Main-Outro)'}
- Chord Progression: ${context.chordProgression.join(' -> ')}

TRACK GUIDELINES:`;

        // Add dynamic track instructions
        context.trackTypes.forEach(trackType => {
            prompt += `\n- ${trackType.toUpperCase()}: ${getTrackSpecificInstructions(trackType, context)}`;
        });

        prompt += `

CRITICAL RULES FOR AI GENERATION:
1. **TIME UNIT = BEATS**: 
   - Use musical BEATS (Float), NOT seconds.
   - 0.0 = Start of Bar 1
   - 1.0 = One Quarter note later
   - ${beatsPerBar}.0 = Start of Bar 2
   - Max start_beat must be < ${totalBeats}

2. **REPETITION IS KEY**:
   - Do not generate random "noodling".
   - Establish a melodic motif in bars 1-2 and repeat it in bars 3-4.
   - Basslines should loop every 1 or 2 bars.

3. **INTERPLAY (Call & Response)**:
   - Don't have all tracks busy at once.
   - If Melody is playing, keep Chords simple.
   - If Melody rests, add a Bass fill.

NOTATION FORMAT: pitch,start_beat,duration_beats,velocity # track_name
- pitch: MIDI note number (36-96)
- start_beat: Float (Time in BEATS from start, e.g. 0.0, 1.5, 4.25)
- duration_beats: Float (Length in BEATS, e.g. 0.25, 1.0)
- velocity: Float (0.0 to 1.0)
- track_name: Must range from [${context.trackTypes.join(', ')}]
- Example: "36,0.0,0.5,0.9 #bassline\\n36,0.5,0.25,0.8 #bassline\\n60,0.0,4.0,0.7 #chord"`;

        prompt += `\n\nGenerate professional-quality music with clear arrangement, varied textures, humanized dynamics, and strong musical coherence.`;

        return prompt;
    }
}
