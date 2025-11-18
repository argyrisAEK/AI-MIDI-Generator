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

Musical Requirements:
- Tracks: ${context.trackTypes.join(', ')}
- Key: ${context.key} ${context.scale}
- Tempo: ${context.tempo} BPM
- Time Signature: ${context.timeSignature}
- Style: ${context.style}
- Mood: ${context.mood}
- Duration: ${context.duration} bars (~${context.totalDurationInSeconds.toFixed(3)} seconds)
- Rhythmic Complexity: ${context.rhythmicComplexity}
- Chord Progression: ${context.chordProgression.join(' → ')}`;

    if (context.structure) {
        prompt += `\n- Structure: ${context.structure}`;
    }

    if (isTextMode) {
        const userPrompt = document.getElementById('text-prompt').value;
        if (userPrompt) {
            prompt += `\nUser Direction: "${userPrompt}"`;
        }
    }

    // Track instructions (compact & genre-aware)
    prompt += `\n\nTrack Guidelines (create each with distinct character):
All tracks must:
- Follow 2–4 bar phrasing with rests of 0.3–0.5s between phrases
- Vary rhythmically to avoid repetitive loops
- Use velocity range to express dynamics (0.1–1.0)
- Maintain voice leading and smooth transitions
- Respect the key (${context.key} ${context.scale}) and chord progression
- Apply style-specific character as per genre: ${context.style} (${styleAdjectives[context.style.toLowerCase()] || 'musically coherent'})`;

    context.trackTypes.forEach(trackType => {
        const instructions = trackInstructions[trackType] || `Create a ${trackType} part that enhances the arrangement.`;
        const adj = styleAdjectives[context.style.toLowerCase()] || '';
        prompt += `\n- ${trackType}: ${instructions} ${adj ? `Make it ${adj} while maintaining musical coherence.` : ''}`;
    });

    // Rhythmic complexity guidance
    const complexityGuide = {
        simple: 'Mostly quarter and eighth notes, minimal syncopation. Clear pulse.',
        moderate: 'Mix of rhythmic values, some syncopation, clear pulse. Avoid over-complication.',
        complex: 'Varied rhythmic values, syncopation, polyrhythmic elements. Use off-beat placements strategically.'
    };
    prompt += `\n\nRHYMIC COMPLEXITY "${context.rhythmicComplexity}":\n${complexityGuide[context.rhythmicComplexity]}`;

    // Notation format
    prompt += `
NOTATION FORMAT: pitch,time,duration,velocity # track_name
- MIDI note numbers (36-96)
- Time in seconds from start (quantized to 16th notes)
- Duration: 0.1s minimum, ${Math.max(0.5, context.totalDurationInSeconds * 0.25).toFixed(2)}s maximum
- Two decimal places for time, duration, velocity
- Track names: ${context.trackTypes.join(', ')}
- Example: 52,0.00,0.44,0.88 #bassline\\n67,0.00,1.00,0.80 #melody`;

    prompt += `\n\nGenerate professional-quality music with clear arrangement, varied textures, humanized dynamics, and strong musical coherence.`;

    return prompt;
}

}
