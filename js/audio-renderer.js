import * as Tone from 'tone';

export class AudioRenderer {
  async renderMultitrack({ tracks, bpm, durationSeconds, genre, onProgress }) {
    if (!tracks || tracks.length === 0) throw new Error('No tracks to render');
    onProgress?.(0.05);
    const renderDuration = durationSeconds + 2.0;

  const pumpGenres = new Set(['house', 'techno', 'trance', 'edm', 'drum-and-bass', 'disco', 'synthwave']);
// Το kick/sidechain ενεργοποιείται ΜΟΝΟ αν υπάρχει ρητά track 'percs' στο JSON
const useSidechain = tracks.some(t => t.trackType === 'percs') && pumpGenres.has((genre || '').toLowerCase());

    let audioBuffer;
    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;
        transport.PPQ = 192;

        const masterLimiter = new Tone.Limiter(-1).toDestination();
        let sidechainCompressors = {};
        let kickSynth = null;

        if (useSidechain) {
          kickSynth = new Tone.MembraneSynth({
            pitchDecay: 0.05,
            octaves: 6,
            envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
          });
          kickSynth.volume.value = -6;

          const scRelease = Math.round((60 / bpm) * 0.6 * 1000) / 1000;
          for (const targetTrack of sidechainTargets) {
            sidechainCompressors[targetTrack] = new Tone.Compressor({
              threshold: -24,
              ratio: 8,
              attack: 0.003,
              release: scRelease,
              knee: 3
            }).connect(masterLimiter);
          }

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

        for (const track of tracks) {
          const { trackType, notes, synthSettings } = track;
          if (!notes || notes.length === 0) continue;

          // Sanitization (pads only)
          let sanitizedNotes = notes;
          if (trackType === 'pad-textures' || trackType === 'strings') {
            const spb = 60 / bpm;
            const minDur = 2.0 * spb;
            sanitizedNotes = notes
              .map(n => ({ ...n, duration: Math.max(minDur, n.duration) }))
              .filter((n, i, arr) => {
                if (i === 0) return true;
                const prev = arr[i - 1];
                return !(n.midi === prev.midi && (n.time - prev.time) < 0.5 * spb);
              });
            if (sanitizedNotes.length === 0 && notes.length > 0) {
              sanitizedNotes = [{ ...notes[0], duration: minDur }];
            }
          }

              const isPad = (trackType === 'pad-textures' || trackType === 'strings');
      
      if (isPad) {
        // ✅ 1. Περνάμε το masterLimiter ΩΣ destination. 
        //    Το _buildSynth θα το χρησιμοποιήσει ως τελικό κόμβο και ΔΕΝ θα συνδεθεί στο default Tone.getDestination().
        const synth = this._buildSynth(synthSettings, masterLimiter, trackType, true); 
        
        // ✅ 2. ΑΦΑΙΡΕΘΗΚΕ η γραμμή: synth.connect(masterLimiter);
        //    Η διπλή σύνδεση ήταν που προκαλούσε ακύρωση φάσης (silence) στο Tone.Offline.

        synth.volume.value = -6; // Ασφαλές override για ευκρίνεια

        // Fallback αν η sanitization αφαίρεσε κατά λάθος όλες τις νότες
        if (sanitizedNotes.length === 0 && notes.length > 0) {
          const spb = 60 / bpm;
          sanitizedNotes = [{ ...notes[0], duration: 2.0 * spb }];
        }

        new Tone.Part((time, event) => {
          try { synth.triggerAttackRelease(event.note, event.duration, time, event.velocity); }
          catch (e) { console.warn('[Pad] Trigger failed:', e); }
        }, sanitizedNotes.map(n => ({
          time: n.time, note: n.name, duration: n.duration, velocity: n.velocity
        }))).start(0);
        
        console.log(`[AudioRenderer] ✅ Pads/Strings scheduled: ${sanitizedNotes.length} notes`);
        continue; // ✅ Παρακάμπτει τη φυσιολογική δρομολόγηση για τα υπόλοιπα όργανα
      }
          // Non-pad tracks: normal routing
          let dest;
          if (useSidechain && sidechainTargets.has(trackType) && sidechainCompressors[trackType]) {
            dest = sidechainCompressors[trackType];
          } else {
            dest = masterLimiter;
          }

          const synth = this._buildSynth(synthSettings, dest, trackType, false);

          new Tone.Part((time, event) => {
            try { synth.triggerAttackRelease(event.note, event.duration, time, event.velocity); }
            catch (e) {}
          }, sanitizedNotes.map(n => ({
            time: n.time, note: n.name, duration: n.duration, velocity: n.velocity
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
        const synth = this._buildSynth(synthSettings);
        new Tone.Part((time, event) => {
          try { synth.triggerAttackRelease(event.note, event.duration, time, event.velocity); }
          catch (e) {}
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
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numSamples = audioBuffer.length;
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

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

  _buildSynth(settings, destination = null, trackType = '', isPadBoost = false) {
    const {
      instrumentType, oscillator, envelope, filter, filterEnvelope,
      effects, volume, pan, portamento: portamentoVal,
      pitchDecay, octaves, harmonicity, modulationIndex, resonance,
      modulation
    } = settings || {};

    const validOscTypes = ['sine','square','triangle','sawtooth','fatsine','fatsquare','fatsawtooth','pwm','fmsine','fmsquare','fmsawtooth'];
    let oscType = oscillator?.type || 'fatsawtooth';
    if (!validOscTypes.includes(oscType)) oscType = 'fatsawtooth';

    const isPad = (trackType === 'pad-textures' || trackType === 'strings');
    const isBass = (trackType === 'bassline');

    const env = {
      attack: Math.min(isPad ? 2.0 : 0.3, Math.max(0.005, envelope?.attack || 0.05)),
      decay: Math.min(3.0, Math.max(0.05, envelope?.decay || 0.2)),
      sustain: Math.min(1, Math.max(isBass ? 0.3 : 0.1, envelope?.sustain || 0.5)),
      release: Math.min(isPad ? 6.0 : 2.0, Math.max(0.1, envelope?.release || 0.8)),
    };

    const filterSettings = filter ? {
      type: filter.type || 'lowpass',
      frequency: Math.min(18000, Math.max(100, filter.frequency || 3000)),
      Q: Math.min(20, Math.max(0.1, filter.Q || 1)),
      rolloff: [-12,-24,-48].includes(filter.rolloff) ? filter.rolloff : -24,
    } : null;

    const filterEnvSettings = filterEnvelope ? {
      attack: Math.max(0.001, filterEnvelope.attack || 0.1),
      decay: Math.max(0.01, filterEnvelope.decay || 0.5),
      sustain: Math.min(1, Math.max(0, filterEnvelope.sustain || 0.2)),
      release: Math.max(0.05, filterEnvelope.release || 1.0),
      baseFrequency: Math.min(4000, Math.max(20, filterEnvelope.baseFrequency || 200)),
      octaves: Math.min(8, Math.max(1, filterEnvelope.octaves || 3)),
      exponent: Math.min(4, Math.max(1, filterEnvelope.exponent || 2)),
    } : null;

    const portamento = typeof portamentoVal === 'number' ? Math.max(0, Math.min(0.5, portamentoVal)) : 0;
    const itype = instrumentType || 'PolySynth';
    let instrument;

    const oscConfig = {
      type: oscType,
      ...(oscillator?.count ? { count: oscillator.count } : {}),
      ...(oscillator?.spread ? { spread: oscillator.spread } : {}),
      ...(oscillator?.detune != null ? { detune: Math.max(-100, Math.min(100, oscillator.detune)) } : {}),
      ...(oscType === 'pwm' && oscillator?.modulationFrequency ? { modulationFrequency: oscillator.modulationFrequency } : {}),
    };

    try {
      if (itype === 'MembraneSynth') {
        instrument = new Tone.MembraneSynth({
          pitchDecay: Math.min(0.3, Math.max(0.01, pitchDecay || 0.05)),
          octaves: Math.min(10, Math.max(1, octaves || 4)),
          envelope: env,
        });
      } else if (itype === 'MetalSynth') {
        instrument = new Tone.MetalSynth({
          harmonicity: Math.min(10, Math.max(0.5, harmonicity || 5.1)),
          modulationIndex: Math.min(50, Math.max(1, modulationIndex || 16)),
          resonance: Math.min(10000, Math.max(100, resonance || 4000)),
          octaves: Math.min(5, Math.max(0, octaves || 1.5)),
          envelope: env,
        });
      } else if (itype === 'FMSynth') {
        instrument = new Tone.FMSynth({
          oscillator: oscConfig,
          envelope: env,
          modulationIndex: Math.min(50, Math.max(1, modulationIndex || 5)),
          harmonicity: Math.min(10, Math.max(0.5, harmonicity || 3)),
          ...(filterSettings ? { filter: filterSettings } : {})
        });
      } else if (itype === 'AMSynth') {
        instrument = new Tone.AMSynth({
          oscillator: oscConfig,
          envelope: env,
          harmonicity: Math.min(10, Math.max(0.5, harmonicity || 3)),
          ...(filterSettings ? { filter: filterSettings } : {})
        });
      } else if (itype === 'MonoSynth') {
        instrument = new Tone.MonoSynth({
          oscillator: oscConfig,
          envelope: env,
          portamento,
          ...(filterSettings ? { filter: filterSettings } : {}),
          ...(filterEnvSettings ? { filterEnvelope: filterEnvSettings } : {}),
        });
      } else {
        instrument = new Tone.PolySynth(Tone.Synth, {
          oscillator: oscConfig,
          envelope: env,
          ...(filterSettings ? { filter: filterSettings } : {}),
          maxPolyphony: 12,
        });
      }
    } catch (e) {
      console.warn('[AudioRenderer] Instrument fallback to PolySynth:', e.message);
      instrument = new Tone.PolySynth(Tone.Synth, { envelope: env, maxPolyphony: 12 });
    }

    // LFO
    if (modulation?.lfo) {
      try {
        const lfo = modulation.lfo;
        const lfoNode = new Tone.LFO({ type: lfo.type || 'sine', frequency: lfo.frequency || '4n', min: lfo.min ?? 200, max: lfo.max ?? 4000 }).start();
        if (lfo.target === 'filter.frequency' && instrument.filter?.frequency) lfoNode.connect(instrument.filter.frequency);
        else if (lfo.target === 'detune' && instrument.detune) lfoNode.connect(instrument.detune);
        else if (lfo.target === 'volume') lfoNode.connect(instrument.volume);
      } catch (e) { console.warn('[AudioRenderer] LFO failed:', e.message); }
    }

    // Effects chain
    const chain = [];
    const effectsList = Array.isArray(effects) ? effects : [];
    for (const fx of effectsList) {
      try {
        if (!fx?.type || (fx.wet ?? 0) <= 0.02) continue;
        switch (fx.type) {
          case 'Distortion': chain.push(new Tone.Distortion({ distortion: Math.min(0.8, fx.distortion || 0.3), wet: Math.min(0.5, fx.wet) })); break;
          case 'Chebyshev': chain.push(new Tone.Chebyshev({ order: Math.min(10, Math.max(1, fx.order || 2)), wet: Math.min(0.3, fx.wet) })); break;
          case 'BitCrusher': chain.push(new Tone.BitCrusher({ bits: Math.min(16, Math.max(4, fx.bits || 8)), wet: Math.min(0.3, fx.wet) })); break;
          case 'AutoFilter': chain.push(new Tone.AutoFilter({ frequency: fx.frequency || '4n', baseFrequency: fx.baseFrequency || 200, octaves: Math.min(6, fx.octaves || 2.6), wet: Math.min(0.6, fx.wet) }).start()); break;
          case 'Chorus': chain.push(new Tone.Chorus({ frequency: fx.frequency || 3, depth: fx.depth || 0.5, wet: Math.min(0.5, fx.wet) }).start()); break;
          case 'Phaser': chain.push(new Tone.Phaser({ frequency: fx.frequency || 0.5, octaves: Math.min(6, fx.octaves || 3), wet: Math.min(0.5, fx.wet) })); break;
          case 'Tremolo': chain.push(new Tone.Tremolo({ frequency: fx.frequency || '4n', depth: Math.min(0.8, fx.depth || 0.5), wet: Math.min(0.5, fx.wet) }).start()); break;
          case 'PingPongDelay':
          case 'Delay': chain.push(new Tone.PingPongDelay({ delayTime: fx.delayTime || '8n', feedback: Math.min(0.6, fx.feedback || 0.2), wet: Math.min(0.5, fx.wet) })); break;
          case 'Reverb': chain.push(new Tone.Reverb({ decay: Math.max(0.5, fx.decay || 2), preDelay: Math.min(0.1, fx.preDelay || 0.01), wet: Math.min(0.8, fx.wet) })); break;
        }
      } catch (e) { console.warn(`[AudioRenderer] FX ${fx.type} failed:`, e.message); }
    }

    const panValue = typeof pan === 'number' ? Math.max(-1, Math.min(1, pan)) : 0;
    const panner = panValue !== 0 ? new Tone.Panner(panValue) : null;

    // Volume: pads get extra boost
    let targetDb = typeof volume === 'number' ? Math.max(-36, Math.min(0, volume)) : -12;
    if (isPad || isPadBoost) {
      targetDb = Math.max(targetDb, -8); // minimum -8 dB
    }
    instrument.volume.value = targetDb;

    // Additional gain stage for pads if requested (isPadBoost)
    const postFxGain = new Tone.Volume(0);
    if (isPadBoost) {
      postFxGain.volume.value = 6; // +6 dB boost
    }
    chain.push(postFxGain);

    // FX compensation: apply only to non-pads
    if (!isPad && !isPadBoost) {
      let fxComp = 0;
      for (const fx of effectsList) {
        if (!fx?.type || (fx.wet ?? 0) <= 0.02) continue;
        if (fx.type === 'Distortion' && fx.distortion > 0.3) fxComp -= Math.min(6, fx.distortion * 8 * (fx.wet || 0.5));
        else if (fx.type === 'Chorus' && (fx.wet || 0) > 0.3) fxComp -= 1.5 * (fx.wet || 0);
        else if (fx.type === 'Chebyshev' && (fx.wet || 0) > 0.2) fxComp -= 2 * (fx.wet || 0);
      }
      if (fxComp < 0) {
        postFxGain.volume.value = Math.max(-12, fxComp);
      }
    }

    if (!destination) {
      const safetyLimiter = new Tone.Limiter(-2);
      chain.push(safetyLimiter);
    }

    const finalDest = destination || Tone.getDestination();
    if (panner) {
      if (chain.length > 0) instrument.chain(...chain, panner, finalDest);
      else { instrument.connect(panner); panner.connect(finalDest); }
    } else {
      if (chain.length > 0) instrument.chain(...chain, finalDest);
      else instrument.connect(finalDest);
    }

    return instrument;
  }
}
