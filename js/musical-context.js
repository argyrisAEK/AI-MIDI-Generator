export class MusicalContext {
    constructor() {
        this.context = {};
    }

    calculateTotalDurationInSeconds() {
        try {
            const bars = parseInt(document.getElementById('duration').value, 10);
            const bpm = parseInt(document.getElementById('bpm').value, 10);
            const timeSignature = document.getElementById('time-signature').value;
            const beatsPerBar = parseInt(timeSignature.split('/')[0], 10);

            if (isNaN(bars) || isNaN(bpm) || isNaN(beatsPerBar) || bpm <= 0) {
                return 0;
            }

            const beatDuration = 60 / bpm;
            const barDuration = beatDuration * beatsPerBar;
            return barDuration * bars;
        } catch (e) {
            console.warn("Could not calculate duration, returning 0.", e);
            return 0;
        }
    }

    generateContext(trackTypes) {
        const get = (id) => document.getElementById(id)?.value || '';
        const key = get('key');
        const scale = get('scale-type');

        const chordProgressions = {
            'Cmajor': ['C', 'Am', 'F', 'G'], 'Cminor': ['Cm', 'Ab', 'Eb', 'Bb'],
            'Dmajor': ['D', 'Bm', 'G', 'A'], 'Dminor': ['Dm', 'Bb', 'F', 'C'],
            'Emajor': ['E', 'C#m', 'A', 'B'], 'Eminor': ['Em', 'C', 'G', 'D'],
            'Fmajor': ['F', 'Dm', 'Bb', 'C'], 'Fminor': ['Fm', 'Db', 'Ab', 'Eb'],
            'Gmajor': ['G', 'Em', 'C', 'D'], 'Gminor': ['Gm', 'Eb', 'Bb', 'F'],
            'Amajor': ['A', 'F#m', 'D', 'E'], 'Aminor': ['Am', 'F', 'C', 'G'],
            'Bmajor': ['B', 'G#m', 'E', 'F#'], 'Bminor': ['Bm', 'G', 'D', 'A']
        };
        
        const fullKey = key + scale;

        this.context = {
            key, scale, tempo: get('bpm'), timeSignature: get('time-signature'),
            style: get('style') || 'house', mood: get('mood'), duration: get('duration'),
            totalDurationInSeconds: this.calculateTotalDurationInSeconds(),
            rhythmicComplexity: get('rhythmic-complexity'),
            chordProgression: chordProgressions[fullKey] || chordProgressions['Cmajor'],
            trackTypes: trackTypes,
            structure: get('structure')
        };
        
        return this.context;
    }

    getContext() {
        return this.context;
    }
}
