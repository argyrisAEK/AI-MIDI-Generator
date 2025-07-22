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
        const get = (id) => document.getElementById(id).value;
        const key = get('key');

        const chordProgressions = {
            'C': ['C', 'Am', 'F', 'G'], 'Cm': ['Cm', 'Ab', 'Eb', 'Bb'],
            'D': ['D', 'Bm', 'G', 'A'], 'Dm': ['Dm', 'Bb', 'F', 'C'],
            'E': ['E', 'C#m', 'A', 'B'], 'Em': ['Em', 'C', 'G', 'D'],
            'F': ['F', 'Dm', 'Bb', 'C'], 'Fm': ['Fm', 'Db', 'Ab', 'Eb'],
            'G': ['G', 'Em', 'C', 'D'], 'Gm': ['Gm', 'Eb', 'Bb', 'F'],
            'A': ['A', 'F#m', 'D', 'E'], 'Am': ['Am', 'F', 'C', 'G'],
            'B': ['B', 'G#m', 'E', 'F#'], 'Bm': ['Bm', 'G', 'D', 'A']
        };

        this.context = {
            key, scale: get('scale-type'), tempo: get('bpm'), timeSignature: get('time-signature'),
            style: get('style') || 'house', mood: get('mood'), duration: get('duration'),
            totalDurationInSeconds: this.calculateTotalDurationInSeconds(),
            rhythmicComplexity: get('rhythmic-complexity'),
            chordProgression: chordProgressions[key] || ['C', 'Am', 'F', 'G'],
            trackTypes: trackTypes
        };
        
        return this.context;
    }

    getContext() {
        return this.context;
    }
}