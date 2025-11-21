import * as Tone from 'tone';
import { TRACK_INSTRUMENTS, GENRE_PROFILES, GENRE_TO_PROFILE_MAP } from './config.js';

export class AudioEngine {
    constructor() {
        this.lowPower = this.detectLowPower();
        this.performanceMetrics = {
            activeNotes: 0,
            maxActiveNotes: this.lowPower ? 16 : 64,
            activeParts: 0
        };
        this.initializeEngine();
    }

    detectLowPower() {
        const cores = navigator.hardwareConcurrency || 2;
        const mem = navigator.deviceMemory || 2;
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        
        console.log(`Device: Cores=${cores}, Memory=${mem}GB, Mobile=${isMobile}`);
        return isMobile || cores <= 4 || mem <= 2;
    }

    initializeEngine() {
        this.instruments = new Map();
        this.isPlaying = false;
        this.parts = [];
        this.transportListener = null;
        this.activeNoteQueue = [];
        this.effects = [];  // Store effects for cleanup
        this.effectChains = new Map(); // ✅ Store effect chains per track

        // ✅ Βελτιστοποιημένα settings για κινητά
        if (this.lowPower) {
            Tone.Transport.lookAhead = 0.5;
            Tone.Transport.updateInterval = 0.25;
        } else {
            Tone.Transport.lookAhead = 0.1;
            Tone.Transport.updateInterval = 0.05;
        }

        this.setupAudioChain();
        this.createInstruments();

        this.transportListener = () => {
            this.isPlaying = false;
        };
        Tone.Transport.on('stop', this.transportListener);
    }

    setupAudioChain() {
        if (this.lowPower) {
            this.compressor = new Tone.Compressor({
                threshold: -20,
                ratio: 2,
                attack: 0.1,
                release: 0.2,
                knee: 8
            }).toDestination();

            this.mainOut = new Tone.Channel({ volume: -3 }).connect(this.compressor);
        } else {
            this.compressor = new Tone.Compressor({
                threshold: -24,
                ratio: 3,
                attack: 0.05,
                release: 0.1,
                knee: 10
            }).toDestination();

            this.mainOut = new Tone.Channel({ volume: -6 }).connect(this.compressor);
        }
    }

    // ✅ Create rich pad instrument with filters & modulation
    createPadSynth(trackType) {
        const maxPoly = this.lowPower ? 3 : 6;
        
        // Sawtooth wave for richness
        const synth = new Tone.PolySynth(Tone.Synth, {
            maxPolyphony: maxPoly,
            oscillator: {
                type: 'sawtooth',
                count: 2  // ✅ Layer 2 oscillators for thickness
            },
            envelope: {
                attack: this.lowPower ? 0.4 : 0.8,
                decay: 0.3,
                sustain: 0.9,
                release: this.lowPower ? 1.0 : 2.0
            }
        });

        // ✅ Add filter with envelope for movement
        const filter = new Tone.Filter({
            type: 'lowpass',
            frequency: this.lowPower ? 3000 : 4000,
            rolloff: -24
        });

        const filterEnv = new Tone.Envelope({
            attack: this.lowPower ? 0.3 : 0.6,
            decay: 0.4,
            sustain: 0.6,
            release: this.lowPower ? 1.2 : 2.0
        });

        // Connect filter envelope to cutoff frequency
        filterEnv.connect(filter.frequency);
        filterEnv.min = this.lowPower ? 1000 : 500;
        filterEnv.max = this.lowPower ? 3500 : 5000;

        synth.connect(filter);

        // ✅ Add effects chain for pads
        let output = filter;

        if (!this.lowPower) {
            // Chorus for width & modulation
            const chorus = new Tone.Chorus({
                frequency: 1.5,
                delayTime: 2.5,
                depth: 0.7,
                type: 'sine',
                spread: 180
            }).start();
            this.effects.push(chorus);
            filter.connect(chorus);

            // Reverb for space
            const reverb = new Tone.Reverb({
                decay: 3.5,
                preDelay: 0.008
            });
            this.effects.push(reverb);
            chorus.connect(reverb);
            output = reverb;
        } else {
            // Simple reverb for low-power
            const reverb = new Tone.Reverb({
                decay: 1.8,
                preDelay: 0.005
            });
            this.effects.push(reverb);
            filter.connect(reverb);
            output = reverb;
        }

        output.connect(this.mainOut);
        synth.volume.value = this.lowPower ? -5 : -8;

        // Store for trigger management
        synth._filterEnv = filterEnv;

        return synth;
    }

