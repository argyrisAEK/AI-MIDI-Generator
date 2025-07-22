export const TRACK_INSTRUMENTS = {
    bassline: {
        type: 'bass',
        settings: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.8, release: 1 },
            filter: { Q: 2, type: 'lowpass', rolloff: -24 }
        }
    },
    melody: {
        type: 'synth',
        settings: {
            oscillator: {
                type: 'fatsawtooth',
                count: 3,
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
        settings: {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1.5 }
        }
    },
    arpeggio: {
        type: 'synth',
        settings: {
            oscillator: { type: 'fatsawtooth' },
            envelope: { attack: 0.001, decay: 0.1, sustain: 0.15, release: 0.2 }
        }
    },
    strings: {
        type: 'synth',
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.5, decay: 1, sustain: 0.8, release: 2 }
        }
    },
    lead: {
        type: 'lead',
        settings: {
            oscillator: { type: 'pulse', width: 0.3 },
            envelope: { attack: 0.005, decay: 0.4, sustain: 0.6, release: 0.7 },
            filter: { type: 'lowpass', frequency: 1200, Q: 1.5 }
        }
    },
    plucks: {
        type: 'synth',
        settings: {
            oscillator: { type: 'fmsquare' },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0.1, release: 0.2 }
        }
    },
    drums: {
        type: 'drums',
        settings: {}
    },
    keys: {
        type: 'synth',
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.01, decay: 0.4, sustain: 0.6, release: 1.2 }
        }
    },
    brass: {
        type: 'synth',
        settings: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.8 }
        }
    },
    percussion: {
        type: 'percussion',
        settings: {}
    },
    guitar: {
        type: 'synth',
        settings: {
            oscillator: { type: 'fmsquare' },
            envelope: { attack: 0.005, decay: 0.5, sustain: 0.1, release: 1 }
        }
    },
    'pad-textures': {
        type: 'synth',
        settings: {
            oscillator: { type: 'fatsine', count: 4, spread: 60 },
            envelope: { attack: 2, decay: 1, sustain: 0.8, release: 4 },
            filter: { type: 'lowpass', frequency: 2000, Q: 0.5 }
        }
    },
    'fx-riser': {
        type: 'riser',
        settings: {}
    }
};

export const GENRE_PROFILES = {
    standard_electronic: {
        bassline: { filter: { frequency: 800 } },
        lead: { oscillator: { width: 0.4 } },
        plucks: { 
            envelope: { decay: 0.08 },
            delay: { delayTime: '16n', feedback: 0.2, wet: 0.25 }
        },
        'fx-riser': {}
    },
    trance_anthem: {
        bassline: { filter: { frequency: 600 } },
        lead: { 
            envelope: { attack: 0.3, release: 1.5 },
            delay: { delayTime: '8n.', feedback: 0.4, wet: 0.35 },
            eq: { low: -2, mid: 4, high: 2 }
        },
        chord: { envelope: { attack: 0.8, release: 2.5 } },
        arpeggio: {
            delay: { delayTime: '16n', feedback: 0.3, wet: 0.3 }
        },
        'pad-textures': {
            envelope: { attack: 3, release: 5 }
        }
    },
    retro_synth: {
        bassline: { oscillator: { width: 0.6 }, filter: { frequency: 1200 } },
        lead: { 
            oscillator: { width: 0.4 },
            delay: { delayTime: '8n', feedback: 0.3, wet: 0.2 }
        },
        chord: { envelope: { attack: 0.4, release: 2.0 } }
    },
    hiphop_chill: {
        bassline: { envelope: { attack: 0.02, sustain: 0.9, release: 0.8 } },
        keys: { 
            envelope: { attack: 0.1, decay: 0.8, release: 1.5 },
            delay: { delayTime: '4n', feedback: 0.1, wet: 0.15 },
            eq: { low: 0, mid: -2, high: 3 }
        }
    },
    rock_band: {
        bassline: { envelope: { decay: 0.2, sustain: 0.9, release: 0.4 } },
        lead: { 
            oscillator: { type: 'sawtooth' },
            eq: { low: -4, mid: 2, high: 1 }
        },
        guitar: {
            delay: { delayTime: '8n', feedback: 0.2, wet: 0.2 }
        }
    },
    jazz_ensemble: {
        bassline: { envelope: { decay: 0.4, release: 0.8 } },
        chord: { envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 1.2 } },
        keys: {
            eq: { high: 2, mid: -1 }
        }
    },
    'dnb_jungle': {
        bassline: { 
            filter: { Q: 5, frequency: 600 }, 
            envelope: { decay: 0.4, release: 0.8 } 
        },
        lead: { 
            envelope: { decay: 0.1, release: 0.3 },
            delay: { delayTime: '16n', feedback: 0.3, wet: 0.25 },
            eq: { low: -3, mid: 3, high: 3 }
        },
        'fx-riser': {}
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
    'drum-and-bass': 'dnb_jungle',
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
    'drums': '#795548',
    'keys': '#e91e63',
    'brass': '#ff5722',
    'percussion': '#607d8b',
    'guitar': '#8B4513',
    'pad-textures': '#673AB7',
    'fx-riser': '#009688'
};