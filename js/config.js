export const TRACK_INSTRUMENTS = {
    bassline: {
        type: 'bass',
        mixVolume: 0.72,        // Loud — anchors the mix
        midiProgram: 34,        // Electric Bass (finger) — GM standard bass
        baseRegister: { min: 31, max: 55 },
        maxPolyphony: 1,
        settings: {
            oscillator: { type: 'fmsquare', modulationType: 'triangle', modulationIndex: 2 },
            envelope: { attack: 0.02, decay: 0.2, sustain: 0.8, release: 0.5 },
            filter: { Q: 2, type: 'lowpass', rolloff: -24, frequency: 800 }
        }
    },
    melody: {
        type: 'synth',
        mixVolume: 0.68,        // Front of mix, slightly below bass
        midiProgram: 81,        // Lead 1 (square) — GM synth lead
        baseRegister: { min: 60, max: 88 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 1.2 },
            filter: { Q: 1, type: 'lowpass', frequency: 6000, rolloff: -12 }
        }
    },

    chord: {
        type: 'synth',
        mixVolume: 0.55,        // Background support, under melody
        midiProgram: 89,        // Pad 2 (warm) — GM warm pad
        baseRegister: { min: 48, max: 72 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fatsine', count: 4, spread: 40 },
            envelope: { attack: 0.2, decay: 0.5, sustain: 0.6, release: 1.6 },
            filter: { type: 'lowpass', frequency: 3500, Q: 0.5 }
        }
    },

    arpeggio: {
        type: 'synth',
        mixVolume: 0.56,
        midiProgram: 84,        // Lead 5 (charang) — GM bright synth arp
        baseRegister: { min: 48, max: 84 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.015, decay: 0.15, sustain: 0.1, release: 0.3 },
            filter: { type: 'lowpass', frequency: 4000, Q: 3 }
        }
    },

    strings: {
        type: 'synth',
        mixVolume: 0.52,        // Background texture, under melody
        midiProgram: 49,        // String Ensemble 1 — GM standard
        baseRegister: { min: 48, max: 79 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 30 },
            envelope: { attack: 0.6, decay: 2, sustain: 0.8, release: 2.0 },
            filter: { type: 'lowpass', frequency: 5000 }
        }
    },

    lead: {
        type: 'lead',
        mixVolume: 0.68,        // Lead synth — prominent in mix
        midiProgram: 80,        // Lead 1 (square) — GM synth lead
        baseRegister: { min: 60, max: 96 },
        maxPolyphony: 1,
        settings: {
            oscillator: { type: 'pwm', modulationFrequency: 0.4 },
            envelope: { attack: 0.02, decay: 0.4, sustain: 0.5, release: 0.65 },
            filter: { type: 'lowpass', frequency: 2500, Q: 4, rolloff: -24 }
        }
    },

    plucks: {
        type: 'synth',
        mixVolume: 0.56,
        midiProgram: 46,        // Orchestral Harp — bright pluck character
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
        mixVolume: 0.60,
        midiProgram: 5,         // Electric Piano 2 (FM) — GM standard
        baseRegister: { min: 48, max: 76 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fmsine', modulationIndex: 3 },
            envelope: { attack: 0.015, decay: 0.5, sustain: 0.3, release: 0.8 },
        }
    },

    brass: {
        type: 'synth',
        mixVolume: 0.58,
        midiProgram: 62,        // Brass Section — GM standard
        baseRegister: { min: 40, max: 84 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 },
            filter: { type: 'lowpass', frequency: 3000, Q: 2 }
        }
    },

    guitar: {
        type: 'synth',
        mixVolume: 0.56,
        midiProgram: 30,        // Distortion Guitar — GM standard
        baseRegister: { min: 40, max: 80 },
        maxPolyphony: 4,
        settings: {
            // Cleaner plucked preview tone; genre profiles add their own guitar character.
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.01, decay: 0.28, sustain: 0.06, release: 0.22 },
            filter: { type: 'bandpass', frequency: 1200, Q: 1 }
        }
    },

    percs: {
        type: 'synth',
        mixVolume: 0.58,
        midiProgram: 119,       // Synth Drum — GM channel 10 percussion (closest)
        baseRegister: { min: 35, max: 81 },
        maxPolyphony: 4,
        settings: {
            oscillator: { type: 'fmsquare', modulationType: 'square', modulationIndex: 5 },
            envelope: { attack: 0.010, decay: 0.12, sustain: 0, release: 0.20 },
            filter: { type: 'bandpass', frequency: 1000, Q: 1 }
        }
    },

    'pad-textures': {
        type: 'synth',
        mixVolume: 0.46,        // Atmospheric background — subtle
        midiProgram: 92,        // Pad 5 (bowed) — GM atmospheric pad
        baseRegister: { min: 36, max: 80 },
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
    },

    // ── Ambient / Downtempo ──────────────────────────────────────────
    ambient_chill: {
        'pad-textures': {
            oscillator: { type: 'fatcustom', partials: [1, 0.5, 0.25, 0.1], spread: 80 },
            envelope: { attack: 3, decay: 6, sustain: 0.9, release: 8 },
            filter: { frequency: 600, Q: 0.3 }
        },
        strings: {
            oscillator: { type: 'fatsawtooth', count: 4, spread: 50 },
            envelope: { attack: 2, decay: 4, sustain: 0.9, release: 6 },
            filter: { frequency: 3000 }
        },
        bassline: {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.5, decay: 2, sustain: 0.7, release: 3 },
            filter: { frequency: 200, Q: 0.5 }
        },
        plucks: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.05, decay: 1.5, sustain: 0.1, release: 2.5 },
            filter: { frequency: 1500 }
        },
        arpeggio: {
            oscillator: { type: 'fatsine', count: 2, spread: 20 },
            envelope: { attack: 0.1, decay: 0.8, sustain: 0.3, release: 1.5 },
            filter: { frequency: 2000 }
        }
    },

    // ── Disco / Funk ─────────────────────────────────────────────────
    disco_funk: {
        bassline: {
            oscillator: { type: 'fmsine', modulationIndex: 2 },
            envelope: { attack: 0.02, decay: 0.25, sustain: 0.6, release: 0.3 },
            filter: { frequency: 1000, Q: 2 }
        },
        guitar: {
            oscillator: { type: 'fmsquare', modulationIndex: 3 },
            envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.5 },
            filter: { type: 'bandpass', frequency: 2000, Q: 2 }
        },
        brass: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.8, release: 0.4 },
            filter: { frequency: 4000, Q: 1 }
        },
        strings: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
            envelope: { attack: 0.3, decay: 1, sustain: 0.7, release: 1.5 }
        },
        keys: {
            oscillator: { type: 'fmsine', modulationIndex: 3 },
            envelope: { attack: 0.015, decay: 0.3, sustain: 0.4, release: 0.8 }
        },
        percs: {
            oscillator: { type: 'square', modulationIndex: 3 },
            envelope: { attack: 0.008, decay: 0.1, sustain: 0, release: 0.15 }
        }
    },

    // ── Classical / Orchestral ───────────────────────────────────────
    classical_orch: {
        strings: {
            oscillator: { type: 'fatsawtooth', count: 5, spread: 35 },
            envelope: { attack: 0.8, decay: 2, sustain: 0.85, release: 3 },
            filter: { frequency: 8000 }
        },
        brass: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.2, decay: 0.8, sustain: 0.7, release: 2 },
            filter: { frequency: 5000, Q: 0.8 }
        },
        'pad-textures': {
            oscillator: { type: 'fatsine', count: 3, spread: 20 },
            envelope: { attack: 2, decay: 4, sustain: 0.8, release: 5 },
            filter: { frequency: 2500 }
        },
        bassline: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 8 },
            envelope: { attack: 0.15, decay: 0.8, sustain: 0.7, release: 2 }
        },
        melody: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 10 },
            envelope: { attack: 0.1, decay: 0.5, sustain: 0.7, release: 1.5 },
            filter: { frequency: 7000 }
        }
    },

    // ── Deep House ───────────────────────────────────────────────────
    deep_house: {
        bassline: {
            oscillator: { type: 'fmsquare', modulationType: 'triangle', modulationIndex: 2.5 },
            envelope: { attack: 0.012, decay: 0.28, sustain: 0.48, release: 0.22 }
        },
        chord: {
            oscillator: { type: 'fatsine', count: 3, spread: 24 },
            envelope: { attack: 0.06, decay: 0.35, sustain: 0.42, release: 0.65 }
        },
        arpeggio: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.012, decay: 0.18, sustain: 0.08, release: 0.18 }
        },
        plucks: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.008, decay: 0.22, sustain: 0.04, release: 0.22 }
        },
        'pad-textures': {
            oscillator: { type: 'fatsine', count: 3, spread: 36 },
            envelope: { attack: 0.9, decay: 2.2, sustain: 0.62, release: 3.2 }
        }
    },

    // ── Trap / 808 ───────────────────────────────────────────────────
    trap_808: {
        bassline: {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.008, decay: 0.55, sustain: 0.72, release: 0.28 }
        },
        lead: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.008, decay: 0.22, sustain: 0.18, release: 0.22 }
        },
        melody: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.06, decay: 0.42, sustain: 0.32, release: 0.8 }
        },
        keys: {
            oscillator: { type: 'fmsine', modulationIndex: 1.5 },
            envelope: { attack: 0.018, decay: 0.72, sustain: 0.18, release: 1.25 }
        },
        plucks: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.008, decay: 0.32, sustain: 0.02, release: 0.32 }
        }
    },

    // ── Bright Pop ───────────────────────────────────────────────────
    pop_bright: {
        bassline: {
            oscillator: { type: 'fmsquare', modulationType: 'triangle', modulationIndex: 1.5 },
            envelope: { attack: 0.012, decay: 0.24, sustain: 0.62, release: 0.3 }
        },
        melody: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 12 },
            envelope: { attack: 0.025, decay: 0.22, sustain: 0.62, release: 0.7 }
        },
        chord: {
            oscillator: { type: 'fatsine', count: 3, spread: 18 },
            envelope: { attack: 0.035, decay: 0.32, sustain: 0.55, release: 0.9 }
        },
        keys: {
            oscillator: { type: 'fmsine', modulationIndex: 2.5 },
            envelope: { attack: 0.012, decay: 0.42, sustain: 0.28, release: 0.75 }
        },
        plucks: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.008, decay: 0.24, sustain: 0.03, release: 0.25 }
        }
    },

    // ── Progressive Rock ─────────────────────────────────────────────
    progressive_rock: {
        bassline: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 9 },
            envelope: { attack: 0.018, decay: 0.28, sustain: 0.68, release: 0.42 }
        },
        guitar: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 16 },
            envelope: { attack: 0.018, decay: 0.62, sustain: 0.58, release: 0.85 }
        },
        lead: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 22 },
            envelope: { attack: 0.025, decay: 0.28, sustain: 0.66, release: 0.9 }
        },
        strings: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 28 },
            envelope: { attack: 0.42, decay: 1.6, sustain: 0.78, release: 2.2 }
        },
        chord: {
            oscillator: { type: 'fatsawtooth', count: 2, spread: 12 },
            envelope: { attack: 0.025, decay: 0.34, sustain: 0.58, release: 0.85 }
        }
    },

    // ── Funk Groove ──────────────────────────────────────────────────
    funk_groove: {
        bassline: {
            oscillator: { type: 'fmsquare', modulationType: 'sine', modulationIndex: 3 },
            envelope: { attack: 0.008, decay: 0.2, sustain: 0.36, release: 0.16 }
        },
        guitar: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.008, decay: 0.2, sustain: 0.08, release: 0.16 }
        },
        keys: {
            oscillator: { type: 'fmsine', modulationIndex: 4 },
            envelope: { attack: 0.008, decay: 0.28, sustain: 0.16, release: 0.28 }
        },
        brass: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.035, decay: 0.22, sustain: 0.58, release: 0.28 }
        }
    },

    // ── Disco ────────────────────────────────────────────────────────
    disco_glam: {
        bassline: {
            oscillator: { type: 'fatsquare', count: 2, spread: 8 },
            envelope: { attack: 0.012, decay: 0.24, sustain: 0.58, release: 0.28 }
        },
        guitar: {
            oscillator: { type: 'fmsquare', modulationIndex: 2.5 },
            envelope: { attack: 0.008, decay: 0.22, sustain: 0.12, release: 0.22 }
        },
        strings: {
            oscillator: { type: 'fatsawtooth', count: 4, spread: 30 },
            envelope: { attack: 0.22, decay: 0.9, sustain: 0.72, release: 1.6 }
        },
        brass: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.035, decay: 0.24, sustain: 0.72, release: 0.38 }
        },
        keys: {
            oscillator: { type: 'fmsine', modulationIndex: 3.5 },
            envelope: { attack: 0.012, decay: 0.32, sustain: 0.32, release: 0.62 }
        }
    },

    // ── Reggae / Offbeat ─────────────────────────────────────────────
    reggae_offbeat: {
        bassline: {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.025, decay: 0.42, sustain: 0.68, release: 0.42 }
        },
        guitar: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.008, decay: 0.16, sustain: 0.025, release: 0.12 }
        },
        keys: {
            oscillator: { type: 'fmsine', modulationIndex: 1.8 },
            envelope: { attack: 0.008, decay: 0.24, sustain: 0.08, release: 0.18 }
        },
        brass: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.08, decay: 0.38, sustain: 0.48, release: 0.5 }
        },
        melody: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.055, decay: 0.35, sustain: 0.38, release: 0.7 }
        }
    }
};

