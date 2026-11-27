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

            // Chord progressions per scale type.
            // Major keys: 6 distinct progressions, rotated by key index (circle of fifths order)
            // Minor keys: 6 distinct progressions, rotated by key index
            // This ensures every key gets a musically different progression.
            const majorProgressions = [
                ['I', 'IV', 'V', 'I'],       // authentic cadence feel
                ['I', 'vi', 'IV', 'V'],       // pop/classic
                ['I', 'V', 'vi', 'IV'],       // "axis" progression
                ['I', 'IV', 'vi', 'V'],       // country/folk
                ['I', 'II', 'IV', 'V'],       // gospel / bright
                ['I', 'iii', 'IV', 'V'],      // uptempo / dance
            ];

            const minorProgressions = [
                ['i', 'VI', 'III', 'VII'],    // natural minor classic
                ['i', 'iv', 'VII', 'III'],    // dorian-flavoured
                ['i', 'VI', 'VII', 'i'],      // cinematic loop
                ['i', 'iv', 'v', 'i'],        // pure minor cadence
                ['i', 'III', 'VI', 'VII'],    // epic / metal
                ['i', 'VII', 'VI', 'VII'],    // andalusian descent
            ];

            // Circle-of-fifths key order → deterministic index per key
            const keyOrder = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F',
                              'C#', 'D#', 'G#', 'A#'];
            const keyIndex = keyOrder.indexOf(key);
            const progressionIndex = keyIndex >= 0 ? keyIndex % majorProgressions.length : 0;

            const modalProgressions = {
                dorian: ['i', 'IV', 'i', 'VII'],
                phrygian: ['i', 'II', 'i', 'VII'],
                aeolian: minorProgressions[progressionIndex],
                'harmonic-minor': ['i', 'iv', 'V', 'i'],
                'melodic-minor': ['i', 'IV', 'V', 'i'],
                mixolydian: ['I', 'bVII', 'IV', 'I'],
                lydian: ['I', 'II', 'I', 'V'],
                locrian: ['i°', 'II', 'v', 'i°'],
                'minor-pentatonic': minorProgressions[progressionIndex],
                blues: minorProgressions[progressionIndex]
            };

            const chordProgression = modalProgressions[scale] ||
                (scale === 'minor' ? minorProgressions[progressionIndex] : majorProgressions[progressionIndex]);

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
