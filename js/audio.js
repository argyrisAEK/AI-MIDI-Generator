import * as Tone from 'tone';
import { TRACK_INSTRUMENTS } from './config.js';

class DrumKit {
    constructor(settings, destination) {
        // Kick
        this.kick = new Tone.MembraneSynth({
            pitchDecay: 0.05,
            octaves: 10,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4, attackCurve: 'exponential' }
        }).connect(destination);
        this.kick.volume.value = -6;

        // Snare
        this.snare = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.2 }
        }).connect(destination);
        this.snare.volume.value = -8;

        // Hi-Hats
        this.hihatFilter = new Tone.Filter(8000, 'lowpass').connect(destination);
        
        this.closedHihat = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.1 }
        }).connect(this.hihatFilter);
        this.closedHihat.volume.value = -12;

        this.openHihat = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.4 }
        }).connect(this.hihatFilter);
        this.openHihat.volume.value = -12;

        // Toms
        this.tomHigh = new Tone.MembraneSynth({
            pitchDecay: 0.05, octaves: 4, oscillator: { type: 'triangle' },
            envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.5 }
        }).connect(destination);
        this.tomHigh.volume.value = -9;

        this.tomMid = new Tone.MembraneSynth({
            pitchDecay: 0.06, octaves: 3, oscillator: { type: 'triangle' },
            envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.5 }
        }).connect(destination);
        this.tomMid.volume.value = -9;

        this.tomLow = new Tone.MembraneSynth({
            pitchDecay: 0.07, octaves: 2, oscillator: { type: 'triangle' },
            envelope: { attack: 0.001, decay: 0.5, sustain: 0.01, release: 0.5 }
        }).connect(destination);
        this.tomLow.volume.value = -9;

        // Cymbals
        this.crash = new Tone.MetalSynth({
            frequency: 200, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
            envelope: { attack: 0.001, decay: 1.4, release: 0.4 }
        }).connect(destination);
        this.crash.volume.value = -10;

        this.ride = new Tone.MetalSynth({
            frequency: 300, harmonicity: 5.1, modulationIndex: 20, resonance: 4000, octaves: 1,
            envelope: { attack: 0.001, decay: 0.8, release: 0.2 }
        }).connect(destination);
        this.ride.volume.value = -14;
    }

    triggerAttackRelease(name, duration, time, velocity) {
        const midi = typeof name === 'string' ? Tone.Frequency(name).toMidi() : parseInt(name);
        
        // Ensure we have a valid time
        const triggerTime = time || Tone.now();
        const triggerDuration = Math.max(0.01, duration || 0.1);
        const triggerVelocity = Math.max(0.1, Math.min(1.0, velocity || 0.7));
        
        // GM Drum Map Inspired Logic
        switch (midi) {
            case 35: case 36: // Kick
                this.kick.triggerAttackRelease('C2', triggerDuration, triggerTime, triggerVelocity);
                break;
            case 37: case 39: // Side Stick, Clap
            case 38: case 40: // Snare
                this.snare.triggerAttackRelease(triggerDuration, triggerTime, triggerVelocity);
                break;
            case 41: case 43: // Low Tom
                this.tomLow.triggerAttackRelease('G3', triggerDuration, triggerTime, triggerVelocity);
                break;
            case 42: // Closed Hi-hat
                this.closedHihat.triggerAttackRelease(triggerDuration, triggerTime, triggerVelocity);
                break;
            case 44: // Pedal Hi-hat
                this.closedHihat.triggerAttackRelease(triggerDuration * 0.5, triggerTime, triggerVelocity * 0.8);
                break;
            case 45: case 47: // Mid Tom
                this.tomMid.triggerAttackRelease('C4', triggerDuration, triggerTime, triggerVelocity);
                break;
            case 46: // Open Hi-hat
                this.openHihat.triggerAttackRelease(triggerDuration, triggerTime, triggerVelocity);
                break;
            case 48: case 50: // High Tom
                this.tomHigh.triggerAttackRelease('F4', triggerDuration, triggerTime, triggerVelocity);
                break;
            case 49: case 57: // Crash Cymbal
                this.crash.triggerAttackRelease(triggerDuration, triggerTime, triggerVelocity);
                break;
            case 51: case 59: // Ride Cymbal
                this.ride.triggerAttackRelease(triggerDuration, triggerTime, triggerVelocity * 0.8);
                break;
            case 52: case 55: // China/Splash Cymbal
                this.crash.triggerAttackRelease(triggerDuration * 0.5, triggerTime, triggerVelocity * 0.9);
                break;
            default:
                // Fallback for other percussion
                this.closedHihat.triggerAttackRelease(triggerDuration, triggerTime, triggerVelocity * 0.6);
                break;
        }
    }

    releaseAll() {
        // Individual synths don't have releaseAll, but this maintains interface consistency
    }

    dispose() {
        if(this.kick) this.kick.dispose();
        if(this.snare) this.snare.dispose();
        if(this.closedHihat) this.closedHihat.dispose();
        if(this.openHihat) this.openHihat.dispose();
        if(this.hihatFilter) this.hihatFilter.dispose();
        if(this.tomHigh) this.tomHigh.dispose();
        if(this.tomMid) this.tomMid.dispose();
        if(this.tomLow) this.tomLow.dispose();
        if(this.crash) this.crash.dispose();
        if(this.ride) this.ride.dispose();
    }
}

