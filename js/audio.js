import * as Tone from 'tone';
import { TRACK_INSTRUMENTS, GENRE_PROFILES, GENRE_TO_PROFILE_MAP } from './config.js';

export class AudioEngine {
    constructor() {
        this.lowPower = this.detectLowPower();
        console.log(`Audio Engine Mode: ${this.lowPower ? 'LOW POWER (Optimized)' : 'HIGH PERFORMANCE'}`);
        this.initializeEngine();
    }

    detectLowPower() {
        const cores = navigator.hardwareConcurrency || 2;
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        return isMobile || cores < 4;
    }

    initializeEngine() {
        this.instruments = new Map();
        this.isPlaying = false;
        this.parts = [];
        // 🔥 FIX: Παρακολούθηση scheduled callbacks για καθαρισμό
        this.scheduledCallbacks = [];
        this.transportListener = null;

        // lookAhead + updateInterval
        Tone.Transport.lookAhead = this.lowPower ? 0.6 : 0.4;
        Tone.Transport.updateInterval = this.lowPower ? 0.1 : 0.08;

        // --- AUDIO BUSSES ---
        this.wetBus = new Tone.Channel(); 
        this.dryBus = new Tone.Channel(); 

        // --- GLOBAL EFFECTS CHAIN ---
        this.limiter = new Tone.Limiter(-3).toDestination();

        this.compressor = new Tone.Compressor({
            threshold: -14,
            ratio: 4,
            attack: 0.005,
            release: 0.15,
            knee: 6
        }).connect(this.limiter);

        this.dryBus.connect(this.compressor);

        if (!this.lowPower) {
            this.reverb = new Tone.Reverb({ 
                decay: 2.5, 
                preDelay: 0.01,
                wet: 0.2 
            }); 

            this.delay = new Tone.PingPongDelay({ 
                delayTime: "8n", 
                feedback: 0.2,
                wet: 0.15 
            });
            
            this.wetBus.connect(this.delay);
            this.delay.connect(this.reverb);
            this.reverb.connect(this.compressor);
        } else {
            this.wetBus.connect(this.compressor);
        }

        this.createInstruments();

        this.transportListener = () => { this.isPlaying = false; };
        Tone.Transport.on('stop', this.transportListener);
    }

