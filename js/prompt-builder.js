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
  bassline: 'Craft a bassline emphasizing root notes in the lower register (E1–E3), using quarter and eighth notes.',
  melody:   'Compose a memorable melody in the mid to upper register (C4–C6), mixing note lengths for interest.',
  chord:    'Construct sustained chord progressions using whole or half notes for a pad-like texture.',
  arpeggio: 'Generate arpeggiated patterns based on the chord progression using eighth and sixteenth notes.',
  lead:     'Design a clear monophonic lead line with rhythmic interest that cuts through the mix.',
  plucks:   'Add short, percussive plucked synth lines that follow the chords with quick decay.',
  strings:  'Include flowing legato string lines with longer note values to support the harmony.',
  drums:    'Create a drum pattern featuring kick, snare, and hi-hats that anchors the groove.',
  keys: 'Compose a part for keys (electric piano, organ, or piano) providing harmonic support or a counter-melody.',
  brass: 'Add a brass section part with stabs, swells, or a melodic line appropriate for the genre.',
  percussion: 'Generate a rhythmic pattern using auxiliary percussion like congas, shakers, or bongos to add texture.',
  guitar: 'Compose a guitar part, either as a rhythmic strumming pattern, a melodic line, or an arpeggiated sequence.',
  'pad-textures': 'Create a slow-evolving, atmospheric pad with long attack and release times. Use complex, layered chords to build a rich texture.',
  'fx-riser': 'Generate a single, long sound effect that builds tension over several bars. It should consist of a rising pitch (e.g., from C2 to C5) and increasing filter cutoff. Typically represented by a single long note.'
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
- Duration: ${context.duration} bars (${context.totalDurationInSeconds.toFixed(1)} seconds)
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
- Duration in seconds (minimum 0.1s for clarity)
- Velocity as decimal (0.3-1.0 for dynamic range)
- Track name must match exactly: ${context.trackTypes.join(', ')}

PROFESSIONAL REQUIREMENTS:
- Maintain consistent groove and timing
- Use proper voice leading for harmonic parts
- Ensure bass frequencies don't clash (bassline below 200Hz)
- Create complementary rhythmic patterns between tracks
- Apply appropriate velocity dynamics (accents, ghost notes)
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