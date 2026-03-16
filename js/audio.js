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
        this.parts = new Set(); // Χρήση Set για αποφυγή memory leaks
        this.transportListener = null;

        // lookAhead + updateInterval για σταθερότητα χρονισμού
        Tone.Transport.lookAhead = this.lowPower ? 0.6 : 0.4;
        Tone.Transport.updateInterval = this.lowPower ? 0.1 : 0.08;

        // --- AUDIO BUSSES ---
        this.wetBus = new Tone.Channel(); 
        this.dryBus = new Tone.Channel(); 

        // --- GLOBAL EFFECTS CHAIN ---
        // Limiter στην έξοδο για να μην "κλείνει" ο ήχος από clipping
        this.limiter = new Tone.Limiter(-2).toDestination();

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
                }
            }

            // Global anti-pop/click safety
            if (!finalSettings.envelope) finalSettings.envelope = {};
            finalSettings.envelope.attack = Math.max(finalSettings.envelope.attack || 0, 0.008);
            finalSettings.envelope.release = Math.max(finalSettings.envelope.release || 0, 0.05);

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
                const maxPolyphony = this.lowPower ? 4 : (config.maxPolyphony || 12);

                switch (config.type) {
                    case 'bass':
                    case 'lead':
                        instrument = new Tone.MonoSynth(settings).connect(destination);
                        break;
                    case 'synth':
                    default:
                        instrument = new Tone.PolySynth(Tone.Synth, settings).set({
                            maxPolyphony: maxPolyphony,
                            voice: Tone.Synth 
                        }).connect(destination);
                        break;
                }

                if (instrument) {
                    instrument.volume.value = dbVolume;
                    this.instruments.set(trackType, instrument);
                }
            } catch (error) {
                console.warn(`Failed to create instrument for ${trackType}:`, error);
            }
        });
    }

    dispose() {
        this.stop();
        if (this.transportListener) Tone.Transport.off('stop', this.transportListener);

        this.instruments.forEach(inst => inst.dispose());
        this.instruments.clear();

        [this.reverb, this.delay, this.compressor, this.limiter, this.wetBus, this.dryBus].forEach(node => {
            if (node) node.dispose();
        });

        Tone.Transport.cancel();
    }

    async start() {
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
        Tone.Transport.start('+0.1');
        this.isPlaying = true;
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
            else if (inst.triggerRelease) inst.triggerRelease();
        });
        this.isPlaying = false;
    }

    playNotes(notes, now, trackType, totalDuration, shouldLoop = false) {
        if (!notes || notes.length === 0) return;
        const instrument = this.instruments.get(trackType);
        if (!instrument) return;

        const sortedNotes = [...notes].sort((a, b) => a.time - b.time);

        const part = new Tone.Part((time, event) => {
            try {
                instrument.triggerAttackRelease(
                    event.note || event.name, 
                    event.duration, 
                    time, 
                    event.velocity || 0.7
                );
            } catch(e) {
                // Voice overflow - silent skip
            }
        }, sortedNotes).start(now || 0);

        part.loop = shouldLoop;
        part.humanize = 0.005; 
        
        const lastNoteEnd = sortedNotes[sortedNotes.length - 1].time + sortedNotes[sortedNotes.length - 1].duration;
        part.loopEnd = Math.max(totalDuration, lastNoteEnd + 0.1);
        
        this.parts.add(part);

        if (!shouldLoop) {
            part.on('end', () => {
                part.dispose();
                this.parts.delete(part);
            });
        }
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
