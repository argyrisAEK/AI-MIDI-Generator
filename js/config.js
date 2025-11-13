export const TRACK_INSTRUMENTS = {
  bassline: {
    type: 'bass',
    midiProgram: 38, // Synth Bass 1 – punchy and classic for house basslines
    settings: {
      oscillator: { type: 'pwm', width: 0.5 },
      envelope: { attack: 0.02, decay: 0.5, sustain: 0.9, release: 0.8 },
      filter: { type: 'lowpass', frequency: 1200, Q: 3.5, rolloff: -24 }
    }
  },
  melody: {
    type: 'synth',
    midiProgram: 81, // Lead 2 (sawtooth) – bright melodic lead
    settings: {
      oscillator: { type: 'fatsawtooth', count: 2, detune: 30 },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 1.0 },
      filter: { type: 'lowpass', frequency: 4200, Q: 2.5, rolloff: -24 }
    }
  },
  chord: {
    type: 'synth',
    midiProgram: 88, // Pad 1 (new age) – lush chords layer
    settings: {
      oscillator: { type: 'fatsine', count: 3, spread: 40 },
      envelope: { attack: 0.15, decay: 0.4, sustain: 0.7, release: 1.5 }
    }
  },
  arpeggio: {
    type: 'synth',
    midiProgram: 100, // FX 2 (soundtrack) – soft evolving arp tone
    settings: {
      oscillator: { type: 'fatsawtooth', count: 2, detune: 15 },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.35 },
      filter: { type: 'lowpass', frequency: 6500, Q: 3.0, rolloff: -24 }
    }
  },
  strings: {
    type: 'synth',
    midiProgram: 49, // String Ensemble 2 – smoother, cinematic string pad
    settings: {
      oscillator: { type: 'fatsine', count: 4, spread: 50 },
      envelope: { attack: 0.6, decay: 1.0, sustain: 0.85, release: 2.0 }
    }
  },
  lead: {
    type: 'lead',
    midiProgram: 82, // Lead 3 (calliope) – bright lead, works well for melodic lines
    settings: {
      oscillator: { type: 'pwm', width: 0.6 },
      envelope: { attack: 0.02, decay: 0.5, sustain: 0.7, release: 1.0 },
      filter: { type: 'lowpass', frequency: 1800, Q: 2.8, rolloff: -24 }
    }
  },
  plucks: {
    type: 'synth',
    midiProgram: 84, // Lead 5 (charang) – short, plucky synth tone
    settings: {
      oscillator: { type: 'triangle', count: 2, spread: 30 },
      envelope: { attack: 0.008, decay: 0.18, sustain: 0.08, release: 0.28 },
      filter: { type: 'lowpass', frequency: 5200, Q: 2.5, rolloff: -24 }
    }
  },
  keys: {
    type: 'synth',
    midiProgram: 5, // Electric Piano 2 – soft harmonic layer
    settings: {
      oscillator: { type: 'fatsine', count: 2, spread: 20 },
      envelope: { attack: 0.02, decay: 0.5, sustain: 0.65, release: 1.2 },
      filter: { type: 'lowpass', frequency: 3500, Q: 1.8, rolloff: -12 }
    }
  },
  brass: {
    type: 'synth',
    midiProgram: 63, // Synth Brass 2 – lush and warm, fits electronic context
    settings: {
      oscillator: { type: 'fatsawtooth', count: 2, detune: 25 },
      envelope: { attack: 0.12, decay: 0.3, sustain: 0.8, release: 1.0 },
      filter: { type: 'lowpass', frequency: 3000, Q: 2.2, rolloff: -24 }
    }
  },
  guitar: {
    type: 'synth',
    midiProgram: 27, // Jazz Guitar – smoother and mellow for ambient textures
    settings: {
      oscillator: { type: 'pwm', width: 0.5 },
      envelope: { attack: 0.006, decay: 0.6, sustain: 0.15, release: 1.0 },
      filter: { type: 'lowpass', frequency: 5800, Q: 2.0, rolloff: -24 }
    }
  },
  'pad-textures': {
    type: 'synth',
    midiProgram: 90, // Pad 3 (polysynth) – evolving lush pad, perfect for house atmosphere
    settings: {
      oscillator: { type: 'fatsine', count: 4, spread: 60 },
      envelope: { attack: 2.0, decay: 1.2, sustain: 0.7, release: 3.0 },
      filter: { type: 'lowpass', frequency: 2200, Q: 0.8, rolloff: -12 }
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
