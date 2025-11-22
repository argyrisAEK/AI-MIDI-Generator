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
        // Αν είναι κινητό ή έχει λιγότερους από 4 πυρήνες -> Low Power
        return isMobile || cores < 4;
    }

    initializeEngine() {
        this.instruments = new Map();
        this.isPlaying = false;
        this.parts = [];
        this.transportListener = null;

        // --- 1. ΒΕΛΤΙΣΤΟΠΟΙΗΣΗ SCHEDULING (Αυτό λειτουργεί δυναμικά) ---
        // Αυξάνουμε το lookAhead για να δώσουμε χρόνο στην CPU να προετοιμάσει τον ήχο
        Tone.Transport.lookAhead = this.lowPower ? 0.5 : 0.1; 
        
        // Μειώνουμε τη συχνότητα ανανέωσης για να γλιτώσουμε κύκλους επεξεργαστή
        Tone.Transport.updateInterval = this.lowPower ? 0.1 : 0.05; 

        // (ΑΦΑΙΡΕΘΗΚΕ Η ΕΝΤΟΛΗ latencyHint ΠΟΥ ΠΡΟΚΑΛΟΥΣΕ ΤΟ CRASH)

        // --- GLOBAL EFFECTS ---
        this.mainOut = new Tone.Channel();
        let outputNode = this.mainOut;

        // Προσθήκη Reverb/Delay ΜΟΝΟ αν έχουμε δυνατό υπολογιστή
        if (!this.lowPower) {
            this.reverb = new Tone.Reverb({ decay: 3.0, wet: 0.3 }).toDestination();
            this.delay = new Tone.PingPongDelay({ delayTime: "8n", wet: 0.15 });
            
            // Chain: Main -> Delay -> Reverb
            outputNode.connect(this.delay);
            outputNode = this.delay;
            outputNode.connect(this.reverb);
            outputNode = this.reverb;
        }

        // Compressor (πάντα χρήσιμος, αλλά με ελαφριές ρυθμίσεις)
        this.compressor = new Tone.Compressor({
            threshold: -20,
            ratio: 3,
            attack: 0.05,
            release: 0.1
        }).toDestination();

        outputNode.connect(this.compressor);

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

            // --- 2. ΑΓΡΙΑ ΒΕΛΤΙΣΤΟΠΟΙΗΣΗ ΓΙΑ LOW POWER ---
            if (this.lowPower) {
                // Απλοποίηση Oscillator: Fatsine -> Sine, PWM -> Square
                if (finalSettings.oscillator?.type) {
                    let type = finalSettings.oscillator.type;
                    if (type.includes('fat')) type = type.replace('fat', '');
                    if (type === 'pwm') type = 'square';
                    if (type === 'fmsquare') type = 'square';
                    finalSettings.oscillator.type = type;
                    
                    delete finalSettings.oscillator.count;
                    delete finalSettings.oscillator.spread;
                }

                // Μείωση Release time
                if (finalSettings.envelope) {
                    finalSettings.envelope.release = Math.min(finalSettings.envelope.release, 0.5);
                }
            }

            return finalSettings;
        };

        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            let instrument;
            const settings = getGenreBasedSettings(trackType);
            const destination = this.mainOut;

            try {
                // 3. ΜΕΙΩΣΗ ΠΟΛΥΦΩΝΙΑΣ
                const maxPolyphony = this.lowPower ? Math.min(config.maxPolyphony || 4, 2) : (config.maxPolyphony || 4);

                switch (config.type) {
                    case 'bass':
                    case 'lead':
                        instrument = new Tone.MonoSynth(settings).connect(destination);
                        instrument.volume.value = -6;
                        break;
                    
                    case 'synth':
                        instrument = new Tone.PolySynth(Tone.Synth, {
                            ...settings,
                            maxPolyphony: maxPolyphony 
                        }).connect(destination);
                        instrument.volume.value = -10;
                        break;
                    
                    default:
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

    dispose() {
        this.parts.forEach(part => part.dispose());
        this.parts = [];
        
        if (this.transportListener) Tone.Transport.off('stop', this.transportListener);

        this.instruments.forEach(inst => inst.dispose());
        this.instruments.clear();

        if (this.reverb) this.reverb.dispose();
        if (this.delay) this.delay.dispose();
        if (this.compressor) this.compressor.dispose();
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

    playNotes(notes, now, trackType, totalDuration) {
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

        part.loop = document.getElementById('play-mode')?.value === 'loop';
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
            else instrument.volume.value = -10;
        }
    }
}
