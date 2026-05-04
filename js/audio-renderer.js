import * as Tone from 'tone';

export class AudioRenderer {
  /**
   * Έξυπνο Gain Staging ανά ρόλο οργάνου & πυκνότητα.
   * Αντικαθιστά τις τιμές του AI με ισορροπημένα επίπεδα[cite: 2].
   */
  _normalizeTrackGain(trackType, baseVolume, density = 'moderate') {
    const densityComp = density === 'high' ? -3 : density === 'low' ? 2 : 0;
    const roleBase = {
      bassline: -8, lead: -10, percs: -12, melody: -12,
      chord: -16, keys: -16, guitar: -16, plucks: -16,
      arpeggio: -16, strings: -20, 'pad-textures': -22, pad: -22
    }[trackType] || -14;
    
    return Math.max(-24, Math.min(-4, roleBase + densityComp));
  }

  async renderMultitrack({ tracks, bpm, durationSeconds, genre, onProgress }) {
    if (!tracks || tracks.length === 0) throw new Error('No tracks to render');
    onProgress?.(0.05);
    const renderDuration = durationSeconds + 2.0;

    const pumpGenres = new Set(['house', 'techno', 'trance', 'edm', 'drum-and-bass', 'disco', 'synthwave']);
    const useSidechain = pumpGenres.has((genre || '').toLowerCase());
    const sidechainTargets = new Set(['bassline', 'chord', 'pad-textures', 'pad', 'arpeggio', 'strings']);

    let audioBuffer;
    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;

        // Master Chain: Limiter -> Compressor[cite: 2]
        const masterLimiter = new Tone.Limiter(-2).toDestination();
        const masterCompressor = new Tone.Compressor({
          threshold: -18,
          ratio: 2.5,
          attack: 0.005,
          release: 0.15,
          knee: 6
        }).connect(masterLimiter);

        let sidechainCompressors = {};
        if (useSidechain) {
          const scRelease = Math.max(0.1, Math.round((60 / bpm) * 0.8 * 1000) / 1000);
          
          for (const targetTrack of sidechainTargets) {
            sidechainCompressors[targetTrack] = new Tone.Compressor({
              threshold: -16,
              ratio: 4,
              attack: 0.005,
              release: scRelease,
              knee: 6
            }).connect(masterCompressor);
          }

          // Σιωπηλός kick trigger για το sidechain[cite: 2]
          const kickSynth = new Tone.MembraneSynth();
          kickSynth.volume.value = -Infinity;
          Object.values(sidechainCompressors).forEach(sc => kickSynth.connect(sc.sidechain || sc));

          const totalBeats = Math.ceil(durationSeconds / (60 / bpm));
          for (let beat = 0; beat < totalBeats; beat++) {
            transport.schedule((time) => {
              kickSynth.triggerAttackRelease('C1', '8n', time);
            }, beat * (60 / bpm));
          }
        }

        for (const track of tracks) {
          const { trackType, notes, patch } = track; // Το synthesize.js στέλνει 'patch'
          if (!notes || notes.length === 0) continue;

          const dest = (useSidechain && sidechainTargets.has(trackType) && sidechainCompressors[trackType])
            ? sidechainCompressors[trackType]
            : masterCompressor;

          const instrument = this._buildSynth(patch, dest, trackType);

          new Tone.Part((time, event) => {
            try {
              instrument.triggerAttackRelease(event.note, event.duration, time, event.velocity);
            } catch (e) { /* voice overflow safety */ }
          }, notes.map(n => ({
            time: n.time, note: n.name || n.note,
            duration: n.duration, velocity: n.velocity || 0.7
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

  _buildSynth(settings, destination = null, trackType = 'unknown') {
    const {
      instrumentType, oscillator, envelope, filter, filterEnvelope,
      effects, volume, pan, portamento,
      pitchDecay, octaves, harmonicity, modulationIndex, resonance,
      modulation, voice0, voice1, vibratoAmount
    } = settings || {};

    const validOscTypes = ['sine','square','triangle','sawtooth','fatsine','fatsquare','fatsawtooth','pwm','fmsine','fmsquare','fmsawtooth'];
    let oscType = oscillator?.type || 'fatsawtooth';
    if (!validOscTypes.includes(oscType)) oscType = 'fatsawtooth';

    const isPerc = ['MembraneSynth', 'MetalSynth', 'NoiseSynth'].includes(instrumentType);
    const env = {
      attack:  Math.max(0.001, envelope?.attack  || 0.01),
      decay:   isPerc ? Math.max(0.05, envelope?.decay || 0.2) : Math.max(0.1, envelope?.decay || 0.3),
      sustain: isPerc ? 0 : Math.min(1, Math.max(0.1, envelope?.sustain || 0.4)),
      release: Math.max(0.05,  envelope?.release || 0.5),
    };

    const oscConfig = {
      type: oscType,
      phase: oscillator?.phase || "random", // FIX: Αποφυγή phasing
      ...(oscillator?.count  ? { count:  oscillator.count  } : {}),
      ...(oscillator?.spread ? { spread: oscillator.spread } : {}),
      ...(oscillator?.detune != null ? { detune: oscillator.detune } : {}),
    };

    let instrument;
    const itype = instrumentType || 'PolySynth';

    try {
      if (itype === 'DuoSynth') { // FIX: Νέο DuoSynth (Source 1)
        instrument = new Tone.DuoSynth({
          vibratoAmount: vibratoAmount || 0.5,
          voice0: { oscillator: oscConfig, envelope: env, filterEnvelope: filterEnvelope || {} },
          voice1: { oscillator: oscConfig, envelope: env, filterEnvelope: filterEnvelope || {} }
        });
      } else if (itype === 'NoiseSynth') { // FIX: Σωστά Hi-hats (Source 1)
        instrument = new Tone.NoiseSynth({ envelope: env });
      } else if (itype === 'MembraneSynth') {
        instrument = new Tone.MembraneSynth({ pitchDecay: pitchDecay || 0.05, octaves: octaves || 4, envelope: env });
      } else if (itype === 'MetalSynth') {
        instrument = new Tone.MetalSynth({ harmonicity: harmonicity || 5, modulationIndex: modulationIndex || 16, resonance: resonance || 4000, envelope: env });
      } else if (itype === 'MonoSynth') {
        instrument = new Tone.MonoSynth({ oscillator: oscConfig, envelope: env, portamento: portamento || 0, filterEnvelope: filterEnvelope || {} });
      } else {
        instrument = new Tone.PolySynth(Tone.Synth, { oscillator: oscConfig, envelope: env, maxPolyphony: 12 });
      }
    } catch (e) {
      instrument = new Tone.PolySynth(Tone.Synth, { envelope: env });
    }

    // Effects & Panning Logic[cite: 2]
    const chain = [];
    if (Array.isArray(effects)) {
      effects.forEach(fx => {
        if (!fx?.type || fx.wet <= 0.05) return;
        let effectNode;
        if (fx.type === 'Reverb') effectNode = new Tone.Reverb({ decay: fx.decay || 2.5, wet: fx.wet });
        if (fx.type === 'Distortion') effectNode = new Tone.Distortion({ distortion: fx.distortion || 0.4, wet: fx.wet });
        if (fx.type === 'Chorus') effectNode = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: fx.wet }).start();
        if (effectNode) chain.push(effectNode);
      });
    }

    const panner = new Tone.Panner(pan || 0);
    instrument.volume.value = this._normalizeTrackGain(trackType, volume);
    
    if (chain.length > 0) instrument.chain(...chain, panner, destination);
    else instrument.chain(panner, destination);

    return instrument;
  }

  _audioBufferToWav(audioBuffer) {
    // [Κλασική υλοποίηση μετατροπής WAV - παραμένει ως έχει στο Source 2]
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numSamples = audioBuffer.length;
    const blockAlign = numChannels * 2;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); writeStr(36, 'data'); view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numChannels; c++) {
        let s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(c)[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }
}
