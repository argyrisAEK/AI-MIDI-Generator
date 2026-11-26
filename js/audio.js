import * as Tone from 'tone';
import { TRACK_INSTRUMENTS } from './config.js';
import { resolvePreviewTrackSettings, resolvePreviewSoundProfile, getPreviewMasterEffectsSettings } from '../lib/preview-audio-config.mjs';
import { getPercussionVoice } from '../lib/percussion-mapping.mjs';
import { getPercussionProfile } from '../lib/percussion-profiles.mjs';

export class AudioEngine {
    constructor() {
        this.lowPower = this.detectLowPower();
        console.log(`Audio Engine Mode: ${this.lowPower ? 'LOW POWER (Optimized)' : 'HIGH PERFORMANCE'}`);
        this.initializeEngine();
    }

    detectLowPower() {
        const cores = navigator.hardwareConcurrency || 2;
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        // Four logical threads can still be CPU-constrained during dense multitrack playback.
        // Use the existing low-power profile at this boundary rather than waiting for < 4.
        return isMobile || cores <= 4;
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

        // --- SHARED PREVIEW MASTER EFFECTS ---
        const masterEffects = getPreviewMasterEffectsSettings({ lowPower: this.lowPower });
        this.limiter = new Tone.Limiter(masterEffects.limiterThresholdDb).toDestination();
        this.compressor = new Tone.Compressor(masterEffects.compressor).connect(this.limiter);
        this.dryBus.connect(this.compressor);

        if (masterEffects.spatialEffectsEnabled) {
            this.reverb = new Tone.Reverb(masterEffects.reverb);
            this.delay = new Tone.PingPongDelay(masterEffects.delay);

            this.wetBus.connect(this.delay);
            this.delay.connect(this.reverb);
            this.reverb.connect(this.compressor);
        } else {
            this.wetBus.connect(this.compressor);
        }

        this.createInstruments();

        this.onTransportStop = null;
        this.activeTransportStartTime = null;
        this.transportListener = (time) => {
            // Ignore stop events scheduled before the currently active playback.
            // Tone may dispatch a previous stop after a new start has been queued.
            if (
                this.activeTransportStartTime !== null &&
                time < this.activeTransportStartTime
            ) {
                return;
            }
            this.activeTransportStartTime = null;
            this.isPlaying = false;
            // Scheduled Transport.stop(time) fires at the actual audio stop time.
            // Dispose Parts here rather than inside the look-ahead callback.
            this.parts.forEach(part => part.dispose());
            this.parts = [];
            if (this.pendingPercussionGenre !== undefined) {
                const pendingGenre = this.pendingPercussionGenre;
                this.pendingPercussionGenre = undefined;
                this.replacePercussionInstrument(pendingGenre);
            }
            this.onTransportStop?.();
        };
        Tone.Transport.on('stop', this.transportListener);
    }

