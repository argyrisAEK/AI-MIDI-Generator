export const config = {
    runtime: 'edge',
};

// --- ΔΕΔΟΜΕΝΑ ΑΠΟ ΤΟ PROMPT-BUILDER ---
const STYLE_ADJECTIVES = {
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
    'drum-and-bass': 'fast, energetic harmonic motion with agile melodic runs',
    synthwave: 'nostalgic, 80s-inspired with warm analog pads and arpeggiated patterns',
    'progressive-rock': 'complex, evolving, with shifting harmonic ideas and expressive melodies'
};

const TRACK_INSTRUCTIONS = {
    bassline: `Range: G0–G2 (MIDI 31–55). Prefer Quarter or Eighth durations. Establish a motif in Bar 1 and repeat with variation.`,
    melody: `Range: C3–G5 (MIDI 48–79). Use call and response. Use syncopation and varied rhythms.`,
    chords: `Range: C3–C5 (MIDI 48–72). Focus on harmonic progression. Use sustained notes or rhythmic stabs.`,
    drums: `MIDI 36 (Kick), 38 (Snare), 42 (Closed Hat), 46 (Open Hat). Use standard patterns for the genre.`,
    pads: `Range: C3–C5. Long sustained notes, lush voicings, focus on texture and atmosphere.`
};

// Helper: Μετατροπή Note Name σε MIDI (π.χ. "C4" -> 60)
function noteToMidi(note) {
    if (!isNaN(note)) return parseInt(note);
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const match = note.match(/^([A-G]#?)(-?\d+)$/);
    if (!match) return 60;
    return (parseInt(match[2]) + 1) * 12 + names.indexOf(match[1]);
}

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const context = await req.json();
        const { style, tempo, key, scale, tracks, durationBars, timeSignature } = context;

        const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
        const totalBeats = durationBars * beatsPerBar;
        const styleAdj = STYLE_ADJECTIVES[style] || 'musical';

        // 1. Κατασκευή του Prompt (Logic από PromptBuilder)
        let aiPrompt = `Act as a world-class Music Producer. Create a MIDI composition in ${style} style (${styleAdj}).
Key: ${key} ${scale}, Tempo: ${tempo} BPM, Time Signature: ${timeSignature}.
Duration: ${durationBars} bars (${totalBeats} total beats).

Tracks to generate: ${tracks.join(', ')}.

Constraints:
${tracks.map(t => `- ${t.toUpperCase()}: ${TRACK_INSTRUCTIONS[t] || ''}`).join('\n')}

Output format (one note per line):
pitch,start_beat,duration_beats,velocity #track_name

Return ONLY valid JSON:
{
  "title": "Composition Title",
  "explanation": "Short musical description",
  "notation": "pitch,start,dur,vel #track\\npitch,start,dur,vel #track"
}`;

        // 2. Κλήση AI API
        const response = await fetch(`https://gen.pollinations.ai/text/${encodeURIComponent(aiPrompt)}?model=openai-large&json=true&seed=${Math.floor(Math.random() * 99999)}&key=key=plln_sk_JmbRcolKjEzatmVsRROri34kyDAmSoUj`);
        
        if (!response.ok) throw new Error("AI Service failed");
        const rawData = await response.text();
        
        // Καθαρισμός JSON
        const cleanJson = rawData.replace(/```json\n?([\s\S]+?)\n?```/g, '$1').trim();
        const parsedData = JSON.parse(cleanJson);

        // 3. Parsing της "notation" (Logic από MIDI-Generator-API)
        const lines = parsedData.notation.split('\n');
        const formattedTracks = {};
        const secondsPerBeat = 60 / tempo;

        lines.forEach(line => {
            if (!line.includes(',') || !line.includes('#')) return;
            
            const [data, trackInfo] = line.split('#');
            const [pitch, start, dur, vel] = data.split(',').map(s => s.trim());
            const trackName = trackInfo.trim();

            if (!formattedTracks[trackName]) formattedTracks[trackName] = [];

            formattedTracks[trackName].push({
                midi: noteToMidi(pitch),
                time: parseFloat(start) * secondsPerBeat,
                duration: parseFloat(dur) * secondsPerBeat,
                velocity: parseFloat(vel) || 0.8
            });
        });

        // 4. Επιστροφή των επεξεργασμένων δεδομένων
        return new Response(JSON.stringify({
            title: parsedData.title,
            explanation: parsedData.explanation,
            tracks: formattedTracks,
            metadata: { tempo, key, scale, totalBeats }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error("Generate Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
