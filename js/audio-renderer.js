import * as Tone from 'tone';

export class AudioRenderer {
  /**
   * 🛠️ FIX 4: Έξυπνο Gain Staging ανά ρόλο οργάνου & πυκνότητα
   * Αντικαθιστά τις ακραίες τιμές του AI με μουσικά ισορροπημένα επίπεδα.
   */
  _normalizeTrackGain(trackType, baseVolume, density = 'moderate') {
    const densityComp = density > 0.7 ? -3 : density < 0.3 ? 2 : 0;
    const roleBase = {
      bassline: -8, lead: -10, percs: -12, melody: -12,
      chord: -16, keys: -16, guitar: -16, plucks: -16,
      arpeggio: -16, strings: -20, 'pad-textures': -22
    }[trackType] || -14;
    // Ασφαλές κλείσιμο μεταξύ -24dB και -4dB
    return Math.max(-22, Math.min(-4, roleBase + densityComp));
  }

  async renderMultitrack({ tracks, bpm, durationSeconds, genre, onProgress }) {
    if (!tracks || tracks.length === 0) throw new Error('No tracks to render');
    onProgress?.(0.05);
    const renderDuration = durationSeconds + 2.0;

    const pumpGenres = new Set(['house', 'techno', 'trance', 'edm', 'drum-and-bass', 'disco', 'synthwave']);
    const useSidechain = pumpGenres.has((genre || '').toLowerCase());
    const sidechainTargets = new Set(['bassline', 'chord', 'pad-textures', 'arpeggio']);

    let audioBuffer;
    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;

        // 🛠️ FIX 1: Πιο ήπια κύρια συμπίεση (αποτρέπει το "squashing")
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
          // Δυναμικό release συγχρονισμένο με το BPM
          const scRelease = Math.max(0.1, Math.round((60 / bpm) * 0.8 * 1000) / 1000);
          
          // 🛠️ FIX 2: Λιγότερο επιθετικό sidechain (μουσικό "ducking" αντί πνιγμού)
          for (const targetTrack of sidechainTargets) {
            sidechainCompressors[targetTrack] = new Tone.Compressor({
              threshold: -16,
              ratio: 4,
              attack: 0.005,
              release: scRelease,
              knee: 6
            }).connect(masterCompressor);
          }

          // Σιωπηλός 4/4 kick trigger μόνο για sidechain input
          const kickSynth = new Tone.MembraneSynth({
            pitchDecay: 0.05,
            octaves: 6,
            envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
          });
          kickSynth.volume.value = -Infinity;

          Object.values(sidechainCompressors).forEach(sc => {
            kickSynth.connect(sc.sidechain || sc);
          });

          const totalBeats = Math.ceil(durationSeconds / (60 / bpm));
          const kickEvents = [];
          for (let beat = 0; beat < totalBeats; beat++) {
            kickEvents.push({ time: beat * (60 / bpm) });
          }

          new Tone.Part((time) => {
            kickSynth.triggerAttackRelease('C1', '8n', time);
          }, kickEvents).start(0);
        }

        // 🛠️ DEBUG: Log εντάσεων & velocities για εύκολο εντοπισμό προβλημάτων
        console.group('[AudioRenderer] Track Debug');
        tracks.forEach(t => {
          const notes = t.notes || [];
          const maxVel = notes.length ? Math.max(...notes.map(n => n.velocity || 0)) : 0;
          const avgVel = notes.length ? notes.reduce((a, n) => a + (n.velocity || 0), 0) / notes.length : 0;
          console.log(`🎵 ${t.trackType} | Notes: ${notes.length} | MaxVel: ${maxVel.toFixed(2)} | AvgVel: ${avgVel.toFixed(2)}`);
        });
        console.groupEnd();

