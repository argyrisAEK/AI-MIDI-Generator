export const TRACK_INSTRUMENTS = {
    bassline: {
        type: 'bass',
        mixVolume: 0.8,
        midiProgram: 38,
        baseRegister: { min: 36, max: 52 },
        maxPolyphony: 1, // 🔥 FIX: Προσθήκη explicit maxPolyphony για MonoSynth-like behavior
        settings: {
            oscillator: { type: 'fmsquare', modulationType: 'triangle', modulationIndex: 2 },
            envelope: { attack: 0.02, decay: 0.2, sustain: 0.8, release: 0.5 },
            filter: { Q: 2, type: 'lowpass', rolloff: -24, frequency: 800 }
        }
    },

    melody: {
        type: 'synth',
        mixVolume: 0.75,
        midiProgram: 81,
        baseRegister: { min: 60, max: 84 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 1.2 },
            filter: { Q: 1, type: 'lowpass', frequency: 6000, rolloff: -12 }
        }
    },

    chord: {
        type: 'synth',
        mixVolume: 0.6,
        midiProgram: 89,
        baseRegister: { min: 48, max: 72 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fatsine', count: 4, spread: 40 },
            envelope: { attack: 0.2, decay: 0.5, sustain: 0.6, release: 2 },
            filter: { type: 'lowpass', frequency: 3500, Q: 0.5 }
        }
    },

    arpeggio: {
        type: 'synth',
        mixVolume: 0.65,
        midiProgram: 39,
        baseRegister: { min: 55, max: 79 },
        maxPolyphony: 4, 
        settings: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.015, decay: 0.15, sustain: 0.1, release: 0.3 },
            filter: { type: 'lowpass', frequency: 4000, Q: 3 }
        }
    },

    strings: {
        type: 'synth',
        mixVolume: 0.55, 
        midiProgram: 49,
        baseRegister: { min: 48, max: 79 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 30 }, 
            envelope: { attack: 0.6, decay: 2, sustain: 0.8, release: 2.5 },
            filter: { type: 'lowpass', frequency: 5000 }
        }
    },

    lead: {
        type: 'lead',
        mixVolume: 0.75, 
        midiProgram: 80,
        baseRegister: { min: 62, max: 88 },
        maxPolyphony: 1, // 🔥 FIX: Mono for solos
        settings: {
            oscillator: { type: 'pwm', modulationFrequency: 0.4 },
            envelope: { attack: 0.02, decay: 0.4, sustain: 0.5, release: 0.8 },
            filter: { type: 'lowpass', frequency: 2500, Q: 4, rolloff: -24 }
        }
    },

    plucks: {
        type: 'synth',
        mixVolume: 0.65,
        midiProgram: 46,
        baseRegister: { min: 60, max: 84 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.015, decay: 0.3, sustain: 0.05, release: 0.4 },
            filter: { type: 'lowpass', frequency: 3000, Q: 2 }
        }
    },

    keys: {
        type: 'synth',
        mixVolume: 0.7,
        midiProgram: 5,
        baseRegister: { min: 48, max: 76 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fmsine', modulationIndex: 3 },
            envelope: { attack: 0.015, decay: 0.5, sustain: 0.3, release: 1 },
        }
    },

    brass: {
        type: 'synth',
        mixVolume: 0.7,
        midiProgram: 62,
        baseRegister: { min: 42, max: 75 },
        maxPolyphony: 5,
        settings: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 },
            filter: { type: 'lowpass', frequency: 3000, Q: 2 }
        }
    },

    guitar: {
        type: 'synth',
        mixVolume: 0.65,
        midiProgram: 30,
        baseRegister: { min: 40, max: 76 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fmsquare', modulationIndex: 5 },
            envelope: { attack: 0.015, decay: 0.6, sustain: 0.1, release: 1.2 },
            filter: { type: 'bandpass', frequency: 1200, Q: 1 }
        }
    },
    
    percs: {
        type: 'synth',
        mixVolume: 0.7, 
        midiProgram: 115,
        baseRegister: { min: 60, max: 72 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'square', modulationType: 'square', modulationIndex: 5 },
            envelope: { attack: 0.010, decay: 0.12, sustain: 0, release: 0.20 },
            filter: { type: 'bandpass', frequency: 1000, Q: 1 }
        }
    },
    
    'pad-textures': {
        type: 'synth',
        mixVolume: 0.5,
        midiProgram: 92,
        baseRegister: { min: 42, max: 75 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatcustom', partials: [0.5, 1, 0.5], spread: 50 },
            envelope: { attack: 1.5, decay: 3, sustain: 0.7, release: 4 },
            filter: { type: 'lowpass', frequency: 1200, Q: 0.5 }
        }
    }
};

