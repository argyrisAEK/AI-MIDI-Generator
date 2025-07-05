import * as Tone from 'tone';
import { TRACK_INSTRUMENTS } from './config.js';

class DrumKit {
    constructor(settings, destination) {
        // Create individual drum sounds to avoid timing conflicts
        this.kick = new Tone.MembraneSynth({
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
        }).connect(destination);
        this.kick.volume.value = -6;

        this.snare = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: {
                attack: 0.005,
                decay: 0.2,
                sustain: 0.1,
                release: 0.2
            }
        }).connect(destination);
        this.snare.volume.value = -8;

        this.hihat = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: {
                attack: 0.001,
                decay: 0.05,
                sustain: 0,
                release: 0.1
            }
        }).connect(destination);
        this.hihat.volume.value = -12;

        // Add a low-pass filter for hi-hats to make them sound more realistic
        this.hihatFilter = new Tone.Filter(8000, 'lowpass').connect(destination);
        this.hihat.disconnect();
        this.hihat.connect(this.hihatFilter);
    }

    triggerAttackRelease(name, duration, time, velocity) {
        const midi = typeof name === 'string' ? Tone.Frequency(name).toMidi() : parseInt(name);
        
        // Ensure we have a valid time
        const triggerTime = time || Tone.now();
        const triggerDuration = Math.max(0.01, duration || 0.1);
        const triggerVelocity = Math.max(0.1, Math.min(1.0, velocity || 0.7));
        
        // Map MIDI notes to drum sounds
        if (midi >= 35 && midi <= 37) { // Kick drums (B1 to C#2)
            this.kick.triggerAttackRelease('C2', triggerDuration, triggerTime, triggerVelocity);
        } 
        else if (midi >= 38 && midi <= 40) { // Snare drums (D2 to E2)
            this.snare.triggerAttackRelease(triggerDuration, triggerTime, triggerVelocity);
        } 
        else if (midi >= 41 && midi <= 47) { // Hi-hats and cymbals (F2 to B2)
            this.hihat.triggerAttackRelease(triggerDuration, triggerTime, triggerVelocity * 0.8);
        }
        else {
            // Default to hi-hat for unknown drum sounds
            this.hihat.triggerAttackRelease(triggerDuration, triggerTime, triggerVelocity * 0.6);
        }
    }

    releaseAll() {
        // Individual synths don't have releaseAll, but this maintains interface consistency
    }

    dispose() {
        if(this.kick) this.kick.dispose();
        if(this.snare) this.snare.dispose();
        if(this.hihat) this.hihat.dispose();
        if(this.hihatFilter) this.hihatFilter.dispose();
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
                    melody: {
                        oscillator: { type: 'sawtooth8' },
                        envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.8 }
                    },
                    lead: {
                        oscillator: { type: 'square8' },
                        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.4 }
                    },
                    plucks: {
                        oscillator: { type: 'triangle' },
                        envelope: { attack: 0.001, decay: 0.1, sustain: 0.1, release: 0.2 }
                    }
                },
                techno: {
                    bassline: {
                        oscillator: { type: 'sawtooth4' },
                        envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.2 },
                        filter: { Q: 4, type: 'lowpass', rolloff: -24, frequency: 500 }
                    },
                    lead: {
                        oscillator: { type: 'square8' },
                        envelope: { attack: 0.01, decay: 0.1, sustain: 0.4, release: 0.3 }
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
                }
            };

            return {
                ...baseSettings,
                ...(genrePresets[style]?.[trackType] || {})
            };
        };
        
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
                case 'piano':
                case 'pad':
                case 'synth':
                case 'strings':
                case 'lead':
                case 'plucks':
                    instrument = new Tone.PolySynth(Tone.Synth, {
                        ...settings,
                        polyphony: 16,
                        voice: Tone.Synth
                    }).connect(this.compressor);
                    
                    // Adjust volume based on track type
                    const volumeMap = {
                        piano: -8,
                        pad: -12,
                        synth: -10,
                        strings: -9,
                        lead: -8,
                        plucks: -6
                    };
                    instrument.volume.value = volumeMap[config.type] || -8;
                    break;
            }
            if (instrument) {
                this.instruments.set(trackType, instrument);
            }
        });

        this.transportListener = () => {
            this.isPlaying = false;
        };
        Tone.Transport.on('stop', this.transportListener);
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
                if (instrument && typeof instrument.releaseAll === 'function') {
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

        // For drums, ensure minimum time spacing and separate voices for overlapping events
        let noteEvents = validNotes.map(note => ({
            time: note.time || 0,
            name: note.name,
            duration: note.duration || 0.25,
            velocity: note.velocity || 0.7
        }));

        if (trackType === 'drums') {
            // Group drum notes by their MIDI number for parallel playback safety
            // and make sure no events scheduled at the *same* time for NoiseSynth (snare/hihat)
            // Sort by time first (already sorted)
            const minSpacing = 0.002; // 2ms minimum spacing (a bit bigger for safety)

            // Split into (time, midi) events to check for collisions
            // We'll group events with the same time per drum type and gently offset if collisions
            let lastTimePerDrum = {};
            noteEvents = noteEvents.map(ev => {
                // Identify group by MIDI
                let midi = typeof ev.name === 'string' ? Tone.Frequency(ev.name).toMidi() : parseInt(ev.name);
                // If two hits on the same drum at the same time, offset by minSpacing
                let key = midi;
                if (!(key in lastTimePerDrum)) lastTimePerDrum[key] = -100;
                if (ev.time <= lastTimePerDrum[key] + minSpacing) {
                    ev.time = lastTimePerDrum[key] + minSpacing;
                }
                lastTimePerDrum[key] = ev.time;
                return ev;
            });
            // Re-sort after possible adjustments
            noteEvents.sort((a, b) => a.time - b.time);
        }

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