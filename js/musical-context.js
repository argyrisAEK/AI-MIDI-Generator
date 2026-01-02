export class MusicalContext {
    constructor() {
        this.context = {};
    }

    /**
     * FIXED: Better error handling and validation
     */
    calculateTotalDurationInSeconds() {
        try {
            const durationEl = document.getElementById('duration');
            const bpmEl = document.getElementById('bpm');
            const timeSignatureEl = document.getElementById('time-signature');

            if (!durationEl || !bpmEl || !timeSignatureEl) {
                console.warn('Missing required DOM elements for duration calculation');
                return 0;
            }

            const bars = parseInt(durationEl.value, 10);
            const bpm = parseInt(bpmEl.value, 10);
            const timeSignature = timeSignatureEl.value || '4/4';
            const beatsPerBar = parseInt(timeSignature.split('/')[0], 10);

            // Validate all values
            if (isNaN(bars) || isNaN(bpm) || isNaN(beatsPerBar)) {
                console.warn('Invalid duration calculation values:', { bars, bpm, beatsPerBar });
                return 0;
            }

            if (bpm <= 0 || bpm > 300) {
                console.warn(`Invalid BPM value: ${bpm}`);
                return 0;
            }

            if (bars <= 0 || bars > 256) {
                console.warn(`Invalid bars value: ${bars}`);
                return 0;
            }

            if (beatsPerBar <= 0 || beatsPerBar > 12) {
                console.warn(`Invalid beats per bar: ${beatsPerBar}`);
                return 0;
            }

            const beatDuration = 60 / bpm;
            const barDuration = beatDuration * beatsPerBar;
            const totalDuration = barDuration * bars;

            return Math.round(totalDuration * 1000) / 1000; // Round to 3 decimal places

        } catch (e) {
            console.warn('Error calculating duration:', e);
            return 0;
        }
    }

    /**
     * FIXED: Better chord progression selection and context generation
     */
    generateContext(trackTypes) {
        try {
            // Safe DOM element access
            const safeGetValue = (id) => {
                try {
                    const el = document.getElementById(id);
                    return el ? (el.value || '') : '';
                } catch (e) {
                    console.warn(`Error getting value for #${id}:`, e);
                    return '';
                }
            };

            const key = safeGetValue('key') || 'C';
            const scale = safeGetValue('scale-type') || 'major';

            // Comprehensive chord progressions database
            const chordProgressions = {
                'Cmajor': ['I', 'vi', 'IV', 'V'],
                'Cminor': ['i', 'VI', 'III', 'VII'],
                'C#major': ['I', 'vi', 'IV', 'V'],
                'C#minor': ['i', 'VI', 'III', 'VII'],
                'Dbmajor': ['I', 'vi', 'IV', 'V'],
                'Dbminor': ['i', 'VI', 'III', 'VII'],
                'Dmajor': ['I', 'vi', 'IV', 'V'],
                'Dminor': ['i', 'VI', 'III', 'VII'],
                'D#major': ['I', 'vi', 'IV', 'V'],
                'D#minor': ['i', 'VI', 'III', 'VII'],
                'Ebmajor': ['I', 'vi', 'IV', 'V'],
                'Ebminor': ['i', 'VI', 'III', 'VII'],
                'Emajor': ['I', 'vi', 'IV', 'V'],
                'Eminor': ['i', 'VI', 'III', 'VII'],
                'Fmajor': ['I', 'vi', 'IV', 'V'],
                'Fminor': ['i', 'VI', 'III', 'VII'],
                'F#major': ['I', 'vi', 'IV', 'V'],
                'F#minor': ['i', 'VI', 'III', 'VII'],
                'Gbmajor': ['I', 'vi', 'IV', 'V'],
                'Gbminor': ['i', 'VI', 'III', 'VII'],
                'Gmajor': ['I', 'vi', 'IV', 'V'],
                'Gminor': ['i', 'VI', 'III', 'VII'],
                'G#major': ['I', 'vi', 'IV', 'V'],
                'G#minor': ['i', 'VI', 'III', 'VII'],
                'Abmajor': ['I', 'vi', 'IV', 'V'],
                'Abminor': ['i', 'VI', 'III', 'VII'],
                'Amajor': ['I', 'vi', 'IV', 'V'],
                'Aminor': ['i', 'VI', 'III', 'VII'],
                'A#major': ['I', 'vi', 'IV', 'V'],
                'A#minor': ['i', 'VI', 'III', 'VII'],
                'Bbmajor': ['I', 'vi', 'IV', 'V'],
                'Bbminor': ['i', 'VI', 'III', 'VII'],
                'Bmajor': ['I', 'vi', 'IV', 'V'],
                'Bminor': ['i', 'VI', 'III', 'VII']
            };

            const fullKey = key + scale;
            const chordProgression = chordProgressions[fullKey] || ['I', 'V', 'vi', 'IV'];

            // Build context object
            const bpm = parseInt(safeGetValue('bpm')) || 120;
            const duration = parseInt(safeGetValue('duration')) || 4;
            const timeSignature = safeGetValue('time-signature') || '4/4';

            this.context = {
                key: key,
                scale: scale,
                tempo: Math.max(40, Math.min(300, bpm)),
                timeSignature: timeSignature,
                style: safeGetValue('style') || 'house',
                mood: safeGetValue('mood') || 'neutral',
                duration: Math.max(1, Math.min(64, duration)),
                totalDurationInSeconds: this.calculateTotalDurationInSeconds(),
                rhythmicComplexity: safeGetValue('rhythmic-complexity') || 'medium',
                chordProgression: chordProgression,
                trackTypes: Array.isArray(trackTypes) ? trackTypes : [],
                structure: safeGetValue('structure') || ''
            };

            return this.context;

        } catch (e) {
            console.error('Error generating musical context:', e);
            // Return safe default context
            return {
                key: 'C',
                scale: 'major',
                tempo: 120,
                timeSignature: '4/4',
                style: 'house',
                mood: 'neutral',
                duration: 4,
                totalDurationInSeconds: 8,
                rhythmicComplexity: 'medium',
                chordProgression: ['I', 'V', 'vi', 'IV'],
                trackTypes: [],
                structure: ''
            };
        }
    }

    /**
     * Get the current context
     */
    getContext() {
        return this.context || {};
    }
}
