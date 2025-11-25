export const TRACK_INSTRUMENTS = {
    bassline: {
        type: 'bass',
        mixVolume: 0.8, // Solid foundation without overpowering
        midiProgram: 38, // Synth Bass 1
        baseRegister: { min: 24, max: 45 },
        settings: {
            oscillator: { type: 'fmsquare', modulationType: 'triangle', modulationIndex: 2 },
            envelope: { attack: 0.02, decay: 0.2, sustain: 0.8, release: 0.5 },
            filter: { Q: 2, type: 'lowpass', rolloff: -24, frequency: 800 }
        }
    },

    melody: {
        type: 'synth',
        mixVolume: 0.75, // Cuts through the mix
        midiProgram: 81, // Lead 2 (sawtooth)
        baseRegister: { min: 60, max: 96 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 1.2 },
            filter: { Q: 1, type: 'lowpass', frequency: 6000, rolloff: -12 }
        }
    },

    chord: {
        type: 'synth',
        mixVolume: 0.6, // Backing harmony, wide stereo
        midiProgram: 89, // Pad 1 (new age)
        baseRegister: { min: 48, max: 72 },
        maxPolyphony: 8,
        settings: {
            oscillator: { type: 'fatsine', count: 4, spread: 40 },
            envelope: { attack: 0.2, decay: 0.5, sustain: 0.6, release: 2 },
            filter: { type: 'lowpass', frequency: 3500, Q: 0.5 }
        }
    },

    arpeggio: {
        type: 'synth',
        mixVolume: 0.65,
        midiProgram: 39, // Synth Bass 2 (often used for plucky arps)
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 2, 
        settings: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.2 },
            filter: { type: 'lowpass', frequency: 4000, Q: 3 }
        }
    },

    strings: {
        type: 'synth',
        mixVolume: 0.55, 
        midiProgram: 49, // String Ensemble 1
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 6,
        settings: {
            // Fatsawtooth sounds more like real strings than sine
            oscillator: { type: 'fatsawtooth', count: 3, spread: 30 }, 
            envelope: { attack: 0.6, decay: 2, sustain: 0.8, release: 2.5 },
            filter: { type: 'lowpass', frequency: 5000 }
        }
    },

    lead: {
        type: 'lead',
        mixVolume: 0.75, 
        midiProgram: 80, // Lead 1 (square)
        baseRegister: { min: 60, max: 96 },
        maxPolyphony: 1, // Mono for solos
        settings: {
            oscillator: { type: 'pwm', modulationFrequency: 0.4 },
            envelope: { attack: 0.02, decay: 0.4, sustain: 0.5, release: 0.8 },
            filter: { type: 'lowpass', frequency: 2500, Q: 4, rolloff: -24 }
        }
    },

    plucks: {
        type: 'synth',
        mixVolume: 0.65,
        midiProgram: 46, // Orchestral Harp (good proxy for plucks)
        baseRegister: { min: 60, max: 96 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.4 },
            filter: { type: 'lowpass', frequency: 3000, Q: 2 }
        }
    },

    keys: {
        type: 'synth',
        mixVolume: 0.7,
        midiProgram: 5, // Electric Piano 1
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fmsine', modulationIndex: 3 },
            envelope: { attack: 0.01, decay: 0.5, sustain: 0.3, release: 1 },
        }
    },

    brass: {
        type: 'synth',
        mixVolume: 0.7,
        midiProgram: 62, // Synth Brass 1
        baseRegister: { min: 36, max: 72 },
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
        midiProgram: 30, // Overdriven Guitar
        baseRegister: { min: 40, max: 76 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fmsquare', modulationIndex: 5 },
            envelope: { attack: 0.01, decay: 0.6, sustain: 0.1, release: 1.2 },
            filter: { type: 'bandpass', frequency: 1200, Q: 1 }
        }
    },
percussion: {
        type: 'synth',
        mixVolume: 0.7, 
        midiProgram: 115, // Woodblock / Synth Drum
        baseRegister: { min: 60, max: 84 }, // Mid-range for clicks/rims
        maxPolyphony: 4,
        settings: {
            // Short, punchy sound (Woodblock/Rimshot style)
            oscillator: { type: 'square', modulationType: 'square', modulationIndex: 5 },
            envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
            filter: { type: 'bandpass', frequency: 1000, Q: 1 }
        }
    },
    'pad-textures': {
        type: 'synth',
        mixVolume: 0.5, // Subtle background
        midiProgram: 92, // Pad 4 (choir)
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 6,
        settings: {
            oscillator: { type: 'fatcustom', partials: [0.5, 1, 0.5], spread: 50 },
            envelope: { attack: 1.5, decay: 3, sustain: 0.7, release: 4 },
            filter: { type: 'lowpass', frequency: 1200, Q: 0.5 }
        }
    }
};

