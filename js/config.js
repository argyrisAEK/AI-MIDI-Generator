export const TRACK_INSTRUMENTS = {
    bassline: {
        type: 'bass',
        mixVolume: 0.20, // Δυνατό μπάσο
        midiProgram: 38, // Synth Bass 2
        baseRegister: { min: 24, max: 48 },
        settings: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.8, release: 1 },
            filter: { Q: 2, type: 'lowpass', rolloff: -24 }
        }
    },

    melody: {
        type: 'synth',
        mixVolume: 0.20, // Η μελωδία μπροστά
        midiProgram: 81, // Saw Lead
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine', count: 3, spread: 30 },
            envelope: { attack: 0.08, decay: 0.25, sustain: 0.5, release: 0.8 },
            filter: { Q: 0.8, type: 'lowpass', frequency: 5000, rolloff: -12 }
        }
    },

    chord: {
        type: 'synth',
        mixVolume: 0.40, // Τα ακόρντα πιο πίσω
        midiProgram: 89, // Pad 1 (New Age)
        baseRegister: { min: 36, max: 72 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1.5 }
        }
    },

    arpeggio: {
        type: 'synth',
        mixVolume: 0.50,
        midiProgram: 81, // Saw Lead
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 1, // Arps = monophonic
        settings: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.001, decay: 0.1, sustain: 0.15, release: 0.2 }
        }
    },

    strings: {
        type: 'synth',
        mixVolume: 0.70, // Background atmosphere
        midiProgram: 48, // String Ensemble
        baseRegister: { min: 36, max: 96 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.5, decay: 1, sustain: 0.8, release: 2 }
        }
    },

    lead: {
        type: 'lead',
        mixVolume: 0.25, // Lead σόλο δυνατά
        midiProgram: 80, // Square Lead
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 1, // Lead = mono
        settings: {
            oscillator: { type: 'pwm', count: 3, detune: 25 },
            envelope: { attack: 0.02, decay: 0.5, sustain: 0.7, release: 1 },
            filter: { type: 'lowpass', frequency: 1600, Q: 2.5, rolloff: -24 }
        }
    },

    plucks: {
        type: 'synth',
        mixVolume: 0.40,
        midiProgram: 87, // Synth Lead 7
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'triangle', count: 2, spread: 30 },
            envelope: { attack: 0.008, decay: 0.15, sustain: 0.08, release: 0.25 },
            filter: { type: 'lowpass', frequency: 5000, Q: 2 }
        }
    },

    keys: {
        type: 'synth',
        mixVolume: 0.45,
        midiProgram: 4, // Electric Piano 1
        baseRegister: { min: 36, max: 96 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: { attack: 0.01, decay: 0.4, sustain: 0.6, release: 1.2 }
        }
    },

    brass: {
        type: 'synth',
        mixVolume: 0.30,
        midiProgram: 61, // Brass Section
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.8 }
        }
    },

    guitar: {
        type: 'synth',
        mixVolume: 0.30,
        midiProgram: 30, // Distortion Guitar
        baseRegister: { min: 36, max: 84 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fmsquare' },
            envelope: { attack: 0.005, decay: 0.5, sustain: 0.1, release: 1 }
        }
    },

    'pad-textures': {
        type: 'synth',
        mixVolume: 0.80, // Πολύ διακριτικά pads
        midiProgram: 90, // Warm Pad
        baseRegister: { min: 36, max: 96 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsine', count: 4, spread: 60 },
            envelope: { attack: 2, decay: 1, sustain: 0.6, release: 3 },
            filter: { type: 'lowpass', frequency: 2000, Q: 0.5 }
        }
    }
};

