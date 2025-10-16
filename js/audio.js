import * as Tone from 'tone';
import { TRACK_INSTRUMENTS, GENRE_PROFILES, GENRE_TO_PROFILE_MAP } from './config.js';

export class AudioEngine {
    constructor() {
        this.lowPower = this.detectLowPower();
        this.initializeEngine();
    }

    detectLowPower() {
        const cores = navigator.hardwareConcurrency || 2;
        const mem = navigator.deviceMemory || 2;
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        return isMobile || cores <= 4 || mem <= 2;
    }

    initializeEngine() {
        this.instruments = new Map();
        this.trackEffects = new Map(); // Store effects for each track
        this.isPlaying = false;
        this.parts = [];
        this.transportListener = null;

        // Scheduling and latency tuning for stability on low-power devices
        // remove: write to read-only context.latencyHint
        Tone.Transport.lookAhead = this.lowPower ? 0.2 : 0.1;
        Tone.Transport.updateInterval = this.lowPower ? 0.1 : 0.05;

        // Setup effects chain with better configuration
        this.compressor = new Tone.Compressor({
            threshold: -24,
            ratio: 3,
            attack: 0.05,
            release: 0.1,
            knee: 10
        }).toDestination();

        // This is the main destination for all track chains
        this.mainOut = new Tone.Channel().connect(this.compressor);

        // Genre-specific synth presets
        const getGenreBasedSettings = (trackType) => {
            const style = document.getElementById('style')?.value?.toLowerCase() || 'house';
            const baseSettings = TRACK_INSTRUMENTS[trackType]?.settings || {};

            const profile = GENRE_TO_PROFILE_MAP[style] || GENRE_TO_PROFILE_MAP['default'];
            
            const specificSettings = GENRE_PROFILES[profile]?.[trackType] || {};

            // Deep merge base settings with specific profile settings
            const mergeDeep = (target, source) => {
                const output = { ...target };
                if (isObject(target) && isObject(source)) {
                    Object.keys(source).forEach(key => {
                        if (isObject(source[key])) {
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
            
            const isObject = (item) => (item && typeof item === 'object' && !Array.isArray(item));

            return mergeDeep(baseSettings, specificSettings);
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

            // Create effects chain for each track *before* creating instrument
            const trackEffects = this.createTrackEffects();
            this.trackEffects.set(trackType, trackEffects);

            // The end of this track's chain is the main output
            const destination = trackEffects.volume;

            switch (config.type) {
                case 'bass':
                    instrument = new Tone.MonoSynth(settings).connect(destination);
                    instrument.volume.value = -6;
                    break;
                case 'lead':
                    instrument = new Tone.MonoSynth(settings).connect(destination);
                    instrument.volume.value = -8;
                    break;
                case 'synth':
                    instrument = new Tone.PolySynth(Tone.Synth, {
                        ...settings,
                        maxPolyphony: 4
                    }).connect(destination);
                    instrument.volume.value = -10;
                    break;
                // Custom instrument cases (percussion, drums, fx-riser) removed for simplification.
            }

            if (instrument) {
                // Apply genre-specific effects if any
                if (['bass', 'lead', 'synth'].includes(config.type)) {
                    const effectsToChain = [];
                    if (settings.eq) {
                        const eq = new Tone.EQ3(settings.eq);
                        effectsToChain.push(eq);
                    }
                    if (settings.delay) {
                        const delay = new Tone.FeedbackDelay(settings.delay);
                        effectsToChain.push(delay);
                    }
                    if (effectsToChain.length > 0) {
                        instrument.chain(...effectsToChain, destination);
                    }
                }
                
                this.instruments.set(trackType, instrument);
            }
        });
    }

    createTrackEffects() {
        const chain = {
            volume: new Tone.Volume(0),
        };
    
        // Chain the effects together in the correct order
        // Dry signal path: Volume -> Main Out
        chain.volume.connect(this.mainOut);
    
        return chain;
    }

    setTrackVolume(trackType, volume) {
        const effects = this.trackEffects.get(trackType);
        if (effects?.volume) {
            effects.volume.volume.value = Tone.gainToDb(volume * 2); // Amplify range
        }
    }

    setTrackPan(trackType, pan) {
        const effects = this.trackEffects.get(trackType);
        if (effects?.panner) {
            effects.panner.pan.value = pan;
        }
    }

    setTrackReverb(trackType, reverb) {
        const effects = this.trackEffects.get(trackType);
        if (effects?.reverbSend) {
            effects.reverbSend.gain.value = reverb;
        }
    }

    setTrackDelay(trackType, delay) {
        const effects = this.trackEffects.get(trackType);
        if (effects?.delaySend) {
            effects.delaySend.gain.value = delay;
        }
    }

    setTrackHighpass(trackType, highpass) {
        const effects = this.trackEffects.get(trackType);
        if (effects?.highpass) {
            effects.highpass.frequency.value = 20 + (highpass * 980); // 20Hz to 1000Hz
        }
    }

    setTrackLowpass(trackType, lowpass) {
        const effects = this.trackEffects.get(trackType);
        if (effects?.lowpass) {
            effects.lowpass.frequency.value = 500 + (lowpass * 19500); // 500Hz to 20000Hz
        }
    }

    setTrackMute(trackType, muted) {
        const effects = this.trackEffects.get(trackType);
        if (effects?.volume) {
            effects.volume.mute = muted;
        }
    }

    setTrackOscillator(trackType, oscillatorType) {
        const instrument = this.instruments.get(trackType);
        if (instrument && (instrument instanceof Tone.PolySynth || instrument instanceof Tone.MonoSynth)) {
            instrument.set({
                oscillator: {
                    type: oscillatorType
                }
            });
        }
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
                    delete instrument.effects;
                }
                instrument.dispose();
            }
        });
        this.instruments.clear();

        // Dispose track effects
        this.trackEffects.forEach((effects) => {
            // Only volume node remains
            if (effects.volume && typeof effects.volume.dispose === 'function') {
                effects.volume.dispose();
            }
        });
        this.trackEffects.clear();

        Tone.Transport.stop();
        Tone.Transport.cancel();
        this.isPlaying = false;
        
        if (this.compressor) this.compressor.dispose();
        if (this.mainOut) this.mainOut.dispose();
    }

    async start() {
        await Tone.start();
        // Start transport with a small delay to allow time for scheduling and prevent audio glitches
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

            if (Tone.Transport.state !== 'stopped') {
                Tone.Transport.stop();
                Tone.Transport.position = 0;
            }

            this.instruments.forEach((instrument) => {
                // Only handle Tone.MonoSynth and Tone.PolySynth (which includes releaseAll)
                if (instrument instanceof Tone.MonoSynth) {
                    instrument.triggerRelease();
                } else if (instrument.releaseAll) {
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

       
        
        const part = new Tone.Part((time, note) => {
            if (typeof instrument.triggerAttackRelease === 'function') {
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
