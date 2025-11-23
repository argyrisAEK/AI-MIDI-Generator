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
        this.transportListener = null;

        Tone.Transport.lookAhead = this.lowPower ? 0.5 : 0.1; 
        Tone.Transport.updateInterval = this.lowPower ? 0.1 : 0.05; 

        // --- AUDIO BUSSES ---
        // Δημιουργούμε δύο "δρόμους" ήχου: έναν για εφέ (Wet) και έναν καθαρό (Dry)
        this.wetBus = new Tone.Channel(); // Πάει στα Delay/Reverb
        this.dryBus = new Tone.Channel(); // Πάει απευθείας στον Compressor

        // --- GLOBAL EFFECTS CHAIN ---
        // Compressor: Κοινός και για τα δύο busses για να "κολλάει" ο ήχος
        this.compressor = new Tone.Compressor({
            threshold: -20,
            ratio: 3,
            attack: 0.05,
            release: 0.1
        }).toDestination();

        // Σύνδεση Dry Bus -> Compressor
        this.dryBus.connect(this.compressor);

        // Conditional Effects (Μόνο αν δεν είμαστε σε Low Power)
        if (!this.lowPower) {
            // ✅ ΜΕΙΩΣΗ ΕΝΤΑΣΗΣ ΕΦΕ
            // Πιο διακριτικό Reverb
            this.reverb = new Tone.Reverb({ 
                decay: 2.0, // Μειώθηκε από 3.0
                preDelay: 0.01,
                wet: 0.15   // Μειώθηκε από 0.3 (πιο πίσω στη μίξη)
            }); 

            // Πιο διακριτικό Delay
            this.delay = new Tone.PingPongDelay({ 
                delayTime: "8n", 
                feedback: 0.2,
                wet: 0.1    // Μειώθηκε από 0.15
            });
            
            // Σύνδεση Wet Bus -> Delay -> Reverb -> Compressor
            // Σημείωση: Δεν κάνουμε .toDestination() στα εφέ, τα περνάμε από τον compressor
            this.wetBus.connect(this.delay);
            this.delay.connect(this.reverb);
            this.reverb.connect(this.compressor);
        } else {
            // Σε low power, το Wet Bus πάει απευθείας στον Compressor (χωρίς εφέ)
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
                    finalSettings.envelope.release = Math.min(finalSettings.envelope.release, 0.5);
                }
            }

            return finalSettings;
        };

        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            let instrument;
            const settings = getGenreBasedSettings(trackType);
            
            // ✅ ΛΟΓΙΚΗ ROUTING: 
            // Αν είναι μπάσο ('bass'), πήγαινε στο Dry Bus (χωρίς Reverb/Delay).
            // Όλα τα άλλα στο Wet Bus.
            const destination = (config.type === 'bass' || trackType === 'bassline') 
                ? this.dryBus 
                : this.wetBus;

            const mixVol = config.mixVolume !== undefined ? config.mixVolume : 0.7;
            const dbVolume = Tone.gainToDb(mixVol);

            try {
                const maxPolyphony = this.lowPower ? Math.min(config.maxPolyphony || 4, 2) : (config.maxPolyphony || 4);

                switch (config.type) {
                    case 'bass':
                    case 'lead':
                        instrument = new Tone.MonoSynth(settings).connect(destination);
                        instrument.volume.value = dbVolume;
                        break;
                    
                    case 'synth':
                        instrument = new Tone.PolySynth(Tone.Synth, {
                            ...settings,
                            maxPolyphony: maxPolyphony 
                        }).connect(destination);
                        instrument.volume.value = dbVolume;
                        break;
                    
                    default:
                        // Fallback για άγνωστους τύπους
                        instrument = new Tone.PolySynth(Tone.Synth, settings).connect(destination);
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

    dispose() {
        this.parts.forEach(part => part.dispose());
        this.parts = [];
        
        if (this.transportListener) Tone.Transport.off('stop', this.transportListener);

        this.instruments.forEach(inst => inst.dispose());
        this.instruments.clear();

        if (this.reverb) this.reverb.dispose();
        if (this.delay) this.delay.dispose();
        if (this.compressor) this.compressor.dispose();
        
        if (this.wetBus) this.wetBus.dispose();
        if (this.dryBus) this.dryBus.dispose();
        if (this.mainOut) this.mainOut.dispose();

        Tone.Transport.stop();
        Tone.Transport.cancel();
    }

    async start() {
        await Tone.start();
        Tone.Transport.start('+0.1');
        this.isPlaying = true;
    }

    stop() {
        this.parts.forEach(part => { part.stop(); part.dispose(); });
        this.parts = [];
        Tone.Transport.stop();
        
        this.instruments.forEach(inst => {
            if (inst.releaseAll) inst.releaseAll();
            else if (inst.triggerRelease) inst.triggerRelease();
        });
        this.isPlaying = false;
    }

    playNotes(notes, now, trackType, totalDuration, shouldLoop = false) {
        if (!notes || notes.length === 0) return;
        const instrument = this.instruments.get(trackType);
        if (!instrument) return;

        const noteEvents = notes.map(note => ({
            time: note.time,
            note: note.name,
            duration: note.duration,
            velocity: note.velocity
        }));

        const part = new Tone.Part((time, event) => {
            instrument.triggerAttackRelease(event.note, event.duration, time, event.velocity);
        }, noteEvents).start(0);

        part.loop = shouldLoop;
        part.loopEnd = totalDuration;
        
        this.parts.push(part);
    }
    
    setTrackVolume(trackType, volume) {
        const instrument = this.instruments.get(trackType);
        if (instrument) instrument.volume.value = Tone.gainToDb(volume * 2);
    }

    setTrackMute(trackType, muted) {
        const instrument = this.instruments.get(trackType);
        if (instrument) {
            if(muted) instrument.volume.value = -Infinity;
            else {
                const config = TRACK_INSTRUMENTS[trackType];
                const mixVol = config?.mixVolume !== undefined ? config.mixVolume : 0.7;
                instrument.volume.value = Tone.gainToDb(mixVol);
            }
        }
    }
}
