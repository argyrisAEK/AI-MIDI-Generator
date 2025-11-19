// Consolidated style-specific instructions with genre details integrated
const styleAdjectives = {
   house: 'groovy, warm, rhythmic with syncopated bass',
    techno: 'hypnotic, minimal, dark harmonic colors',
    trance: 'uplifting, euphoric, soaring leads',
    'hip-hop': 'laid-back, swung, jazz-influenced loops',
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
    bassline: `Focus on root/fifth, (G0–G2 range, MIDI 31–55), Use Quarter (1.0) or Eighth (0.5) notes. Lock with the Kick drum on beat 1. Avoid overlap.`,
    
    chord: `Sustain chords for 2.0 to 4.0 beats. Change only on bar start or middle. Use closed voicing (root-3-5).`,
    
    arpeggio: `16th note (0.25) flow. Outline current chord. Keep strict quantization.`,
    
    melody: `Catchy motif (2-4 beats). Use rests to breathe. Repeat the main phrase with variation.`,
    
    lead: `Expressive monophonic lines. Start phrases on off-beats for groove. Duration 0.5-1.5 beats.`,
    
    plucks: `Short rhythmic stabs (0.25 beats). Syncopated patterns interact with bass.`,
    
    strings: `Long legato lines (4.0 beats). Slow attack. Harmony focus.`,
    
    keys: `Rhythmic comping or sustained pads. Keep it sparse.`,
    
    guitar: `Strumming patterns or mute-plucks on 8th notes.`,
    
    'pad-textures': `Atmospheric drones. 4-8 beat duration. Low velocity.`
};
function getTrackSpecificInstructions(trackType, context) {
  const style = (context.style || 'house').toLowerCase();
  const base = trackInstructions[trackType] || `Create a ${trackType} part fitting the groove.`;
  const adj = styleAdjectives[style] || '';
  return `${base} Context: ${adj}`;
}

// 3. The Builder Class
export class PromptBuilder {
    constructMultiTrackPrompt(context) {
        const activeTab = document.querySelector('.tab-panel.active');
        const isTextMode = activeTab && activeTab.id === 'text-panel';

        // Calculate total beats for clarity
        const beatsPerBar = parseInt(context.timeSignature.split('/')[0]);
        const totalBeats = context.duration * beatsPerBar;

        let prompt = `Act as a world-class Music Producer specializing in ${context.style}.
Generate a professional multi-track MIDI composition in strict JSON format.

The JSON object must have exactly these three keys:
{
  "title": "String - A creative title for the composition",
  "explanation": "String - One short sentence describing the musical piece, mood, and style",
  "notation": "String - All musical notes in a single string with escaped newlines (\\n)"
}


MUSICAL PARAMETERS:
- Key: ${context.key} ${context.scale}
- Tempo: ${context.tempo} BPM
- Total Length: ${context.duration} bars (${totalBeats} beats)
- Structure: ${context.structure || 'A-B-A (Intro-Main-Outro)'}
- Chord Progression: ${context.chordProgression.join(' -> ')}

TRACK GUIDELINES:`;

        // Add dynamic track instructions
        context.trackTypes.forEach(trackType => {
            prompt += `\n- ${trackType}: ${getTrackSpecificInstructions(trackType, context)}`;
        });

        prompt += `

CRITICAL RULES FOR AI GENERATION:
1. TIME UNIT = BEATS: Use musical beats (Float), NOT seconds.
   - 0.0 = Start of Bar 1
   - 1.0 = Quarter note later
   - ${beatsPerBar}.0 = Start of Bar 2
   - Max start_beat < ${totalBeats}

2. REPETITION IS KEY:
   - Do not generate random "noodling".
   - Establish a melodic motif in bars 1-2 and repeat it in bars 3-4.
   - Basslines should loop every 1 or 2 bars.

3. INTERPLAY (Call & Response):
   - Don't have all tracks busy at once.
   - If Melody is playing, keep Chords simple.
   - If Melody rests, add a Bass fill.

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