export const GENRE_PROFILES = {
    standard_electronic: {
        bassline: { 
            filter: { frequency: 900, Q: 1.2 },
            envelope: { decay: 0.25, release: 0.9 }
        },
        lead: { 
            filter: { frequency: 3800, Q: 2.2 },
            envelope: { attack: 0.02, release: 0.7 }
        },
        plucks: { 
            envelope: { decay: 0.12, release: 0.18 },
            filter: { frequency: 6000 }
        },
        chord: {
            envelope: { attack: 0.2, release: 1.3 }
        }
    },

    trance_anthem: {
        bassline: { 
            filter: { frequency: 700, Q: 1.6 },
            envelope: { decay: 0.3, release: 0.6 }
        },
        lead: { 
            envelope: { attack: 0.025, decay: 0.3, release: 1.0 },
            filter: { frequency: 4800, Q: 3.2 }
        },
        chord: { 
            envelope: { attack: 0.9, decay: 0.4, release: 2.8 }
        },
        arpeggio: {
            filter: { frequency: 6800 },
            envelope: { decay: 0.12 }
        },
        plucks: {
            envelope: { decay: 0.1, release: 0.14 },
            filter: { frequency: 7500 }
        },
        'pad-textures': {
            envelope: { attack: 3.5, release: 3.5 }
        }
    },

    retro_synth: {
        bassline: { 
            oscillator: { width: 0.6 },
            filter: { frequency: 1300, Q: 0.9 }
        },
        lead: { 
            filter: { frequency: 3100, Q: 1.8 },
            envelope: { decay: 0.4, release: 0.9 }
        },
        chord: { 
            envelope: { attack: 0.45, release: 2.2 }
        },
        plucks: {
            envelope: { decay: 0.14, release: 0.22 },
            filter: { frequency: 4200 }
        },
        keys: {
            envelope: { attack: 0.03, release: 1.1 }
        }
    },

    hiphop_chill: {
        bassline: { 
            envelope: { attack: 0.03, sustain: 0.95, release: 0.9 },
            filter: { frequency: 500 }
        },
        keys: { 
            envelope: { attack: 0.15, decay: 0.9, release: 1.7 },
            filter: { frequency: 3800 }
        },
        plucks: {
            envelope: { decay: 0.2, release: 0.35 },
            filter: { frequency: 4800 }
        },
        lead: {
            filter: { frequency: 3000, Q: 1.7 },
            envelope: { attack: 0.04 }
        },
        'pad-textures': {
            envelope: { attack: 1.5, release: 2.5 }
        }
    },

    rock_band: {
        bassline: { 
            envelope: { decay: 0.25, sustain: 0.9, release: 0.45 },
            filter: { frequency: 900 }
        },
        lead: { 
            oscillator: { type: 'sawtooth' },
            filter: { frequency: 4200, Q: 2.4 },
            envelope: { decay: 0.4, release: 1.0 }
        },
        guitar: {
            envelope: { attack: 0.01, decay: 0.4, release: 1.0 },
            filter: { frequency: 3500 }
        },
        plucks: {
            envelope: { decay: 0.12, release: 0.22 },
            filter: { frequency: 5000 }
        },
        chord: {
            envelope: { attack: 0.25, release: 1.7 }
        }
    },

    jazz_ensemble: {
        bassline: { 
            envelope: { decay: 0.45, release: 0.9 },
            filter: { frequency: 700 }
        },
        chord: { 
            envelope: { attack: 0.06, decay: 0.25, sustain: 0.65, release: 1.3 }
        },
        keys: {
            envelope: { attack: 0.03, decay: 0.4, release: 1.4 }
        },
        plucks: {
            envelope: { decay: 0.22, release: 0.37 },
            filter: { frequency: 5400 }
        },
        lead: {
            envelope: { attack: 0.03, decay: 0.25, sustain: 0.45, release: 0.7 },
            filter: { frequency: 3600, Q: 2.2 }
        }
    },

    dnb_jungle: {
        bassline: { 
            filter: { Q: 5, frequency: 520 }, 
            envelope: { decay: 0.35, release: 0.75 }
        },
        lead: { 
            envelope: { decay: 0.09, release: 0.25 },
            filter: { frequency: 4400, Q: 3.4 }
        },
        plucks: {
            envelope: { decay: 0.08, release: 0.12 },
            filter: { frequency: 6500 }
        },
        arpeggio: {
            filter: { frequency: 7600 },
            envelope: { decay: 0.1 }
        },
        'pad-textures': {
            envelope: { attack: 1.8, release: 2.2 }
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
    'cinematic': 'jazz_ensemble', // Προσωρινή χαρτογράφηση σε jazz για να μην κρασάρει
    'funk': 'jazz_ensemble',
    'drum-and-bass': 'dnb_jungle',
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
    'progressive-rock': ['bassline', 'guitar', 'strings', 'keys', 'lead'],
    'cinematic': ['strings', 'brass', 'pad-textures', 'keys', 'bassline']
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
