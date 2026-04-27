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
    
    // Προσθήκη 2.5 δευτερολέπτων για να μην κόβεται το Reverb/Delay tail
    const renderDuration = durationSeconds + 2.5;

    const pumpGenres = new Set(['house', 'techno', 'trance', 'edm', 'drum-and-bass', 'disco', 'synthwave']);
    const useSidechain = pumpGenres.has((genre || '').toLowerCase());
    const sidechainTargets = new Set(['bassline', 'chord', 'pad-textures', 'arpeggio']);

    let audioBuffer;
    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;

        // Κεντρική αλυσίδα Master (Limiter στα -1.5dB για "αέρα")
        const masterLimiter = new Tone.Limiter(-1.5).toDestination();
        const masterCompressor = new Tone.Compressor({
          threshold: -15, 
          ratio: 3, 
          attack: 0.01, 
          release: 0.2
        }).connect(masterLimiter);

        // Sidechain Bus (πιο ήπιο threshold για να μην "πνίγονται" τα όργανα)
        let sidechainBus = null;
        if (useSidechain) {
          sidechainBus = new Tone.Compressor({
            threshold: -20, // Από -30 που ήταν, το πηγαίνουμε -20
            ratio: 4,
            attack: 0.01,
            release: 0.15
          }).connect(masterCompressor);
        }

        const trackPromises = tracks.map(async (trackData, index) => {
          const type = (trackData.type || 'lead').toLowerCase();
          
          // Δυναμικός καθορισμός έντασης ανάλογα με τον τύπο οργάνου
          let volume = -10; 
          if (type.includes('bass')) volume = -8;
          if (type.includes('lead')) volume = -7; 
          if (type.includes('perc') || type.includes('drum')) volume = -6;
          if (type.includes('pad') || type.includes('chord')) volume = -15;

          const destination = (useSidechain && sidechainTargets.has(type)) 
            ? sidechainBus 
            : masterCompressor;

          const instrument = await this._createInstrument(trackData, destination, volume);
          
          // Διόρθωση Velocity για να μην υπάρχουν "βουβές" νότες
          trackData.notes.forEach(note => {
            // Αν το velocity είναι κάτω από 0.3, το ενισχύουμε στο 0.5
            const finalVelocity = (note.velocity < 0.3) ? 0.5 : note.velocity;
            
            instrument.triggerAttackRelease(
              note.name,
              note.duration,
              note.time,
              finalVelocity
            );
          });

          onProgress?.(0.05 + (0.85 * (index / tracks.length)));
        });

        await Promise.all(trackPromises);
      }, renderDuration);

      onProgress?.(0.95);
      return this.bufferToWav(audioBuffer);
    } catch (err) {
      console.error('[AudioRenderer] Render failed:', err);
      throw err;
    }
  }

  async _createInstrument(trackData, destination, baseVolume) {
    const { patch, pan, effects } = trackData;
    
    const sampler = new Tone.Sampler({
      urls: patch.samples,
      baseUrl: patch.baseUrl
    });

    // Εφαρμογή της τελικής έντασης
    sampler.volume.value = baseVolume;

    const chain = [];
    const effectsList = Array.isArray(effects) ? effects : (patch.effects || []);

    for (const fx of effectsList) {
      try {
        const node = this._createFX(fx);
        if (node) chain.push(node);
      } catch (e) {
        console.warn(`[AudioRenderer] FX ${fx.type} failed:`, e.message);
      }
    }

    const panValue = typeof pan === 'number' ? Math.max(-1, Math.min(1, pan)) : 0;
    const panner = panValue !== 0 ? new Tone.Panner(panValue) : null;

    if (panner) {
      if (chain.length > 0) sampler.chain(...chain, panner, destination);
      else { sampler.connect(panner); panner.connect(destination); }
    } else {
      if (chain.length > 0) sampler.chain(...chain, destination);
      else sampler.connect(destination);
    }

    await Tone.loaded();
    return sampler;
  }

  _createFX(fx) {
    if (!fx || !fx.type) return null;
    switch (fx.type) {
      case 'Reverb': return new Tone.Reverb({ decay: fx.decay || 1.5, wet: Math.min(0.6, fx.wet || 0.3) });
      case 'Delay': return new Tone.FeedbackDelay({ delayTime: fx.delayTime || '8n', feedback: fx.feedback || 0.2, wet: fx.wet || 0.2 });
      case 'Distortion': return new Tone.Distortion({ distortion: fx.distortion || 0.2, wet: fx.wet || 0.1 });
      default: return null;
    }
  }

  bufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const bufferLen = buffer.length;
    const dataLen = bufferLen * blockAlign;
    const headerLen = 44;
    const totalLen = headerLen + dataLen;
    
    const arrayBuffer = new ArrayBuffer(totalLen);
    const view = new DataView(arrayBuffer);
    
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, totalLen - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLen, true);
    
    const offset = 44;
    const channelData = [];
    for (let i = 0; i < numChannels; i++) {
      channelData.push(buffer.getChannelData(i));
    }
    
    let index = 0;
    for (let i = 0; i < bufferLen; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        let sample = channelData[channel][i];
        sample = Math.max(-1, Math.min(1, sample));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset + (index * 2), sample, true);
        index++;
      }
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }
}

  _buildSynth(settings, destination = null) {
    const {
        instrumentType, oscillator, envelope, filter, filterEnvelope,
        effects, volume, pan, portamento: portamentoVal,
        pitchDecay, octaves, harmonicity, modulationIndex, resonance,
        modulation
    } = settings || {};

    const validOscTypes = ['sine','square','triangle','sawtooth','fatsine','fatsquare','fatsawtooth','fatsawtooth','pwm','fmsine','fmsquare','fmsawtooth'];
    let oscType = oscillator?.type || 'fatsawtooth';
    if (!validOscTypes.includes(oscType)) oscType = 'fatsawtooth';

    const env = {
        attack:  Math.max(0.001, envelope?.attack  || 0.05),
        decay:   Math.max(0.01,  envelope?.decay   || 0.2),
        sustain: Math.min(1, Math.max(0, envelope?.sustain || 0.5)),
        release: Math.max(0.05,  envelope?.release || 0.8),
    };

    const filterSettings = filter ? {
        type:      filter.type      || 'lowpass',
        frequency: Math.min(18000, Math.max(100, filter.frequency || 3000)),
        Q:         Math.min(20, Math.max(0.1, filter.Q || 1)),
        rolloff:   [-12,-24,-48].includes(filter.rolloff) ? filter.rolloff : -24,
    } : null;

    const filterEnvSettings = filterEnvelope ? {
        attack:        Math.max(0.001, filterEnvelope.attack        || 0.1),
        decay:         Math.max(0.01,  filterEnvelope.decay         || 0.5),
        sustain:       Math.min(1, Math.max(0, filterEnvelope.sustain || 0.2)),
        release:       Math.max(0.05,  filterEnvelope.release       || 1.0),
        baseFrequency: Math.min(4000, Math.max(20, filterEnvelope.baseFrequency || 200)),
        octaves:       Math.min(8, Math.max(1, filterEnvelope.octaves || 3)),
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
        ...(oscType === 'pwm' && oscillator?.modulationFrequency ? { modulationFrequency: oscillator.modulationFrequency } : {}),
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
                harmonicity:     Math.min(10,    Math.max(0.5, harmonicity     || 5.1)),
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
            if (lfo.target === 'filter.frequency' && instrument.filter?.frequency) lfoNode.connect(instrument.filter.frequency);
            else if (lfo.target === 'detune' && instrument.detune) lfoNode.connect(instrument.detune);
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

    const targetDb = typeof volume === 'number' ? Math.max(-36, Math.min(0, volume)) : -12;
    instrument.volume.value = targetDb;

    const postFxGain = new Tone.Volume(0);
    chain.push(postFxGain);

    if (!destination) chain.push(new Tone.Limiter(-1)); // single-track safety

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
        else if (fx.type === 'Chorus'     && (fx.wet || 0) > 0.3) fxComp -= 1.5 * (fx.wet || 0);
        else if (fx.type === 'Chebyshev'  && (fx.wet || 0) > 0.2) fxComp -= 2   * (fx.wet || 0);
    }
    if (fxComp < 0) postFxGain.volume.value = Math.max(-12, fxComp);

    return instrument;
  }
}
