// Dynamic style-specific instructions
const styleAdjectives = {
  house: 'groovy and syncopated, built around a steady 4-on-the-floor kick pattern with off-beat open hi-hats, rhythmic basslines, and subtle chord stabs',
  
  techno: 'minimal and hypnotic, driven by repetitive motifs with layered percussive textures, evolving synth patterns, and relentless kick-driven momentum',
  
  trance: 'uplifting and melodic, featuring soaring lead lines, cascading arpeggios, lush pads, extended build-ups with risers, and euphoric breakdowns',
  
  trap: 'dark and spacious, characterized by rapid double-time or triple-time hi-hat rolls, deep 808 sub-bass slides, sparse kick-snare patterns, and atmospheric pads',
  
  'hip-hop': 'swinging and sample-inspired, with a strong backbeat snare, syncopated hi-hats, melodic loops, punchy bass, and rhythmic variation every 4-8 bars',
  
  rock: 'energetic and riff-based, driven by power chords, distorted guitar lines, steady 8th-note hi-hats, aggressive kick-snare patterns, and strong dynamics',
  
  pop: 'catchy and hook-driven, following clear verse-chorus structures with memorable melodies, layered vocals, bright production, and rhythmic consistency',
  
  funk: 'tight and syncopated, featuring locked-in bass grooves, rhythmic 16th-note guitar scratches, punchy horn stabs, ghost notes on snare, and percussive interplay',
  
  reggae: 'laid-back with offbeat rhythms, characterized by syncopated skank guitar on the 2nd and 4th beats, deep round bass, rimshot snares, and spacious delays',
  
  jazz: 'improvisational and harmonically rich, featuring swing rhythms with shuffled timing, complex chord extensions (7ths, 9ths, 13ths), walking bass, and dynamic interplay',
  
  disco: 'steady 4-on-the-floor groove with orchestral string stabs, syncopated rhythm guitar, funky bass octaves, open hi-hats on offbeats, and lush horn sections',
  
  classical: 'structured and polyphonic, following traditional voice-leading principles, balanced phrase lengths, dynamic contrast, and thematic development across movements',
  
  ambient: 'slow-moving and atmospheric, with spacious evolving textures, no strict rhythmic grid, sustained pad layers, subtle melodic fragments, and emphasis on tone color',
  
  'drum-and-bass': 'fast-paced with rapid tempo (160-180 BPM), featuring syncopated breakbeat patterns, rolling sub-bass reese sounds, chopped breaks, and layered atmospheric pads',
  
  synthwave: 'retro-futuristic and 80s-inspired, characterized by gated reverb snares, lush analog-style pads, arpeggiated synth sequences, sidechain compression, and nostalgic melodies',
  
  downtempo: 'chill and groove-driven, with laid-back drum patterns (80-100 BPM), warm Rhodes or electric piano textures, deep bass, vinyl crackle aesthetics, and spacious mixing',
  
  'progressive-rock': 'complex and dynamic, featuring shifting time signatures (5/4, 7/8), extended instrumental passages, intricate counterpoint, dramatic build-ups, and multi-layered arrangements with guitar-keyboard interplay'
};

  