export const GENRE_PROFILES = {
    // ── Electronic / Dance ──────────────────────────────────────────
    standard_electronic: {
        bassline: {
            oscillator: { type: 'fmsquare', modulationType: 'triangle', modulationIndex: 2 },
            envelope: { attack: 0.012, decay: 0.3, sustain: 0.4, release: 0.25 },
            filter: { frequency: 1200, Q: 3 }
        },
        melody: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
            filter: { frequency: 5000 }
        },
        chord: {
            oscillator: { type: 'fatsine', count: 3, spread: 30 },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.4, release: 0.4 },
            filter: { frequency: 2500 }
        },
        'pad-textures': {
            envelope: { attack: 1.2, decay: 2, sustain: 0.6, release: 3 }
        }
    },

    // ── Techno ──────────────────────────────────────────────────────
    techno: {
        bassline: {
            oscillator: { type: 'fmsquare', modulationType: 'square', modulationIndex: 3 },
            envelope: { attack: 0.008, decay: 0.15, sustain: 0.3, release: 0.1 },
            filter: { frequency: 600, Q: 4 }
        },
        arpeggio: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.008, decay: 0.1, sustain: 0.05, release: 0.1 },
            filter: { frequency: 3000, Q: 5 }
        },
        'pad-textures': {
            oscillator: { type: 'fatcustom', partials: [1, 0.3, 0.1], spread: 60 },
            envelope: { attack: 2, decay: 4, sustain: 0.5, release: 5 },
            filter: { frequency: 800, Q: 0.3 }
        },
        percs: {
            oscillator: { type: 'fmsquare', modulationIndex: 8 },
            envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.1 }
        }
    },

    // ── Trance ──────────────────────────────────────────────────────
    trance_anthem: {
        bassline: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 10 },
            envelope: { attack: 0.05, decay: 0.15, sustain: 0.3, release: 0.1 },
            filter: { frequency: 600 }
        },
        lead: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 40 },
            envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 1.5 },
            filter: { frequency: 8000, Q: 1 }
        },
        arpeggio: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.01, decay: 0.1, sustain: 0.0, release: 0.2 },
            filter: { frequency: 6000 }
        },
        'pad-textures': {
            oscillator: { type: 'fatsawtooth', count: 4, spread: 60 },
            envelope: { attack: 2, decay: 3, sustain: 0.8, release: 5 },
            filter: { frequency: 2000 }
        },
        chord: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
            envelope: { attack: 0.3, decay: 1, sustain: 0.7, release: 2 }
        }
    },

    // ── Synthwave / Retro ────────────────────────────────────────────
    retro_synth: {
        bassline: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.3 },
            filter: { frequency: 1500, Q: 1 }
        },
        lead: {
            oscillator: { type: 'pwm', modulationFrequency: 0.3 },
            envelope: { attack: 0.05, decay: 0.3, sustain: 0.5, release: 1 },
            filter: { frequency: 4000, Q: 2 }
        },
        chord: {
            oscillator: { type: 'pwm', modulationFrequency: 0.5 },
            envelope: { attack: 0.1, decay: 0.5, sustain: 0.5, release: 1.5 }
        },
        arpeggio: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.2 },
            filter: { frequency: 4000 }
        },
        'pad-textures': {
            oscillator: { type: 'fatsawtooth', count: 5, spread: 80 },
            envelope: { attack: 1.5, decay: 2, sustain: 0.8, release: 4 },
            filter: { frequency: 1800 }
        },
        plucks: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.0, release: 0.2 },
            filter: { frequency: 2000 }
        }
    },

    // ── Hip-Hop / Trap / Chill ───────────────────────────────────────
    hiphop_chill: {
        bassline: {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.05, decay: 0.4, sustain: 0.7, release: 0.5 },
            filter: { frequency: 300 }
        },
        keys: {
            oscillator: { type: 'fmsine', modulationIndex: 2, detune: 10 },
            envelope: { attack: 0.02, decay: 0.6, sustain: 0.2, release: 1.5 },
            filter: { frequency: 2000 }
        },
        melody: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.08, decay: 0.3, sustain: 0.4, release: 1 }
        },
        'pad-textures': {
            oscillator: { type: 'fatsine', count: 3, spread: 30, detune: -15 },
            envelope: { attack: 1, decay: 2, sustain: 0.6, release: 3 },
            filter: { frequency: 800 }
        },
        plucks: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.01, decay: 0.4, sustain: 0.0, release: 0.5 }
        }
    },

    // ── Rock / Pop ───────────────────────────────────────────────────
    rock_band: {
        bassline: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.015, decay: 0.2, sustain: 0.7, release: 0.3 },
            filter: { frequency: 1800, Q: 0.5 }
        },
        lead: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 15 },
            envelope: { attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.8 },
            filter: { frequency: 5000, Q: 3 }
        },
        guitar: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 10 },
            envelope: { attack: 0.015, decay: 0.5, sustain: 0.8, release: 1 },
            filter: { type: 'bandpass', frequency: 1500, Q: 1.5 }
        },
        chord: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 15 },
            envelope: { attack: 0.03, decay: 0.3, sustain: 0.6, release: 0.8 }
        }
    },

    // ── Jazz / Cinematic / Funk ──────────────────────────────────────
    jazz_ensemble: {
        bassline: {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.08, decay: 0.5, sustain: 0.3, release: 1 }
        },
        keys: {
            oscillator: { type: 'fmsine', modulationIndex: 4 },
            envelope: { attack: 0.015, decay: 0.4, sustain: 0.3, release: 1.2 }
        },
        brass: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.15, decay: 0.3, sustain: 0.7, release: 0.8 },
            filter: { frequency: 3500, Q: 1.5 }
        },
        strings: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 25 },
            envelope: { attack: 0.8, decay: 2, sustain: 0.8, release: 2.5 }
        },
        chord: {
            oscillator: { type: 'fmsine', modulationIndex: 2 },
            envelope: { attack: 0.1, decay: 0.5, sustain: 0.5, release: 2 }
        }
    },

    // ── Cinematic / Orchestral ───────────────────────────────────────
    cinematic: {
        strings: {
            oscillator: { type: 'fatsawtooth', count: 4, spread: 40 },
            envelope: { attack: 1.2, decay: 3, sustain: 0.9, release: 4 },
            filter: { type: 'lowpass', frequency: 6000 }
        },
        brass: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.3, decay: 0.5, sustain: 0.8, release: 1.5 },
            filter: { frequency: 4000, Q: 1 }
        },
        'pad-textures': {
            oscillator: { type: 'fatcustom', partials: [1, 0.5, 0.25, 0.1], spread: 70 },
            envelope: { attack: 3, decay: 5, sustain: 0.8, release: 6 },
            filter: { frequency: 1000 }
        },
        bassline: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 10 },
            envelope: { attack: 0.3, decay: 1, sustain: 0.6, release: 2 }
        }
    },

    // ── Drum & Bass / Jungle ─────────────────────────────────────────
    dnb_jungle: {
        bassline: {
            oscillator: { type: 'fatsawtooth', count: 2, detune: 10 },
            envelope: { attack: 0.008, decay: 0.2, sustain: 0.5, release: 0.2 },
            filter: { frequency: 400, Q: 2 }
        },
        lead: {
            oscillator: { type: 'fmsquare', modulationIndex: 4 },
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.5 },
            filter: { frequency: 5000, Q: 3 }
        },
        'pad-textures': {
            oscillator: { type: 'fatcustom', partials: [0.8, 0.4, 0.2], spread: 40 },
            envelope: { attack: 1, decay: 2, sustain: 0.5, release: 3 }
        }
    }
};