class PercussionKit {
    constructor(destination) {
        const bongoSettings = {
            pitchDecay: 0.02,
            octaves: 2,
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.001, decay: 0.15, sustain: 0.01, release: 0.1 }
        };
        const congaSettings = {
            pitchDecay: 0.04,
            octaves: 3,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.002, decay: 0.25, sustain: 0.02, release: 0.2 }
        };
        const woodblockSettings = {
            pitchDecay: 0.005,
            octaves: 1,
            oscillator: { type: 'square' },
            envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 }
        };

        this.bongo = new Tone.MembraneSynth(bongoSettings).connect(destination);
        this.bongo.volume.value = -8;

        this.conga = new Tone.MembraneSynth(congaSettings).connect(destination);
        this.conga.volume.value = -7;
        
        this.woodblock = new Tone.MembraneSynth(woodblockSettings).connect(destination);
        this.woodblock.volume.value = -10;
    }

    triggerAttackRelease(name, duration, time, velocity) {
        const midi = typeof name === 'string' ? Tone.Frequency(name).toMidi() : parseInt(name);
        const triggerTime = time || Tone.now();
        const triggerDuration = Math.max(0.01, duration || 0.1);
        const triggerVelocity = Math.max(0.1, Math.min(1.0, velocity || 0.7));

        if (midi >= 76) { // High percussion (Bongo high, woodblock)
            this.bongo.triggerAttackRelease(name, triggerDuration, triggerTime, triggerVelocity);
        } else if (midi >= 60) { // Mid percussion (Conga, bongo low)
            this.conga.triggerAttackRelease(name, triggerDuration, triggerTime, triggerVelocity);
        } else { // Low percussion (Tumba-like)
            this.woodblock.triggerAttackRelease(name, triggerDuration, triggerTime, triggerVelocity * 0.9);
        }
    }
    
    releaseAll() {}

    dispose() {
        if (this.bongo) this.bongo.dispose();
        if (this.conga) this.conga.dispose();
        if (this.woodblock) this.woodblock.dispose();
    }
}

export class AudioEngine {
    constructor() {
        this.initializeEngine();
    }

