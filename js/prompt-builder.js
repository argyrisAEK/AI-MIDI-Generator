// Dynamic style-specific instructions
const styleAdjectives = {
  house:      'groovy and danceable',
  techno:     'hypnotic and driving',
  trance:     'euphoric and melodic',
  trap:       'dark and syncopated',
  'hip-hop':  'soulful and sample-inspired',
  rock:       'energetic and powerful',
  pop:        'catchy and melodic',
  funk:       'rhythmic and percussive',
  reggae:     'laid-back and offbeat',
  jazz:       'improvisational and swingy',
  disco:      'uplifting and orchestral',
  classical:  'structured and harmonic',
  ambient:    'atmospheric and evolving',
  'drum-and-bass': 'fast-paced with complex breakbeats and heavy basslines',
  synthwave: 'nostalgic, 80s-inspired, with driving arpeggios and lush pads',
  downtempo: 'chill, groovy, and atmospheric with a relaxed feel',
  'progressive-rock': 'complex, with changing time signatures and intricate arrangements'
};

const defaultInstructions = {
  bassline: `
Create a cohesive bassline that reinforces the chord progression and tonal center.
Focus on root and fifth notes (E1–E3 range) with simple rhythmic motion (quarter or eighth notes).
Ensure rhythmic alignment with the harmonic rhythm, avoiding excessive syncopation.
`,

  chord: `
Generate a harmonic chord progression (triads or seventh chords) that defines the key of the piece.
Use sustained or half-note durations to establish a clear tonal foundation.
Avoid dense voicings; keep 3–4 notes per chord and ensure smooth voice leading.
`,

  arpeggio: `
Develop arpeggiated patterns derived from the chord progression.
Use eighth or sixteenth notes with occasional rhythmic variation.
Arpeggios should complement the chord track without overlapping note density excessively.
`,

  melody: `
Compose a memorable melody that fits within the established key and progression.
Use the C4–C6 range for clarity, combining stepwise motion with occasional leaps.
Emphasize motifs and repetition for cohesion across phrases.
`,

  lead: `
Design a clear, expressive monophonic lead line that complements the melody or arpeggio.
Focus on rhythmic interest and phrasing rather than dense note output.
Ideal range: C4–C6. Keep within the harmonic context.
`,

  plucks: `
Add short, percussive plucked notes derived from the chords.
Use staccato articulation and short decay, often emphasizing off-beats or syncopation.
Avoid doubling the bass; stay in the mid-register (C3–C5).
`,

  strings: `
Compose flowing legato string lines reinforcing the harmony.
Use longer note durations and gradual melodic contour.
Stay mostly in the mid to upper register (C3–C6) for warmth and support.
`,

  keys: `
Add harmonic or counter-melodic motion using piano or electric piano style.
Support the chord progression while introducing subtle rhythmic or melodic movement.
Keep it sparse to avoid overcrowding other harmonic parts.
`,

  brass: `
Introduce brass stabs or sustained harmonies matching the chord progression.
Use accent patterns or short rhythmic phrases for energy.
Stay within the harmonic framework, avoiding dissonances unless stylistically intentional.
`,

  guitar: `
Compose a guitar part consistent with the chord progression.
May alternate between rhythmic strumming, melodic fills, or simple arpeggios.
Use realistic voicings and maintain harmonic coherence with other tracks.
`,

  'pad-textures': `
Generate an atmospheric pad that sustains and enriches the harmonic field.
Use slow-evolving chords with smooth transitions and long attack/release envelopes.
Maintain subtle movement without rhythmic emphasis.
`,
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

        let prompt = `Generate a cohesive, multi-track MIDI composition as a single, valid JSON object. Respond ONLY with properly formatted JSON - no markdown, explanations, or additional text.

The JSON object must have exactly these three keys:
{
  "title": "String - A creative title for the composition",
  "explanation": "String - One sentence describing the musical piece, mood, and style"
  "notation": "String - All musical notes in a single string with escaped newlines (\\n)"
}

CRITICAL: The "notation" value must be a single JSON string where all newlines are escaped as \\n. Do NOT use actual line breaks within the JSON string value.

Musical Requirements:
- Tracks: ${context.trackTypes.join(', ')}
- Key: ${context.key} ${context.scale}
- Tempo: ${context.tempo} BPM
- Time Signature: ${context.timeSignature}
- Style: ${context.style}
- Mood: ${context.mood}
- Duration: ${context.duration} bars
- Total Duration Seconds: ${context.totalDurationInSeconds.toFixed(3)}
- Rhythmic Complexity: ${context.rhythmicComplexity}
- Chord Progression: ${context.chordProgression.join(' → ')}
`;

        if (context.structure) {
            prompt += `- Structure: ${context.structure}\n`;
        }

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
NOTATION FORMAT: Each note must be: pitch,time,duration,velocity  # track_name
- Use MIDI note numbers (36-96) or note names (C4, F#2, etc.)
- Time in seconds from start (quantized to 16th notes)
- All note start times must be within [0, ${context.totalDurationInSeconds.toFixed(3)}] seconds
- Ensure (time + duration) does not exceed ${context.totalDurationInSeconds.toFixed(3)} seconds
- Duration in seconds (minimum 0.1s for clarity)
- Velocity as decimal (0.3-1.0 for dynamic range)
- Track name must match exactly: ${context.trackTypes.join(', ')}

PROFESSIONAL REQUIREMENTS:
- Avoid making simple melodies and rhythms. E.g. use timings that are not always multiples of 0.5.
- Avoid repeating the same melody multiple times.
-Notes properly handle transitions across loop boundaries
- Return only the notation. No explanation.
-Consider incorporating these music theory concepts in your composition:
- Diatonic scales and key signatures (e.g., C major scale: C, D, E, F, G, A, B)
- Harmonic progressions and cadences (e.g., ii-V-I progression: Dm7, G7, Cmaj7)
- Rhythmic patterns and time signatures (e.g., syncopated rhythm in 4/4 time)
- Melodic contour and phrasing (e.g., ascending melody with a peak, followed by a descent)
- Chord inversions and voicings (e.g., Cmaj7 in first inversion: E, G, B, C)
- Always vary the velocity/dynamics of notes- Apply appropriate velocity dynamics (accents, ghost notes)
- Use scale-appropriate notes only
- Maintain proper register separation between instruments

EXAMPLE JSON OUTPUT:
{
  "title": "Midnight Groove",
  "explanation": "An energetic house track with driving bassline and soaring melody in C major.",
  "notation": "36,0,0.5,0.9  # bassline\\n67,0.5,0.5,0.8  # melody\\n36,1,0.5,0.85  # bassline\\n72,1.5,0.25,0.75  # melody"
}

Generate exactly this JSON structure with proper escaping. Create professional-quality music with clear arrangement, proper dynamics, and musical coherence.`;
        
        return prompt;
    }
}
