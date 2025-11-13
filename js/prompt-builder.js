// Consolidated style-specific instructions with genre details integrated
const styleAdjectives = {
    house:      'groovy, four-on-the-floor driven with swung hi-hat patterns',
    techno:     'hypnotic and industrial with relentless kick patterns and evolving textures',
    trance:     'euphoric and uplifting with soaring leads and emotional breakdowns',
    trap:       'dark and syncopated with heavy 808s and rapid hi-hat rolls',
    'hip-hop':  'soulful and sample-inspired with boom-bap drums and jazzy chords',
    rock:       'energetic and powerful with driving guitars and solid backbeat',
    pop:        'catchy and polished with memorable hooks and modern production',
    funk:       'rhythmic and percussive with syncopated basslines and tight grooves',
    reggae:     'laid-back and offbeat with skank guitar and deep bass',
    jazz:       'improvisational and swingy with complex harmonies and walking bass',
    disco:      'uplifting and orchestral with four-on-the-floor and lush strings',
    classical:  'structured and harmonic with voice leading and orchestral colors',
    ambient:    'atmospheric and evolving with long sustains and minimal rhythm',
    'drum-and-bass': 'fast-paced with complex breakbeats, heavy basslines and jungle influences',
    synthwave: 'nostalgic, 80s-inspired with driving arpeggios, lush pads and analog warmth',
    downtempo: 'chill, groovy, and atmospheric with a relaxed, organic feel',
    'progressive-rock': 'complex, with changing time signatures, intricate arrangements and epic builds'
};

const trackInstructions = {
  bassline: `Create a cohesive bassline that establishes harmonic foundation and groove. Use root notes and chord tones (E1–E3 range) with intelligent rhythmic placement. Mix sustained notes with occasional syncopation.`,
  chord: `Generate harmonic chord progression (triads or seventh chords). Use voice leading that minimizes movement. Sustain chords for 1-2 beats.`,
  arpeggio: `Develop arpeggiated patterns from chord progression. Use eighth-note subdivisions with occasional sixteenth-note flourishes. Range: C3-C6.`,
  melody: `Compose memorable melody fitting the key and progression. Use C4–C6 range combining stepwise motion with strategic leaps. Create call-and-response phrases.`,
  lead: `Design expressive monophonic lead complementing the melody. Focus on phrasing with bends and vibrato. Create space between phrases. Use upper register (C5-C7).`,
  plucks: `Add short, percussive plucked elements for rhythmic interest. Use staccato articulation with quick decay. Range: C3-C5, avoiding bass frequencies.`,
  strings: `Compose flowing, legato string lines adding emotional depth. Use longer durations (half/whole notes) with gradual crescendos. Range: C3-C6.`,
  keys: `Add harmonic support or counter-melodies using piano/keyboard. Support chord progression with subtle rhythmic interest. Keep sparse and spacious.`,
  brass: `Introduce brass stabs or sustained harmonies for impact. Use accent patterns punctuating the rhythm. Short, powerful notes work better than sustained tones.`,
  guitar: `Compose guitar parts serving the arrangement. Match technique and voicing to style authenticity.`,
  'pad-textures': `Generate evolving pad textures creating atmospheric depth. Use slow attack/release envelopes. Layer multiple oscillators with slight detuning.`,
};

function getTrackSpecificInstructions(trackType, context) {
  const style = (context.style || 'house').toLowerCase();
  const base = trackInstructions[trackType] || `Create a ${trackType} part that enhances the arrangement.`;
  const adj = styleAdjectives[style];
  
  return adj ? `${base} Make it ${adj} while maintaining musical coherence.` : base;
}

export class PromptBuilder {
    constructMultiTrackPrompt(context) {
        const activeTab = document.querySelector('.tab-panel.active');
        const isTextMode = activeTab && activeTab.id === 'text-panel';

        let prompt = `Generate a cohesive, multi-track MIDI composition as a single, valid JSON object. Respond ONLY with properly formatted JSON - no markdown, explanations, or additional text.

The JSON object must have exactly these three keys:
{
  "title": "String - A creative title for the composition",
  "explanation": "String - One sentence describing the musical piece, mood, and style",
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
- Duration: ${context.duration} bars (~${context.totalDurationInSeconds.toFixed(3)} seconds)
- Rhythmic Complexity: ${context.rhythmicComplexity}
- Chord Progression: ${context.chordProgression.join(' → ')}
`;

        if (context.structure) {
            prompt += `- Structure: ${context.structure}\n`;
        }

        if (isTextMode) {
            const userPrompt = document.getElementById('text-prompt').value;
            if (userPrompt) {
                prompt += `\nUser Direction: "${userPrompt}"\n`;
            }
        }

        // Add ONLY track instructions for selected tracks
        prompt += `\nTrack Guidelines (create each with distinct character):\n`;
        context.trackTypes.forEach(trackType => {
            const instructions = getTrackSpecificInstructions(trackType, context);
            prompt += `- ${trackType}: ${instructions}\n`;
        });

        // Rhythmic complexity guidance
        const complexityGuide = {
            simple: 'Mostly quarter and eighth notes, minimal syncopation. Clear pulse.',
            moderate: 'Mix of rhythmic values, some syncopation, clear pulse. Avoid over-complication.',
            complex: 'Varied rhythmic values, syncopation, polyrhythmic elements. Use off-beat placements strategically.'
        };

        prompt += `
NOTATION FORMAT: pitch,time,duration,velocity # track_name
- MIDI note numbers (36-96) for brevity
- Time in seconds from start (quantized to 16th notes)
- All note times within [0, ${context.totalDurationInSeconds.toFixed(3)}] seconds
- Duration: minimum 0.1s, maximum ${Math.max(0.5, context.totalDurationInSeconds * 0.25).toFixed(2)}s
- Maximum two decimal places (X.XX) for time, duration, velocity
- Velocity: 0.1-1.0 (0.3-0.7 for normal, 0.8-1.0 for accents, 0.1-0.3 for ghost notes)
- Track names (exact): ${context.trackTypes.join(', ')}

COMPOSITION QUALITY:
✓ Variety: Avoid repetitive patterns; vary note timings from simple grid
✓ Dynamics: Use full velocity range with proper accents
✓ Voice Leading: Smooth transitions; minimize large leaps unless stylistic
✓ Density: Balance sparse intro/outro with full mid-section
✓ Coherence: All tracks work harmonically and rhythmically together
✓ Energy Arc: Build from intro through development to climax

RHYTHMIC COMPLEXITY "${context.rhythmicComplexity}":
${complexityGuide[context.rhythmicComplexity]}

PROFESSIONAL MUSIC THEORY:
- Use only ${context.key} ${context.scale} scale notes
- Follow chord progression: ${context.chordProgression.join(' → ')}
- Register: bass (C1-C3), mid (C3-C5), high (C5-C7)
- Create interesting melodic contours, not flat lines

EXAMPLE NOTATION (compact, use only \\n):
52,0.00,0.44,0.88 #bassline\\n52,0.44,0.44,0.92 #bassline\\n67,0.00,1.00,0.80 #melody

Generate professional-quality music with clear arrangement and strong dynamics.`;
        
        return prompt;
    }
}
