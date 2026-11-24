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
            this.onTransportStop?.();
        };
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
        const profile = GENRE_TO_PROFILE_MAP[style] || GENRE_TO_PROFILE_MAP['default'];
        const genreProfile = GENRE_PROFILES[profile] || {};

        const mergeDeep = (base, override) => {
            const result = { ...base };
            for (const [key, value] of Object.entries(override || {})) {
                if (
                    value && typeof value === 'object' && !Array.isArray(value) &&
                    base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
                ) {
                    result[key] = mergeDeep(base[key], value);
                } else {
                    result[key] = value;
                }
            }
            return result;
        };

        this.instruments.forEach((instrument, trackType) => {
            const baseSettings = TRACK_INSTRUMENTS[trackType]?.settings || {};
            // Always rebuild from the base patch. This prevents settings from a
            // previously selected genre leaking into properties omitted by the next profile.
            const settings = mergeDeep(baseSettings, genreProfile[trackType] || {});

            try {
                let oscillator = { ...(settings.oscillator || {}) };
                if (oscillator.type === 'fatcustom') {
                    // Match createInstruments(): Tone.js does not support fatcustom.
                    oscillator = {
                        type: 'fatsine',
                        count: oscillator.count || 3,
                        spread: oscillator.spread || 40
                    };
                } else if (oscillator.type === 'custom') {
                    oscillator = { type: 'sine' };
                }

                if (this.lowPower) {
                    if (oscillator.type?.includes('fat')) {
                        oscillator.type = oscillator.type.replace('fat', '');
                    }
                    if (oscillator.type === 'pwm' || oscillator.type === 'fmsquare') {
                        oscillator.type = 'square';
                    }
                    delete oscillator.count;
                    delete oscillator.spread;
                }

                const envelope = { ...(settings.envelope || {}) };
                if (this.lowPower) {
                    if (Number.isFinite(envelope.release)) {
                        envelope.release = Math.min(envelope.release, 0.25);
                    }
                }
                if (trackType === 'pad-textures' && envelope.attack > 1.2) {
                    envelope.attack = 1.2;
                }
                if (Number.isFinite(envelope.attack) && envelope.attack < 0.008) {
                    envelope.attack = 0.008;
                }
                if (Number.isFinite(envelope.release) && envelope.release < 0.05) {
                    envelope.release = 0.05;
                }

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

        console.log(`[AudioEngine] Genre settings reset and updated to: ${style} (${profile})`);
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