    // ✅ Create strings instrument
    createStringsSynth(trackType) {
        const maxPoly = this.lowPower ? 3 : 8;

        const synth = new Tone.PolySynth(Tone.Synth, {
            maxPolyphony: maxPoly,
            oscillator: {
                type: 'triangle',
                count: 3  // ✅ 3 detuned oscillators for string richness
            },
            envelope: {
                attack: this.lowPower ? 0.6 : 1.0,
                decay: 0.4,
                sustain: 0.8,
                release: this.lowPower ? 1.2 : 1.8
            }
        });

        // ✅ Filter with slow cutoff sweep
        const filter = new Tone.Filter({
            type: 'lowpass',
            frequency: this.lowPower ? 3500 : 4500,
            rolloff: -24
        });

        const filterEnv = new Tone.Envelope({
            attack: this.lowPower ? 0.5 : 0.8,
            decay: 0.3,
            sustain: 0.7,
            release: this.lowPower ? 1.0 : 1.5
        });

        filterEnv.connect(filter.frequency);
        filterEnv.min = this.lowPower ? 1500 : 1000;
        filterEnv.max = this.lowPower ? 4000 : 5500;

        synth.connect(filter);

        // ✅ Effects chain
        let output = filter;

        if (!this.lowPower) {
            // Chorus for violin-like vibrato
            const chorus = new Tone.Chorus({
                frequency: 1.2,
                delayTime: 3,
                depth: 0.8,
                type: 'sine',
                spread: 180
            }).start();
            this.effects.push(chorus);
            filter.connect(chorus);

            // Heavy reverb for orchestral space
            const reverb = new Tone.Reverb({
                decay: 4.0,
                preDelay: 0.015
            });
            this.effects.push(reverb);
            chorus.connect(reverb);
            output = reverb;
        } else {
            const reverb = new Tone.Reverb({
                decay: 2.2,
                preDelay: 0.01
            });
            this.effects.push(reverb);
            filter.connect(reverb);
            output = reverb;
        }

        output.connect(this.mainOut);
        synth.volume.value = this.lowPower ? -4 : -6;

        synth._filterEnv = filterEnv;
        return synth;
    }