// ── Genre-specific accents for core melodic instruments ────────────────
// These patches complement the broader genre profiles above. They deliberately
// affect preview synthesis only; MIDI notes, GM program metadata and exports
// remain unchanged. Keep patches to oscillator/envelope parameters so they are
// supported by the existing Tone.Synth voices and Low Power simplification.

const GENRE_INSTRUMENT_ACCENTS = {
    electronic: {
        melody: { oscillator: { type: 'fatsawtooth', count: 2, spread: 12 }, envelope: { attack: 0.025, decay: 0.22, sustain: 0.48, release: 0.45 } },
        chord:  { oscillator: { type: 'fatsine', count: 3, spread: 22 }, envelope: { attack: 0.08, decay: 0.32, sustain: 0.38, release: 0.55 } },
        guitar: { oscillator: { type: 'fatsine', count: 2, spread: 8 }, envelope: { attack: 0.01, decay: 0.24, sustain: 0.035, release: 0.2 } },
        brass:  { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.045, decay: 0.2, sustain: 0.38, release: 0.25 } },
        percs:  { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.085, sustain: 0, release: 0.09 } }
    },
    techno: {
        melody: { oscillator: { type: 'fmsquare', modulationIndex: 3 }, envelope: { attack: 0.01, decay: 0.16, sustain: 0.18, release: 0.18 } },
        chord:  { oscillator: { type: 'fatsawtooth', count: 2, spread: 14 }, envelope: { attack: 0.07, decay: 0.28, sustain: 0.28, release: 0.38 } },
        guitar: { oscillator: { type: 'triangle' }, envelope: { attack: 0.008, decay: 0.16, sustain: 0.02, release: 0.12 } },
        brass:  { oscillator: { type: 'square' }, envelope: { attack: 0.025, decay: 0.16, sustain: 0.28, release: 0.2 } },
        percs:  { oscillator: { type: 'fmsquare', modulationIndex: 6 }, envelope: { attack: 0.008, decay: 0.065, sustain: 0, release: 0.08 } }
    },
    trance: {
        melody: { oscillator: { type: 'fatsawtooth', count: 4, spread: 28 }, envelope: { attack: 0.025, decay: 0.3, sustain: 0.62, release: 1.1 } },
        chord:  { oscillator: { type: 'fatsawtooth', count: 3, spread: 30 }, envelope: { attack: 0.24, decay: 0.8, sustain: 0.68, release: 1.8 } },
        guitar: { oscillator: { type: 'fatsine', count: 2, spread: 10 }, envelope: { attack: 0.015, decay: 0.28, sustain: 0.045, release: 0.25 } },
        brass:  { oscillator: { type: 'fatsawtooth', count: 2, spread: 8 }, envelope: { attack: 0.1, decay: 0.32, sustain: 0.58, release: 0.65 } },
        percs:  { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.09, sustain: 0, release: 0.1 } }
    },
    retro: {
        melody: { oscillator: { type: 'pwm', modulationFrequency: 0.35 }, envelope: { attack: 0.035, decay: 0.28, sustain: 0.48, release: 0.75 } },
        chord:  { oscillator: { type: 'pwm', modulationFrequency: 0.5 }, envelope: { attack: 0.09, decay: 0.42, sustain: 0.48, release: 1.1 } },
        guitar: { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.18, sustain: 0.06, release: 0.16 } },
        brass:  { oscillator: { type: 'fatsquare', count: 2, spread: 10 }, envelope: { attack: 0.06, decay: 0.24, sustain: 0.42, release: 0.35 } },
        percs:  { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.075, sustain: 0, release: 0.09 } }
    },
    hiphop: {
        melody: { oscillator: { type: 'triangle' }, envelope: { attack: 0.07, decay: 0.34, sustain: 0.3, release: 0.75 } },
        chord:  { oscillator: { type: 'fmsine', modulationIndex: 1.6 }, envelope: { attack: 0.025, decay: 0.58, sustain: 0.18, release: 1.1 } },
        guitar: { oscillator: { type: 'fmsine', modulationIndex: 1.4 }, envelope: { attack: 0.012, decay: 0.3, sustain: 0.025, release: 0.35 } },
        brass:  { oscillator: { type: 'fmsine', modulationIndex: 1.6 }, envelope: { attack: 0.11, decay: 0.34, sustain: 0.28, release: 0.55 } },
        percs:  { oscillator: { type: 'fmsquare', modulationIndex: 4 }, envelope: { attack: 0.008, decay: 0.07, sustain: 0, release: 0.08 } }
    },
    rock: {
        melody: { oscillator: { type: 'fatsawtooth', count: 3, spread: 18 }, envelope: { attack: 0.018, decay: 0.24, sustain: 0.68, release: 0.75 } },
        chord:  { oscillator: { type: 'fatsawtooth', count: 2, spread: 12 }, envelope: { attack: 0.025, decay: 0.3, sustain: 0.58, release: 0.72 } },
        guitar: { oscillator: { type: 'fmsquare', modulationIndex: 3 }, envelope: { attack: 0.012, decay: 0.48, sustain: 0.34, release: 0.62 } },
        brass:  { oscillator: { type: 'fatsawtooth', count: 2, spread: 10 }, envelope: { attack: 0.035, decay: 0.25, sustain: 0.55, release: 0.42 } },
        percs:  { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.1, sustain: 0, release: 0.11 } }
    },
    jazz_funk: {
        melody: { oscillator: { type: 'fmsine', modulationIndex: 2.2 }, envelope: { attack: 0.025, decay: 0.38, sustain: 0.28, release: 0.85 } },
        chord:  { oscillator: { type: 'fmsine', modulationIndex: 2.8 }, envelope: { attack: 0.035, decay: 0.42, sustain: 0.25, release: 0.95 } },
        guitar: { oscillator: { type: 'fmsine', modulationIndex: 1.8 }, envelope: { attack: 0.008, decay: 0.22, sustain: 0.035, release: 0.18 } },
        brass:  { oscillator: { type: 'fatsawtooth', count: 2, spread: 6 }, envelope: { attack: 0.035, decay: 0.24, sustain: 0.52, release: 0.32 } },
        percs:  { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.095, sustain: 0, release: 0.1 } }
    },
    cinematic: {
        melody: { oscillator: { type: 'fatsine', count: 3, spread: 24 }, envelope: { attack: 0.22, decay: 0.8, sustain: 0.72, release: 2.2 } },
        chord:  { oscillator: { type: 'fatsine', count: 4, spread: 38 }, envelope: { attack: 0.65, decay: 1.8, sustain: 0.78, release: 3.2 } },
        guitar: { oscillator: { type: 'triangle' }, envelope: { attack: 0.08, decay: 0.9, sustain: 0.08, release: 1.4 } },
        brass:  { oscillator: { type: 'fatsawtooth', count: 3, spread: 14 }, envelope: { attack: 0.28, decay: 0.65, sustain: 0.72, release: 1.8 } },
        percs:  { oscillator: { type: 'sine' }, envelope: { attack: 0.012, decay: 0.22, sustain: 0, release: 0.28 } }
    },
    ambient: {
        melody: { oscillator: { type: 'fatsine', count: 3, spread: 34 }, envelope: { attack: 0.5, decay: 1.8, sustain: 0.72, release: 3.5 } },
        chord:  { oscillator: { type: 'fatsine', count: 4, spread: 46 }, envelope: { attack: 1.1, decay: 2.8, sustain: 0.78, release: 4.5 } },
        guitar: { oscillator: { type: 'sine' }, envelope: { attack: 0.05, decay: 1.1, sustain: 0.08, release: 1.8 } },
        brass:  { oscillator: { type: 'sine' }, envelope: { attack: 0.45, decay: 1.2, sustain: 0.58, release: 2.5 } },
        percs:  { oscillator: { type: 'sine' }, envelope: { attack: 0.025, decay: 0.3, sustain: 0, release: 0.4 } }
    },
    dnb: {
        melody: { oscillator: { type: 'fmsquare', modulationIndex: 4 }, envelope: { attack: 0.01, decay: 0.18, sustain: 0.34, release: 0.35 } },
        chord:  { oscillator: { type: 'fatsine', count: 2, spread: 18 }, envelope: { attack: 0.12, decay: 0.45, sustain: 0.3, release: 0.65 } },
        guitar: { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.18, sustain: 0.025, release: 0.14 } },
        brass:  { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.045, decay: 0.22, sustain: 0.36, release: 0.3 } },
        percs:  { oscillator: { type: 'fmsquare', modulationIndex: 7 }, envelope: { attack: 0.008, decay: 0.06, sustain: 0, release: 0.075 } }
    },
    reggae: {
        melody: { oscillator: { type: 'triangle' }, envelope: { attack: 0.025, decay: 0.28, sustain: 0.22, release: 0.45 } },
        chord:  { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.18, sustain: 0.04, release: 0.15 } },
        guitar: { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.16, sustain: 0.025, release: 0.12 } },
        brass:  { oscillator: { type: 'square' }, envelope: { attack: 0.045, decay: 0.26, sustain: 0.44, release: 0.38 } },
        percs:  { oscillator: { type: 'triangle' }, envelope: { attack: 0.008, decay: 0.11, sustain: 0, release: 0.12 } }
    },
    disco: {
        melody: { oscillator: { type: 'fatsawtooth', count: 3, spread: 22 }, envelope: { attack: 0.018, decay: 0.22, sustain: 0.58, release: 0.55 } },
        chord:  { oscillator: { type: 'fatsine', count: 3, spread: 20 }, envelope: { attack: 0.025, decay: 0.24, sustain: 0.38, release: 0.42 } },
        guitar: { oscillator: { type: 'fmsine', modulationIndex: 2 }, envelope: { attack: 0.008, decay: 0.2, sustain: 0.045, release: 0.16 } },
        brass:  { oscillator: { type: 'fatsawtooth', count: 2, spread: 10 }, envelope: { attack: 0.025, decay: 0.2, sustain: 0.58, release: 0.28 } },
        percs:  { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.09, sustain: 0, release: 0.1 } }
    }
};

