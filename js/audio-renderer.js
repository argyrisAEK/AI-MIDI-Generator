import * as Tone from 'tone';

export class AudioRenderer {
  async renderMultitrack({ tracks, bpm, durationSeconds, genre, trackGainDbByType = {}, onProgress }) {
    if (!tracks || tracks.length === 0) throw new Error('No tracks to render');
    onProgress?.(0.05);
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) throw new Error('Invalid tempo for audio rendering');
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid audio duration');
    const renderDuration = durationSeconds + 2.0;

    const pumpGenres = new Set(['house', 'techno', 'trance', 'edm', 'drum-and-bass', 'disco', 'synthwave']);
    const useSidechain = pumpGenres.has((genre || '').toLowerCase());
    const sidechainTargets = new Set(['bassline', 'chord', 'arpeggio', 'pad-textures', 'keys']);

    let audioBuffer;
    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;

        // Transparent master bus: remove subsonic rumble, control dynamics, prevent overs.
        const masterLimiter = new Tone.Limiter(-1).toDestination();
        const masterCompressor = new Tone.Compressor({ threshold: -12, ratio: 2.5, attack: 0.01, release: 0.15 });
        const masterHighPass = new Tone.Filter(25, 'highpass');
        masterHighPass.connect(masterCompressor);
        masterCompressor.connect(masterLimiter);

        const duckingGains = new Map();
        if (useSidechain) {
          const beatDuration = 60 / bpm;
          const duckRelease = Math.min(0.22, beatDuration * 0.75);
          for (const targetTrack of sidechainTargets) {
            const gain = new Tone.Gain(1).connect(masterHighPass);
            duckingGains.set(targetTrack, gain);
            const beatEvents = [];
            const totalBeats = Math.ceil(durationSeconds / beatDuration);
            for (let beat = 0; beat < totalBeats; beat++) {
              beatEvents.push({ time: beat * beatDuration });
            }
            // Gain automation is genuine ducking; Tone.Compressor has no external sidechain input.
            new Tone.Part((time) => {
              const param = gain.gain;
              param.cancelScheduledValues(time);
              param.setValueAtTime(0.45, time);
              param.linearRampToValueAtTime(1, time + duckRelease);
            }, beatEvents).start(0);
          }
        }

        for (const track of tracks) {
          const { trackType, notes, synthSettings } = track;
          if (!notes || notes.length === 0) continue;
          const dest = duckingGains.get(trackType) || masterHighPass;
          const additionalGainDb = Number.isFinite(trackGainDbByType?.[trackType]) ? trackGainDbByType[trackType] : 0;
          const synth = await this._buildSynth(synthSettings, dest, trackType, additionalGainDb);
          new Tone.Part((time, event) => {
            try { synth.triggerAttackRelease(event.note, event.duration, time, event.velocity); }
            catch (e) { /* ignore */ }
          }, notes.map(n => ({
            time: n.time, note: n.name, duration: n.duration, velocity: n.velocity
          }))).start(0);
        }