const defaultInstructions = {
bassline: 'Create a bassline in the lower register (E1–E3) emphasizing root notes and fifths. Use quarter and eighth notes with occasional syncopation. Follow the chord progression closely and maintain rhythmic consistency with the kick drum.',

melody: 'Compose a memorable, singable melody in the mid to upper register (C4–C6). Use a mix of stepwise motion and small leaps. Vary note lengths (quarter, eighth, half notes) and include intentional rests for breathing room. Peak notes should align with harmonic tension points.',

chord: 'Construct chord progressions using triads or seventh chords with whole or half notes. Voice chords in mid register (C3–C5) for clarity. Use smooth voice leading between changes. Create a pad-like texture with sustained notes and minimal movement.',

arpeggio: 'Generate arpeggiated patterns based on the active chord progression. Use eighth or sixteenth notes in ascending, descending, or alternating patterns. Stay within 1-2 octaves (typically C3–C5). Sync rhythmically with the tempo.',

lead: 'Design a clear monophonic lead line in the upper register (C5–C7) with strong melodic contour. Use expressive rhythms with a mix of held notes and faster runs. Include slides, bends (pitch wheel), and dynamic variation (velocity 80-127) for expressiveness.',

plucks: 'Create short, percussive plucked synth lines (16th or 8th notes) following chord tones. Keep note duration under 200ms for staccato effect. Use mid-register (C4–C5) and moderate velocity (60-90) for a clean, rhythmic texture.',

strings: 'Compose flowing legato string lines with longer note values (half, whole notes, tied notes). Use smooth voice leading in mid register (G3–G5). Layer multiple voices for richness. Apply gradual crescendos/decrescendos through velocity changes (40-100).',

drums: 'Create a drum pattern with: kick (C1) on strong beats, snare (D1) on backbeats, closed hi-hat (F#1) in 8th or 16th notes, and open hi-hat (A#1) for accents. Add variation every 4-8 bars. Use velocity 80-120 for dynamics.',

keys: 'Compose a keyboard part (electric piano, organ, or acoustic piano) with block chords or broken chord patterns in mid register (C3–C5). Provide harmonic support or counter-melody. Use medium velocity (60-90) and vary rhythm from sustained to syncopated.',

brass: 'Create a brass section part with punchy stabs (short notes, high velocity 100-127), sustained swells (long notes with crescendo), or melodic phrases. Use mid-high register (G3–G5). Emphasize strong beats and harmonic transitions.',

percussion: 'Generate auxiliary percussion patterns using congas (D2, E2), shakers (F#3), bongos (C2, D2), tambourine (G3), or claps (E1). Create syncopated rhythms that complement the main drum groove. Use varied velocity (50-100) for organic feel.',

guitar: 'Compose a guitar part as: strummed chords (all notes simultaneously, 4-6 notes per chord), picked arpeggios (sequential notes), or single-note melodic lines. Use mid register (E3–E5). Add slight timing offsets (±10ms) for humanization.',

'pad-textures': 'Create an atmospheric pad with complex chords (7ths, 9ths, sus chords) in mid register (C3–C5). Use long sustained notes (whole notes or longer) with slow attack and release. Layer 3-4 voices with gentle movement. Low velocity (40-70) for subtlety.',

'fx-riser': 'Generate a tension-building riser effect: single note rising from C2 to C5 over 4-8 bars, OR multiple notes with increasing pitch and density. Gradually increase velocity from 40 to 110. Add filter sweep simulation through note density increase.'


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

        let prompt = `You are an expert composer AI. Generate a cohesive, multi-track MIDI composition as a single valid JSON object. 
Respond ONLY with raw JSON (no markdown, no explanations).

REQUIRED JSON STRUCTURE:
{
  "title": "String - max 20 characters",
  "explanation": "String - exactly 15 words describing mood, style, and piece",
  "notation": "String - all notes in a single JSON string with escaped \\n line breaks"
}

IMPORTANT:
- The "notation" string MUST escape all newlines as \\n
- No actual line breaks allowed inside the JSON string
- Do not add extra keys or text outside the JSON


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

        prompt += ` Consider incorporating these music theory concepts in your composition:
- Diatonic scales and key signatures (e.g., C major scale: C, D, E, F, G, A, B)
- Harmonic progressions and cadences (e.g., ii-V-I progression: Dm7, G7, Cmaj7)
- Rhythmic patterns and time signatures (e.g., syncopated rhythm in 4/4 time)
- Melodic contour and phrasing (e.g., ascending melody with a peak, followed by a descent)
- Chord inversions and voicings (e.g., Cmaj7 in first inversion: E, G, B, C)
- Always vary the velocity/dynamics of notes.
`;

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
NOTATION FORMAT: pitch,time,duration,velocity  # track_name
- Pitch: MIDI number (36–96) OR note name (C2–C6 range recommended)
- Time: floating point seconds from start (allow irregular values, e.g., 0.37, 1.12)
- Duration: floating point in seconds (min 0.05s, sustain allowed)
- Velocity: decimal 0.3–1.0 (ghost notes <0.5, accents >0.8)
- Track: must exactly match ${context.trackTypes.join(', ')}


PROFESSIONAL REQUIREMENTS:
- Maintain consistent groove and timing
- Ensure bass frequencies don't clash (bassline below 200Hz)
- Create complementary rhythmic patterns between tracks
- Apply appropriate and varied velocity dynamics (accents, ghost notes)
- Use scale-appropriate notes only; passing tones are acceptable if they resolve correctly.


EXAMPLE JSON OUTPUT:
{
  "title": "Neon Pulse",
  "explanation": "Driving house track with groovy bassline, syncopated chords, and euphoric melodic build",
  "notation": "36,0,0.5,0.95  # bassline\\n67,0.7,0.3,0.8  # melody\\n36,1.2,0.5,0.85  # bassline\\n72,1.6,0.25,0.75  # melody\\n40,2.1,0.4,0.9  # bassline"
}


Generate exactly this JSON structure with proper escaping. Create professional-quality music with clear arrangement, proper dynamics, and musical coherence.`;
        
        return prompt;
    }
}