const GENRE_PROFILE_ACCENT_MAP = {
    standard_electronic: 'electronic',
    techno: 'techno',
    trance_anthem: 'trance',
    retro_synth: 'retro',
    hiphop_chill: 'hiphop',
    rock_band: 'rock',
    jazz_ensemble: 'jazz_funk',
    cinematic: 'cinematic',
    dnb_jungle: 'dnb',
    ambient_chill: 'ambient',
    disco_funk: 'disco',
    classical_orch: 'cinematic',
    deep_house: 'electronic',
    trap_808: 'hiphop',
    pop_bright: 'electronic',
    progressive_rock: 'rock',
    funk_groove: 'jazz_funk',
    disco_glam: 'disco',
    reggae_offbeat: 'reggae'
};

// Apply the accents once at config load. Existing genre-specific settings for
// bass, keys, strings, pads and arpeggios are retained; these five core voices
// get a deliberate, genre-appropriate character even when a profile had no
// explicit entry for that track. Nested settings are merged, not discarded.
for (const [profileName, accentName] of Object.entries(GENRE_PROFILE_ACCENT_MAP)) {
    const profile = GENRE_PROFILES[profileName];
    const accents = GENRE_INSTRUMENT_ACCENTS[accentName];
    if (!profile || !accents) continue;

    for (const [trackType, patch] of Object.entries(accents)) {
        const existing = profile[trackType] || {};
        profile[trackType] = {
            ...existing,
            ...patch,
            oscillator: { ...(existing.oscillator || {}), ...(patch.oscillator || {}) },
            envelope: { ...(existing.envelope || {}), ...(patch.envelope || {}) }
        };
    }
}