    initializeEngine() {
        this.instruments = new Map();
        this.isPlaying = false;
        this.parts = [];
        this.transportListener = null;

        // Setup effects chain with better configuration
        this.reverb = new Tone.Reverb({
            decay: 1.5,
            wet: 0.2,
            preDelay: 0.01
        }).toDestination();

        this.compressor = new Tone.Compressor({
            threshold: -24,
            ratio: 3,
            attack: 0.05,
            release: 0.1,
            knee: 10
        }).connect(this.reverb);

        // Genre-specific synth presets
        const getGenreBasedSettings = (trackType) => {
            const style = document.getElementById('style')?.value?.toLowerCase() || 'house';
            const baseSettings = TRACK_INSTRUMENTS[trackType]?.settings || {};

            const genrePresets = {
                house: {
                    bassline: {
                        oscillator: { type: 'triangle4' },
                        envelope: { attack: 0.05, decay: 0.2, sustain: 0.8, release: 0.5 },
                        filter: { Q: 2, type: 'lowpass', rolloff: -24, frequency: 800 }
                    },
                    lead: { // House Lead
                        oscillator: { type: 'square8' },
                        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.4 },
                        portamento: 0.01
                    },
                    plucks: {
                        oscillator: { type: 'triangle' },
                        envelope: { attack: 0.001, decay: 0.1, sustain: 0.1, release: 0.2 }
                    },
                    arpeggio: { // House Arp
                        oscillator: { type: 'fmsquare', modulationType: 'sawtooth' },
                        envelope: { attack: 0.005, decay: 0.1, sustain: 0.1, release: 0.15 }
                    }
                },
                techno: {
                    bassline: {
                        oscillator: { type: 'sawtooth4' },
                        envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.2 },
                        filter: { Q: 4, type: 'lowpass', rolloff: -24, frequency: 500 }
                    },
                    lead: { // Techno Lead
                        oscillator: { type: 'square8' },
                        envelope: { attack: 0.01, decay: 0.1, sustain: 0.4, release: 0.3 },
                        portamento: 0.02
                    }
                },
                trance: {
                    bassline: {
                        oscillator: { type: 'sawtooth4' },
                        envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 },
                        filter: { Q: 3, type: 'lowpass', rolloff: -24, frequency: 600 }
                    },
                    lead: { // Trance Lead (Supersaw)
                        oscillator: { type: 'supersaw', count: 8, spread: 50 },
                        envelope: { attack: 0.3, decay: 0.5, sustain: 0.7, release: 1.5 },
                        filter: { type: 'notch', frequency: 1200, Q: 4 },
                        portamento: 0.08
                    },
                    arpeggio: { // Trance Arp
                         oscillator: { type: 'pulse', width: 0.7 },
                         envelope: { attack: 0.005, decay: 0.1, sustain: 0.1, release: 0.15 },
                         filter: { type: 'highpass', frequency: 200, Q: 1.5 },
                         filterEnvelope: { attack: 0.01, decay: 0.2, baseFrequency: 800, octaves: 2 }
                    },
                    chord: { // for pads
                        oscillator: { type: 'fatsine' },
                        envelope: { attack: 0.8, decay: 1.5, sustain: 0.8, release: 2.5 }
                    }
                },
                trap: {
                    bassline: {
                        oscillator: { type: 'sine' },
                        envelope: { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.8 },
                        filter: { Q: 1, type: 'lowpass', rolloff: -24, frequency: 100 }
                    },
                    plucks: {
                        oscillator: { type: 'triangle' },
                        envelope: { attack: 0.001, decay: 0.05, sustain: 0.05, release: 0.1 }
                    }
                },
                rock: {
                    lead: {
                        oscillator: { type: 'sawtooth8' },
                        envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.4 }
                    },
                    chord: {
                        oscillator: { type: 'square4' },
                        envelope: { attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.8 }
                    }
                },
                jazz: {
                    chord: {
                        oscillator: { type: 'triangle8' },
                        envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 1.2 }
                    },
                    lead: {
                        oscillator: { type: 'sine8' },
                        envelope: { attack: 0.02, decay: 0.2, sustain: 0.7, release: 1 }
                    }
                },
                'drum-and-bass': {
                    bassline: {
                        oscillator: { type: 'fatsawtooth' },
                        envelope: { attack: 0.02, decay: 0.4, sustain: 0.4, release: 0.8 },
                        filter: { Q: 5, type: 'lowpass', rolloff: -24, frequency: 600 }
                    },
                    lead: {
                        oscillator: { type: 'square4' },
                        envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 }
                    }
                },
                synthwave: {
                    bassline: {
                        oscillator: { type: 'pulse', width: 0.6 },
                        envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.4 },
                        filter: { Q: 2, type: 'lowpass', rolloff: -12, frequency: 1200 }
                    },
                    arpeggio: { // Synthwave Arp
                        oscillator: { type: 'pwm', modulationFrequency: 0.7 },
                        filter: { type: 'highpass', frequency: 400, rolloff: -12 },
                        envelope: { attack: 0.005, decay: 0.1, sustain: 0.1, release: 0.15 },
                        effects: ['chorus'] // Special flag for effect
                    },
                    lead: { // Synthwave Lead
                        oscillator: { type: 'pulse', width: 0.4 },
                        envelope: { attack: 0.01, decay: 0.4, sustain: 0.5, release: 0.6 },
                        portamento: 0.04
                    },
                    chord: { // Pad
                        oscillator: { type: 'fatsawtooth', count: 6 },
                        envelope: { attack: 0.4, decay: 0.8, sustain: 0.7, release: 2.0 }
                    }
                },
                downtempo: {
                    bassline: {
                        oscillator: { type: 'sine' },
                        envelope: { attack: 0.05, decay: 0.5, sustain: 0.6, release: 1.0 },
                        filter: { Q: 1, type: 'lowpass', rolloff: -24, frequency: 300 }
                    },
                    keys: {
                        oscillator: { type: 'fatsine', count: 4 },
                        envelope: { attack: 0.1, decay: 0.8, sustain: 0.4, release: 1.5 }
                    },
                     chord: { // Pad
                        oscillator: { type: 'triangle' },
                        envelope: { attack: 1.2, decay: 2.0, sustain: 0.8, release: 3.0 }
                    }
                },
                'progressive-rock': {
                    lead: {
                        oscillator: { type: 'sawtooth', width: 0.7 },
                        envelope: { attack: 0.01, decay: 0.5, sustain: 0.6, release: 0.8 }
                    },
                    keys: { // For organ-like sounds
                        oscillator: { type: 'fmsquare', modulationType: 'sine' },
                        envelope: { attack: 0.05, decay: 0.3, sustain: 0.8, release: 1.0 }
                    },
                    bassline: {
                         oscillator: { type: 'triangle' },
                         envelope: { attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.4 }
                    }
                }
            };

            return {
                ...baseSettings,
                ...(genrePresets[style]?.[trackType] || {})
            };
        };
        
        this.createInstruments(getGenreBasedSettings);

        this.transportListener = () => {
            this.isPlaying = false;
        };
        Tone.Transport.on('stop', this.transportListener);
    }

    createInstruments(getGenreBasedSettings) {
        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            let instrument;
            const settings = getGenreBasedSettings(trackType);

            switch (config.type) {
                case 'drums':
                    instrument = new DrumKit(settings, this.compressor);
                    break;
                case 'bass':
                    instrument = new Tone.MonoSynth({
                        ...settings,
                        filterEnvelope: {
                            attack: 0.05,
                            decay: 0.2,
                            sustain: 0.5,
                            release: 0.5,
                            baseFrequency: 200,
                            octaves: 2
                        }
                    }).connect(this.compressor);
                    instrument.volume.value = -6;
                    break;
                case 'lead':
                    instrument = new Tone.MonoSynth(settings).connect(this.compressor);
                    instrument.volume.value = settings.volume || -8;
                    break;
                case 'arpeggio':
                    instrument = new Tone.PolySynth(Tone.Synth, {
                        ...settings,
                        maxPolyphony: 8
                    });

                    if (settings.effects?.includes('chorus')) {
                        const chorus = new Tone.Chorus(4, 2.5, 0.5).start();
                        instrument.chain(chorus, this.compressor);
                    } else {
                        instrument.connect(this.compressor);
                    }
                    break;
                case 'piano':
                case 'pad':
                case 'synth':
                case 'strings':
                case 'plucks':
                case 'guitar':
                    instrument = new Tone.PolySynth(Tone.Synth, {
                        ...settings,
                        maxPolyphony: 16,
                    }).connect(this.compressor);
                    
                    // Adjust volume based on track type
                    const volumeMap = {
                        piano: -8,
                        pad: -12,
                        synth: -10,
                        strings: -9,
                        plucks: -6,
                        guitar: -9
                    };
                    instrument.volume.value = volumeMap[config.type] || -8;
                    break;
                case 'keys':
                    instrument = new Tone.PolySynth(Tone.Synth, {
                        ...settings,
                        maxPolyphony: 8,
                    }).connect(this.compressor);
                    instrument.volume.value = -7;
                    break;
                case 'brass':
                    instrument = new Tone.PolySynth(Tone.Synth, {
                        ...settings,
                        maxPolyphony: 8,
                    }).connect(this.compressor);
                    instrument.volume.value = -9;
                    break;
                case 'percussion':
                     instrument = new PercussionKit(this.compressor);
                    break;
            }
            if (instrument) {
                this.instruments.set(trackType, instrument);
            }
        });
    }

    dispose() {
        this.parts.forEach(part => part.dispose());
        this.parts = [];
        
        if (this.transportListener) {
            Tone.Transport.off('stop', this.transportListener);
            this.transportListener = null;
        }

        this.instruments.forEach((instrument) => {
            if (instrument && typeof instrument.dispose === 'function') {
                // If the instrument has an effects chain, dispose it properly.
                if (instrument.effects) {
                    instrument.effects.forEach(effect => effect.dispose());
                }
                instrument.dispose();
            }
        });
        this.instruments.clear();

        Tone.Transport.stop();
        Tone.Transport.cancel();
        this.isPlaying = false;
        
        if (this.reverb) this.reverb.dispose();
        if (this.compressor) this.compressor.dispose();
    }

    async start() {
        await Tone.start();
        Tone.Transport.start();
        this.isPlaying = true;
    }

    stop() {
        try {
            this.parts.forEach(part => {
                part.stop(0);
                part.dispose();
            });
            this.parts = [];

            if (Tone.Transport.state !== 'stopped') {
                Tone.Transport.stop();
                Tone.Transport.position = 0;
            }

            this.instruments.forEach((instrument) => {
                if (instrument instanceof Tone.MonoSynth) {
                    instrument.triggerRelease();
                } else if (instrument && typeof instrument.releaseAll === 'function') {
                    instrument.releaseAll();
                }
            });
            
            this.isPlaying = false;
        } catch (error) {
            console.error('Error stopping playback:', error);
            this.isPlaying = false;
        }
    }

    playNotes(notes, now, trackType = 'melody', totalDuration) {
        if (!notes || notes.length === 0) return;
        
        // Filter out invalid notes and sort by time
        const validNotes = notes.filter(note => note && note.name && typeof note.time === 'number');
        if (validNotes.length === 0) return;
        
        validNotes.sort((a, b) => a.time - b.time);
        const instrument = this.instruments.get(trackType);
        if (!instrument) return;

        const loopEndDuration = totalDuration > 0 ? totalDuration : Math.max(...validNotes.map(note => {
            const time = note.time || 0;
            const duration = note.duration || 0.25;
            return time + duration;
        }));
        
        const playMode = document.getElementById('play-mode')?.value || 'loop';

        let noteEvents = validNotes.map(note => ({
            time: note.time || 0,
            name: note.name,
            midi: note.midi,
            duration: note.duration || 0.25,
            velocity: note.velocity || 0.7
        }));


        if (trackType === 'drums') {
            // Group drum notes by their MIDI number for parallel playback safety
            // and make sure no events scheduled at the *same* time for NoiseSynth (snare/hihat)
            const minSpacing = 0.002; // 2ms minimum spacing
            let lastTimePerDrum = {};
            noteEvents = noteEvents.map(ev => {
                let key = ev.midi;
                if (!(key in lastTimePerDrum)) lastTimePerDrum[key] = -100;
                if (ev.time <= lastTimePerDrum[key] + minSpacing) {
                    ev.time = lastTimePerDrum[key] + minSpacing;
                }
                lastTimePerDrum[key] = ev.time;
                return ev;
            }).sort((a, b) => a.time - b.time);
        }
        
        const part = new Tone.Part((time, note) => {
            if (instrument instanceof Tone.MonoSynth) {
                // Handle MonoSynth with velocity sensitivity and round-robin
                const vel = note.velocity;
                const filterFreq = 300 + (3000 * vel); // Brighter sound for higher velocity
                const vibratoDepth = 0.05 + (0.15 * vel); // More vibrato for higher velocity
                
                // Batch parameter updates
                instrument.set({
                    'filter.frequency': filterFreq,
                    'vibrato.depth': vibratoDepth
                });
                instrument.triggerAttackRelease(note.name, note.duration, time, note.velocity);

            } else if (typeof instrument.triggerAttackRelease === 'function') {
                try {
                    instrument.triggerAttackRelease(
                        note.name,
                        note.duration,
                        time,
                        note.velocity
                    );
                } catch (error) {
                    console.warn(`Failed to trigger note for ${trackType}:`, error);
                }
            }
        }, noteEvents).start(0);

        part.loopEnd = Math.max(loopEndDuration, 1);
        part.loop = playMode === 'loop';

        this.parts.push(part);
    }

    playNote(trackType, name, duration, velocity) {
        const instrument = this.instruments.get(trackType);
        if (instrument) {
            instrument.triggerAttackRelease(name, duration, undefined, velocity);
        }
    }
}