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

        // lookAhead + updateInterval
        Tone.Transport.lookAhead = this.lowPower ? 0.6 : 0.4;
        Tone.Transport.updateInterval = this.lowPower ? 0.1 : 0.08;

        // --- AUDIO BUSSES ---
        this.wetBus = new Tone.Channel(); 
        this.dryBus = new Tone.Channel(); 

        // --- GLOBAL EFFECTS CHAIN ---
        // ✅ FIXED: Χαλαρώσαμε το compression. 
        // Το -20 ήταν πολύ επιθετικό. Το -12 επιτρέπει δυναμικές χωρίς να "πνίγει" τις νότες.
        // Limiter πριν τον compressor — κόβει hard peaks που προκαλούν clicks
        this.limiter = new Tone.Limiter(-3).toDestination();

        this.compressor = new Tone.Compressor({
            threshold: -14,
            ratio: 4,
            attack: 0.005,  // Γρήγορο attack για να πιάνει transients
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
                    // Κόβουμε το release για να ελευθερώνονται φωνές πιο γρήγορα
                    finalSettings.envelope.release = Math.min(finalSettings.envelope.release, 0.25);
                    // Minimum attack για αποφυγή pops — ποτέ κάτω από 8ms
                    if (finalSettings.envelope.attack < 0.008) {
                        finalSettings.envelope.attack = 0.008;
                    }
                }
            }

            // Global anti-pop: ποτέ attack < 8ms σε κανένα instrument
            if (finalSettings.envelope?.attack < 0.008) {
                finalSettings.envelope.attack = 0.008;
            }
            // Global anti-click: ποτέ release < 0.05s
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

            // ✅ FIXED: Χαμηλώσαμε λίγο το Gain γιατί αυξήσαμε την πολυφωνία
            const mixVol = config.mixVolume !== undefined ? config.mixVolume : 0.6;
            const dbVolume = Tone.gainToDb(mixVol);

            // ── Fix unsupported oscillator types before instrument creation ──
            // 'fatcustom' is not valid in Tone.js → replace with fatsine + spread
            if (settings.oscillator?.type === 'fatcustom') {
                settings.oscillator = {
                    type:   'fatsine',
                    count:  settings.oscillator.count  || 3,
                    spread: settings.oscillator.spread || 40,
                };
            } else if (settings.oscillator?.type === 'custom') {
                // Happens in lowPower mode: 'fat'.replace('fat','') = 'custom'
                settings.oscillator = { type: 'sine' };
            }

            // ── Cap pad-textures attack for audibility in short loops ──
            // attack > 1.2s means nearly silent for the first bar.
            // Clamp to 1.2s — still "slow" but guaranteed audible.
            if (trackType === 'pad-textures' && settings.envelope?.attack > 1.2) {
                settings.envelope.attack = 1.2;
            }

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
        if (this.limiter) this.limiter.dispose();
        
        if (this.wetBus) this.wetBus.dispose();
        if (this.dryBus) this.dryBus.dispose();

        Tone.Transport.stop();
        Tone.Transport.cancel();
    }

    async start() {
        await Tone.start();
        Tone.Transport.start();
        this.isPlaying = true;
    }

    stop() {
        this.parts.forEach(part => { part.stop(); part.dispose(); });
        this.parts = [];
        Tone.Transport.stop();
        Tone.Transport.cancel();

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

        // ✅ FIX: Use the passed 'now' parameter for Transport-relative scheduling
        // 'now' should be 0 (Transport start) or a specific Transport time
        const part = new Tone.Part((time, event) => {
            try {
                instrument.triggerAttackRelease(event.note, event.duration, time, event.velocity);
            } catch(e) {
                // Voice overflow — skip note instead of crashing
                console.warn(`[Audio] Voice overflow on ${trackType}, skipping note`);
            }
        }, noteEvents).start(now);  // ✅ Use 'now' parameter instead of hardcoded 0

        part.loop = shouldLoop;
        part.humanize = 0.002; // 2ms jitter — prevents simultaneous triggering pops
        
        // ✅ FIX: Ensure loopEnd is at least as long as the last note
        const lastNoteEnd = sortedNotes[sortedNotes.length - 1].time + sortedNotes[sortedNotes.length - 1].duration;
        part.loopEnd = Math.max(totalDuration, lastNoteEnd);
        
        // Auto-cleanup for non-looping parts
        if (!shouldLoop) {
            const partEndTime = part.loopEnd + 1;
            
            Tone.Transport.scheduleOnce((time) => {
                const index = this.parts.indexOf(part);
                if (index > -1) {
                    part.stop();
                    part.dispose();
                    this.parts.splice(index, 1);
                }
            }, `+${partEndTime}`);
        }
        
        this.parts.push(part);
    }
    
    updateGenreSettings() {
        const style = document.getElementById('style')?.value?.toLowerCase() || 'house';
        const profile = GENRE_TO_PROFILE_MAP[style] || GENRE_TO_PROFILE_MAP['default'];
        const genreProfile = GENRE_PROFILES[profile] || {};

        this.instruments.forEach((instrument, trackType) => {
            const specificSettings = genreProfile[trackType];
            if (!specificSettings) return;

            try {
                // Oscillator update
                if (specificSettings.oscillator) {
                    const osc = specificSettings.oscillator;
                    if (osc.type !== undefined) {
                        let oscType = osc.type;
                        // Fix fatcustom — not valid in Tone.js
                        if (oscType === 'fatcustom') oscType = 'fatsine';
                        if (this.lowPower) {
                            if (oscType.includes('fat')) oscType = oscType.replace('fat', '');
                            if (oscType === 'pwm' || oscType === 'fmsquare' || oscType === 'custom') oscType = 'square';
                        }
                        instrument.set({ oscillator: { ...osc, type: oscType } });
                    } else {
                        instrument.set({ oscillator: osc });
                    }
                }

                // Envelope update
                if (specificSettings.envelope) {
                    let env = { ...specificSettings.envelope };
                    if (this.lowPower) {
                        if (env.release) env.release = Math.min(env.release, 0.25);
                        if (env.attack && env.attack < 0.008) env.attack = 0.008;
                    }
                    // Cap pad-textures attack for audibility
                    if (trackType === 'pad-textures' && env.attack > 1.2) env.attack = 1.2;
                    // Global anti-pop/click
                    if (env.attack < 0.008) env.attack = 0.008;
                    if (env.release < 0.05) env.release = 0.05;
                    instrument.set({ envelope: env });
                }

                // Filter update
                if (specificSettings.filter && instrument.filter) {
                    instrument.set({ filter: specificSettings.filter });
                }

            } catch (err) {
                console.warn(`[AudioEngine] updateGenreSettings failed for ${trackType}:`, err.message);
            }
        });

        console.log(`[AudioEngine] Genre settings updated to: ${style} (${profile})`);
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
