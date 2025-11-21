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

        // ✅ Βελτιστοποιημένα settings για κινητά
        if (this.lowPower) {
            Tone.Transport.lookAhead = 0.5;      // Μεγαλύτερο buffer
            Tone.Transport.updateInterval = 0.25; // Λιγότερες updates
        } else {
            Tone.Transport.lookAhead = 0.1;
            Tone.Transport.updateInterval = 0.05;
        }

        // ✅ Απλούστερος master output chain για low-power
        this.setupAudioChain();
        this.createInstruments();

        this.transportListener = () => {
            this.isPlaying = false;
        };
        Tone.Transport.on('stop', this.transportListener);
    }

    setupAudioChain() {
        if (this.lowPower) {
            // Minimal processing chain
            this.compressor = new Tone.Compressor({
                threshold: -20,
                ratio: 2,
                attack: 0.1,     // ↑ Πιο αργό
                release: 0.2,    // ↑ Πιο αργό
                knee: 8
            }).toDestination();

            this.mainOut = new Tone.Channel({ volume: -3 }).connect(this.compressor);
        } else {
            // Full processing chain
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
            const settings = getGenreBasedSettings(trackType);
            const destination = this.mainOut;

            try {
                switch (config.type) {
                    case 'bass':
                        // ✅ MonoSynth είναι πολύ πιο αποδοτικό
                        instrument = new Tone.MonoSynth(settings).connect(destination);
                        instrument.volume.value = this.lowPower ? -3 : -6;
                        break;
                    
                    case 'lead':
                        instrument = new Tone.MonoSynth(settings).connect(destination);
                        instrument.volume.value = this.lowPower ? -3 : -8;
                        instrument.portamento = this.lowPower ? 0.04 : 0.06;
                        break;
                    
                    case 'synth':
                        // ✅ Μειώστε maxPolyphony για κινητά
                        const maxPoly = this.lowPower ? 2 : (config.maxPolyphony || 4);
                        instrument = new Tone.PolySynth(Tone.Synth, {
                            ...settings,
                            maxPolyphony: maxPoly,
                            // Απλούστερο envelope για low-power
                            envelope: this.lowPower ? {
                                attack: 0.005,
                                decay: 0.1,
                                sustain: 0.1,
                                release: 0.05
                            } : settings.envelope
                        }).connect(destination);
                        instrument.volume.value = this.lowPower ? -5 : -10;
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
        // Καθαρίστε όλα τα parts
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

    // ✅ Καινούργιο: Culling κοντινών σημειώσεων
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

        // ✅ Cullνα κοντινές σημειώσεις σε low-power devices
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
            duration: Math.min(note.duration || 0.25, this.lowPower ? 0.5 : 1), // Cap duration
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

        // ✅ Περιορίστε ενεργά parts σε low-power devices
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
