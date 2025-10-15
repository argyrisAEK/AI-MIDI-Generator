export const TRACK_INSTRUMENTS = {
    bassline: {
        type: 'bass',
        midiProgram: 38, // Synth Bass 1
        settings: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.8, release: 1 },
            filter: { Q: 2, type: 'lowpass', rolloff: -24 }
        }
    },
    melody: {
        type: 'synth',
        midiProgram: 81, // Lead 2 (sawtooth)
        maxPolyphony: 6,
        settings: {
            oscillator: {
                type: 'fatsawtooth',
                count: 2, // Reduced from 3 for performance
                detune: 30
            },
            envelope: {
                attack: 0.05,
                decay: 0.2,
                sustain: 0.4,
                release: 1
            },
            filter: {
                Q: 1,
                type: 'lowpass',
                frequency: 4000,
                rolloff: -12
            }
        }
    },
    chord: {
        type: 'synth',
        midiProgram: 89, // Pad 2 (warm)
        maxPolyphony: 6, // Increased from implicit 6 to allow richer chords
        settings: {
            oscillator: { type: 'fatsine' }, // Changed from sine for a warmer pad sound
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1.5 }
        }
    },
    arpeggio: {
        type: 'synth',
        midiProgram: 98, 
        maxPolyphony: 6, 
        settings: {
            oscillator: { type: 'sawtooth' }, 
            envelope: { attack: 0.001, decay: 0.1, sustain: 0.15, release: 0.2 }
        }
    },
    strings: {
        type: 'synth',
        midiProgram: 48, // String Ensemble 1
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.5, decay: 1, sustain: 0.8, release: 2 }
        }
    },
    lead: {
        type: 'lead',
        midiProgram: 80, // Lead 1 (square)
        settings: {
            oscillator: { type: 'pulse', width: 0.3 },
            envelope: { attack: 0.005, decay: 0.4, sustain: 0.6, release: 0.7 },
            filter: { type: 'lowpass', frequency: 1200, Q: 1.5 }
        }
    },
    plucks: {
        type: 'synth',
        midiProgram: 7, 
        maxPolyphony: 6, 
        settings: {
            oscillator: { type: 'fmsquare' },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0.1, release: 0.2 }
        }
    },
 
    keys: {
        type: 'synth',
        midiProgram: 4, 
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.01, decay: 0.4, sustain: 0.6, release: 1.2 }
        }
    },
    brass: {
        type: 'synth',
        midiProgram: 61, 
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.8 }
        }
    },
  
    guitar: {
        type: 'synth',
        midiProgram: 24, // Acoustic Guitar (nylon)
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fmsquare' },
            envelope: { attack: 0.005, decay: 0.5, sustain: 0.1, release: 1 }
        }
    },
    'pad-textures': {
        type: 'synth',
        midiProgram: 90, // Pad 3 (polysynth)
        maxPolyphony: 4, // Pads are sustained, keep polyphony lower
        settings: {
            oscillator: { type: 'fatsine', count: 4, spread: 60 },
            envelope: { attack: 2, decay: 1, sustain: 0.6, release: 3 },
            filter: { type: 'lowpass', frequency: 2000, Q: 0.5 }
        }
    },
    
};

export const GENRE_PROFILES = {
    standard_electronic: {
        bassline: { filter: { frequency: 800 } },
        lead: { 
            oscillator: { width: 0.4 }
        },
        plucks: { 
            envelope: { decay: 0.08 }
        },
    },
    trance_anthem: {
        bassline: { filter: { frequency: 600 } },
        lead: { 
            envelope: { attack: 0.3, release: 1.5 }
        },
        chord: { envelope: { attack: 0.8, release: 2.5 } },
        arpeggio: {},
        'pad-textures': {
            envelope: { attack: 3, release: 3 }
        }
    },
    retro_synth: {
        bassline: { oscillator: { width: 0.6 }, filter: { frequency: 1200 } },
        lead: { 
            oscillator: { width: 0.4 }
        },
        chord: { envelope: { attack: 0.4, release: 2.0 } }
    },
    hiphop_chill: {
        bassline: { envelope: { attack: 0.02, sustain: 0.9, release: 0.8 } },
        keys: { 
            envelope: { attack: 0.1, decay: 0.8, release: 1.5 }
        }
    },
    rock_band: {
        bassline: { envelope: { decay: 0.2, sustain: 0.9, release: 0.4 } },
        lead: { 
            oscillator: { type: 'sawtooth' }
        },
        guitar: {}
    },
    jazz_ensemble: {
        bassline: { envelope: { decay: 0.4, release: 0.8 } },
        chord: { envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 1.2 } },
        keys: {}
    },
    'dnb_jungle': {
        bassline: { 
            filter: { Q: 5, frequency: 600 }, 
            envelope: { decay: 0.4, release: 0.8 } 
        },
        lead: { 
            envelope: { decay: 0.1, release: 0.3 }
        },
    }
};

export const GENRE_TO_PROFILE_MAP = {
    'house': 'standard_electronic',
    'disco': 'standard_electronic',
    'techno': 'standard_electronic',
    'trance': 'trance_anthem',
    'synthwave': 'retro_synth',
    'hip-hop': 'hiphop_chill',
    'downtempo': 'hiphop_chill',
    'trap': 'hiphop_chill',
    'rock': 'rock_band',
    'progressive-rock': 'rock_band',
    'pop': 'rock_band',
    'jazz': 'jazz_ensemble',
  
    'funk': 'jazz_ensemble',
    // Default to standard electronic for others
    'default': 'standard_electronic'
};

export const OSCILLATOR_TYPES = [
    'sine', 'square', 'triangle', 'sawtooth', 
    'fatsine', 'fatsquare', 'fatsawtooth', 
    'pulse', 'pwm', 
    'fmsine', 'fmsquare', 'fmtriangle', 'fmsawtooth',
    'amsine', 'amsquare', 'amtriangle', 'amsawtooth'
];

export const TRACK_COLORS = {
    'bassline': '#ff6b6b',
    'melody': '#4caf50',
    'chord': '#2196f3',
    'arpeggio': '#9c27b0',
    'strings': '#ff9800',
    'lead': '#ffeb3b',
    'plucks': '#00bcd4',
   
    'keys': '#e91e63',
    'brass': '#ff5722',
    
    'guitar': '#8B4513',
    'pad-textures': '#673AB7',
    
};