// Subgenre profiles inherit the corresponding broad genre profile and override
// only the instrument patches that define their preview character. Oscillator
// and envelope remain independent Tone.js settings.
const mergeProfileSettings = (base, overrides) => {
    const result = { ...(base || {}) };
    for (const [key, value] of Object.entries(overrides || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = mergeProfileSettings(result[key], value);
        } else {
            result[key] = value;
        }
    }
    return result;
};

GENRE_PROFILES.melodic_house = mergeProfileSettings(GENRE_PROFILES.deep_house, {
    melody: { oscillator: { type: 'fatsawtooth', count: 2, spread: 16 }, envelope: { attack: 0.035, decay: 0.32, sustain: 0.48, release: 0.65 } },
    chord:  { oscillator: { type: 'fatsine', count: 3, spread: 26 }, envelope: { attack: 0.12, decay: 0.55, sustain: 0.52, release: 0.95 } },
    guitar: { oscillator: { type: 'fatsine', count: 2, spread: 8 }, envelope: { attack: 0.018, decay: 0.28, sustain: 0.05, release: 0.28 } },
    brass:  { oscillator: { type: 'fatsawtooth', count: 2, spread: 6 }, envelope: { attack: 0.07, decay: 0.3, sustain: 0.46, release: 0.48 } }
});
GENRE_PROFILES.progressive_house = mergeProfileSettings(GENRE_PROFILES.deep_house, {
    melody: { oscillator: { type: 'fatsawtooth', count: 3, spread: 22 }, envelope: { attack: 0.045, decay: 0.42, sustain: 0.58, release: 0.85 } },
    chord:  { oscillator: { type: 'fatsawtooth', count: 3, spread: 30 }, envelope: { attack: 0.18, decay: 0.72, sustain: 0.62, release: 1.25 } },
    guitar: { oscillator: { type: 'fatsine', count: 2, spread: 10 }, envelope: { attack: 0.025, decay: 0.34, sustain: 0.06, release: 0.38 } },
    brass:  { oscillator: { type: 'fatsawtooth', count: 2, spread: 10 }, envelope: { attack: 0.09, decay: 0.38, sustain: 0.52, release: 0.62 } }
});
GENRE_PROFILES.melodic_techno = mergeProfileSettings(GENRE_PROFILES.techno, {
    melody: { oscillator: { type: 'fatsawtooth', count: 3, spread: 24 }, envelope: { attack: 0.025, decay: 0.28, sustain: 0.48, release: 0.62 } },
    chord:  { oscillator: { type: 'fatsine', count: 3, spread: 30 }, envelope: { attack: 0.16, decay: 0.62, sustain: 0.58, release: 1.1 } },
    guitar: { oscillator: { type: 'triangle' }, envelope: { attack: 0.012, decay: 0.24, sustain: 0.045, release: 0.24 } },
    brass:  { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.065, decay: 0.32, sustain: 0.48, release: 0.48 } },
    'pad-textures': { oscillator: { type: 'fatsine', count: 3, spread: 28 }, envelope: { attack: 0.48, decay: 1.4, sustain: 0.72, release: 2.2 } }
});
GENRE_PROFILES.industrial_techno = mergeProfileSettings(GENRE_PROFILES.techno, {
    melody: { oscillator: { type: 'fmsquare', modulationIndex: 7 }, envelope: { attack: 0.008, decay: 0.12, sustain: 0.12, release: 0.14 } },
    chord:  { oscillator: { type: 'fmsquare', modulationIndex: 3 }, envelope: { attack: 0.025, decay: 0.22, sustain: 0.2, release: 0.24 } },
    guitar: { oscillator: { type: 'fmsquare', modulationIndex: 5 }, envelope: { attack: 0.008, decay: 0.14, sustain: 0.025, release: 0.12 } },
    brass:  { oscillator: { type: 'square' }, envelope: { attack: 0.018, decay: 0.14, sustain: 0.3, release: 0.18 } },
    percs:  { oscillator: { type: 'fmsquare', modulationIndex: 8 }, envelope: { attack: 0.008, decay: 0.055, sustain: 0, release: 0.07 } }
});
GENRE_PROFILES.cyberpunk_industrial = mergeProfileSettings(GENRE_PROFILES.industrial_techno, {
    melody: { oscillator: { type: 'fmsquare', modulationIndex: 9 }, envelope: { attack: 0.008, decay: 0.1, sustain: 0.16, release: 0.16 } },
    chord:  { oscillator: { type: 'fmsawtooth', modulationIndex: 5 }, envelope: { attack: 0.045, decay: 0.28, sustain: 0.28, release: 0.34 } },
    guitar: { oscillator: { type: 'fmsquare', modulationIndex: 7 }, envelope: { attack: 0.008, decay: 0.12, sustain: 0.018, release: 0.1 } },
    brass:  { oscillator: { type: 'fmsawtooth', modulationIndex: 4 }, envelope: { attack: 0.025, decay: 0.2, sustain: 0.32, release: 0.24 } }
});

