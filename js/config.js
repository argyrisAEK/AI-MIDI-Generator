export const TRACK_INSTRUMENTS = {
    bassline: {
        type: 'bass',
        midiProgram: 38,
        baseRegister: { min: 24, max: 48 },
        settings: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.8, release: 1 },
            filter: { Q: 2, type: 'lowpass', rolloff: -24 }
        }
    },
    
    melody: {
        type: 'synth',
        midiProgram: 81,
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 6,
        settings: {
            oscillator: {
                type: 'fatsine',
                count: 3,
                spread: 30
            },
            envelope: {
                attack: 0.08,
                decay: 0.25,
                sustain: 0.5,
                release: 0.8
            },
            filter: {
                Q: 0.8,
                type: 'lowpass',
                frequency: 5000,
                rolloff: -12
            }
        }
    },

    chord: {
        type: 'synth',
        midiProgram: 89,
        baseRegister: { min: 36, max: 72 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1.5 }
        }
    },

    arpeggio: {
        type: 'synth',
        midiProgram: 98,
        baseRegister: { min: 36, max: 84 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.001, decay: 0.1, sustain: 0.15, release: 0.2 }
        }
    },

    strings: {
        type: 'synth',
        midiProgram: 48,
        baseRegister: { min: 36, max: 96 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.5, decay: 1, sustain: 0.8, release: 2 }
        }
    },

    lead: {
        type: 'lead',
        midiProgram: 80,
        baseRegister: { min: 48, max: 84 },
        settings: {
            oscillator: { type: 'pwm', count: 3, detune: 25 },
            envelope: { attack: 0.02, decay: 0.5, sustain: 0.7, release: 1 },
            filter: { type: 'lowpass', frequency: 1600, Q: 2.5, rolloff: -24 }
        }
    },

    plucks: {
        type: 'synth',
        midiProgram: 25,
        baseRegister: { min: 36, max: 72 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'triangle', count: 2, spread: 30 },
            envelope: { attack: 0.008, decay: 0.15, sustain: 0.08, release: 0.25 },
            filter: { type: 'lowpass', frequency: 5000, Q: 2 }
        }
    },

    keys: {
        type: 'synth',
        midiProgram: 4,
        baseRegister: { min: 24, max: 96 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.01, decay: 0.4, sustain: 0.6, release: 1.2 }
        }
    },

    brass: {
        type: 'synth',
        midiProgram: 61,
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.8 }
        }
    },

    guitar: {
        type: 'synth',
        midiProgram: 24,
        baseRegister: { min: 36, max: 84 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fmsquare' },
            envelope: { attack: 0.005, decay: 0.5, sustain: 0.1, release: 1 }
        }
    },

    'pad-textures': {
        type: 'synth',
        midiProgram: 90,
        baseRegister: { min: 36, max: 96 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fatsine', count: 4, spread: 60 },
            envelope: { attack: 2, decay: 1, sustain: 0.6, release: 3 },
            filter: { type: 'lowpass', frequency: 2000, Q: 0.5 }
        }
    }
};


