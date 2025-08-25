// Dynamic style-specific instructions
 const styleAdjectives = {
  house:      'groovy, syncopated, and built around a steady 4/4 kick',
  techno:     'minimal, hypnotic, with layered percussive textures',
  trance:     'uplifting, melodic, and driven by arpeggios with long build-ups',
  trap:       'dark, spacious, with syncopated hi-hats and heavy 808 bass',
  'hip-hop':  'swinging, sample-inspired, with strong backbeat emphasis',
  rock:       'energetic, riff-based, with strong guitar and driving drums',
  pop:        'catchy, verse-chorus structured, with melodic hooks',
  funk:       'tight, syncopated, with rhythmic bass and percussive guitar',
  reggae:     'laid-back, offbeat rhythms, with syncopated skank guitar',
  jazz:       'improvisational, harmonically rich, with swing rhythms',
  disco:      'steady 4/4 with orchestral strings, groovy bass, and syncopated guitar',
  classical:  'structured, polyphonic, and following traditional voice-leading',
  ambient:    'slow-moving, evolving, with spacious textures and no strict groove',
  'drum-and-bass': 'fast-paced, syncopated breakbeats, rolling basslines, and layered atmospherics',
  synthwave: 'retro-futuristic, 80s-inspired, with lush pads and arpeggiated synths',
  downtempo: 'chill, groove-driven, with laid-back beats and warm textures',
  'progressive-rock': 'complex, shifting time signatures, extended instrumental passages, and layered arrangements'
};

  

const defaultInstructions = {
  bassline: 'Craft a bassline emphasizing root and fifths in the lower register (E1–E3). Mix sustained notes with rhythmic pulses (quarter/eighth).',
  melody:   'Compose a singable, motif-based melody in C4–C6. Vary rhythm and contour for memorability.',
  chord:    'Use sustained chords or rhythmic stabs. Prefer inversions for smooth transitions and voice leading.',
  arpeggio: 'Generate broken chord patterns (8th/16th). Use ascending/descending motion for variation.',
  lead:     'Design a monophonic lead with syncopation and pitch variation. Ensure it cuts through the mix.',
  plucks:   'Short, percussive notes with fast decay. Often play chord tones on off-beats for groove.',
  strings:  'Sustained, legato lines supporting harmony. Use crescendos/decrescendos for realism.',
  drums:    'Kick on strong beats, snare on 2/4 (or stylistic variation), hi-hats add subdivisions. Maintain groove consistency.',
  keys: 'Play harmonic support or counter-melody. Use rhythmic stabs or flowing chords.',
  brass: 'Short stabs for rhythm, long swells for drama. Follow genre-specific phrasing.',
  percussion: 'Use shakers, congas, or auxiliary percussion to add syncopated layers without cluttering main groove.',
  guitar: 'Rhythmic strumming, riffs, or arpeggiated picking. Genre-appropriate tone (clean, distorted, funky).',
  'pad-textures': 'Slowly evolving chords with long attack/release. Use layered harmonics for atmosphere.',
  'fx-riser': 'One long riser: gradual pitch bend upward (C2→C5), filter opening, velocity crescendo.'
};



function getTrackSpecificInstructions(trackType, context) {
  const style = (context.style || 'house').toLowerCase();
  const base  = defaultInstructions[trackType]
              || `Create a ${trackType} part that complements the arrangement.`;
  const adj   = styleAdjectives[style];
  return adj
    ? `${base} Tailor it to be ${adj}.`
    : base;
}

export class PromptBuilder {
    constructMultiTrackPrompt(context) {
        const activeTab = document.querySelector('.tab-panel.active');
        const isTextMode = activeTab && activeTab.id === 'text-panel';

        let prompt = `You are an expert composer AI. Generate a cohesive, multi-track MIDI composition as a single valid JSON object. 
Respond ONLY with raw JSON (no markdown, no explanations).

REQUIRED JSON STRUCTURE:
{
  "title": "String - max 20 characters",
  "explanation": "String - exactly 15 words describing mood, style, and piece",
  "notation": "String - all notes in a single JSON string with escaped \\n line breaks"
}

IMPORTANT:
- The "notation" string MUST escape all newlines as \\n
- No actual line breaks allowed inside the JSON string
- Do not add extra keys or text outside the JSON


Musical Requirements:
- Tracks: ${context.trackTypes.join(', ')}
- Key: ${context.key} ${context.scale}
- Tempo: ${context.tempo} BPM
- Time Signature: ${context.timeSignature}
- Style: ${context.style}
- Mood: ${context.mood}
- Duration: ${context.duration} bars (${context.totalDurationInSeconds.toFixed(1)} seconds)
- Rhythmic Complexity: ${context.rhythmicComplexity}
- Chord Progression: ${context.chordProgression.join(' → ')}
`;

        if (context.structure) {
            prompt += `- Structure: ${context.structure}\n`;
        }

        prompt += `
Expert Musical Theory Guidelines:
- Harmonic Progression: Use rich diatonic progressions (e.g., ii-V-I, I-vi-IV-V). Employ chord inversions and voicings for smooth voice leading.
- Melodic Contour: Create melodies with clear phrasing, using ascending and descending lines to build and release tension. Avoid simple, repetitive patterns.
- Rhythmic Complexity: Use syncopation, triplets, and varied note durations. Timings should not always be on simple 8th or 16th note grids (e.g., use values like 0.3, 0.7, 1.1).
- Dynamic Variation: Make extensive use of a wide velocity range (0.3 to 1.0) to create expressive dynamics, accents, and ghost notes.
`;

        if (isTextMode) {
            const userPrompt = document.getElementById('text-prompt').value;
            if (userPrompt) {
                prompt += `\nCreative Direction: "${userPrompt}"\n`;
            }
        }

        // Add specific track instructions
        prompt += `\nTrack-Specific Guidelines:\n`;
        context.trackTypes.forEach(trackType => {
            prompt += `- ${trackType}: ${getTrackSpecificInstructions(trackType, context)}\n`;
        });

        prompt += `
NOTATION FORMAT: pitch,time,duration,velocity  # track_name
- Pitch: MIDI number (36–96) OR note name (C2–C6 range recommended)
- Time: floating point seconds from start (allow irregular values, e.g., 0.37, 1.12)
- Duration: floating point in seconds (min 0.05s, sustain allowed)
- Velocity: decimal 0.3–1.0 (ghost notes <0.5, accents >0.8)
- Track: must exactly match ${context.trackTypes.join(', ')}


PROFESSIONAL REQUIREMENTS:
- Maintain consistent groove and timing
- Ensure bass frequencies don't clash (bassline below 200Hz)
- Create complementary rhythmic patterns between tracks
- Apply appropriate and varied velocity dynamics (accents, ghost notes)
- Use scale-appropriate notes only; passing tones are acceptable if they resolve correctly.


EXAMPLE JSON OUTPUT:
{
  "title": "Neon Pulse",
  "explanation": "Driving house track with groovy bassline, syncopated chords, and euphoric melodic build",
  "notation": "36,0,0.5,0.95  # bassline\\n67,0.7,0.3,0.8  # melody\\n36,1.2,0.5,0.85  # bassline\\n72,1.6,0.25,0.75  # melody\\n40,2.1,0.4,0.9  # bassline"
}


Generate exactly this JSON structure with proper escaping. Create professional-quality music with clear arrangement, proper dynamics, and musical coherence.`;
        
        return prompt;
    }
}
