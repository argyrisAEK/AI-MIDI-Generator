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

const defaultInstructions = {
  bassline: `Create a cohesive bassline that establishes harmonic foundation and groove. Use root notes and chord tones (E1–E3 range) with intelligent rhythmic placement. For house/techno: lock with kick pattern. For jazz: use walking bassline with approach tones. For hip-hop: deep, warm sub-bass foundation. Mix sustained notes with occasional syncopation.`,
  chord: `Generate harmonic chord progression (triads or seventh chords). Use voice leading that minimizes movement. Sustain chords for 1-2 beats. For jazz: use extended voicings (9ths, 11ths). For classical: smooth voice leading avoiding parallel fifths.`,
  arpeggio: `Develop arpeggiated patterns from chord progression. Use eighth-note subdivisions with occasional sixteenth-note flourishes. For synthwave/trance: driving, repeating patterns. For ambient: sparse, delicate arpeggios. Range: C3-C6.`,
  melody: `Compose memorable melody fitting the key and progression. Use C4–C6 range combining stepwise motion with strategic leaps. Create call-and-response phrases. Vary rhythm between sustained and ornamental notes. End phrases on stable tones.`,
  lead: `Design expressive monophonic lead complementing the melody. Focus on phrasing with bends and vibrato. Create space between phrases. Use upper register (C5-C7). For rock: soaring, bending lines. For electronic: punchy, digital articulation.`,
  plucks: `Add short, percussive plucked elements for rhythmic interest. Use staccato articulation with quick decay. For hip-hop: syncopated, hitting off-beats. For ambient: sparse and delicate. Range: C3-C5, avoiding bass frequencies. Vary velocity for organic feel.`,
  strings: `Compose flowing, legato string lines adding emotional depth. Use longer durations (half/whole notes) with gradual crescendos. Create smooth voice leading. Range: C3-C6. Layer sustained notes under harmony for richness.`,
  keys: `Add harmonic support or counter-melodies using piano/keyboard. Support chord progression with subtle rhythmic interest. For jazz: sophisticated voicings with extensions. For hip-hop: warm, soulful electric piano. Keep sparse and spacious.`,
  brass: `Introduce brass stabs or sustained harmonies for impact. Use accent patterns punctuating the rhythm (often beats 2 and 4). Short, powerful notes work better than sustained tones. Stay within harmonic framework using passing tones sparingly.`,
  guitar: `Compose guitar parts serving the arrangement - rhythm, lead, or texture. For rock: power chords and rhythmic patterns. For jazz: jazz voicings and comping. For acoustic: fingerpicking patterns. Match technique to style authenticity.`,
  'pad-textures': `Generate evolving pad textures creating atmospheric depth. Use slow attack/release envelopes (0.5-2 seconds). Layer multiple oscillators with slight detuning. For ambient: morphing, never-repeating textures. For synthwave: warm, analog-sounding beds. Avoid rhythmic patterns - focus on sustained harmony.`,
};

function getTrackSpecificInstructions(trackType, context) {
  const style = (context.style || 'house').toLowerCase();
  const base  = defaultInstructions[trackType] || `Create a ${trackType} part that enhances the arrangement.`;
  const adj   = styleAdjectives[style];
  
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
                prompt += `\nCreative Direction from User: "${userPrompt}"\n`;
            }
        }

        // Add specific track instructions with enhanced detail
        prompt += `\nTrack-Specific Guidelines (CREATE EACH TRACK WITH DISTINCT CHARACTER):\n`;
        context.trackTypes.forEach(trackType => {
            const instructions = getTrackSpecificInstructions(trackType, context);
            prompt += `- **${trackType}**: ${instructions}\n`;
        });

        prompt += `
NOTATION FORMAT: Each note must be: pitch,time,duration,velocity  # track_name
- Use MIDI note numbers (36-96) over note names for brevity.
- Time in seconds from start (quantized to 16th notes for precision)
- All note start times must be within [0, ${context.totalDurationInSeconds.toFixed(3)}] seconds
- Duration in seconds (minimum 0.1s, maximum ${Math.max(0.5, context.totalDurationInSeconds * 0.25).toFixed(2)}s)
- **CRITICAL:** Use maximum two decimal places (X.XX) for time, duration, and velocity to save tokens.
- Velocity as decimal 0.1-1.0 (use 0.3-0.7 for most notes, 0.8-1.0 for accents, 0.1-0.3 for ghost notes)
- Track name must match exactly: ${context.trackTypes.join(', ')}

COMPOSITION QUALITY REQUIREMENTS:
✓ Variety: Avoid repetitive patterns. Vary note timings from simple grid (not all multiples of 0.5)
✓ Dynamics: Use full velocity range with proper accents and dynamics
✓ Voice Leading: Smooth transitions between registers, minimize large leaps unless stylistic
✓ Density Control: Balance sparse intro/outro with full mid-section
✓ Musical Coherence: All tracks work harmonically and rhythmically together
✓ Energy Arc: Build from intro through development to a satisfying climax
✓ Avoid Repetition: Don't repeat identical melodies or patterns more than twice consecutively
✓ AVOID: Identical rhythmic patterns across all sections
✓ CREATE: Progressive change in register, timing, articulation between sections
✓ HUMANIZE: Add micro-variations in timing and velocity even when using similar harmonic content

PROFESSIONAL MUSIC THEORY APPLICATION:
- Apply diatonic scales: Use only notes from ${context.key} ${context.scale}
- Harmonic progressions: Follow the provided chord progression intelligently
- Rhythmic complexity as "${context.rhythmicComplexity}": 
  ${context.rhythmicComplexity === 'simple' ? '  • Simple: Mostly quarter and eighth notes, minimal syncopation' :
    context.rhythmicComplexity === 'moderate' ? '  • Moderate: Mix of rhythmic values, some syncopation, clear pulse' :
    '  • Complex: Varied rhythmic values, syncopation, polyrhythmic elements, off-beat placements'}
- Melodic contour: Create interesting shapes (peaks, valleys, arcs) not just flat lines
- Register management: Separate tracks by register for clarity (bass: C1-C3, mid: C3-C5, high: C5-C7)

EXAMPLE NOTATION (ESSENTIAL FORMAT - COMPACT, USE ONLY \\n FOR SEPARATION):
52,0.00,0.44,0.88 #bassline\\n52,0.44,0.44,0.92 #bassline\\n67,0.00,1.00,0.80 #melody\\n36,0.25,0.25,0.50 #arpeggio

Generate exactly this JSON structure with proper escaping. Create professional-quality music with clear arrangement, strong dynamics, musical coherence.`;
        
        return prompt;
    }
}