export const GENRE_PROFILES = {
    standard_electronic: {
        bassline: { filter: { frequency: 800 } },
        lead: { 
            filter: { frequency: 3500, Q: 2.5 }
        },
        plucks: { 
            envelope: { decay: 0.12, release: 0.2 },
            filter: { frequency: 5500 }
        },
    },
    trance_anthem: {
        bassline: { filter: { frequency: 600 } },
        lead: { 
            envelope: { attack: 0.03, release: 0.8 },
            filter: { frequency: 4500, Q: 3.5 }
        },
        chord: { envelope: { attack: 0.8, release: 2.5 } },
        arpeggio: {},
        plucks: {
            envelope: { decay: 0.1, release: 0.15 },
            filter: { frequency: 6000 }
        },
        'pad-textures': {
            envelope: { attack: 3, release: 3 }
        }
    },
    retro_synth: {
        bassline: { oscillator: { width: 0.6 }, filter: { frequency: 1200 } },
        lead: { 
            filter: { frequency: 3000, Q: 2 }
        },
        chord: { envelope: { attack: 0.4, release: 2.0 } },
        plucks: {
            envelope: { decay: 0.14 },
            filter: { frequency: 4500 }
        }
    },
    hiphop_chill: {
        bassline: { envelope: { attack: 0.02, sustain: 0.9, release: 0.8 } },
        keys: { 
            envelope: { attack: 0.1, decay: 0.8, release: 1.5 }
        },
        plucks: {
            envelope: { decay: 0.18, release: 0.3 },
            filter: { frequency: 5200 }
        },
        lead: {
            filter: { frequency: 3200, Q: 2 }
        }
    },
    rock_band: {
        bassline: { envelope: { decay: 0.2, sustain: 0.9, release: 0.4 } },
        lead: { 
            oscillator: { type: 'sawtooth' },
            filter: { frequency: 4000, Q: 3 }
        },
        guitar: {},
        plucks: {
            envelope: { decay: 0.12 },
            filter: { frequency: 5800 }
        }
    },
    jazz_ensemble: {
        bassline: { envelope: { decay: 0.4, release: 0.8 } },
        chord: { envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 1.2 } },
        keys: {},
        plucks: {
            envelope: { decay: 0.2, release: 0.35 },
            filter: { frequency: 5500 }
        },
        lead: {
            envelope: { attack: 0.03, decay: 0.25, sustain: 0.4 },
            filter: { frequency: 3800, Q: 2.5 }
        }
    },
    'dnb_jungle': {
        bassline: { 
            filter: { Q: 5, frequency: 600 }, 
            envelope: { decay: 0.4, release: 0.8 } 
        },
        lead: { 
            envelope: { decay: 0.08, release: 0.2 },
            filter: { frequency: 4200, Q: 3.5 }
        },
        plucks: {
            envelope: { decay: 0.08, release: 0.12 },
            filter: { frequency: 6200 }
        }
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
    'drum-and-bass': 'dnb_jungle',
    // Default to standard electronic for others
    'default': 'standard_electronic'
};

export const GENRE_TRACK_RECOMMENDATIONS = {
    'house': ['bassline', 'chord', 'arpeggio', 'lead', 'plucks'],
    'techno': ['bassline', 'arpeggio', 'lead', 'pad-textures'],
    'trance': ['bassline', 'melody', 'chord', 'arpeggio', 'lead'],
    'trap': ['bassline', 'melody', 'lead', 'plucks'],
    'hip-hop': ['bassline', 'keys', 'plucks', 'melody'],
    'rock': ['bassline', 'guitar', 'melody', 'lead', 'strings'],
    'pop': ['bassline', 'melody', 'keys', 'chord'],
    'funk': ['bassline', 'guitar', 'keys', 'plucks'],
    'reggae': ['bassline', 'guitar', 'keys', 'plucks'],
    'jazz': ['bassline', 'keys', 'chord', 'strings'],
    'disco': ['bassline', 'strings', 'chord', 'lead'],
    'classical': ['strings', 'keys', 'chord', 'lead'],
    'ambient': ['pad-textures', 'strings', 'chord', 'plucks'],
    'drum-and-bass': ['bassline', 'lead', 'arpeggio', 'pad-textures'],
    'synthwave': ['bassline', 'arpeggio', 'lead', 'pad-textures', 'chord'],
    'downtempo': ['bassline', 'keys', 'plucks', 'pad-textures'],
    'progressive-rock': ['bassline', 'guitar', 'strings', 'keys', 'lead']
};

export const OSCILLATOR_TYPES = [
    'sine', 'square', 'triangle', 'sawtooth', 
    'fatsine', 'fatsquare', 'fatsawtooth', 'pwm'
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