    createPercussionInstrument(destination, genre = '', initialVolumeDb = -4.7) {
        const profile = getPercussionProfile(genre);
        const voiceSettings = profile.voices;
        const bus = new Tone.Volume(initialVolumeDb);
        const hatFilter = new Tone.Filter(7000, 'highpass');
        const snareFilter = new Tone.Filter(1200, 'highpass');
        const clapFilter = new Tone.Filter(1500, 'bandpass');
        hatFilter.connect(bus);
        snareFilter.connect(bus);
        clapFilter.connect(bus);
        bus.connect(destination);

        // Fixed-size pools are created once, before playback. No synth or filter
        // allocation occurs in the Transport callback, keeping real-time work bounded.
        const poolSize = (role) => {
            const base = this.lowPower ? 1 : 2;
            return ['closedHat', 'openHat', 'ride', 'crash'].includes(role)
                ? Math.max(2, base)
                : base;
        };
        const createPool = (role, factory, output = bus) =>
            Array.from({ length: poolSize(role) }, () => factory().connect(output));

        const voices = {
            kick: createPool('kick', () => new Tone.MembraneSynth({
                pitchDecay: 0.05,
                octaves: 6,
                envelope: { attack: 0.001, decay: 0.35, sustain: 0.01, release: 0.8 }
            })),
            snare: createPool('snare', () => new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.001, decay: 0.14, sustain: 0 }
            }), snareFilter),
            clap: createPool('clap', () => new Tone.NoiseSynth({
                noise: { type: 'pink' },
                envelope: { attack: 0.001, decay: 0.15, sustain: 0 }
            }), clapFilter),
            closedHat: createPool('closedHat', () => new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.001, decay: 0.05, sustain: 0 }
            }), hatFilter),
            openHat: createPool('openHat', () => new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.05 }
            }), hatFilter),
            tom: createPool('tom', () => new Tone.MembraneSynth({
                pitchDecay: voiceSettings.tom.pitchDecay,
                octaves: voiceSettings.tom.octaves,
                envelope: { attack: 0.001, decay: voiceSettings.tom.decay, sustain: 0, release: voiceSettings.tom.release }
            })),
            shaker: createPool('shaker', () => new Tone.NoiseSynth({
                noise: { type: voiceSettings.shaker.noise },
                envelope: { attack: 0.001, decay: voiceSettings.shaker.decay, sustain: 0, release: 0.015 }
            })),
            ride: createPool('ride', () => new Tone.MetalSynth({
                frequency: voiceSettings.ride.frequency,
                harmonicity: voiceSettings.ride.harmonicity,
                modulationIndex: voiceSettings.ride.modulationIndex,
                resonance: voiceSettings.ride.resonance,
                octaves: voiceSettings.ride.octaves,
                envelope: { attack: 0.001, decay: voiceSettings.ride.decay, release: 0.12 }
            })),
            crash: createPool('crash', () => new Tone.MetalSynth({
                frequency: voiceSettings.crash.frequency,
                harmonicity: voiceSettings.crash.harmonicity,
                modulationIndex: voiceSettings.crash.modulationIndex,
                resonance: voiceSettings.crash.resonance,
                octaves: voiceSettings.crash.octaves,
                envelope: { attack: 0.001, decay: voiceSettings.crash.decay, release: 0.2 }
            }))
        };

        const cursors = Object.create(null);
        const allVoices = Object.values(voices).flat();
        const percussion = {
            volume: bus.volume,
            triggerAttackRelease: (note, duration, time, velocity) => {
                const role = getPercussionVoice(note);
                const pool = voices[role] || voices.crash;
                const index = cursors[role] || 0;
                const voice = pool[index % pool.length];
                cursors[role] = (index + 1) % pool.length;
                const hitVelocity = Number.isFinite(velocity)
                    ? Math.max(0.05, Math.min(1, velocity))
                    : 0.7;
                const hitDuration = Number.isFinite(duration) && duration > 0 ? duration : 0.1;

                switch (role) {
                    case 'kick':
                        voice.triggerAttackRelease('C1', '8n', time, hitVelocity);
                        break;
                    case 'snare':
                        voice.triggerAttackRelease(0.14, time, hitVelocity);
                        break;
                    case 'clap':
                        voice.triggerAttackRelease(0.15, time, hitVelocity);
                        break;
                    case 'closedHat':
                        voice.triggerAttackRelease(0.05, time, hitVelocity);
                        break;
                    case 'openHat':
                        voice.triggerAttackRelease(0.22, time, hitVelocity);
                        break;
                    case 'tom':
                        voice.triggerAttackRelease(note, Math.max(0.08, Math.min(0.4, hitDuration)), time, hitVelocity);
                        break;
                    case 'shaker':
                        voice.triggerAttackRelease(Math.max(0.025, Math.min(0.09, hitDuration)), time, hitVelocity);
                        break;
                    case 'ride':
                        voice.triggerAttackRelease(Math.max(0.18, Math.min(0.65, hitDuration)), time, hitVelocity);
                        break;
                    default:
                        voice.triggerAttackRelease(Math.max(0.3, Math.min(1, hitDuration)), time, hitVelocity);
                }
            },
            releaseAll: (time) => {
                allVoices.forEach(voice => {
                    if (typeof voice.releaseAll === 'function') voice.releaseAll(time);
                    else if (typeof voice.triggerRelease === 'function') voice.triggerRelease(time);
                });
            },
            dispose: () => {
                allVoices.forEach(voice => voice.dispose());
                hatFilter.dispose();
                snareFilter.dispose();
                clapFilter.dispose();
                bus.dispose();
            }
        };
        return percussion;
    }

    replacePercussionInstrument(genre) {
        const previous = this.instruments.get('percs');
        const previousVolumeDb = previous?.volume?.value;
        const previousSavedVolume = previous?._savedVolume;
        if (previous) previous.dispose?.();
        const config = TRACK_INSTRUMENTS.percs;
        if (!config) return;
        const mixVol = config.mixVolume !== undefined ? config.mixVolume : 0.6;
        const initialVolumeDb = previousVolumeDb === -Infinity || Number.isFinite(previousVolumeDb)
            ? previousVolumeDb
            : Tone.gainToDb(mixVol);
        const instrument = this.createPercussionInstrument(this.dryBus, genre, initialVolumeDb);
        if (previousSavedVolume !== undefined) instrument._savedVolume = previousSavedVolume;
        this.instruments.set('percs', instrument);
    }

    createInstruments() {
        const getPreviewOptions = () => ({
            style: document.getElementById('style')?.value?.toLowerCase() || 'house',
            subgenre: document.getElementById('audio-style')?.value || '',
            soundProfileMode: document.getElementById('sound-profile-mode')?.value,
            lowPower: this.lowPower
        });

        Object.entries(TRACK_INSTRUMENTS).forEach(([trackType, config]) => {
            let instrument;
            const settings = resolvePreviewTrackSettings(trackType, getPreviewOptions());
            
            const destination = (config.type === 'bass' || trackType === 'bassline' || trackType === 'percs')
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
                    case 'synth':
                        if (trackType === 'percs') {
                            const options = getPreviewOptions();
                            instrument = this.createPercussionInstrument(destination, options.subgenre || options.style, dbVolume);
                            break;
                        }
                        instrument = new Tone.PolySynth(Tone.Synth, {
                            ...settings,
                            maxPolyphony: maxPolyphony,
                            voice: Tone.Synth
                        }).connect(destination);
                        instrument.volume.value = dbVolume;
                        break;

                    case 'bass':
                    case 'lead':
                        // MonoSynth is naturally monophonic (1 note), that's intended
                        instrument = new Tone.MonoSynth(settings).connect(destination);
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

        this.instruments.forEach(inst => inst.dispose?.());
        this.instruments.clear();
        this.pendingPercussionGenre = undefined;

        if (this.reverb) this.reverb.dispose();
        if (this.delay) this.delay.dispose();
        if (this.compressor) this.compressor.dispose();
        if (this.limiter) this.limiter.dispose();
        
        if (this.wetBus) this.wetBus.dispose();
        if (this.dryBus) this.dryBus.dispose();

        Tone.Transport.stop();
        Tone.Transport.cancel();
    }

    async start({ startTransport = true, startTime = "+0.05" } = {}) {
        // Resume the AudioContext from the user's Play gesture, but allow the
        // caller to finish scheduling every track before the Transport starts.
        await Tone.start();

        if (startTransport) this.startTransport(startTime);
        return Tone.now();
    }

    startTransport(time = "+0.05") {
        // Store the scheduled start's absolute audio time. A delayed stop event
        // from an earlier playback must not clean up Parts from this playback.
        const startOffset = typeof time === 'string' && time.startsWith('+')
            ? Number(time.slice(1))
            : 0.05;
        const startAt = typeof time === 'number' ? time : Tone.now() + startOffset;
        this.activeTransportStartTime = startAt;
        Tone.Transport.start(startAt);
        this.isPlaying = true;
    }

    stop(time) {
        if (time !== undefined) {
            // Called from a Transport callback: schedule audio operations at its
            // supplied AudioContext time. Do not dispose/cancel events early.
            this.parts.forEach(part => part.stop(time));
            Tone.Transport.stop(time);
            this.instruments.forEach(inst => {
                if (inst.releaseAll) inst.releaseAll(time);
                else if (inst.triggerRelease) inst.triggerRelease(time);
            });
            return;
        }

        // Immediate user-initiated stop. Tone.Transport may dispatch its stop
        // event asynchronously; prevent that stale event from disposing Parts
        // registered by an immediate subsequent Play action.
        const stopTime = Tone.now();
        this.parts.forEach(part => {
            part.stop();
            part.dispose();
        });
        this.parts = [];
        Tone.Transport.stop(stopTime);
        Tone.Transport.cancel();

        this.instruments.forEach(inst => {
            if (inst.releaseAll) inst.releaseAll();
            else if (inst.triggerRelease) inst.triggerRelease();
        });
        this.isPlaying = false;
    }

// audio_3_.js
playNotes(notes, now, trackType, totalDuration, shouldLoop = false, compositionBpm = 120, targetBpm = 120) {
    if (!notes || notes.length === 0) return;
    const instrument = this.instruments.get(trackType);
    if (!instrument) return;

    const sortedNotes = [...notes].sort((a, b) => a.time - b.time);

    // ⬇️ ΝΕΟ: rescale seconds ώστε οι νότες να παίξουν στο tempo που όντως
    // έχει επιλέξει ο χρήστης, και όχι σε αυτό που είχαν "γεννηθεί"
    const scale = (compositionBpm || 120) / (targetBpm || 120);

    const noteEvents = sortedNotes.map(note => ({
        time: note.time * scale,
        note: note.name,
        duration: note.duration * scale,
        velocity: note.velocity
    }));

    const part = new Tone.Part((time, event) => {
        if (this.diagnostics?.enabled) this.diagnostics.recordNoteEvent(trackType);
        try {
            instrument.triggerAttackRelease(event.note, event.duration, time, event.velocity);
        } catch(e) {
            console.warn(`[Audio] Voice overflow on ${trackType}, skipping note`);
        }
    }, noteEvents).start(now);

    part.loop = shouldLoop;
    part.humanize = 0.002;

    const lastNoteEnd = (sortedNotes[sortedNotes.length - 1].time + sortedNotes[sortedNotes.length - 1].duration) * scale;
    // totalDuration is supplied by the shared beat-based arrangement timeline.
    // Keep the last-note fallback for callers that do not provide a valid duration.
    const arrangementEnd = Number.isFinite(Number(totalDuration)) && Number(totalDuration) > 0
        ? Number(totalDuration)
        : lastNoteEnd;
    part.loopEnd = Math.max(arrangementEnd, lastNoteEnd);
   
   
        
        // Keep Parts registered until the shared Transport stops. Tone invokes
        // scheduled callbacks ahead of their audio time, so disposing a Part in
        // such a callback can truncate its final notes.
        this.parts.push(part);
    }
    
    updateGenreSettings() {
        const style = document.getElementById('style')?.value?.toLowerCase() || 'house';
        const subgenre = document.getElementById('audio-style')?.value || '';
        const options = {
            style,
            subgenre,
            soundProfileMode: document.getElementById('sound-profile-mode')?.value,
            lowPower: this.lowPower
        };
        const useGenreSounds = options.soundProfileMode !== 'default';
        const profile = resolvePreviewSoundProfile(options);
        if (this.instruments.has('percs')) {
            if (this.isPlaying) this.pendingPercussionGenre = options.subgenre || options.style;
            else this.replacePercussionInstrument(options.subgenre || options.style);
        }

        this.instruments.forEach((instrument, trackType) => {
            if (trackType === 'percs') return;
            const settings = resolvePreviewTrackSettings(trackType, options);

            try {
                const oscillator = { ...(settings.oscillator || {}) };
                const envelope = { ...(settings.envelope || {}) };

                // Apply the complete effective oscillator/envelope, not just
                // fields present in the new profile, so genre changes are reversible.
                if (Object.keys(oscillator).length) {
                    instrument.set({ oscillator });
                }
                if (Object.keys(envelope).length) {
                    instrument.set({ envelope });
                }

                // Tone.Synth voices do not expose the same filter API as MonoSynth.
                // Apply filters only where the instrument actually supports one.
                if (instrument.filter && settings.filter) {
                    instrument.set({ filter: { ...settings.filter } });
                }
            } catch (err) {
                console.warn(`[AudioEngine] updateGenreSettings failed for ${trackType}:`, err.message);
            }
        });

        console.log(`[AudioEngine] Preview sound mode: ${useGenreSounds ? `genre-based — ${subgenre || style} (${profile})` : 'default patches'}`);
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