        for (const track of tracks) {
          const { trackType, notes, synthSettings } = track;
          if (!notes || notes.length === 0) continue;

          const dest = (useSidechain && sidechainTargets.has(trackType) && sidechainCompressors[trackType])
            ? sidechainCompressors[trackType]
            : masterCompressor;

          const synth = this._buildSynth(synthSettings, dest, trackType);

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

  async render({ trackType, notes, synthSettings, bpm, durationSeconds, onProgress }) {
    if (!notes || notes.length === 0) throw new Error('No notes to render');
    onProgress?.(0.05);
    const renderDuration = durationSeconds + 1.5;
    let audioBuffer;
    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;
        const synth = this._buildSynth(synthSettings, null, trackType);

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

  _buildSynth(settings, destination = null, trackType = 'unknown') {
    const {
      instrumentType, oscillator, envelope, filter, filterEnvelope,
      effects, volume, pan, portamento: portamentoVal,
      pitchDecay, octaves, harmonicity, modulationIndex, resonance,
      modulation
    } = settings || {};

    const validOscTypes = ['sine','square','triangle','sawtooth','fatsine','fatsquare','fatsawtooth','fatsawtooth','pwm','fmsine','fmsquare','fmsawtooth'];
    let oscType = oscillator?.type || 'fatsawtooth';
    if (!validOscTypes.includes(oscType)) oscType = 'fatsawtooth';

    // 🛠️ FIX 3: Type-aware ADSR fallbacks (αποτρέπει τα "φάντασμα" νότες)
    const isPerc = instrumentType === 'MembraneSynth' || instrumentType === 'MetalSynth';
    const env = {
      attack:  Math.max(0.001, envelope?.attack  || 0.01),
      decay:   isPerc ? Math.max(0.05, envelope?.decay || 0.2) : Math.max(0.1, envelope?.decay || 0.3),
      sustain: isPerc ? 0 : Math.min(1, Math.max(0.1, envelope?.sustain || 0.4)), // Ελάχιστο sustain για μη κρουστά
      release: Math.max(0.05,  envelope?.release || 0.5),
    };

    const filterSettings = filter ? {
      type:      filter.type      || 'lowpass',
      frequency: Math.min(18000, Math.max(100, filter.frequency || 3000)),
      Q:         Math.min(20, Math.max(0.1, filter.Q  || 1)),
      rolloff:   [-12,-24,-48].includes(filter.rolloff) ? filter.rolloff : -24,
    } : null;

    const filterEnvSettings = filterEnvelope ? {
      attack:        Math.max(0.001, filterEnvelope.attack        || 0.1),
      decay:         Math.max(0.01,  filterEnvelope.decay         || 0.5),
      sustain:       Math.min(1, Math.max(0, filterEnvelope.sustain || 0.2)),
      release:       Math.max(0.05,  filterEnvelope.release       || 1.0),
      baseFrequency: Math.min(4000, Math.max(20, filterEnvelope.baseFrequency || 200)),
      octaves:        Math.min(8, Math.max(1, filterEnvelope.octaves || 3)),
      exponent:      Math.min(4, Math.max(1, filterEnvelope.exponent || 2)),
    } : null;

    const portamento = typeof portamentoVal === 'number' ? Math.max(0, Math.min(0.5, portamentoVal)) : 0;
    const itype = instrumentType || 'PolySynth';
    let instrument;

    const oscConfig = {
      type: oscType,
      ...(oscillator?.count  ? { count:  oscillator.count  } : {}),
      ...(oscillator?.spread ? { spread: oscillator.spread } : {}),
      ...(oscillator?.detune != null ? { detune: Math.max(-100, Math.min(100, oscillator.detune)) } : {}),
      ...(oscType === 'pwm'  && oscillator?.modulationFrequency ? { modulationFrequency: oscillator.modulationFrequency } : {}),
    };

    try {
      if (itype === 'MembraneSynth') {
        instrument = new Tone.MembraneSynth({
          pitchDecay: Math.min(0.3,  Math.max(0.01, pitchDecay  || 0.05)),
          octaves:    Math.min(10,   Math.max(1,    octaves      || 4)),
          envelope:   env,
        });
      } else if (itype === 'MetalSynth') {
        instrument = new Tone.MetalSynth({
          harmonicity:     Math.min(10,    Math.max(0.5, harmonicity      || 5.1)),
          modulationIndex: Math.min(50,    Math.max(1,   modulationIndex || 16)),
          resonance:       Math.min(10000, Math.max(100, resonance       || 4000)),
          octaves:         Math.min(5,     Math.max(0,   octaves         || 1.5)),
          envelope:        env,
        });
      } else if (itype === 'FMSynth') {
        instrument = new Tone.FMSynth({
          oscillator:      oscConfig,
          envelope:        env,
          modulationIndex: Math.min(50, Math.max(1, modulationIndex || 5)),
          harmonicity:     Math.min(10, Math.max(0.5, harmonicity   || 3)),
          ...(filterSettings ? { filter: filterSettings } : {})
        });
      } else if (itype === 'AMSynth') {
        instrument = new Tone.AMSynth({
          oscillator:  oscConfig,
          envelope:    env,
          harmonicity: Math.min(10, Math.max(0.5, harmonicity || 3)),
          ...(filterSettings ? { filter: filterSettings } : {})
        });
      } else if (itype === 'MonoSynth') {
        instrument = new Tone.MonoSynth({
          oscillator:  oscConfig,
          envelope:    env,
          portamento,
          ...(filterSettings    ? { filter:         filterSettings    } : {}),
          ...(filterEnvSettings ? { filterEnvelope: filterEnvSettings } : {}),
        });
      } else {
        instrument = new Tone.PolySynth(Tone.Synth, {
          oscillator:  oscConfig,
          envelope:    env,
          ...(filterSettings ? { filter: filterSettings } : {}),
          maxPolyphony: 8,
        });
      }
    } catch (e) {
      console.warn('[AudioRenderer] Instrument fallback to PolySynth:', e.message);
      instrument = new Tone.PolySynth(Tone.Synth, { envelope: env, maxPolyphony: 8 });
    }

    // LFO modulation
    if (modulation?.lfo) {
      try {
        const lfo = modulation.lfo;
        const lfoNode = new Tone.LFO({ type: lfo.type || 'sine', frequency: lfo.frequency || '4n', min: lfo.min ?? 200, max: lfo.max ?? 4000 }).start();
        if (lfo.target === 'filter.frequency'  && instrument.filter?.frequency) lfoNode.connect(instrument.filter.frequency);
        else if (lfo.target === 'detune'  && instrument.detune) lfoNode.connect(instrument.detune);
        else if (lfo.target === 'volume') lfoNode.connect(instrument.volume);
      } catch (e) { console.warn('[AudioRenderer] LFO failed:', e.message); }
    }

    const chain = [];
    const effectsList = Array.isArray(effects) ? effects : [];
    for (const fx of effectsList) {
      try {
        if (!fx?.type || (fx.wet ?? 0) <= 0.02) continue;
        switch (fx.type) {
          case 'Distortion':    chain.push(new Tone.Distortion({ distortion: Math.min(0.8, fx.distortion || 0.3), wet: Math.min(0.5, fx.wet) })); break;
          case 'Chebyshev':     chain.push(new Tone.Chebyshev({ order: Math.min(10, Math.max(1, fx.order || 2)), wet: Math.min(0.3, fx.wet) })); break;
          case 'BitCrusher':    chain.push(new Tone.BitCrusher({ bits: Math.min(16, Math.max(4, fx.bits || 8)), wet: Math.min(0.3, fx.wet) })); break;
          case 'AutoFilter':    chain.push(new Tone.AutoFilter({ frequency: fx.frequency || '4n', baseFrequency: fx.baseFrequency || 200, octaves: Math.min(6, fx.octaves || 2.6), wet: Math.min(0.6, fx.wet) }).start()); break;
          case 'Chorus':        chain.push(new Tone.Chorus({ frequency: fx.frequency || 3, depth: fx.depth || 0.5, wet: Math.min(0.5, fx.wet) }).start()); break;
          case 'Phaser':        chain.push(new Tone.Phaser({ frequency: fx.frequency || 0.5, octaves: Math.min(6, fx.octaves || 3), wet: Math.min(0.5, fx.wet) })); break;
          case 'Tremolo':       chain.push(new Tone.Tremolo({ frequency: fx.frequency || '4n', depth: Math.min(0.8, fx.depth || 0.5), wet: Math.min(0.5, fx.wet) }).start()); break;
          case 'PingPongDelay':
          case 'Delay':         chain.push(new Tone.PingPongDelay({ delayTime: fx.delayTime || '8n', feedback: Math.min(0.6, fx.feedback || 0.2), wet: Math.min(0.5, fx.wet) })); break;
          case 'Reverb':        chain.push(new Tone.Reverb({ decay: Math.max(0.5, fx.decay || 2), preDelay: Math.min(0.1, fx.preDelay || 0.01), wet: Math.min(0.8, fx.wet) })); break;
        }
      } catch (e) { console.warn(`[AudioRenderer] FX ${fx.type} failed:`, e.message); }
    }

    const panValue = typeof pan === 'number' ? Math.max(-1, Math.min(1, pan)) : 0;
    const panner   = panValue !== 0 ? new Tone.Panner(panValue) : null;

    // 🛠️ FIX 4: Εφαρμογή έξυπνου gain staging πριν τα εφέ
    const targetDb = this._normalizeTrackGain(trackType, volume, 'moderate');
    instrument.volume.value = targetDb;

    const postFxGain = new Tone.Volume(0);
    chain.push(postFxGain);

    if (!destination) chain.push(new Tone.Limiter(-1));

    const finalDest = destination || Tone.getDestination();
    if (panner) {
      if (chain.length > 0) instrument.chain(...chain, panner, finalDest);
      else { instrument.connect(panner); panner.connect(finalDest); }
    } else {
      if (chain.length > 0) instrument.chain(...chain, finalDest);
      else instrument.connect(finalDest);
    }

    let fxComp = 0;
    for (const fx of effectsList) {
      if (!fx?.type || (fx.wet ?? 0) <= 0.02) continue;
      if (fx.type === 'Distortion' && fx.distortion > 0.3) fxComp -= Math.min(6, fx.distortion * 8 * (fx.wet || 0.5));
      else if (fx.type === 'Chorus' && (fx.wet || 0) > 0.3) fxComp -= 1.5 * (fx.wet || 0);
      else if (fx.type === 'Chebyshev' && (fx.wet || 0) > 0.2) fxComp -= 2 * (fx.wet || 0);
    }
    if (fxComp < 0) postFxGain.volume.value = Math.max(-12, fxComp);

    return instrument;
  }
}
