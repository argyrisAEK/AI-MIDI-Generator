import * as Tone from 'tone';
import { TRACK_INSTRUMENTS, GENRE_PROFILES, GENRE_TO_PROFILE_MAP } from './config.js';

export class AudioEngine {
    constructor() {
        this.lowPower = this.detectLowPower();
        this.instruments = new Map();
        this.parts = new Set();
        this.isPlaying = false;
        this.initializeEngine();
    }

    detectLowPower() {
        return (navigator.hardwareConcurrency || 2) < 4 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
    }

    initializeEngine() {
        // Ρυθμίσεις χρονισμού για αποφυγή διακοπών (stuttering)
        Tone.Transport.lookAhead = this.lowPower ? 0.6 : 0.4;

        // Master Chain
        this.limiter = new Tone.Limiter(-2).toDestination();
        this.compressor = new Tone.Compressor({
            threshold: -15,
            ratio: 4,
            attack: 0.01,
            release: 0.2
        }).connect(this.limiter);

        // Busses
        this.dryBus = new Tone.Channel().connect(this.compressor);
        this.wetBus = new Tone.Channel();

        if (!this.lowPower) {
            this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.15 }).generate();
            this.delay = new Tone.PingPongDelay("8n", 0.1);
            this.wetBus.chain(this.delay, this.reverb, this.compressor);
        } else {
            this.wetBus.connect(this.compressor);
        }

        this.createInstruments();
    }

    createInstruments() {
        // 1. Καθαρισμός προηγούμενων οργάνων για αποφυγή memory leaks
        this.instruments.forEach(inst => inst.dispose());
        this.instruments.clear();

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

            return mergeDeep(baseSettings, specificSettings);
        };

        // 2. Δημιουργία οργάνων βάσει του τρέχοντος στυλ
        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            const settings = getGenreBasedSettings(trackType);
            const destination = (config.type === 'bass' || trackType === 'bassline') ? this.dryBus : this.wetBus;
            
            let inst;
            if (config.type === 'bass' || config.type === 'lead') {
                inst = new Tone.MonoSynth(settings).connect(destination);
            } else {
                inst = new Tone.PolySynth(Tone.Synth, settings).set({
                    maxPolyphony: this.lowPower ? 4 : 12
                }).connect(destination);
            }
            
            inst.volume.value = Tone.gainToDb(config.mixVolume || 0.6);
            this.instruments.set(trackType, inst);
        });
    }

    async start() {
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
        // Σημαντικό: Μηδενισμός χρόνου πριν το Start
        Tone.Transport.seconds = 0;
        Tone.Transport.start('+0.1');
        this.isPlaying = true;
    }

    stop() {
        // Σταμάτημα όλων των ενεργών Parts
        this.parts.forEach(part => {
            part.stop();
            part.dispose();
        });
        this.parts.clear();

        // Καθαρισμός του Transport
        Tone.Transport.stop();
        Tone.Transport.cancel();
        Tone.Transport.seconds = 0;

        // Σίγαση όλων των οργάνων
        this.instruments.forEach(inst => {
            if (inst.releaseAll) inst.releaseAll();
        });
        this.isPlaying = false;
    }

    playNotes(notes, startTime, trackType, totalDuration, shouldLoop = false) {
        const instrument = this.instruments.get(trackType);
        if (!instrument || !notes?.length) return;

        // Δημιουργία Part που ξεκινάει πάντα στο 0 του Transport
        const part = new Tone.Part((time, event) => {
            instrument.triggerAttackRelease(
                event.note || event.name, 
                event.duration, 
                time, 
                event.velocity || 0.7
            );
        }, notes).start(0);

        part.loop = shouldLoop;
        part.loopEnd = totalDuration;
        this.parts.add(part);
    }

    setTrackVolume(trackType, volume) {
        const inst = this.instruments.get(trackType);
        if (inst) inst.volume.value = Tone.gainToDb(volume);
    }

    setTrackMute(trackType, muted) {
        const inst = this.instruments.get(trackType);
        if (inst) inst.mute = muted;
    }

    dispose() {
        this.stop();
        this.instruments.forEach(i => i.dispose());
        [this.dryBus, this.wetBus, this.reverb, this.delay, this.compressor, this.limiter].forEach(n => n?.dispose());
    }
}
