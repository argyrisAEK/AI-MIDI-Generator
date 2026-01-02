// Συμπιεσμένα Style Adjectives (Keywords only)
const styleAdjectives = {
    house: 'syncopated bass, groovy, warm',
    techno: 'hypnotic, minimal, dark',
    trance: 'uplifting, euphoric, soaring leads',
    'hip-hop': 'laid-back, swung, jazz-loops',
    rock: 'energetic, bold, harmonic motion',
    pop: 'catchy, hook-driven, clean',
    funk: 'syncopated, tight, rhythmic expressiveness',
    reggae: 'offbeat, warm, groovy bass',
    jazz: 'swing, 7th/9th chords, expressive',
    disco: 'lush, orchestral, 4/4 energy',
    classical: 'structured, voice-leading, orchestral',
    ambient: 'atmospheric, evolving, long sustains',
    'drum-and-bass': 'fast, agile melodic runs',
    synthwave: '80s analog, nostalgic, arps',
    downtempo: 'chill, smooth layers, mellow',
    'progressive-rock': 'complex, evolving, shifting ideas'
};

const trackInstructions = {
    bassline: "31-55,1.0/0.5,P5max,root",
    chord: "48-72,sync,3-4notes,2-4beat",
    melody: "60-84,call/response,motif,octavemax",
    arpeggio: "48-84,16th,rolling,scale",
    lead: "60-96,soaring,highvel",
    plucks: "60-84,0.25short,staccato",
    strings: "48-84,legato,4.0+ long",
    keys: "48-72,humanvel,harmonic",
    guitar: "40-76,strum,rhythm",
    'pad-textures': "36-72,drone,verylong",
    brass: "40-80,punchy,beat1+3",
    percs: "36-60,nontonal,rhythm"
};

export class PromptBuilder {
    /**
     * Κατασκευάζει το prompt για την AI χρησιμοποιώντας συμπιεσμένη μορφή
     * ΟΝΟΜΑ ΣΥΝΑΡΤΗΣΗΣ: constructMultiTrackPrompt (όπως απαιτεί το main.js)
     */
    constructMultiTrackPrompt(params) {
        const { key, bpm, duration_bars, style, mood, trackTypes, rhythmicComplexity, timeSignature, structure } = params;

        const beatsPerBar = parseInt(timeSignature?.split('/')[0]) || 4;
        const totalBeats = (duration_bars || 4) * beatsPerBar;

        const systemCore = `GEN MIDI: Key:${key} BPM:${bpm} Style:${style} (${styleAdjectives[style] || ''}) Mood:${mood} Bars:${duration_bars} Complexity:${rhythmicComplexity}

FORMAT: pitch,start_beat,duration,velocity #track

RULES:
1. Motif bars 1-2, repeat+variation bars 3-4
2. Melody-Chord interplay: when one plays, other simplifies
3. Human timing: ±0.05s, velocity ±0.1
4. Stay in ${key}, follow ${style} traits

TRACKS:
${trackTypes.map(t => `${t}(${trackInstructions[t] || 'default'})`).join(' ')}

JSON OUTPUT: {"title":"...","description":"...","tracks":{"track":"pitch,start,dur,vel\\n..."}}`;

        return systemCore;
    }
}
