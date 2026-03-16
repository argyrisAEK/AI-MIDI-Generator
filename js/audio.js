import * as Tone from 'tone';
import { TRACK_INSTRUMENTS, GENRE_PROFILES, GENRE_TO_PROFILE_MAP } from './config.js';

export class AudioEngine {
    constructor() {
        this.lowPower = this.detectLowPower();
        this.initializeEngine();
    }

    detectLowPower() {
        return (navigator.hardwareConcurrency || 2) < 4 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
    }

    initializeEngine() {
        this.instruments = new Map();
        this.isPlaying = false;
        this.parts = new Set();

        // Safety Buffering
        Tone.Transport.lookAhead = this.lowPower ? 0.6 : 0.3;

        // --- MASTER CHAIN ---
        this.limiter = new Tone.Limiter(-2).toDestination();
        this.compressor = new Tone.Compressor({
            threshold: -16,
            ratio: 4,
            attack: 0.01,
            release: 0.2
        }).connect(this.limiter);

        // --- BUSSES ---
        this.dryBus = new Tone.Channel().connect(this.compressor);
        this.wetBus = new Tone.Channel();

        if (!this.lowPower) {
            this.reverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.01, wet: 0.15 });
            this.delay = new Tone.PingPongDelay("8n", 0.15);
            this.wetBus.chain(this.delay, this.reverb, this.compressor);
        } else {
            this.wetBus.connect(this.compressor);
        }

        this.createInstruments();
    }

    createInstruments() {
        const getGenreSettings = (trackType) => {
            const style = document.getElementById('style')?.value?.toLowerCase() || 'house';
            const base = TRACK_INSTRUMENTS[trackType]?.settings || {};
            const profile = GENRE_TO_PROFILE_MAP[style] || GENRE_TO_PROFILE_MAP['default'];
            const specific = GENRE_PROFILES[profile]?.[trackType] || {};
            
            // Deep merge logic
            const settings = { ...base, ...specific };
            if (!settings.envelope) settings.envelope = {};
            settings.envelope.attack = Math.max(settings.envelope.attack || 0, 0.01);
            settings.envelope.release = Math.max(settings.envelope.release || 0, 0.08);
            return settings;
        };

        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            const settings = getGenreSettings(trackType);
            const destination = (config.type === 'bass' || trackType === 'bassline') ? this.dryBus : this.wetBus;
            const vol = config.mixVolume !== undefined ? config.mixVolume : 0.6;

            let inst;
            if (config.type === 'bass' || config.type === 'lead') {
                inst = new Tone.MonoSynth(settings).connect(destination);
            } else {
                inst = new Tone.PolySynth(Tone.Synth, settings).set({
                    maxPolyphony: this.lowPower ? 4 : 12,
                    voice: Tone.Synth
                }).connect(destination);
            }
            inst.volume.value = Tone.gainToDb(vol);
            this.instruments.set(trackType, inst);
        });
    }

    async start() {
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
        Tone.Transport.start();
        this.isPlaying = true;
    }

    stop() {
        this.parts.forEach(p => p.dispose());
        this.parts.clear();
        Tone.Transport.stop();
        Tone.Transport.cancel();
        this.instruments.forEach(inst => inst.releaseAll ? inst.releaseAll() : null);
        this.isPlaying = false;
    }

    playNotes(notes, now, trackType, totalDuration, shouldLoop = false) {
        const inst = this.instruments.get(trackType);
        if (!inst || !notes?.length) return;

        const part = new Tone.Part((time, event) => {
            inst.triggerAttackRelease(
                event.name || event.note, 
                event.duration, 
                time, 
                event.velocity || 0.7
            );
        }, notes).start(now);

        part.loop = shouldLoop;
        part.loopEnd = totalDuration;
        this.parts.add(part);

        if (!shouldLoop) {
            part.on('end', () => {
                part.dispose();
                this.parts.delete(part);
            });
        }
    }

    dispose() {
        this.stop();
        this.instruments.forEach(i => i.dispose());
        [this.dryBus, this.wetBus, this.reverb, this.delay, this.compressor, this.limiter].forEach(n => n?.dispose());
    }
}
