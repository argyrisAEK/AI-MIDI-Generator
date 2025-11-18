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

CRITICAL: The "notation" value must be a single JSON string where all newlines are escaped as \\n. Do NOT use actual line breaks within the JSON string.

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
            prompt += `\n\nUser Direction: "${userPrompt}"`;
        }
    }

    // Track-specific guidelines
    prompt += `

Track Guidelines (create each with distinct character):`;
    context.trackTypes.forEach(trackType => {
        const instructions = getTrackSpecificInstructions(trackType, context);
        prompt += `\n- ${trackType}: ${instructions}`;
    });

    // Unified musical rules block (high impact, low token cost)
    prompt += `

Unified Musical Behavior Rules:
- Arpeggios: 1–2 bar patterns, 1/8–1/16 notes, max 8–12 notes per bar, no chaotic intervals, add small rests every few notes.
- Leads/Melodies: 2–4 note motifs with 0.20–0.45s durations, rests between phrases, variation every 4 bars, mostly stepwise motion.
- Basslines: root/5th/octave focus (C1–C3), simple rhythmic cells that repeat in 8-bar cycles with subtle 1–2 note variations.
- Chords/Keys/Pads/Strings: clean voice leading, natural sustains, lightly staggered entries, avoid dense clusters.
- Global: avoid over-density, avoid random jumps, phrase in 2–4 bar units, ensure breathing space through rests.

NOTATION FORMAT: pitch,time,duration,velocity # track_name
- MIDI note numbers (36–96)
- Time in seconds from start (quantized to 16th notes)
- All times within [0, ${context.totalDurationInSeconds.toFixed(3)}]
- Duration: 0.1–${Math.max(0.5, context.totalDurationInSeconds * 0.25).toFixed(2)} seconds
- Velocity: 0.1–1.0 (0.3–0.7 normal, 0.8–1.0 accents, 0.1–0.3 ghost)
- Track names: ${context.trackTypes.join(', ')}

COMPOSITION QUALITY:
✓ Variety: avoid repetitive loops
✓ Dynamics: full velocity range with accents
✓ Voice Leading: smooth transitions
✓ Density: balance sparse + full moments
✓ Coherence: tracks support each other

RHYTHMIC COMPLEXITY "${context.rhythmicComplexity}":
${
      {
        simple: 'Mostly quarter/eighth notes, minimal syncopation.',
        moderate: 'Mix of note lengths, light syncopation.',
        complex: 'Varied rhythms with purposeful syncopation.'
      }[context.rhythmicComplexity]
    }

PRO MUSIC THEORY:
- Use only ${context.key} ${context.scale} scale notes
- Follow chord progression: ${context.chordProgression.join(' → ')}
- Register rules: bass (C1–C3), mid (C3–C5), high (C5–C7)
- Phrase in 2–4 bar units with rests

EXAMPLE (compact, use only \\n):
52,0.00,0.44,0.88 #bassline\\n67,0.00,1.00,0.80 #melody

Generate professional-quality music with clear arrangement and controlled dynamics.`;

    return prompt;
}


}
