export const TRACK_INSTRUMENTS = {
    bassline: {
        type: 'bass',
        settings: {
            oscillator: { type: 'triangle' },
            envelope: {
                attack: 0.05,
                decay: 0.2,
                sustain: 0.8,
                release: 1
            },
            filter: {
                Q: 2,
                type: 'lowpass',
                rolloff: -24
            }
        }
    },
    melody: {
        type: 'piano',
        settings: {
            oscillator: { type: 'triangle' },
            envelope: {
                attack: 0.02,
                decay: 0.1,
                sustain: 0.3,
                release: 0.8
            }
        }
    },
    chord: {
        type: 'pad',
        settings: {
            oscillator: { type: 'sine' },
            envelope: {
                attack: 0.1,
                decay: 0.2,
                sustain: 0.5,
                release: 1.5
            }
        }
    },
    arpeggio: {
        type: 'arpeggio',
        settings: {
            oscillator: {
                type: 'fatsawtooth',
                count: 3,
                spread: 40
            },
            envelope: {
                attack: 0.001,
                decay: 0.1,
                sustain: 0.15,
                release: 0.2,
                attackCurve: 'exponential'
            },
            filter: {
                type: 'highpass',
                frequency: 200,
                Q: 2
            },
            filterEnvelope: {
                attack: 0.01,
                decay: 0.3,
                sustain: 0.1,
                release: 0.2,
                baseFrequency: 800,
                octaves: 3
            },
            portamento: 0.05
        }
    },
    strings: {
        type: 'strings',
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: {
                attack: 0.5,
                decay: 1,
                sustain: 0.8,
                release: 2
            }
        }
    },
    orchestra: {
        type: 'orchestra',
        settings: {
            oscillator: { type: 'fmsquare' },
            envelope: {
                attack: 1,
                decay: 2,
                sustain: 0.8,
                release: 3
            }
        }
    },
    lead: {
        type: 'lead',
        settings: {
            oscillator: {
                type: 'pulse',
                width: 0.3 // Default, can be modulated
            },
            envelope: {
                attack: 0.005,
                decay: 0.4,
                sustain: 0.6,
                release: 0.7,
                attackCurve: 'linear'
            },
            filter: {
                type: 'lowpass',
                frequency: 1200,
                rolloff: -24,
                Q: 1.5
            },
            filterEnvelope: {
                attack: 0.1,
                decay: 0.3,
                sustain: 0.5,
                release: 0.8,
                baseFrequency: 300,
                octaves: 4
            },
            vibrato: {
                maxDelay: 0.005,
                frequency: 5,
                depth: 0.1,
                type: 'sine'
            },
            portamento: 0.05,
            volume: -8
        }
    },
    plucks: {
        type: 'plucks',
        settings: {
            oscillator: { type: 'fmsquare' },
            envelope: {
                attack: 0.005,
                decay: 0.1,
                sustain: 0.1,
                release: 0.2
            }
        }
    },
    drums: {
        type: 'drums',
        settings: {
            kick: {
                pitchDecay: 0.05,
                octaves: 10,
                oscillator: { type: 'sine' },
                envelope: {
                    attack: 0.001,
                    decay: 0.4,
                    sustain: 0.01,
                    release: 1.4,
                    attackCurve: 'exponential'
                }
            },
            snare: {
                noise: { type: 'white' },
                envelope: {
                    attack: 0.005,
                    decay: 0.2,
                    sustain: 0.1,
                    release: 0.2
                }
            },
            hihat: {
                noise: { type: 'pink' },
                envelope: {
                    attack: 0.001,
                    decay: 0.05,
                    sustain: 0,
                    release: 0.1
                }
            }
        }
    },
    keys: {
        type: 'keys',
        settings: {
            oscillator: { type: 'fatsine' },
            envelope: {
                attack: 0.01,
                decay: 0.4,
                sustain: 0.6,
                release: 1.2
            }
        }
    },
    brass: {
        type: 'brass',
        settings: {
            oscillator: { type: 'sawtooth' },
            envelope: {
                attack: 0.1,
                decay: 0.2,
                sustain: 0.7,
                release: 0.8
            }
        }
    },
    percussion: {
        type: 'percussion',
        settings: {
             pitchDecay: 0.05,
             octaves: 6,
             oscillator: { type: 'sine' },
             envelope: {
                attack: 0.001,
                decay: 0.3,
                sustain: 0.01,
                release: 0.5
            }
        }
    },
    guitar: {
        type: 'guitar',
        settings: {
            oscillator: { type: 'fmsquare' },
            envelope: {
                attack: 0.005,
                decay: 0.5,
                sustain: 0.1,
                release: 1
            }
        }
    }
};

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
    'guitar': '#8B4513'
};