export const GENRE_TO_PROFILE_MAP = {
    'house':            'standard_electronic',
    'disco':            'standard_electronic',
    'techno':           'techno',
    'trance':           'trance_anthem',
    'synthwave':        'retro_synth',
    'hip-hop':          'hiphop_chill',
    'downtempo':        'hiphop_chill',
    'trap':             'hiphop_chill',
    'rock':             'rock_band',
    'progressive-rock': 'rock_band',
    'pop':              'rock_band',
    'jazz':             'jazz_ensemble',
    'funk':             'jazz_ensemble',
    'cinematic':        'cinematic',
    'drum-and-bass':    'dnb_jungle',
    'default':          'standard_electronic'
};

export const GENRE_TRACK_RECOMMENDATIONS = {
    'house': ['bassline', 'chord', 'melody', 'percs'],
    'techno': ['bassline', 'arpeggio', 'percs', 'pad-textures'],
    'trance': ['bassline', 'melody', 'chord', 'percs', 'arpeggio'],
    'trap': ['bassline', 'lead', 'plucks', 'percs'],
    'hip-hop': ['bassline', 'keys', 'percs', 'melody', 'chord'],
    'rock': ['bassline', 'guitar', 'melody', 'percs'],
    'pop': ['bassline', 'melody', 'keys', 'percs'],
    'funk': ['bassline', 'guitar', 'brass', 'percs'],
    'jazz': ['bassline', 'keys', 'brass', 'percs'],
    'cinematic': ['strings', 'brass', 'percs', 'pad-textures', 'bassline'],
    'synthwave': ['bassline', 'arpeggio', 'lead', 'percs'],
    'downtempo': ['bassline', 'keys', 'pad-textures', 'percs'],
    'drum-and-bass': ['bassline', 'lead', 'percs', 'pad-textures']
};

export const OSCILLATOR_TYPES = [
    'sine', 'square', 'triangle', 'sawtooth', 
    'fatsine', 'fatsquare', 'fatsawtooth', 'pwm', 'fmsine', 'fmsquare'
];

export const TRACK_COLORS = {
      bassline: '#FF1744', brass: '#FF9100', arpeggio: '#FFD600',
        plucks: '#00E676', keys: '#00B8D4', melody: '#2979FF',
        strings: '#AA00FF', 'pad-textures': '#F50057', lead: '#FFFFFF',
        chord: '#78909C', guitar: '#FFAB91', percs: '#69FF47'
};
