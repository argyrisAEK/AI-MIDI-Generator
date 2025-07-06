// Dynamic style-specific instructions
const styleAdjectives = {
  house:      'groovy and danceable',
  techno:     'hypnotic and driving',
  trap:       'dark and syncopated',
  'hip-hop':  'soulful and sample-inspired',
  rock:       'energetic and powerful',
  pop:        'catchy and melodic',
  funk:       'rhythmic and percussive',
  reggae:     'laid-back and offbeat',
  jazz:       'improvisational and swingy',
  disco:      'uplifting and orchestral',
  classical:  'structured and harmonic',
  ambient:    'atmospheric and evolving'
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
  guitar: 'Compose a guitar part, either as a rhythmic strumming pattern, a melodic line, or an arpeggiated sequence.'
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
        const isTextMode = document.getElementById('text-prompt-container').classList.contains('active');

        let prompt = `Generate a cohesive, multi-track MIDI composition as a single, valid JSON object. Do not include any text, explanations, or markdown formatting before or after the JSON object itself.

The JSON object must have the following top-level keys: "title", "explanation", and "notation".

- "title": A creative title for the entire composition.
- "explanation": A brief, one-sentence description of the overall musical piece, its mood, and style.
- "notation": A single, valid JSON string containing the musical notation for ALL tracks. All internal newlines MUST be escaped as \\n.

Musical Context for Generation:
- Tracks to include: ${context.trackTypes.join(', ')}
- Key: ${context.key} ${context.scale}
- Tempo: ${context.tempo} BPM
- Time Signature: ${context.timeSignature}
- Style: ${context.style}
- Mood: ${context.mood}
- Duration: ${context.duration} bars (approximately ${context.totalDurationInSeconds.toFixed(1)} seconds)
- Rhythmic Complexity: ${context.rhythmicComplexity}
- Chord Progression: ${context.chordProgression.join(' - ')}
`;

        if (context.structure) {
            prompt += `- Desired Structure: ${context.structure}\n`;
        }

        if (isTextMode) {
            const userPrompt = document.getElementById('text-prompt').value;
            if (userPrompt) {
                prompt += `\nUser's creative direction: "${userPrompt}"\n`;
            }
        }

        prompt += `
For the "notation" value, list all notes for all tracks together. Use escaped newlines (\\n) to separate each note. Each note entry must be on a new conceptual line in the format:
pitch,time,duration,velocity  # track_name

Use the exact track names (${context.trackTypes.join(', ')}) in the comments after the # symbol. All tracks must be harmonically and rhythmically aligned. All notes MUST strictly adhere to the specified Key: ${context.key} ${context.scale}.

Example of the required final JSON output structure (note the escaped \\n in the notation string):
{
  "title": "Dreamy House Groove",
  "explanation": "An uplifting house track with a groovy bassline and a catchy melody, perfect for a summer vibe.",
  "notation": "|-\\n40,0,0.5,90  # bassline\\n67,0.5,0.5,80  # melody\\n40,1.5,0.5,95  # bassline\\n..."
}
`;
        
        return prompt;
    }
}