// Additional genre families: each subgenre inherits its broad genre patch and
// changes only the oscillator and ADSR details that shape its preview identity.
const defineSubgenreProfile = (name, baseProfile, overrides) => {
    GENRE_PROFILES[name] = mergeProfileSettings(GENRE_PROFILES[baseProfile], overrides);
};

defineSubgenreProfile('uplifting_trance', 'trance_anthem', {
    melody: { oscillator: { type: 'fatsawtooth', count: 4, spread: 34 }, envelope: { attack: 0.012, decay: 0.34, sustain: 0.68, release: 1.25 } },
    chord: { oscillator: { type: 'fatsawtooth', count: 4, spread: 38 }, envelope: { attack: 0.16, decay: 0.72, sustain: 0.72, release: 1.8 } },
    strings: { oscillator: { type: 'fatsawtooth', count: 3, spread: 26 }, envelope: { attack: 0.38, decay: 1.2, sustain: 0.78, release: 2.4 } }
});
defineSubgenreProfile('progressive_trance', 'trance_anthem', {
    melody: { oscillator: { type: 'fatsawtooth', count: 3, spread: 22 }, envelope: { attack: 0.045, decay: 0.42, sustain: 0.52, release: 0.95 } },
    chord: { oscillator: { type: 'fatsine', count: 3, spread: 32 }, envelope: { attack: 0.3, decay: 0.9, sustain: 0.62, release: 2.1 } },
    arpeggio: { oscillator: { type: 'triangle' }, envelope: { attack: 0.025, decay: 0.3, sustain: 0.16, release: 0.55 } }
});
defineSubgenreProfile('melodic_trap', 'trap_808', {
    lead: { oscillator: { type: 'fmsine', modulationIndex: 2.2 }, envelope: { attack: 0.025, decay: 0.42, sustain: 0.34, release: 0.72 } },
    plucks: { oscillator: { type: 'triangle' }, envelope: { attack: 0.008, decay: 0.52, sustain: 0.035, release: 0.48 } },
    keys: { oscillator: { type: 'fmsine', modulationIndex: 1.4 }, envelope: { attack: 0.035, decay: 0.65, sustain: 0.2, release: 1.15 } }
});
defineSubgenreProfile('boom_bap', 'hiphop_chill', {
    bassline: { oscillator: { type: 'fmsine', modulationIndex: 1.2 }, envelope: { attack: 0.018, decay: 0.32, sustain: 0.72, release: 0.3 } },
    keys: { oscillator: { type: 'fmsine', modulationIndex: 3.2 }, envelope: { attack: 0.008, decay: 0.42, sustain: 0.12, release: 0.42 } },
    melody: { oscillator: { type: 'triangle' }, envelope: { attack: 0.025, decay: 0.3, sustain: 0.24, release: 0.52 } }
});
defineSubgenreProfile('lofi_hiphop', 'hiphop_chill', {
    bassline: { oscillator: { type: 'sine' }, envelope: { attack: 0.045, decay: 0.48, sustain: 0.62, release: 0.62 } },
    keys: { oscillator: { type: 'fmsine', modulationIndex: 1.1 }, envelope: { attack: 0.035, decay: 0.72, sustain: 0.12, release: 1.35 } },
    plucks: { oscillator: { type: 'triangle' }, envelope: { attack: 0.025, decay: 0.62, sustain: 0.025, release: 0.8 } }
});
defineSubgenreProfile('alternative_rock', 'rock_band', {
    melody: { oscillator: { type: 'fatsawtooth', count: 2, spread: 14 }, envelope: { attack: 0.018, decay: 0.28, sustain: 0.7, release: 0.68 } },
    guitar: { oscillator: { type: 'fmsquare', modulationIndex: 3.5 }, envelope: { attack: 0.012, decay: 0.52, sustain: 0.4, release: 0.58 } },
    bassline: { oscillator: { type: 'fmsquare', modulationIndex: 1.8 }, envelope: { attack: 0.018, decay: 0.28, sustain: 0.72, release: 0.38 } }
});
defineSubgenreProfile('synth_pop', 'pop_bright', {
    melody: { oscillator: { type: 'pwm', modulationFrequency: 0.45 }, envelope: { attack: 0.025, decay: 0.28, sustain: 0.56, release: 0.62 } },
    chord: { oscillator: { type: 'fatsawtooth', count: 2, spread: 18 }, envelope: { attack: 0.08, decay: 0.38, sustain: 0.48, release: 0.9 } },
    bassline: { oscillator: { type: 'fmsquare', modulationIndex: 2.2 }, envelope: { attack: 0.012, decay: 0.22, sustain: 0.68, release: 0.3 } }
});
defineSubgenreProfile('electropop', 'pop_bright', {
    melody: { oscillator: { type: 'fmsquare', modulationIndex: 2.8 }, envelope: { attack: 0.012, decay: 0.2, sustain: 0.38, release: 0.32 } },
    chord: { oscillator: { type: 'fatsawtooth', count: 3, spread: 20 }, envelope: { attack: 0.035, decay: 0.32, sustain: 0.42, release: 0.58 } },
    arpeggio: { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.14, sustain: 0.08, release: 0.18 } }
});
defineSubgenreProfile('funk_groove_subgenre', 'funk_groove', {
    bassline: { oscillator: { type: 'fmsquare', modulationIndex: 2.4 }, envelope: { attack: 0.008, decay: 0.26, sustain: 0.62, release: 0.2 } },
    guitar: { oscillator: { type: 'square' }, envelope: { attack: 0.008, decay: 0.14, sustain: 0.035, release: 0.12 } },
    brass: { oscillator: { type: 'fatsawtooth', count: 2, spread: 8 }, envelope: { attack: 0.025, decay: 0.2, sustain: 0.48, release: 0.28 } }
});
defineSubgenreProfile('smooth_jazz', 'jazz_ensemble', {
    keys: { oscillator: { type: 'fmsine', modulationIndex: 1.5 }, envelope: { attack: 0.025, decay: 0.62, sustain: 0.18, release: 1.1 } },
    brass: { oscillator: { type: 'fatsine', count: 2, spread: 8 }, envelope: { attack: 0.12, decay: 0.48, sustain: 0.58, release: 0.85 } },
    bassline: { oscillator: { type: 'sine' }, envelope: { attack: 0.025, decay: 0.36, sustain: 0.72, release: 0.42 } }
});
defineSubgenreProfile('jazz_fusion', 'jazz_ensemble', {
    keys: { oscillator: { type: 'fmsquare', modulationIndex: 2.6 }, envelope: { attack: 0.012, decay: 0.32, sustain: 0.3, release: 0.62 } },
    brass: { oscillator: { type: 'fatsawtooth', count: 2, spread: 12 }, envelope: { attack: 0.035, decay: 0.28, sustain: 0.56, release: 0.42 } },
    melody: { oscillator: { type: 'fmsine', modulationIndex: 2.4 }, envelope: { attack: 0.018, decay: 0.34, sustain: 0.32, release: 0.68 } }
});
defineSubgenreProfile('nu_disco', 'disco_glam', {
    bassline: { oscillator: { type: 'fmsquare', modulationIndex: 2.6 }, envelope: { attack: 0.008, decay: 0.22, sustain: 0.68, release: 0.24 } },
    guitar: { oscillator: { type: 'fmsine', modulationIndex: 2.4 }, envelope: { attack: 0.008, decay: 0.18, sustain: 0.04, release: 0.14 } },
    strings: { oscillator: { type: 'fatsawtooth', count: 3, spread: 18 }, envelope: { attack: 0.16, decay: 0.58, sustain: 0.62, release: 1.1 } }
});
defineSubgenreProfile('liquid_dnb', 'dnb_jungle', {
    bassline: { oscillator: { type: 'sine' }, envelope: { attack: 0.012, decay: 0.28, sustain: 0.76, release: 0.28 } },
    melody: { oscillator: { type: 'fatsine', count: 3, spread: 20 }, envelope: { attack: 0.045, decay: 0.38, sustain: 0.5, release: 0.72 } },
    'pad-textures': { oscillator: { type: 'fatsine', count: 3, spread: 30 }, envelope: { attack: 0.42, decay: 1.2, sustain: 0.72, release: 2.0 } }
});
defineSubgenreProfile('neurofunk', 'dnb_jungle', {
    bassline: { oscillator: { type: 'fmsquare', modulationIndex: 8 }, envelope: { attack: 0.008, decay: 0.18, sustain: 0.28, release: 0.18 } },
    lead: { oscillator: { type: 'fmsquare', modulationIndex: 7 }, envelope: { attack: 0.008, decay: 0.16, sustain: 0.2, release: 0.16 } },
    melody: { oscillator: { type: 'fmsawtooth', modulationIndex: 4 }, envelope: { attack: 0.008, decay: 0.18, sustain: 0.3, release: 0.2 } }
});
defineSubgenreProfile('outrun', 'retro_synth', {
    bassline: { oscillator: { type: 'fmsquare', modulationIndex: 2.4 }, envelope: { attack: 0.012, decay: 0.28, sustain: 0.68, release: 0.38 } },
    melody: { oscillator: { type: 'fatsawtooth', count: 3, spread: 24 }, envelope: { attack: 0.035, decay: 0.28, sustain: 0.62, release: 0.82 } },
    chord: { oscillator: { type: 'fatsawtooth', count: 3, spread: 28 }, envelope: { attack: 0.1, decay: 0.42, sustain: 0.52, release: 1.0 } }
});
defineSubgenreProfile('dark_synthwave', 'retro_synth', {
    bassline: { oscillator: { type: 'fmsquare', modulationIndex: 4 }, envelope: { attack: 0.018, decay: 0.32, sustain: 0.58, release: 0.48 } },
    melody: { oscillator: { type: 'fmsquare', modulationIndex: 5 }, envelope: { attack: 0.025, decay: 0.24, sustain: 0.32, release: 0.58 } },
    chord: { oscillator: { type: 'fatsine', count: 3, spread: 34 }, envelope: { attack: 0.28, decay: 0.9, sustain: 0.68, release: 1.8 } }
});
defineSubgenreProfile('dark_ambient', 'ambient_chill', {
    'pad-textures': { oscillator: { type: 'fatsine', count: 4, spread: 48 }, envelope: { attack: 1.0, decay: 2.4, sustain: 0.72, release: 3.8 } },
    strings: { oscillator: { type: 'fatsine', count: 3, spread: 36 }, envelope: { attack: 0.75, decay: 1.8, sustain: 0.7, release: 3.0 } },
    melody: { oscillator: { type: 'sine' }, envelope: { attack: 0.42, decay: 1.2, sustain: 0.52, release: 2.5 } }
});
defineSubgenreProfile('cinematic_ambient', 'ambient_chill', {
    'pad-textures': { oscillator: { type: 'fatsine', count: 4, spread: 42 }, envelope: { attack: 0.72, decay: 2.0, sustain: 0.82, release: 4.2 } },
    strings: { oscillator: { type: 'fatsawtooth', count: 3, spread: 24 }, envelope: { attack: 0.48, decay: 1.4, sustain: 0.78, release: 3.2 } },
    brass: { oscillator: { type: 'sine' }, envelope: { attack: 0.5, decay: 1.5, sustain: 0.55, release: 2.8 } }
});
defineSubgenreProfile('chillhop', 'ambient_chill', {
    bassline: { oscillator: { type: 'sine' }, envelope: { attack: 0.035, decay: 0.5, sustain: 0.64, release: 0.62 } },
    keys: { oscillator: { type: 'fmsine', modulationIndex: 1.2 }, envelope: { attack: 0.025, decay: 0.7, sustain: 0.14, release: 1.2 } },
    plucks: { oscillator: { type: 'triangle' }, envelope: { attack: 0.018, decay: 0.5, sustain: 0.025, release: 0.7 } }
});
defineSubgenreProfile('epic_cinematic', 'cinematic', {
    strings: { oscillator: { type: 'fatsawtooth', count: 4, spread: 34 }, envelope: { attack: 0.28, decay: 1.2, sustain: 0.82, release: 2.6 } },
    brass: { oscillator: { type: 'fatsawtooth', count: 3, spread: 18 }, envelope: { attack: 0.16, decay: 0.68, sustain: 0.72, release: 1.8 } },
    'pad-textures': { oscillator: { type: 'fatsine', count: 3, spread: 32 }, envelope: { attack: 0.5, decay: 1.5, sustain: 0.78, release: 2.8 } }
});
defineSubgenreProfile('orchestral', 'classical_orch', {
    strings: { oscillator: { type: 'fatsawtooth', count: 3, spread: 22 }, envelope: { attack: 0.42, decay: 1.4, sustain: 0.8, release: 2.4 } },
    brass: { oscillator: { type: 'fatsawtooth', count: 2, spread: 10 }, envelope: { attack: 0.18, decay: 0.8, sustain: 0.68, release: 1.8 } },
    melody: { oscillator: { type: 'fatsine', count: 2, spread: 12 }, envelope: { attack: 0.16, decay: 0.72, sustain: 0.7, release: 1.5 } }
});