    createInstruments() {
        const getGenreBasedSettings = (trackType) => {
            const style = document.getElementById('style')?.value?.toLowerCase() || 'house';
            const baseSettings = TRACK_INSTRUMENTS[trackType]?.settings || {};
            const profile = GENRE_TO_PROFILE_MAP[style] || GENRE_TO_PROFILE_MAP['default'];
            const specificSettings = GENRE_PROFILES[profile]?.[trackType] || {};

            const mergeDeep = (target, source) => {
                const output = { ...target };
                for (const key in source) {
                    if (source[key] instanceof Object && key in target)
                        Object.assign(output, { [key]: mergeDeep(target[key], source[key]) });
                    else
                        Object.assign(output, { [key]: source[key] });
                }
                return output;
            };

            let finalSettings = mergeDeep(baseSettings, specificSettings);

            // Low Power optimizations
            if (this.lowPower) {
                if (finalSettings.oscillator?.type) {
                    let type = finalSettings.oscillator.type;
                    if (type.includes('fat')) type = type.replace('fat', '');
                    if (type === 'pwm' || type === 'fmsquare') type = 'square';
                    finalSettings.oscillator.type = type;
                    delete finalSettings.oscillator.count;
                    delete finalSettings.oscillator.spread;
                }
                if (finalSettings.envelope) {
                    finalSettings.envelope.release = Math.min(finalSettings.envelope.release, 0.25);
                    if (finalSettings.envelope.attack < 0.008) {
                        finalSettings.envelope.attack = 0.008;
                    }
                }
            }

            // Global anti-pop
            if (finalSettings.envelope?.attack < 0.008) {
                finalSettings.envelope.attack = 0.008;
            }
            if (finalSettings.envelope?.release < 0.05) {
                finalSettings.envelope.release = 0.05;
            }

            return finalSettings;
        };

        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            let instrument;
            const settings = getGenreBasedSettings(trackType);
            
            const destination = (config.type === 'bass' || trackType === 'bassline') 
                ? this.dryBus 
                : this.wetBus;

            const mixVol = config.mixVolume !== undefined ? config.mixVolume : 0.6;
            const dbVolume = Tone.gainToDb(mixVol);

            try {
                // 🔥 FIX: Σωστό maxPolyphony με fallback
                const maxPolyphony = this.lowPower ? 
                    Math.min(config.maxPolyphony || 6, 4) : 
                    (config.maxPolyphony || 12);

                switch (config.type) {
                    case 'bass':
                    case 'lead':
                        instrument = new Tone.MonoSynth(settings).connect(destination);
                        instrument.volume.value = dbVolume;
                        break;
                    
                    case 'synth':
                        // 🔥 FIX: Σωστό PolySynth configuration - αφαίρεση του λάθος 'voice' property
                        instrument = new Tone.PolySynth(Tone.Synth, {
                            maxPolyphony: maxPolyphony,
                            ...settings
                        }).connect(destination);
                        instrument.volume.value = dbVolume;
                        break;
                    
                    default:
                        instrument = new Tone.PolySynth(Tone.Synth, {
                            maxPolyphony: maxPolyphony,
                            ...settings
                        }).connect(destination);
                        instrument.volume.value = dbVolume;
                        break;
                }

                if (instrument) {
                    this.instruments.set(trackType, instrument);
                }
            } catch (error) {
                console.warn(`Failed to create instrument for ${trackType}:`, error);
            }
        });
    }

    // 🔥 FIX: Νέα μέθοδος για ασφαλή ακύρωση όλων των scheduled callbacks
    clearScheduledCallbacks() {
        this.scheduledCallbacks.forEach(callbackId => {
            try {
                Tone.Transport.clear(callbackId);
            } catch (e) {
                // Ignore errors από ήδη εκτελεσμένα callbacks
            }
        });
        this.scheduledCallbacks = [];
    }

    dispose() {
        // 🔥 FIX: Καθαρισμός scheduled callbacks πρώτα
        this.clearScheduledCallbacks();
        
        // 🔥 FIX: Επιβεβλημένος καθαρισμός όλων των parts
        this.parts.forEach(part => {
            try {
                part.stop();
                part.dispose();
            } catch (e) {
                console.warn('Error disposing part:', e);
            }
        });
        this.parts = [];
        
        if (this.transportListener) {
            try {
                Tone.Transport.off('stop', this.transportListener);
            } catch (e) {
                console.warn('Error removing transport listener:', e);
            }
        }

        this.instruments.forEach(inst => {
            try {
                if (inst.releaseAll) inst.releaseAll();
                else if (inst.triggerRelease) inst.triggerRelease();
                inst.dispose();
            } catch (e) {
                console.warn('Error disposing instrument:', e);
            }
        });
        this.instruments.clear();

        if (this.reverb) {
            try { this.reverb.dispose(); } catch (e) {}
        }
        if (this.delay) {
            try { this.delay.dispose(); } catch (e) {}
        }
        if (this.compressor) {
            try { this.compressor.dispose(); } catch (e) {}
        }
        if (this.limiter) {
            try { this.limiter.dispose(); } catch (e) {}
        }
        
        if (this.wetBus) {
            try { this.wetBus.dispose(); } catch (e) {}
        }
        if (this.dryBus) {
            try { this.dryBus.dispose(); } catch (e) {}
        }

        try {
            Tone.Transport.stop();
            Tone.Transport.cancel();
        } catch (e) {
            console.warn('Error stopping transport:', e);
        }
    }

    async start() {
        await Tone.start();
        Tone.Transport.start('+0.1');
        this.isPlaying = true;
    }

    stop() {
        // 🔥 FIX: Καθαρισμός scheduled callbacks κατά το stop
        this.clearScheduledCallbacks();
        
        // 🔥 FIX: Επιθετικός καθαρισμός parts κατά το stop
        this.parts.forEach(part => {
            try {
                part.stop();
                part.dispose();
            } catch (e) {
                console.warn('Error stopping part:', e);
            }
        });
        this.parts = [];
        
        try {
            Tone.Transport.stop();
            Tone.Transport.cancel();
        } catch (e) {
            console.warn('Error stopping transport:', e);
        }

        this.instruments.forEach(inst => {
            try {
                if (inst.releaseAll) inst.releaseAll();
                else if (inst.triggerRelease) inst.triggerRelease();
            } catch (e) {
                console.warn('Error releasing instrument:', e);
            }
        });
        this.isPlaying = false;
    }

    playNotes(notes, now, trackType, totalDuration, shouldLoop = false) {
        if (!notes || notes.length === 0) return;
        const instrument = this.instruments.get(trackType);
        if (!instrument) return;

        // Sort notes by time
        const sortedNotes = [...notes].sort((a, b) => a.time - b.time);

        const noteEvents = sortedNotes.map(note => ({
            time: note.time,
            note: note.name,
            duration: note.duration,
            velocity: note.velocity
        }));

        // 🔥 FIX: Υπολογισμός loopEnd με ασφάλεια
        const lastNoteEnd = sortedNotes[sortedNotes.length - 1].time + sortedNotes[sortedNotes.length - 1].duration;
        const safeTotalDuration = Math.max(totalDuration, lastNoteEnd, 1); // Ελάχιστο 1 δευτερόλεπτο

        const part = new Tone.Part((time, event) => {
            try {
                instrument.triggerAttackRelease(event.note, event.duration, time, event.velocity);
            } catch(e) {
                console.warn(`[Audio] Voice overflow on ${trackType}, skipping note`);
            }
        }, noteEvents).start(0);

        part.loop = shouldLoop;
        part.humanize = 0.002;
        part.loopEnd = safeTotalDuration;
        
        this.parts.push(part);

        // 🔥 FIX: Αξιόπιστος καθαρισμός για non-looping parts
        if (!shouldLoop) {
            // Υπολογίζουμε πότε τελειώνει το part με ασφάλεια
            const partEndTime = safeTotalDuration + 0.5; // +0.5s buffer
            
            // Schedule το cleanup - αποθηκεύουμε το ID για ακύρωση αν χρειαστεί
            const cleanupCallbackId = Tone.Transport.scheduleOnce((time) => {
                // Βρίσκουμε το index του part (μπορεί να έχει αλλάξει αν προστέθηκαν άλλα)
                const index = this.parts.indexOf(part);
                if (index > -1) {
                    try {
                        part.stop();
                        part.dispose();
                        this.parts.splice(index, 1);
                    } catch (e) {
                        console.warn('Error in scheduled cleanup:', e);
                    }
                }
                // Καθαρίζουμε το ID από τη λίστα
                const callbackIndex = this.scheduledCallbacks.indexOf(cleanupCallbackId);
                if (callbackIndex > -1) {
                    this.scheduledCallbacks.splice(callbackIndex, 1);
                }
            }, `+${partEndTime}`);
            
            this.scheduledCallbacks.push(cleanupCallbackId);
        }
        
        // 🔥 FIX: Εναλλακτικός καθαρισμός μέσω Transport.stop event
        // Αν ο χρήστης πατήσει stop πριν το scheduled cleanup, καθαρίζουμε εδώ
        const stopCleanup = () => {
            const index = this.parts.indexOf(part);
            if (index > -1) {
                try {
                    part.dispose();
                    this.parts.splice(index, 1);
                } catch (e) {}
            }
            // Αφαιρούμε αυτόν τον listener
            Tone.Transport.off('stop', stopCleanup);
        };
        Tone.Transport.once('stop', stopCleanup);
    }
    
    setTrackVolume(trackType, volume) {
        const instrument = this.instruments.get(trackType);
        if (instrument) instrument.volume.value = Tone.gainToDb(volume);
    }

    setTrackMute(trackType, muted) {
        const instrument = this.instruments.get(trackType);
        if (instrument) {
            if (muted) {
                instrument._savedVolume = instrument.volume.value;
                instrument.volume.value = -Infinity;
            } else {
                if (instrument._savedVolume !== undefined) {
                    instrument.volume.value = instrument._savedVolume;
                } else {
                    const config = TRACK_INSTRUMENTS[trackType];
                    const mixVol = config?.mixVolume !== undefined ? config.mixVolume : 0.6;
                    instrument.volume.value = Tone.gainToDb(mixVol);
                }
            }
        }
    }
}
