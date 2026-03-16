import * as Tone from 'tone';
import { TRACK_INSTRUMENTS, GENRE_PROFILES, GENRE_TO_PROFILE_MAP } from './config.js';

export class AudioEngine {
    constructor() {
        this.lowPower = this.detectLowPower();
        console.log(`%c Audio Engine Mode: ${this.lowPower ? 'LOW POWER (Optimized)' : 'HIGH PERFORMANCE'} `, 'background: #222; color: #bada55');
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
        this.parts = new Set(); // Χρήση Set για ευκολότερη διαχείριση μοναδικών Parts
        this.transportListener = null;

        // Ρυθμίσεις για αποφυγή stuttering
        // Το lookAhead 0.6 είναι "βράχος" για low-end συσκευές
        Tone.Transport.lookAhead = this.lowPower ? 0.6 : 0.4;
        Tone.Transport.updateInterval = this.lowPower ? 0.1 : 0.08;

        // --- AUDIO BUSSES ---
        this.wetBus = new Tone.Channel().toDestination(); 
        this.dryBus = new Tone.Channel().toDestination(); 

        // --- GLOBAL EFFECTS CHAIN ---
        // Limiter στην κορυφή για να μην "σπάσει" ποτέ ο ήχος στα ηχεία
        this.limiter = new Tone.Limiter(-2).toDestination();

        this.compressor = new Tone.Compressor({
            threshold: -16,
            ratio: 4,
            attack: 0.01,
            release: 0.2,
            knee: 10
        }).connect(this.limiter);

        this.dryBus.connect(this.compressor);

        if (!this.lowPower) {
            // High-quality Reverb μόνο αν έχουμε CPU "αέρα"
            this.reverb = new Tone.Reverb({ 
                decay: 2.5, 
                preDelay: 0.02,
                wet: 0.15 
            }); 

            this.delay = new Tone.PingPongDelay({ 
                delayTime: "8n", 
                feedback: 0.2,
                wet: 0.1 
            });
            
            this.wetBus.connect(this.delay);
            this.delay.connect(this.reverb);
            this.reverb.connect(this.compressor);
        } else {
            // Στο Low Power, το wet bus πάει κατευθείαν στον compressor (bypass effects)
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

            // CPU Optimizations: Απλοποίηση oscillators σε κινητά
            if (this.lowPower && finalSettings.oscillator?.type) {
                let type = finalSettings.oscillator.type;
                if (type.includes('fat')) type = type.replace('fat', '');
                finalSettings.oscillator.type = type;
                delete finalSettings.oscillator.count;
            }

            // Global Safety Envelopes (Anti-click/pop)
            if (!finalSettings.envelope) finalSettings.envelope = {};
            finalSettings.envelope.attack = Math.max(finalSettings.envelope.attack || 0, 0.01);
            finalSettings.envelope.release = Math.max(finalSettings.envelope.release || 0, 0.08);

            return finalSettings;
        };

        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            const settings = getGenreBasedSettings(trackType);
            const destination = (config.type === 'bass' || trackType === 'bassline') 
                ? this.dryBus 
                : this.wetBus;

            const mixVol = config.mixVolume !== undefined ? config.mixVolume : 0.6;
            const dbVolume = Tone.gainToDb(mixVol);

            try {
                const maxPolyphony = this.lowPower ? 4 : (config.maxPolyphony || 12);

                let instrument;
                if (config.type === 'bass' || config.type === 'lead') {
                    instrument = new Tone.MonoSynth(settings).connect(destination);
                } else {
                    instrument = new Tone.PolySynth(Tone.Synth, settings).set({
                        maxPolyphony: maxPolyphony,
                        voice: Tone.Synth // Force standard synth for stability
                    }).connect(destination);
                }

                instrument.volume.value = dbVolume;
                this.instruments.set(trackType, instrument);
            } catch (error) {
                console.error(`Failed to create ${trackType}:`, error);
            }
        });
    }

    playNotes(notes, now, trackType, totalDuration, shouldLoop = false) {
        if (!notes || notes.length === 0) return;
        const instrument = this.instruments.get(trackType);
        if (!instrument) return;

        const sortedNotes = [...notes].sort((a, b) => a.time - b.time);

        // ✅ Δημιουργία Part με αυτόματο disposal
        const part = new Tone.Part((time, event) => {
            try {
                instrument.triggerAttackRelease(event.note, event.duration, time, event.velocity);
            } catch(e) {
                // Ignore voice stealing logs
            }
        }, sortedNotes).start(now || 0);

        part.loop = shouldLoop;
        part.humanize = 0.005; // Μικρό jitter για φυσικότητα και αποφυγή phase cancellation
        
        const lastNoteEnd = sortedNotes[sortedNotes.length - 1].time + sortedNotes[sortedNotes.length - 1].duration;
        part.loopEnd = Math.max(totalDuration, lastNoteEnd + 0.1);

        // ✅ ΚΑΘΑΡΙΣΜΟΣ ΜΝΗΜΗΣ:
        // Προσθήκη στο Set
        this.parts.add(part);

        // Αν δεν λουπάρει, το πετάμε μόλις τελειώσει για να μην γεμίσει η RAM
        if (!shouldLoop) {
            part.on('end', () => {
                part.dispose();
                this.parts.delete(part);
            });
        }
    }

    stop() {
        this.parts.forEach(part => {
            part.stop();
            part.dispose();
        });
        this.parts.clear();
        
        Tone.Transport.stop();
        Tone.Transport.cancel();

        this.instruments.forEach(inst => {
            if (inst.releaseAll) inst.releaseAll();
        });
        this.isPlaying = false;
    }

    dispose() {
        this.stop();
        if (this.transportListener) Tone.Transport.off('stop', this.transportListener);
        this.instruments.forEach(inst => inst.dispose());
        this.instruments.clear();
        
        [this.reverb, this.delay, this.compressor, this.limiter, this.wetBus, this.dryBus].forEach(effect => {
            if (effect) effect.dispose();
        });
    }

    async start() {
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
        Tone.Transport.start('+0.1');
        this.isPlaying = true;
    }
}
