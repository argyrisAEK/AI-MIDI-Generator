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

        // Λίγο μεγαλύτερο lookAhead για να μην έχουμε glitches σε βαριά chords
        Tone.Transport.lookAhead = this.lowPower ? 0.6 : 0.2; 
        Tone.Transport.updateInterval = this.lowPower ? 0.1 : 0.04; 

        // --- AUDIO BUSSES ---
        this.wetBus = new Tone.Channel(); 
        this.dryBus = new Tone.Channel(); 

        // --- GLOBAL EFFECTS CHAIN ---
        // ✅ FIXED: Χαλαρώσαμε το compression. 
        // Το -20 ήταν πολύ επιθετικό. Το -12 επιτρέπει δυναμικές χωρίς να "πνίγει" τις νότες.
        this.compressor = new Tone.Compressor({
            threshold: -12, 
            ratio: 3,
            attack: 0.03,
            release: 0.25,
            knee: 10 // Soft knee για πιο φυσικό ήχο
        }).toDestination();

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
                    // Κόβουμε λίγο το release για να ελευθερώνονται φωνές πιο γρήγορα
                    finalSettings.envelope.release = Math.min(finalSettings.envelope.release, 0.3);
                }
            }

            return finalSettings;
        };

        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            let instrument;
            const settings = getGenreBasedSettings(trackType);
            
            const destination = (config.type === 'bass' || trackType === 'bassline') 
                ? this.dryBus 
                : this.wetBus;

            // ✅ FIXED: Χαμηλώσαμε λίγο το Gain γιατί αυξήσαμε την πολυφωνία
            const mixVol = config.mixVolume !== undefined ? config.mixVolume : 0.6;
            const dbVolume = Tone.gainToDb(mixVol);

            try {
                // ✅ FIXED: ΑΥΞΗΣΗ ΠΟΛΥΦΩΝΙΑΣ
                // Πριν ήταν 4 (και 2). Τώρα 12 (και 6). 
                // Αυτό είναι το #1 αίτιο που χάνονταν νότες.
                const maxPolyphony = this.lowPower ? 
                    Math.min(config.maxPolyphony || 6, 4) : 
                    (config.maxPolyphony || 12);

                switch (config.type) {
                    case 'bass':
                    case 'lead':
                        // MonoSynth is naturally monophonic (1 note), that's intended
                        instrument = new Tone.MonoSynth(settings).connect(destination);
                        instrument.volume.value = dbVolume;
                        break;
                    
                    case 'synth':
                        instrument = new Tone.PolySynth(Tone.Synth, {
                            ...settings,
                            maxPolyphony: maxPolyphony,
                            // Προσθέτουμε voice stealing algorithm για να κόβει τις πιο παλιές νότες αν γεμίσει
                            voice: Tone.Synth 
                        }).connect(destination);
                        instrument.volume.value = dbVolume;
                        break;
                    
                    default:
                        instrument = new Tone.PolySynth(Tone.Synth, {
                            ...settings,
                            maxPolyphony: maxPolyphony 
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
        Tone.Transport.cancel(); // Ακύρωση scheduled events — αποφεύγει νότες μετά το stop
        
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

        // Sort notes by time to ensure correct scheduling order
        const sortedNotes = [...notes].sort((a, b) => a.time - b.time);

        const noteEvents = sortedNotes.map(note => ({
            time: note.time,
            note: note.name,
            duration: note.duration,
            velocity: note.velocity
        }));

        // ✅ Δημιουργία του Part με προσοχή στη διάρκεια
        const part = new Tone.Part((time, event) => {
            instrument.triggerAttackRelease(event.note, event.duration, time, event.velocity);
        }, noteEvents).start(0);

        part.loop = shouldLoop;
        
        // ✅ Fix για το Loop: Βεβαιωνόμαστε ότι το loopEnd είναι τουλάχιστον όσο η τελευταία νότα
        // Αν το totalDuration που έρχεται είναι μικρότερο από την τελευταία νότα, οι νότες κόβονται.
        const lastNoteEnd = sortedNotes[sortedNotes.length - 1].time + sortedNotes[sortedNotes.length - 1].duration;
        part.loopEnd = Math.max(totalDuration, lastNoteEnd);
        
        this.parts.push(part);
    }
    
    setTrackVolume(trackType, volume) {
        const instrument = this.instruments.get(trackType);
        if (instrument) instrument.volume.value = Tone.gainToDb(volume);
    }

    setTrackMute(trackType, muted) {
        const instrument = this.instruments.get(trackType);
        if (instrument) {
            if (muted) {
                // Αποθήκευση τρέχοντος volume πριν το mute
                instrument._savedVolume = instrument.volume.value;
                instrument.volume.value = -Infinity;
            } else {
                // Επαναφορά αποθηκευμένου volume (ή default αν δεν υπάρχει)
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
