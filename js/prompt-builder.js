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

    let prompt = `Generate a cohesive, professional multi-track MIDI composition as a single valid JSON object. Respond ONLY with valid JSON. No markdown, no explanations.

The JSON must contain exactly:
{
  "title": "String",
  "explanation": "String",
  "notation": "String with all \\n escaped, no real line breaks"
}

CRITICAL:
- "notation" must be ONE SINGLE LINE STRING with all line breaks escaped as \\n.
- NEVER insert actual line breaks inside the JSON string.
- Provide only valid JSON formatting.

MUSICAL REQUIREMENTS:
- Tracks: ${context.trackTypes.join(', ')}
- Key: ${context.key} ${context.scale}
- Tempo: ${context.tempo} BPM
- Time Signature: ${context.timeSignature}
- Style: ${context.style}
- Mood: ${context.mood}
- Duration: ${context.duration} bars (~${context.totalDurationInSeconds.toFixed(3)} seconds)
- Harmonic Progression: ${context.chordProgression.join(' → ')}
- Rhythmic Complexity: ${context.rhythmicComplexity}
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

    // TRACK-BY-TRACK GUIDANCE
    prompt += `\nTRACK GUIDELINES (each track must have its own character):\n`;
    context.trackTypes.forEach(trackType => {
        const instructions = getTrackSpecificInstructions(trackType, context);
        prompt += `- ${trackType}: ${instructions}\n`;
    });

    // Complexity descriptors
    const complexityGuide = {
        simple: 'Use mostly quarter/eighth notes, minimal syncopation, clean rhythmic grid.',
        moderate: 'Blend varied note lengths with light syncopation. Avoid mechanical patterns.',
        complex: 'Include controlled syncopation, off-beat placements, and dynamic rhythmic shapes.'
    };

    // NOTATION FORMAT
    prompt += `
NOTATION FORMAT (CRITICAL):
pitch,time,duration,velocity # track_name
- pitch: MIDI notes 36–96
- time: seconds from start, quantized to 16th grid
- duration: 0.10s–${Math.max(0.5, context.totalDurationInSeconds * 0.25).toFixed(2)}s
- velocity: 0.10–1.00
- track_name must match exactly: ${context.trackTypes.join(', ')}
- Total time range must stay within 0 to ${context.totalDurationInSeconds.toFixed(3)} seconds
- Use max 2 decimals for time/duration/velocity

RHYTHMIC COMPLEXITY "${context.rhythmicComplexity}":
${complexityGuide[context.rhythmicComplexity]}

COMPOSITION QUALITY RULES:
✓ Avoid loops: vary timing, rhythm, and contour across bars  
✓ Introduce subtle humanization: small timing offsets (0.02–0.10s) in non-percussive tracks  
✓ Gradual arrangement: do NOT start all tracks at time 0  
✓ Insert 0.3–0.6s rests between phrases  
✓ Create 2–4 bar phrase units  
✓ Apply dynamic shaping: crescendos/decrescendos using velocity  
✓ All notes MUST follow: ${context.key} ${context.scale}  
✓ Chord tones for harmony; color tones allowed tastefully  
✓ Bass emphasizes chord roots, avoids constant repetition  
✓ Strings must swell, evolve, and avoid static blocks  
✓ Pads must be atmospheric and slow-evolving, not rhythmic  
✓ Keys should reinforce harmony without overplaying  
✓ Lead/melody must breathe — no nonstop streams

CINEMATIC / EPIC GUIDANCE:
- Use emotional arc: soft intro → gradual layering → fuller midpoint → controlled ending
- Strings: stagger entrances by 0.1–0.3s for realism
- Pads: long, smooth fades (2–4s attack/release feel implied)
- Bass: anchoring but not overly busy; focus on root motion and smooth intervals
- Harmonic rhythm must match chord progression timing
- Avoid robotic repetition: vary note start times slightly
- Apply expressive contour to melodic tracks

NOTATION EXAMPLE (ESCAPED ONLY):
52,0.00,0.44,0.88 #bassline\\n67,0.12,1.00,0.74 #melody\\n72,0.00,2.00,0.65 #pad-textures

Generate high-quality, emotionally expressive music with natural phrasing and strong dynamic evolution.`;

    return prompt;
}
