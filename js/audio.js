import * as Tone from 'tone';
import { TRACK_INSTRUMENTS, GENRE_PROFILES, GENRE_TO_PROFILE_MAP } from './config.js';

export class AudioEngine {
    constructor() {
        this.lowPower = this.detectLowPower();
        this.initializeEngine();
        console.log("Audio Engine Initialized ✅");
    }

    detectLowPower() {
        return (navigator.hardwareConcurrency || 2) < 4 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
    }

    initializeEngine() {
        this.instruments = new Map();
        this.parts = new Set();
        this.isPlaying = false;

        // Ρυθμίσεις χρονισμού
        Tone.Transport.lookAhead = this.lowPower ? 0.6 : 0.3;

        // --- 1. SETUP MASTER CHAIN (Από το τέλος προς την αρχή) ---
        // Ο Limiter είναι ο τελευταίος κρίκος πριν τα ηχεία
        this.limiter = new Tone.Limiter(-1).toDestination();

        // Ο Compressor "ταΐζει" τον Limiter
        this.compressor = new Tone.Compressor({
            threshold: -15,
            ratio: 4,
            attack: 0.01,
            release: 0.2
        }).connect(this.limiter);

        // --- 2. SETUP BUSSES ---
        this.dryBus = new Tone.Channel().connect(this.compressor);
        this.wetBus = new Tone.Channel();

        // --- 3. SETUP EFFECTS (για το Wet Bus) ---
        if (!this.lowPower) {
            this.reverb = new Tone.Reverb({ decay: 2, wet: 0.2 });
            this.delay = new Tone.PingPongDelay("8n", 0.2);
            
            // Wet Bus -> Delay -> Reverb -> Compressor
            this.wetBus.chain(this.delay, this.reverb, this.compressor);
        } else {
            // Στο low power, το wet πάει κατευθείαν στον compressor χωρίς εφέ
            this.wetBus.connect(this.compressor);
        }

        this.createInstruments();
    }

    createInstruments() {
        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            // Επιλογή Bus ανάλογα με το όργανο
            const destination = (config.type === 'bass' || trackType === 'bassline') 
                ? this.dryBus 
                : this.wetBus;

            const mixVol = config.mixVolume !== undefined ? config.mixVolume : 0.5;
            const maxPoly = this.lowPower ? 4 : (config.maxPolyphony || 8);

            let inst;
            if (config.type === 'bass' || config.type === 'lead') {
                inst = new Tone.MonoSynth(config.settings || {}).connect(destination);
            } else {
                inst = new Tone.PolySynth(Tone.Synth, config.settings || {}).set({
                    maxPolyphony: maxPoly,
                    voice: Tone.Synth
                }).connect(destination);
            }

            inst.volume.value = Tone.gainToDb(mixVol);
            this.instruments.set(trackType, inst);
        });
    }

    async start() {
        // Κρίσιμο: Ο browser απαιτεί Tone.start() μετά από click
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
        Tone.Transport.start();
        this.isPlaying = true;
        console.log("Audio Context Started 🔊");
    }

    playNotes(notes, trackType, totalDuration, shouldLoop = false) {
        const instrument = this.instruments.get(trackType);
        if (!instrument || !notes.length) return;

        // Δημιουργία Part
        const part = new Tone.Part((time, event) => {
            instrument.triggerAttackRelease(
                event.note, 
                event.duration, 
                time, 
                event.velocity || 0.7
            );
        }, notes);

        part.loop = shouldLoop;
        part.loopEnd = totalDuration;
        
        // Ξεκινάει αμέσως σε σχέση με το Transport
        part.start(0);
        this.parts.add(part);

        if (!shouldLoop) {
            part.on('end', () => {
                part.dispose();
                this.parts.delete(part);
            });
        }
    }

    stop() {
        this.parts.forEach(p => p.dispose());
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
        this.instruments.forEach(i => i.dispose());
        [this.dryBus, this.wetBus, this.reverb, this.delay, this.compressor, this.limiter].forEach(d => d?.dispose());
    }
}