        transport.start(0);
      }, renderDuration, 2);
    } catch (err) {
      throw new Error(`Multitrack offline render failed: ${err.message}`);
    }

    // Εφαρμογή fade in/out 50ms για εξάλειψη click
    this._applyFades(audioBuffer, 0.05);
    this.lastRenderMetrics = this._measureAudioBuffer(audioBuffer);
    onProgress?.(0.8);
    const wavBlob = this._audioBufferToWav(audioBuffer);
    onProgress?.(1.0);
    return wavBlob;
  }

  // Render each instrument in isolation so diagnostics can attribute level and spectrum per track.
  // These measurements are pre-master (no shared bus compressor/limiter) and are diagnostic only.
  async analyzeTracksIndividually({ tracks, bpm, durationSeconds, onProgress }) {
    if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('No tracks to analyze individually');
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) throw new Error('Invalid tempo for track analysis');
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid duration for track analysis');

    const renderDuration = durationSeconds + 2.0;
    const results = [];
    const activeTracks = tracks.filter(track => Array.isArray(track.notes) && track.notes.length > 0);

    for (let index = 0; index < activeTracks.length; index++) {
      const track = activeTracks[index];
      let audioBuffer;
      try {
        audioBuffer = await Tone.Offline(async ({ transport }) => {
          transport.bpm.value = bpm;
          const synth = await this._buildSynth(track.synthSettings, null, track.trackType);
          new Tone.Part((time, event) => {
            synth.triggerAttackRelease(event.note, event.duration, time, event.velocity);
          }, track.notes.map(note => ({
            time: note.time,
            note: note.name,
            duration: note.duration,
            velocity: note.velocity
          }))).start(0);
          transport.start(0);
        }, renderDuration, 2);
      } catch (err) {
        throw new Error(`Individual analysis failed for ${track.trackType}: ${err.message}`);
      }

      this._applyFades(audioBuffer, 0.05);
      const metrics = this._measureAudioBuffer(audioBuffer);
      results.push({
        trackType: track.trackType,
        noteCount: track.notes.length,
        peakDbfs: metrics.peakDbfs,
        rmsDbfs: metrics.rmsDbfs,
        spectrum: metrics.spectrum
      });
      onProgress?.((index + 1) / activeTracks.length);
    }

    const loudestRms = Math.max(...results.map(result => result.rmsDbfs).filter(Number.isFinite));
    for (const result of results) {
      result.relativeRmsDb = Number.isFinite(loudestRms) && Number.isFinite(result.rmsDbfs)
        ? result.rmsDbfs - loudestRms
        : null;
    }
    results.sort((a, b) => (b.rmsDbfs || -Infinity) - (a.rmsDbfs || -Infinity));
    this.lastTrackDiagnostics = results;
    return results;
  }

  // Convert isolated-track RMS measurements into conservative, role-aware gain trims.
  // Targets are practical starting points for this renderer, not mastering standards.
  calculateTrackGainAdjustments(trackDiagnostics) {
    const targetRmsDbfsByRole = {
      bassline: -25,
      lead: -30,
      melody: -30,
      brass: -30,
      guitar: -31,
      keys: -32,
      chord: -32,
      plucks: -32,
      strings: -34,
      arpeggio: -35,
      'pad-textures': -35
    };
    const minGainDb = -6;
    const maxGainDb = 6;
    const gainByTrackType = {};

    for (const track of trackDiagnostics || []) {
      const targetDbfs = targetRmsDbfsByRole[track.trackType];
      const hasMeasurement = Number.isFinite(track.rmsDbfs);
      const requestedGainDb = Number.isFinite(targetDbfs) && hasMeasurement
        ? targetDbfs - track.rmsDbfs
        : 0;
      const appliedGainDb = Math.max(minGainDb, Math.min(maxGainDb, requestedGainDb));

      track.targetRmsDbfs = Number.isFinite(targetDbfs) ? targetDbfs : null;
      track.requestedGainDb = requestedGainDb;
      track.appliedGainDb = appliedGainDb;
      track.projectedRmsDbfs = hasMeasurement ? track.rmsDbfs + appliedGainDb : null;
      gainByTrackType[track.trackType] = appliedGainDb;
    }

    return gainByTrackType;
  }

  async render({ trackType, notes, synthSettings, bpm, durationSeconds, onProgress }) {
    if (!notes || notes.length === 0) throw new Error('No notes to render');
    onProgress?.(0.05);
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) throw new Error('Invalid tempo for audio rendering');
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid audio duration');
    const renderDuration = durationSeconds + 1.5;
    let audioBuffer;

    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;
        const synth = await this._buildSynth(synthSettings, null, trackType);

        // Single-track master chain: light compressor → limiter
        const compressor = new Tone.Compressor({ threshold: -18, ratio: 2.5, attack: 0.01, release: 0.2 });
        const limiter = new Tone.Limiter(-1);
        synth.connect(compressor);
        compressor.connect(limiter);
        limiter.toDestination();

        new Tone.Part((time, event) => {
          try { synth.triggerAttackRelease(event.note, event.duration, time, event.velocity); }
          catch (e) {}
        }, notes.map(n => ({
          time: n.time, note: n.name, duration: n.duration, velocity: n.velocity
        }))).start(0);

        transport.start(0);
      }, renderDuration, 2);
    } catch (err) {
      throw new Error(`Offline render failed: ${err.message}`);
    }

    this._applyFades(audioBuffer, 0.05);
    this.lastRenderMetrics = this._measureAudioBuffer(audioBuffer);
    onProgress?.(0.75);
    const wavBlob = this._audioBufferToWav(audioBuffer);
    onProgress?.(1.0);
    return wavBlob;
  }

  _applyFades(audioBuffer, fadeSeconds = 0.05) {
    const fadeSamples = Math.floor(fadeSeconds * audioBuffer.sampleRate);
    if (fadeSamples <= 0 || fadeSamples >= audioBuffer.length / 2) return;
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const data = audioBuffer.getChannelData(c);
      // Fade in (γραμμική αύξηση από 0 σε 1)
      for (let i = 0; i < fadeSamples; i++) {
        data[i] *= (i / fadeSamples);
      }
      // Fade out (γραμμική μείωση από 1 σε 0)
      for (let i = 0; i < fadeSamples; i++) {
        data[data.length - 1 - i] *= (fadeSamples - i) / fadeSamples;
      }
    }
  }

  _measureSpectrum(audioBuffer) {
    const fftSize = 4096;
    const hopSize = 8192;
    const bands = [
      { key: 'sub20To60Hz', min: 20, max: 60 },
      { key: 'bass60To120Hz', min: 60, max: 120 },
      { key: 'lowMid120To250Hz', min: 120, max: 250 },
      { key: 'mid250To2kHz', min: 250, max: 2000 },
      { key: 'upperMid2kTo6kHz', min: 2000, max: 6000 },
      { key: 'high6kTo12kHz', min: 6000, max: 12000 },
      { key: 'air12kTo20kHz', min: 12000, max: 20000 }
    ];
    const bandPower = Object.fromEntries(bands.map(band => [band.key, 0]));
    let totalPower = 0;
    let centroidNumerator = 0;
    let centroidDenominator = 0;
    let frameCount = 0;
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    const window = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));

    const fft = () => {
      for (let i = 1, j = 0; i < fftSize; i++) {
        let bit = fftSize >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
          [re[i], re[j]] = [re[j], re[i]];
          [im[i], im[j]] = [im[j], im[i]];
        }
      }
      for (let size = 2; size <= fftSize; size <<= 1) {
        const angle = -2 * Math.PI / size;
        const stepRe = Math.cos(angle), stepIm = Math.sin(angle);
        for (let start = 0; start < fftSize; start += size) {
          let wr = 1, wi = 0;
          const half = size >> 1;
          for (let j = 0; j < half; j++) {
            const even = start + j, odd = even + half;
            const tr = wr * re[odd] - wi * im[odd];
            const ti = wr * im[odd] + wi * re[odd];
            re[odd] = re[even] - tr; im[odd] = im[even] - ti;
            re[even] += tr; im[even] += ti;
            const nextWr = wr * stepRe - wi * stepIm;
            wi = wr * stepIm + wi * stepRe; wr = nextWr;
          }
        }
      }
    };

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const data = audioBuffer.getChannelData(channel);
      if (data.length < 2) continue;
      const starts = [];
      if (data.length <= fftSize) starts.push(0);
      else {
        for (let start = 0; start + fftSize <= data.length; start += hopSize) starts.push(start);
        const lastStart = data.length - fftSize;
        if (starts[starts.length - 1] !== lastStart) starts.push(lastStart);
      }
      for (const start of starts) {
        re.fill(0); im.fill(0);
        const available = Math.min(fftSize, data.length - start);
        for (let i = 0; i < available; i++) re[i] = data[start + i] * window[i];
        fft(); frameCount++;
        for (let bin = 1; bin < fftSize / 2; bin++) {
          const frequency = (bin * audioBuffer.sampleRate) / fftSize;
          if (frequency < 20 || frequency > 20000) continue;
          const power = re[bin] * re[bin] + im[bin] * im[bin];
          totalPower += power;
          const magnitude = Math.sqrt(power);
          centroidNumerator += frequency * magnitude;
          centroidDenominator += magnitude;
          const band = bands.find(item => frequency >= item.min && frequency < item.max);
          if (band) bandPower[band.key] += power;
        }
      }
    }
    return {
      bandEnergyPercent: Object.fromEntries(bands.map(band => [
        band.key, totalPower > 0 ? (bandPower[band.key] / totalPower) * 100 : 0
      ])),
      spectralCentroidHz: centroidDenominator > 0 ? centroidNumerator / centroidDenominator : 0,
      analysisFrames: frameCount
    };
  }

  _measureAudioBuffer(audioBuffer) {
    let peak = 0;
    let sumSquares = 0;
    let sum = 0;
    let sampleCount = 0;
    let clippedSamples = 0;

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const data = audioBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        const sample = data[i];
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        if (abs >= 0.9999) clippedSamples++;
        sum += sample;
        sumSquares += sample * sample;
        sampleCount++;
      }
    }

    let stereoCorrelation = null;
    if (audioBuffer.numberOfChannels >= 2) {
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      let leftSum = 0, rightSum = 0, leftSq = 0, rightSq = 0, cross = 0;
      for (let i = 0; i < Math.min(left.length, right.length); i++) {
        leftSum += left[i];
        rightSum += right[i];
        leftSq += left[i] * left[i];
        rightSq += right[i] * right[i];
        cross += left[i] * right[i];
      }
      const count = Math.min(left.length, right.length);
      const covariance = cross - (leftSum * rightSum / count);
      const leftVariance = leftSq - (leftSum * leftSum / count);
      const rightVariance = rightSq - (rightSum * rightSum / count);
      stereoCorrelation = leftVariance > 0 && rightVariance > 0
        ? Math.max(-1, Math.min(1, covariance / Math.sqrt(leftVariance * rightVariance)))
        : 0;
    }

    const rms = sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0;
    const toDb = value => value > 0 ? 20 * Math.log10(value) : -Infinity;
    return {
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      durationSeconds: audioBuffer.duration,
      peakDbfs: toDb(peak),
      rmsDbfs: toDb(rms),
      dcOffset: sampleCount ? sum / sampleCount : 0,
      clippedSamples,
      stereoCorrelation,
      spectrum: this._measureSpectrum(audioBuffer)
    };
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

  async _buildSynth(settings, destination = null, trackType = null, additionalGainDb = 0) {
    const {
      instrumentType, oscillator, envelope, filter, filterEnvelope,
      effects, volume, pan, portamento: portamentoVal,
      pitchDecay, octaves, harmonicity, modulationIndex, resonance,
      modulation
    } = settings || {};

    const validOscTypes = ['sine', 'square', 'triangle', 'sawtooth', 'fatsine', 'fatsquare', 'fatsawtooth', 'pwm', 'fmsine', 'fmsquare', 'fmsawtooth'];
    let oscType = oscillator?.type || 'fatsawtooth';
    if (!validOscTypes.includes(oscType)) oscType = 'fatsawtooth';

    const env = {
      attack: Math.max(0.001, envelope?.attack || 0.05),
      decay: Math.max(0.01, envelope?.decay || 0.2),
      sustain: Math.min(1, Math.max(0, envelope?.sustain ?? 0.5)),
      release: Math.max(0.05, envelope?.release || 0.8),
    };

    const filterSettings = filter ? {
      type: filter.type || 'lowpass',
      frequency: Math.min(18000, Math.max(100, filter.frequency || 3000)),
      Q: Math.min(20, Math.max(0.1, filter.Q || 1)),
      rolloff: [-12, -24, -48].includes(filter.rolloff) ? filter.rolloff : -24,
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
          maxPolyphony: 16,
        });
      }
    } catch (e) {
      throw new Error(`Unable to create ${itype} for ${trackType || 'track'}: ${e.message}`);
    }

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
    const pendingEffectPromises = [];
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
          case 'Reverb': {
            const reverb = new Tone.Reverb({
              decay: Math.max(0.5, fx.decay || 2),
              preDelay: Math.min(0.1, fx.preDelay || 0.01),
              wet: Math.min(0.8, fx.wet)
            });
            chain.push(reverb);
            pendingEffectPromises.push(reverb.ready);
            break;
          }
        }
      } catch (e) {
        throw new Error(`Unable to create ${fx.type} effect for ${trackType || 'track'}: ${e.message}`);
      }
    }
    if (pendingEffectPromises.length) {
      await Promise.all(pendingEffectPromises);
    }

    const panValue = typeof pan === 'number' ? Math.max(-1, Math.min(1, pan)) : 0;
    const panner = panValue !== 0 ? new Tone.Panner(panValue) : null;

    // Volume floors: pads now -16dB (instead of -22)
    const isPadOrStrings = trackType === 'pad-textures' || trackType === 'strings';
    const volFloor = isPadOrStrings ? -16 : -24;
    const targetDb = typeof volume === 'number'
      ? Math.max(volFloor, Math.min(0, volume))
      : isPadOrStrings ? -14 : -12;
    instrument.volume.value = targetDb;

    // Conservative role trims establish a repeatable starting balance.
    // They are not loudness normalization: actual level still depends on notes and timbre.
    const roleTargetsDb = {
      bassline: -11,
      lead: -10,
      arpeggio: -16,
      'pad-textures': -16,
      keys: -14,
      chord: -14
    };
    const roleTargetDb = roleTargetsDb[trackType];
    const roleTrimDb = Number.isFinite(roleTargetDb)
      ? Math.max(-3, Math.min(4, roleTargetDb - targetDb))
      : 0;

    const postFxGain = new Tone.Volume(roleTrimDb);
    chain.push(postFxGain);

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
    const safeAdditionalGainDb = Number.isFinite(additionalGainDb)
      ? Math.max(-6, Math.min(6, additionalGainDb))
      : 0;
    postFxGain.volume.value = Math.max(-18, Math.min(12, fxComp + roleTrimDb + safeAdditionalGainDb));

    return instrument;
  }
}