export const SUBGENRE_TO_PROFILE_MAP = {
    'deep-house': 'deep_house',
    'melodic-house': 'melodic_house',
    'progressive-house': 'progressive_house',
    'melodic-techno': 'melodic_techno',
    'industrial-techno': 'industrial_techno',
    'cyberpunk-industrial': 'cyberpunk_industrial',
    'uplifting-trance': 'uplifting_trance',
    'progressive-trance': 'progressive_trance',
    'melodic-trap': 'melodic_trap',
    'boom-bap': 'boom_bap',
    'lo-fi-hip-hop': 'lofi_hiphop',
    'alternative-rock': 'alternative_rock',
    'synth-pop': 'synth_pop',
    'electropop': 'electropop',
    'funk-groove': 'funk_groove_subgenre',
    'smooth-jazz': 'smooth_jazz',
    'jazz-fusion': 'jazz_fusion',
    'nu-disco': 'nu_disco',
    'liquid-dnb': 'liquid_dnb',
    'neurofunk': 'neurofunk',
    'outrun': 'outrun',
    'dark-synthwave': 'dark_synthwave',
    'dark-ambient': 'dark_ambient',
    'cinematic-ambient': 'cinematic_ambient',
    'chillhop': 'chillhop',
    'epic-cinematic': 'epic_cinematic',
    'orchestral': 'orchestral'
};

export const GENRE_TO_PROFILE_MAP = {
    'house':            'deep_house',
    'techno':           'techno',
    'trance':           'trance_anthem',
    'trap':             'trap_808',
    'hip-hop':          'hiphop_chill',
    'rock':             'rock_band',
    'progressive-rock': 'progressive_rock',
    'pop':              'pop_bright',
    'funk':             'funk_groove',
    'reggae':           'reggae_offbeat',
    'jazz':             'jazz_ensemble',
    'disco':            'disco_glam',
    'cinematic':        'cinematic',
    'classical':        'classical_orch',
    'ambient':          'ambient_chill',
    'drum-and-bass':    'dnb_jungle',
    'synthwave':        'retro_synth',
    'downtempo':        'ambient_chill',
    'default':          'standard_electronic'
};

export { GENRE_TRACK_RECOMMENDATIONS } from '../lib/genre-track-recommendations.mjs';

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
