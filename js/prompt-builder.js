// Consolidated style-specific instructions with genre details integrated
const styleAdjectives = {
    house: 'groovy, warm, and rhythmic through bass phrasing and chord stabs',
    techno: 'hypnotic, minimal, and evolving with dark harmonic colors',
    trance: 'uplifting, emotional, with soaring leads and wide pads',
    trap: 'dark, sparse, melodic with expressive bass movement',
    'hip-hop': 'soulful, jazzy, with smooth chord progressions and melodic phrasing',
    rock: 'energetic, bold, with strong melodic and harmonic movement',
    pop: 'catchy, polished, and hook-driven with clean harmonies',
    funk: 'syncopated, tight, and rhythmically expressive through bass and chords',
    reggae: 'laid-back, groovy, with syncopated harmonic movement and warm tones',
    jazz: 'swingy, expressive, harmonically rich with 7ths, 9ths, and extended voicings',
    disco: 'uplifting, lush, orchestral with energetic harmonic movement',
    classical: 'structured, expressive, with careful voice leading and orchestral color',
    ambient: 'atmospheric, minimal, evolving with long sustains and soft transitions',
    'drum-and-bass': 'fast, energetic harmonic motion with agile melodic runs',
    synthwave: 'nostalgic, 80s-inspired with warm analog pads and arpeggiated patterns',
    downtempo: 'chill, mellow, atmospheric with smooth melodic layers',
    'progressive-rock': 'complex, evolving, with shifting harmonic ideas and expressive melodies'
};

const trackInstructions = {
    bassline: `Create a cohesive bassline that matches the Style and reinforces the chord progression and tonal center.
Focus on root and fifth notes (C1–C3 range) with simple rhythmic motion (quarter or eighth notes).
Ensure rhythmic alignment with the harmonic rhythm, avoiding excessive syncopation. Duration per note: 0.3-0.8s.`,
    
    chord: `Create harmonic chords with proper voicing (root, 3rd, 5th stacked).
Sustain 1.5-2.0s per chord. Leave 0.4s silence between chord changes.`,
    
    arpeggio: `Generate arpeggiated patterns outlining the chord progression.
Use eighth-note movement. Duration per note: 0.1-0.2s.`,
    
    melody: `Compose a memorable melody in C4–C6 with clear phrasing.
Create musical phrases (2-4 notes) followed by 0.3s rests.`,
    
    lead: `Create expressive monophonic lead in C5–C7.
Add phrasing with 0.2-0.3s gaps between phrases.`,
    
    plucks: `Add tight, rhythmic plucked notes. Short decay (0.1-0.2s).
Fill spaces but leave breathing room between note groups.`,
    
    strings: `Compose warm legato lines with 1.5-3.0s sustains.
Stagger note entry times for layered texture.`,
    
    keys: `Provide sparse harmonic support with 0.8-1.5s sustains.
Maximum 3 notes per bar. Align with phrase boundaries.`,
    
    brass: `Short harmonic stabs (0.2-0.4s) on beat 1 and 3.
Keep sparse and impactful.`,
    
    guitar: `Create rhythmic stabs or chords aligned to chord changes.
Duration: 0.4-0.8s per note.`,
    
    'pad-textures': `Add evolving pads with 2-4s attack/release.
Stagger multiple pads for layered atmosphere.`
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
  "explanation": "String - One short sentence describing the musical piece, mood, and style",
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


RHYTHMIC COMPLEXITY "${context.rhythmicComplexity}":
${complexityGuide[context.rhythmicComplexity]}

PROFESSIONAL MUSIC THEORY:
- Use only ${context.key} ${context.scale} scale notes
- Follow chord progression: ${context.chordProgression.join(' → ')}
- Register: bass (C1-C3), mid (C3-C5), high (C5-C7)
- Create interesting melodic contours, not flat lines

PHRASING RULES (CRITICAL):
- Insert 0.3-0.5s silence gaps at arrangement section boundaries
- No track should play continuously without rests
- Create 2-4 bar phrase units within each section
- Lead/Melody must have deliberate breathing space

HARMONIC ALIGNMENT:
- All notes MUST fit within the scale: ${context.key} ${context.scale}
- Chord progression: ${context.chordProgression.join(' → ')}
- Bass emphasizes chord ROOT at section starts
- Other tracks outline chord tones (root, 3rd, 5th, 7th allowed)


EXAMPLE NOTATION (compact, use only \\n):
52,0.00,0.44,0.88 #bassline\\n52,0.44,0.44,0.92 #bassline\\n67,0.00,1.00,0.80 #melody

Generate professional-quality music with clear arrangement and strong dynamics.`;
        
        return prompt;
    }
}
