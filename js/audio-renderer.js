import * as Tone from 'tone';

/**
 * AudioRenderer — Offline Tone.js render → WAV (native, no external library)
 */
export class AudioRenderer {
  /**
   * Renders ALL tracks together into a single stereo WAV (full mix).
   */
  async renderMultitrack({ tracks, bpm, durationSeconds, genre, onProgress }) {
    if (!tracks || tracks.length === 0) throw new Error('No tracks to render');
    onProgress?.(0.05);
    const renderDuration = durationSeconds + 2.0;

    // Genres that benefit from 4/4 kick sidechain ducking
    const pumpGenres = new Set(['house', 'techno', 'trance', 'edm', 'drum-and-bass', 'disco', 'synthwave']);
    const useSidechain = pumpGenres.has((genre || '').toLowerCase());

    // Tracks that get ducked (rhythm/low-end focused)
    const sidechainTargets = new Set(['bassline', 'chord', 'pad-textures', 'arpeggio']);

    let audioBuffer;
    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;

        const masterLimiter    = new Tone.Limiter(-2).toDestination();
        const masterCompressor = new Tone.Compressor({
          threshold: -12, ratio: 4, attack: 0.003, release: 0.1
        }).connect(masterLimiter);

        // ── Sidechain Setup ────────────────────────────────────────
        let sidechainCompressors = {};

        if (useSidechain) {
            // Dynamic release synced to BPM (60/bpm * 0.6)
            const scRelease = Math.round((60 / bpm) * 0.6 * 1000) / 1000;

            // Create one sidechain compressor per target track
            for (const targetTrack of sidechainTargets) {
                sidechainCompressors[targetTrack] = new Tone.Compressor({
                    threshold: -24,
                    ratio:     10,
                    attack:    0.003,
                    release:   scRelease,
                    knee:      3
                }).connect(masterCompressor);
            }

            // Silent 4/4 kick trigger — routed ONLY to sidechain input
            const kickSynth = new Tone.MembraneSynth({
                pitchDecay:  0.05,
                octaves:     6,
                envelope:    { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
            });
            kickSynth.volume.value = -Infinity; // completely silent in mix

            // Connect to each sidechain compressor's sidechain input
            Object.values(sidechainCompressors).forEach(sc => {
                kickSynth.connect(sc.sidechain || sc); // fallback if no sidechain
            });

            // Schedule 4/4 kicks for the full duration
            const beatsPerBar  = 4;
            const totalBeats   = Math.ceil(durationSeconds / (60 / bpm));
            const kickEvents   = [];
            for (let beat = 0; beat < totalBeats; beat++) {
                kickEvents.push({ time: beat * (60 / bpm) });
            }

            new Tone.Part((time) => {
                kickSynth.triggerAttackRelease('C1', '8n', time);
            }, kickEvents).start(0);
        }

        // ── Build and schedule each track ─────────────────────────
        for (const track of tracks) {
            const { trackType, notes, synthSettings } = track;
            if (!notes || notes.length === 0) continue;

            // Route sidechain targets to their dedicated SC compressor
            const dest = (useSidechain && sidechainTargets.has(trackType) && sidechainCompressors[trackType])
                ? sidechainCompressors[trackType]
                : masterCompressor;

            const synth = this._buildSynth(synthSettings, dest);

            new Tone.Part((time, event) => {
                try {
                    synth.triggerAttackRelease(event.note, event.duration, time, event.velocity);
                } catch (e) { /* voice overflow */ }
            }, notes.map(n => ({
                time: n.time, note: n.name,
                duration: n.duration, velocity: n.velocity
            }))).start(0);
        }

        transport.start(0);
      }, renderDuration, 2);

    } catch (err) {
      throw new Error(`Multitrack offline render failed: ${err.message}`);
    }

    onProgress?.(0.8);
    const wavBlob = this._audioBufferToWav(audioBuffer);
    onProgress?.(1.0);
    return wavBlob;
  }

  /**
   * Renders a single track to WAV.
   */
  async render({ trackType, notes, synthSettings, bpm, durationSeconds, onProgress }) {
    if (!notes || notes.length === 0) throw new Error('No notes to render');
    onProgress?.(0.05);
    const renderDuration = durationSeconds + 1.5;
    let audioBuffer;

    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;
        const synth = this._buildSynth(synthSettings);

        new Tone.Part((time, event) => {
          try { synth.triggerAttackRelease(event.note, event.duration, time, event.velocity); } 
          catch (e) { /* voice overflow */ }
        }, notes.map(n => ({ time: n.time, note: n.name, duration: n.duration, velocity: n.velocity }))).start(0);

        transport.start(0);
      }, renderDuration, 2);
    } catch (err) {
      throw new Error(`Offline render failed: ${err.message}`);
    }

    onProgress?.(0.75);
    const wavBlob = this._audioBufferToWav(audioBuffer);
    onProgress?.(1.0);
    return wavBlob;
  }

  _audioBufferToWav(audioBuffer) {
    const numChannels   = audioBuffer.numberOfChannels;
    const sampleRate    = audioBuffer.sampleRate;
    const numSamples    = audioBuffer.length;
    const bitsPerSample = 16;
    const blockAlign    = numChannels * (bitsPerSample / 8);
    const byteRate      = sampleRate * blockAlign;
    const dataSize      = numSamples * blockAlign;
    const buffer        = new ArrayBuffer(44 + dataSize);
    const view          = new DataView(buffer);

    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    const channels = [];
    for (let c = 0; c < numChannels; c++) channels.push(audioBuffer.getChannelData(c));

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numChannels; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  _buildSynth(settings, destination = null) {
    const { instrumentType, oscillator, envelope, filter, effects, volume, pan, portamento: portamentoVal } = settings || {};
    const validOscTypes = ['sine','square','triangle','sawtooth','fatsine','fatsquare','fatsawtooth','pwm','fmsine','fmsquare'];
    let oscType = oscillator?.type || 'fatsawtooth';
    if (!validOscTypes.includes(oscType)) oscType = 'fatsawtooth';

    const env = {
      attack:  Math.max(0.001, envelope?.attack || 0.05),
      decay:   Math.max(0.01, envelope?.decay || 0.2),
      sustain: Math.min(1, Math.max(0, envelope?.sustain || 0.5)),
      release: Math.max(0.05, envelope?.release || 0.8),
    };

    const filterSettings = filter ? {
      type: filter.type || 'lowpass',
      frequency: Math.min(18000, Math.max(100, filter.frequency || 3000)),
      Q: Math.min(20, Math.max(0.1, filter.Q || 1)),
      rolloff: [-12,-24,-48].includes(filter.rolloff) ? filter.rolloff : -24,
    } : null;

    const synthConfig = {
      oscillator: {
        type: oscType,
        ...(oscillator?.count ? { count: oscillator.count } : {}),
        ...(oscillator?.spread ? { spread: oscillator.spread } : {}),
        ...(oscillator?.detune != null ? { detune: Math.max(-100, Math.min(100, oscillator.detune)) } : {}),
      },
      envelope: env,
      ...(filterSettings ? { filter: filterSettings } : {})
    };

    const portamento = typeof portamentoVal === 'number' ? Math.max(0, Math.min(0.5, portamentoVal)) : 0;

    let instrument;
    const itype = instrumentType || 'PolySynth';
    try {
      if (itype === 'MonoSynth') instrument = new Tone.MonoSynth({ ...synthConfig, portamento });
      else if (itype === 'FMSynth') instrument = new Tone.FMSynth({ ...synthConfig, modulationIndex: 5 });
      else if (itype === 'AMSynth') instrument = new Tone.AMSynth(synthConfig);
      else instrument = new Tone.PolySynth(Tone.Synth, { ...synthConfig, maxPolyphony: 8 });
    } catch (e) {
      console.warn('[AudioRenderer] Instrument creation failed, falling back to PolySynth:', e.message);
      instrument = new Tone.PolySynth(Tone.Synth, { envelope: env, maxPolyphony: 8 });
    }

    const chain = [];
    const effectsList = Array.isArray(effects) ? effects : [];
    for (const fx of effectsList) {
      try {
        if (!fx?.type || fx?.wet <= 0.02) continue;
        switch (fx.type) {
          case 'Reverb': chain.push(new Tone.Reverb({ decay: Math.max(0.5, fx.decay || 2), preDelay: 0.01, wet: Math.min(0.8, fx.wet) })); break;
          case 'Delay':  chain.push(new Tone.PingPongDelay({ delayTime: fx.delayTime || '8n', feedback: Math.min(0.6, fx.feedback || 0.2), wet: Math.min(0.5, fx.wet) })); break;
          case 'Distortion': chain.push(new Tone.Distortion({ distortion: Math.min(0.8, fx.distortion || 0.2), wet: Math.min(0.5, fx.wet) })); break;
          case 'Chorus': chain.push(new Tone.Chorus({ frequency: fx.frequency || 3, depth: fx.depth || 0.5, wet: Math.min(0.5, fx.wet) })); break;
        }
      } catch (e) { console.warn(`[AudioRenderer] Effect ${fx.type} failed:`, e.message); }
    }

    const panValue = typeof pan === 'number' ? Math.max(-1, Math.min(1, pan)) : 0;
    const panner = panValue !== 0 ? new Tone.Panner(panValue) : null;

    // ── Gain staging: apply volume as pre-effects gain ─────────────────
    // instrument.volume sets the synth output level BEFORE effects.
    // A distortion or chorus can add gain inside the chain — so we also
    // add a post-effects Volume node to re-apply the intended level after FX.
    const targetDb = typeof volume === 'number'
        ? Math.max(-36, Math.min(0, volume))
        : -12; // safe default if LLM didn't return a volume

    // Pre-FX: set instrument output to the target level
    instrument.volume.value = targetDb;

    // Post-FX: a Volume node after the entire chain brings level back to target.
    // This prevents distortion/chorus gain from accumulating before the master bus.
    const postFxGain = new Tone.Volume(0); // starts at 0dB, adjusted below
    chain.push(postFxGain);

    // In multitrack mode the master compressor handles bus limiting.
    // In single-track mode add a safety limiter to avoid WAV clipping.
    const isSingleTrack = !destination;
    if (isSingleTrack) {
        chain.push(new Tone.Limiter(-1));
    }

    const finalDest = destination || Tone.getDestination();
    if (panner) {
        if (chain.length > 0) instrument.chain(...chain, panner, finalDest);
        else { instrument.connect(panner); panner.connect(finalDest); }
    } else {
        if (chain.length > 0) instrument.chain(...chain, finalDest);
        else instrument.connect(finalDest);
    }

    // Compensate for gain added by effects:
    // Distortion can add ~+3-6dB, Chorus ~+1-2dB — pull back accordingly.
    // This runs after chain() so postFxGain is already connected.
    let fxGainCompensation = 0;
    for (const fx of (Array.isArray(effects) ? effects : [])) {
        if (!fx?.type || (fx.wet ?? 0) <= 0.02) continue;
        if (fx.type === 'Distortion' && fx.distortion > 0.3) {
            fxGainCompensation -= Math.min(6, fx.distortion * 8 * (fx.wet || 0.5));
        } else if (fx.type === 'Chorus' && (fx.wet || 0) > 0.3) {
            fxGainCompensation -= 1.5 * (fx.wet || 0);
        }
    }
    if (fxGainCompensation < 0) {
        postFxGain.volume.value = Math.max(-12, fxGainCompensation);
    }

    return instrument;
  }
}
