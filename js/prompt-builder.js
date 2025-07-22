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
  drums:    'Create a drum pattern featuring kick, snare, and hi-hats that anchors the groove.'
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

        let prompt = `Generate a cohesive, multi-track MIDI composition with the following tracks: ${context.trackTypes.join(', ')}.
Musical Context:
- Key: ${context.key} ${context.scale}
- Tempo: ${context.tempo} BPM
- Time Signature: ${context.timeSignature}
- Style: ${context.style}
- Mood: ${context.mood}
- Duration: ${context.duration} bars (approximately ${context.totalDurationInSeconds.toFixed(1)} seconds)
- Rhythmic Complexity: ${context.rhythmicComplexity}
- Chord Progression: ${context.chordProgression.join(' - ')}

`;

        if (isTextMode) {
            const userPrompt = document.getElementById('text-prompt').value;
            if (userPrompt) {
                prompt += `User's creative direction: "${userPrompt}"\n\n`;
            }
        }

        prompt += 'Instructions for each track:\n';
        context.trackTypes.forEach(trackType => {
            prompt += `- ${trackType}: ${getTrackSpecificInstructions(trackType, context)}\n`;
        });

        prompt += `
For each track, also include:
title: <Track Title>
description: <Brief Track Description>

IMPORTANT: Generate a single response. For each track, provide its musical notation in a structured format.
Use the following format exactly, with a [TRACK:...] separator for each instrument:

[TRACK:track_name_1]
notation: |-
pitch,time,duration,velocity
...
[TRACK:track_name_2]
notation: |-
pitch,time,duration,velocity
...

Ensure track names (${context.trackTypes.join(', ')}) are used in the [TRACK:...] separators. The tracks must be harmonically and rhythmically aligned.`;
        
        return prompt;
    }
}