    createInstruments() {
        const getGenreBasedSettings = (trackType) => {
            const style = document.getElementById('style')?.value?.toLowerCase() || 'house';
            const baseSettings = TRACK_INSTRUMENTS[trackType]?.settings || {};

            const profile = GENRE_TO_PROFILE_MAP[style] || GENRE_TO_PROFILE_MAP['default'];
            const specificSettings = GENRE_PROFILES[profile]?.[trackType] || {};

            const mergeDeep = (target, source) => {
                const output = { ...target };
                if (this.isObject(target) && this.isObject(source)) {
                    Object.keys(source).forEach(key => {
                        if (this.isObject(source[key])) {
                            if (!(key in target))
                                Object.assign(output, { [key]: source[key] });
                            else
                                output[key] = mergeDeep(target[key], source[key]);
                        } else {
                            Object.assign(output, { [key]: source[key] });
                        }
                    });
                }
                return output;
            };

            return mergeDeep(baseSettings, specificSettings);
        };

        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            let instrument;

            try {
                switch (config.type) {
                    case 'bass':
                        instrument = new Tone.MonoSynth({
                            oscillator: { type: 'sawtooth' },
                            envelope: {
                                attack: 0.005,
                                decay: 0.1,
                                sustain: 0.3,
                                release: 0.1
                            }
                        }).connect(this.mainOut);
                        instrument.volume.value = this.lowPower ? -3 : -6;
                        break;
                    
                    case 'lead':
                        instrument = new Tone.MonoSynth({
                            oscillator: { type: 'square' },
                            envelope: {
                                attack: 0.01,
                                decay: 0.1,
                                sustain: 0.4,
                                release: 0.05
                            }
                        }).connect(this.mainOut);
                        instrument.volume.value = this.lowPower ? -3 : -8;
                        instrument.portamento = this.lowPower ? 0.04 : 0.06;
                        break;
                    
                    case 'synth':
                        const maxPoly = this.lowPower ? 2 : 4;
                        instrument = new Tone.PolySynth(Tone.Synth, {
                            maxPolyphony: maxPoly,
                            oscillator: { type: 'square' },
                            envelope: this.lowPower ? {
                                attack: 0.005,
                                decay: 0.1,
                                sustain: 0.1,
                                release: 0.05
                            } : {
                                attack: 0.01,
                                decay: 0.15,
                                sustain: 0.2,
                                release: 0.1
                            }
                        }).connect(this.mainOut);
                        instrument.volume.value = this.lowPower ? -5 : -10;
                        break;
                    
                    case 'pad':
                        // ✅ Use custom pad synth
                        instrument = this.createPadSynth(trackType);
                        break;
                    
                    case 'strings':
                        // ✅ Use custom strings synth
                        instrument = this.createStringsSynth(trackType);
                        break;
                    
                    default:
                        console.warn(`Unknown track type: ${config.type}`);
                        return;
                }

                if (instrument) {
                    this.instruments.set(trackType, instrument);
                }
            } catch (error) {
                console.warn(`Failed to create instrument for ${trackType}:`, error);
            }
        });
    }

    isObject(item) {
        return item && typeof item === 'object' && !Array.isArray(item);
    }

    dispose() {
        this.parts.forEach(part => {
            try {
                part.stop(0);
                part.dispose();
            } catch (e) {
                console.warn('Error disposing part:', e);
            }
        });
        this.parts = [];
        this.activeNoteQueue = [];

        this.effectChains.forEach(chain => {
            try {
                if (chain.filterEnv && typeof chain.filterEnv.dispose === 'function') {
                    chain.filterEnv.dispose();
                }
            } catch (e) {
                console.warn('Error disposing filter envelope:', e);
            }
        });
        this.effectChains.clear();

        this.effects.forEach(effect => {
            try {
                if (effect && typeof effect.dispose === 'function') {
                    effect.dispose();
                }
            } catch (e) {
                console.warn('Error disposing effect:', e);
            }
        });
        this.effects = [];
        
        if (this.transportListener) {
            Tone.Transport.off('stop', this.transportListener);
            this.transportListener = null;
        }

        this.instruments.forEach((instrument) => {
            try {
                if (instrument && typeof instrument.dispose === 'function') {
                    instrument.dispose();
                }
            } catch (e) {
                console.warn('Error disposing instrument:', e);
            }
        });
        this.instruments.clear();

        try {
            Tone.Transport.stop();
            Tone.Transport.cancel();
        } catch (e) {
            console.warn('Error stopping transport:', e);
        }
        
        this.isPlaying = false;
        
        if (this.compressor) this.compressor.dispose();
        if (this.mainOut) this.mainOut.dispose();
    }

    async start() {
        await Tone.start();
        Tone.Transport.start('+0.1');
        this.isPlaying = true;
    }

    stop() {
        try {
            this.parts.forEach(part => {
                part.stop(0);
                part.dispose();
            });
            this.parts = [];
            this.activeNoteQueue = [];

            if (Tone.Transport.state !== 'stopped') {
                Tone.Transport.stop();
                Tone.Transport.position = 0;
            }

            this.instruments.forEach((instrument) => {
                try {
                    if (instrument instanceof Tone.MonoSynth) {
                        instrument.triggerRelease();
                    } else if (instrument.releaseAll) {
                        instrument.releaseAll();
                    }
                } catch (e) {
                    console.warn('Error releasing instrument:', e);
                }
            });
            
            this.isPlaying = false;
        } catch (error) {
            console.error('Error stopping playback:', error);
            this.isPlaying = false;
        }
    }

    cullNotes(notes, minTimeDelta = 0.01) {
        if (!this.lowPower || notes.length <= this.performanceMetrics.maxActiveNotes) {
            return notes;
        }

        const culled = [];
        let lastTime = -minTimeDelta;

        notes.forEach(note => {
            if (note.time - lastTime >= minTimeDelta) {
                culled.push(note);
                lastTime = note.time;
            }
        });

        console.log(`Culled notes: ${notes.length} → ${culled.length}`);
        return culled;
    }

    playNotes(notes, now, trackType = 'melody', totalDuration) {
        if (!notes || notes.length === 0) return;
        
        const validNotes = notes.filter(note => note && note.name && typeof note.time === 'number');
        if (validNotes.length === 0) return;
        
        validNotes.sort((a, b) => a.time - b.time);

        const finalNotes = this.cullNotes(validNotes);

        const instrument = this.instruments.get(trackType);
        if (!instrument) return;

        const loopEndDuration = totalDuration > 0 ? totalDuration : Math.max(...finalNotes.map(note => {
            const time = note.time || 0;
            const duration = note.duration || 0.25;
            return time + duration;
        }));
        
        const playMode = document.getElementById('play-mode')?.value || 'loop';

        const noteEvents = finalNotes.map(note => ({
            time: note.time || 0,
            name: note.name,
            midi: note.midi,
            duration: Math.min(note.duration || 0.25, this.lowPower ? 0.5 : 1),
            velocity: note.velocity || 0.7
        }));

        const part = new Tone.Part((time, note) => {
            if (typeof instrument.triggerAttackRelease === 'function') {
                try {
                    // ✅ Trigger filter envelope for pads/strings
                    if (instrument._filterEnv) {
                        instrument._filterEnv.triggerAttackRelease(note.duration, time);
                    }

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

        if (this.lowPower && this.parts.length > 8) {
            const oldestPart = this.parts.shift();
            oldestPart.stop(0);
            oldestPart.dispose();
        }
    }

    playNote(trackType, name, duration, velocity) {
        const instrument = this.instruments.get(trackType);
        if (instrument) {
            try {
                if (instrument._filterEnv) {
                    instrument._filterEnv.triggerAttackRelease(duration);
                }
                instrument.triggerAttackRelease(name, duration, undefined, velocity);
            } catch (e) {
                console.warn('Error playing note:', e);
            }
        }
    }

    setTrackVolume(trackType, volume) {
        const instrument = this.instruments.get(trackType);
        if (instrument) {
            try {
                instrument.volume.value = Tone.gainToDb(volume * 2);
            } catch (e) {
                console.warn('Error setting volume:', e);
            }
        }
    }

    setTrackMute(trackType, muted) {
        const instrument = this.instruments.get(trackType);
        if (instrument) {
            instrument.mute = muted;
        }
    }
}