export const GENRE_PROFILES = {
    // 🏠 House / Disco / Techno
    standard_electronic: {
        bassline: { 
            envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.2 },
            filter: { frequency: 1200, Q: 3 } // Punchy filter
        },
        melody: {
            oscillator: { type: 'fatsawtooth' },
            filter: { frequency: 5000 }
        },
        chord: {
            // Stab chords
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.4, release: 0.4 },
            filter: { frequency: 2500 }
        }
    },

    // 🌌 Trance / Progressive
    trance_anthem: {
        bassline: { 
            // Rolling bass
            envelope: { attack: 0.05, decay: 0.15, sustain: 0.3, release: 0.1 },
            filter: { frequency: 600 }
        },
        lead: { 
            // Super-Saw style
            oscillator: { type: 'fatsawtooth', count: 3, spread: 40 },
            filter: { frequency: 8000, Q: 1 },
            envelope: { release: 1.5 }
        },
        arpeggio: {
            envelope: { attack: 0.01, decay: 0.1 },
            filter: { frequency: 6000 }
        },
        'pad-textures': {
            envelope: { attack: 2, release: 5 } // Infinite sustain
        }
    },

    // 📼 Synthwave / Retro
    retro_synth: {
        bassline: { 
            oscillator: { type: 'sawtooth' },
            filter: { frequency: 1500, Q: 1 }
        },
        chord: { 
            oscillator: { type: 'pwm' }, // Analog warmth
            envelope: { attack: 0.1, release: 1.5 }
        },
        plucks: {
            // Short analog blips
            envelope: { decay: 0.15, release: 0.2 },
            filter: { frequency: 2000 }
        }
    },

    // ☕ Lofi / Hip Hop
    hiphop_chill: {
        bassline: { 
            oscillator: { type: 'sine' }, // Deep sub
            filter: { frequency: 300 }
        },
        keys: { 
            // Wobbly electric piano
            oscillator: { type: 'fmsine', detune: 10 },
            filter: { frequency: 2000 }
        },
        melody: {
            oscillator: { type: 'triangle' }, // Flute-like
            envelope: { attack: 0.1 }
        },
        'pad-textures': {
            oscillator: { detune: -15 }, // Tape wobble effect
            filter: { frequency: 800 } // Muffled
        }
    },

    // 🎸 Rock / Pop
    rock_band: {
        bassline: { 
            oscillator: { type: 'square' },
            filter: { frequency: 1800, Q: 0.5 } // Picked bass sound
        },
        lead: { 
            oscillator: { type: 'sawtooth' }, // Distortion-like
            filter: { frequency: 5000, Q: 3 }
        },
        guitar: {
            oscillator: { type: 'fatsawtooth' },
            envelope: { sustain: 0.8 } // Sustained chords
        }
    },

    // 🎷 Jazz / Cinematic
    jazz_ensemble: {
        bassline: { 
            type: 'sine', // Upright bass
            envelope: { attack: 0.1, decay: 0.5, sustain: 0.2, release: 1 }
        },
        keys: {
            oscillator: { type: 'fmsine' }, // Rhodes style
            envelope: { attack: 0.02 }
        },
        brass: {
            envelope: { attack: 0.2, release: 0.8 } // Swell
        },
        strings: {
             envelope: { attack: 0.8, release: 2 } // Slow emotional strings
        }
    },

    // 🥁 DnB
    dnb_jungle: {
        bassline: { 
            // Reese bass territory
            oscillator: { type: 'fatsawtooth', count: 2, detune: 10 },
            filter: { frequency: 400, Q: 2 }
        },
        pad: {
             filter: { frequency: 6000 } // High atmospheric pads
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
    'cinematic': 'jazz_ensemble', 
    'funk': 'jazz_ensemble',
    'drum-and-bass': 'dnb_jungle',
    'default': 'standard_electronic'
};

export const GENRE_TRACK_RECOMMENDATIONS = {
    'house': ['bassline', 'chord', 'melody', 'percussion'],
    'techno': ['bassline', 'arpeggio', 'percussion', 'pad-textures'],
    'trance': ['bassline', 'melody', 'chord', 'percussion'],
    'trap': ['bassline', 'lead', 'plucks', 'percussion'],
    'hip-hop': ['bassline', 'keys', 'percussion', 'melody'],
    'rock': ['bassline', 'guitar', 'melody', 'percussion'],
    'pop': ['bassline', 'melody', 'keys', 'percussion'],
    'funk': ['bassline', 'guitar', 'brass', 'percussion'],
    'jazz': ['bassline', 'keys', 'brass', 'percussion'],
    'cinematic': ['strings', 'brass', 'percussion', 'pad-textures', 'bassline'],
    'synthwave': ['bassline', 'arpeggio', 'lead', 'percussion'],
    'downtempo': ['bassline', 'keys', 'pad-textures', 'percussion'],
    'drum-and-bass': ['bassline', 'lead', 'percussion', 'pad-textures']
};
export const OSCILLATOR_TYPES = [
    'sine', 'square', 'triangle', 'sawtooth', 
    'fatsine', 'fatsquare', 'fatsawtooth', 'pwm', 'fmsine', 'fmsquare'
];

// 🎨 UPDATED COLOR PALETTE: Vibrant, Neon, High Contrast
export const TRACK_COLORS = {
    'bassline': '#FF2E63',      // Neon Red/Pink (Στερεά Βάση)
    'melody': '#08D9D6',        // Cyan/Teal (Πιο φωτεινή γραμμή)
    'chord': '#FF7F50',         // Coral/Salmon (Ζεστές Αρμονίες)
    'keys': '#F9F871',          // Bright Yellow/Lime (Πληκτροφόρα)
    'lead': '#9A40FF',          // Bright Purple (Έντονα σόλο)
    'arpeggio': '#4DEE93',      // Neon Green (Ροή)
    'plucks': '#FFB000',        // Bright Orange (Κρουστό)
    'guitar': '#A343A3',        // Magenta
    'brass': '#F4D03F',         // Gold/Μπρούτζινο
    'strings': '#5DADE2',       // Sky Blue
    'pad-textures': '#34495E'  // Dark Blue-Grey (Χαμηλή Ένταση/Φόντο)
 'percussion': '#D35400'
};
