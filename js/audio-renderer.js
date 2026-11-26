import * as Tone from 'tone';
import { groupNotesByStartTime } from '../lib/audio-events.mjs';
import { getPercussionVoice } from '../lib/percussion-mapping.mjs';
import { getMonoSynthVoiceCount } from '../lib/audio-polyphony.mjs';
import { getPercussionProfile } from '../lib/percussion-profiles.mjs';
import { measureStereoImage } from '../lib/stereo-metrics.mjs';
import { getPercussionGainPolicy } from '../lib/percussion-gain.mjs';
import { getPreviewMasterEffectsSettings } from '../lib/preview-audio-config.mjs';

function getPercussionPolyphony(notes, bpm) {
  const maxVoicesByRole = {};
  for (const event of groupNotesByStartTime(notes, bpm)) {
    const counts = {};
    for (const note of event.notes || []) {
      const role = getPercussionVoice(note.note);
      counts[role] = (counts[role] || 0) + 1;
    }
    for (const [role, count] of Object.entries(counts)) {
      maxVoicesByRole[role] = Math.max(maxVoicesByRole[role] || 1, count);
    }
  }
  return maxVoicesByRole;
}

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

        // Match the full-power Preview master chain while retaining the
        // offline renderer's subsonic filter and genre sidechain routing.
        const masterEffects = getPreviewMasterEffectsSettings({ lowPower: false });
        const masterLimiter = new Tone.Limiter(masterEffects.limiterThresholdDb).toDestination();
        const masterCompressor = new Tone.Compressor(masterEffects.compressor);
        const masterHighPass = new Tone.Filter(25, 'highpass');
        masterHighPass.connect(masterCompressor);
        masterCompressor.connect(masterLimiter);

        const dryBus = new Tone.Channel();
        const wetBus = new Tone.Channel();
        dryBus.connect(masterHighPass);

        const masterDelay = new Tone.PingPongDelay(masterEffects.delay);
        const masterReverb = new Tone.Reverb(masterEffects.reverb);
        wetBus.connect(masterDelay);
        masterDelay.connect(masterReverb);
        masterReverb.connect(masterHighPass);
        await masterReverb.ready;

        const duckingGains = new Map();
        if (useSidechain) {
          const beatDuration = 60 / bpm;
          const duckRelease = Math.min(0.22, beatDuration * 0.75);
          for (const targetTrack of sidechainTargets) {
            const bus = targetTrack === 'bassline' ? dryBus : wetBus;
            const gain = new Tone.Gain(1).connect(bus);
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
          const bus = trackType === 'bassline' ? dryBus : wetBus;
          const dest = duckingGains.get(trackType) || bus;
          const additionalGainDb = Number.isFinite(trackGainDbByType?.[trackType]) ? trackGainDbByType[trackType] : 0;
          const events = groupNotesByStartTime(notes, bpm);
          const percussionPolyphony = trackType === 'percs' ? getPercussionPolyphony(notes, bpm) : undefined;
          const monoVoiceCount = synthSettings?.instrumentType === 'MonoSynth' ? getMonoSynthVoiceCount(notes) : 1;
          const synth = await this._buildSynth(synthSettings, dest, trackType, additionalGainDb, percussionPolyphony, monoVoiceCount, genre);
          new Tone.Part((time, event) => {
            for (const note of event.notes) {
              try { synth.triggerAttackRelease(note.note, note.duration, time, note.velocity); }
              catch (e) { /* ignore */ }
            }
          }, events).start(0);
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
  async analyzeTracksIndividually({ tracks, bpm, durationSeconds, genre, onProgress }) {
    if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('No tracks to analyze individually');
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) throw new Error('Invalid tempo for track analysis');
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid duration for track analysis');

    const renderDuration = durationSeconds + 2.0;
    const results = [];
    const activeTracks = tracks.filter(track => Array.isArray(track.notes) && track.notes.length > 0);

    for (let index = 0; index < activeTracks.length; index++) {
      const track = activeTracks[index];
      let audioBuffer;
      let percussionEventDiagnostics = null;
      try {
        audioBuffer = await Tone.Offline(async ({ transport }) => {
          transport.bpm.value = bpm;
          const events = groupNotesByStartTime(track.notes, bpm);
          const percussionPolyphony = track.trackType === 'percs' ? getPercussionPolyphony(track.notes, bpm) : undefined;
          const monoVoiceCount = track.synthSettings?.instrumentType === 'MonoSynth' ? getMonoSynthVoiceCount(track.notes) : 1;
          const synth = await this._buildSynth(track.synthSettings, null, track.trackType, 0, percussionPolyphony, monoVoiceCount, genre);

          if (track.trackType === 'percs') {
            const parsedTicks = events.map(event => {
              const match = typeof event.time === 'string' ? event.time.match(/^(\d+)i$/) : null;
              return match ? Number(match[1]) : NaN;
            });
            const invalidIndices = [];
            const nonIncreasingPairs = [];
            const sameVoiceCollisions = [];
            const voiceHitCounts = {};
            const lastTickByVoice = {};
            const shortestVoiceGaps = {};

            for (let i = 0; i < parsedTicks.length; i++) {
              const tick = parsedTicks[i];
              if (!Number.isFinite(tick)) invalidIndices.push(i);
              if (i > 0 && !(tick > parsedTicks[i - 1])) {
                nonIncreasingPairs.push({
                  previousIndex: i - 1,
                  previousTime: events[i - 1]?.time,
                  currentIndex: i,
                  currentTime: events[i]?.time
                });
              }

              const notesByVoice = new Map();
              for (const note of events[i]?.notes || []) {
                const voice = getPercussionVoice(note.note);
                if (!notesByVoice.has(voice)) notesByVoice.set(voice, []);
                notesByVoice.get(voice).push(note.note);
                voiceHitCounts[voice] = (voiceHitCounts[voice] || 0) + 1;

                if (Number.isFinite(tick) && Number.isFinite(lastTickByVoice[voice])) {
                  const gap = tick - lastTickByVoice[voice];
                  shortestVoiceGaps[voice] = Number.isFinite(shortestVoiceGaps[voice])
                    ? Math.min(shortestVoiceGaps[voice], gap)
                    : gap;
                }
                if (Number.isFinite(tick)) lastTickByVoice[voice] = tick;
              }

              for (const [voice, pitches] of notesByVoice) {
                if (pitches.length > 1) {
                  sameVoiceCollisions.push({
                    eventIndex: i,
                    time: events[i].time,
                    tick,
                    voice,
                    hitCount: pitches.length,
                    pitches
                  });
                }
              }
            }

            percussionEventDiagnostics = {
              noteCount: track.notes.length,
              eventCount: events.length,
              groupedNotes: events.reduce((sum, event) => sum + (event.notes?.length || 0), 0),
              invalidTimeIndices: invalidIndices.slice(0, 10),
              nonIncreasingPairs: nonIncreasingPairs.slice(0, 10),
              sameVoiceCollisionCount: sameVoiceCollisions.length,
              sameVoiceCollisions: sameVoiceCollisions.slice(0, 20),
              voiceHitCounts,
              shortestVoiceGapsInTicks: shortestVoiceGaps,
              firstEvents: events.slice(0, 12).map(event => ({
                time: event.time,
                noteCount: event.notes?.length || 0,
                voices: event.notes?.reduce((counts, note) => {
                  const voice = getPercussionVoice(note.note);
                  counts[voice] = (counts[voice] || 0) + 1;
                  return counts;
                }, {})
              })),
              lastEvents: events.slice(-5).map(event => ({
                time: event.time,
                noteCount: event.notes?.length || 0,
                voices: event.notes?.reduce((counts, note) => {
                  const voice = getPercussionVoice(note.note);
                  counts[voice] = (counts[voice] || 0) + 1;
                  return counts;
                }, {})
              }))
            };
            console.info('[Full Mix WAV][percs] Voice collision diagnostics', percussionEventDiagnostics);
          }

          new Tone.Part((time, event) => {
            for (const note of event.notes) {
              synth.triggerAttackRelease(note.note, note.duration, time, note.velocity);
            }
          }, events).start(0);
          transport.start(0);
        }, renderDuration, 2);
      } catch (err) {
        if (track.trackType === 'percs') {
          console.error('[Full Mix WAV][percs] Individual analysis failed; event diagnostics:', percussionEventDiagnostics, err);
        } else {
          console.warn(`[Full Mix WAV] Individual analysis failed for ${track.trackType}; continuing without an analysis-based gain trim:`, err);
        }
        // Solo analysis is advisory only. A failed measurement must not abort
        // the full mix; calculateTrackGainAdjustments() assigns 0 dB when RMS
        // is unavailable, leaving this track's original level unchanged.
        results.push({
          trackType: track.trackType,
          noteCount: track.notes.length,
          durationSeconds,
          peakDbfs: null,
          rmsDbfs: null,
          spectrum: null,
          analysisError: err.message
        });
        onProgress?.((index + 1) / activeTracks.length);
        continue;
      }

      this._applyFades(audioBuffer, 0.05);
      const metrics = this._measureAudioBuffer(audioBuffer);
      results.push({
        trackType: track.trackType,
        noteCount: track.notes.length,
        durationSeconds,
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

  // Build arrangement-relative gain trims for the Full Mix WAV path.
  // Solo RMS reflects patch loudness, note density, articulation and effects.
  // Percussion uses a dedicated, peak-constrained policy: short drum transients
  // naturally produce low RMS and must not be buried by a generic density cap.
  calculateTrackGainAdjustments(trackDiagnostics) {
    const percussionPolicy = getPercussionGainPolicy();
    const roleOffsetsDb = {
      bassline: 0,
      percs: percussionPolicy.roleOffsetDb,
      lead: -1,
      melody: -1,
      brass: -2,
      guitar: -3,
      keys: -3,
      chord: -3,
      plucks: -3,
      arpeggio: -3,
      strings: -5,
      'pad-textures': -5
    };
    const defaultMaxGainDb = 6;
    const minGainDb = -6;
    const measured = (trackDiagnostics || []).filter(track =>
      Number.isFinite(track.rmsDbfs) && Number.isFinite(roleOffsetsDb[track.trackType])
    );
    const pitched = measured.filter(track => track.trackType !== 'percs');
    const anchorCandidates = pitched.filter(track =>
      ['bassline', 'lead', 'melody'].includes(track.trackType)
    );
    const anchorPool = anchorCandidates.length ? anchorCandidates : pitched.length ? pitched : measured;
    const anchorRmsDbfs = anchorPool.length
      ? Math.max(...anchorPool.map(track => track.rmsDbfs))
      : null;

    const priority = {
      bassline: 10, percs: 9, lead: 8, melody: 8, brass: 7,
      guitar: 6, keys: 6, chord: 6, plucks: 6, arpeggio: 5,
      strings: 4, 'pad-textures': 3
    };
    const bandKeys = [
      'sub20To60Hz', 'bass60To120Hz', 'lowMid120To250Hz',
      'mid250To2kHz', 'upperMid2kTo6kHz', 'high6kTo12kHz', 'air12kTo20kHz'
    ];
    const getBandVector = track => {
      const values = bandKeys.map(key => {
        const value = track.spectrum?.bandEnergyPercent?.[key];
        return Number.isFinite(value) && value > 0 ? value : 0;
      });
      const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
      return norm > 0 ? values.map(value => value / norm) : null;
    };
    const spectralCompetition = new Map();
    for (const track of measured) {
      const vector = getBandVector(track);
      if (!vector) continue;
      let strongestOverlap = 0;
      for (const other of measured) {
        if (other === track || (priority[other.trackType] || 0) <= (priority[track.trackType] || 0)) continue;
        const otherVector = getBandVector(other);
        if (!otherVector) continue;
        const similarity = vector.reduce((sum, value, index) => sum + value * otherVector[index], 0);
        if (similarity > strongestOverlap) strongestOverlap = similarity;
      }
      spectralCompetition.set(track.trackType, strongestOverlap >= 0.94 ? 1.5
        : strongestOverlap >= 0.88 ? 0.75 : 0);
    }

    const gainByTrackType = {};
    for (const track of trackDiagnostics || []) {
      const hasMeasurement = Number.isFinite(track.rmsDbfs);
      const roleOffsetDb = roleOffsetsDb[track.trackType];
      const maxGainDb = track.trackType === 'percs' ? percussionPolicy.maxGainDb
        : track.trackType === 'arpeggio' ? 9 : defaultMaxGainDb;
      let requestedGainDb = 0;
      let gainAfterDensityDb = 0;
      let peakSafetyLimitDb = null;
      let densityBoostLimitDb = null;
      let targetRmsDbfs = null;
      const gainLimitReasons = [];

      if (hasMeasurement && Number.isFinite(anchorRmsDbfs) && Number.isFinite(roleOffsetDb)) {
        targetRmsDbfs = anchorRmsDbfs + roleOffsetDb;
        requestedGainDb = targetRmsDbfs - track.rmsDbfs;
        const spectralTrimDb = spectralCompetition.get(track.trackType) || 0;
        requestedGainDb -= spectralTrimDb;
        if (spectralTrimDb > 0) gainLimitReasons.push('spectral-competition');

        const duration = Number.isFinite(track.durationSeconds) && track.durationSeconds > 0
          ? track.durationSeconds : 0;
        const notesPerSecond = duration > 0 ? track.noteCount / duration : Infinity;
        // Musical roles with sustained or foreground phrasing need higher
        // headroom than the generic note-density heuristic allows.
        // Peak safety and the global/role maximums still constrain the final gain.
        densityBoostLimitDb = track.trackType === 'percs' ? percussionPolicy.densityBoostLimitDb
          : track.trackType === 'arpeggio' ? 9
            : track.trackType === 'melody' ? 6
            : track.trackType === 'pad-textures' ? 5
              : notesPerSecond < 1 ? 2
                : notesPerSecond < 3 ? 3 : 4;
        gainAfterDensityDb = Math.min(requestedGainDb, densityBoostLimitDb);
        if (gainAfterDensityDb < requestedGainDb) gainLimitReasons.push('note-density-cap');

        if (Number.isFinite(track.peakDbfs)) {
          peakSafetyLimitDb = -1.5 - track.peakDbfs;
          const peakLimitedGainDb = Math.min(gainAfterDensityDb, peakSafetyLimitDb);
          if (peakLimitedGainDb < gainAfterDensityDb) gainLimitReasons.push('peak-safety');
          gainAfterDensityDb = peakLimitedGainDb;
        }

        if (gainAfterDensityDb > maxGainDb) gainLimitReasons.push('role-max-boost');
        if (gainAfterDensityDb < minGainDb) gainLimitReasons.push('global-min-cut');
      }

      const appliedGainDb = hasMeasurement
        ? Math.max(minGainDb, Math.min(maxGainDb, gainAfterDensityDb))
        : 0;
      track.roleOffsetDb = Number.isFinite(roleOffsetDb) ? roleOffsetDb : null;
      track.targetRmsDbfs = targetRmsDbfs;
      track.requestedGainDb = requestedGainDb;
      track.densityBoostLimitDb = densityBoostLimitDb;
      track.peakSafetyLimitDb = peakSafetyLimitDb;
      track.spectralCompetitionTrimDb = spectralCompetition.get(track.trackType) || 0;
      track.gainLimitReasons = gainLimitReasons;
      track.appliedGainDb = appliedGainDb;
      track.projectedRmsDbfs = hasMeasurement ? track.rmsDbfs + appliedGainDb : null;
      track.notesPerSecond = Number.isFinite(track.durationSeconds) && track.durationSeconds > 0
        ? track.noteCount / track.durationSeconds : null;
      gainByTrackType[track.trackType] = appliedGainDb;
    }

    return gainByTrackType;
  }

  async render({ trackType, notes, synthSettings, bpm, durationSeconds, genre, onProgress }) {
    if (!notes || notes.length === 0) throw new Error('No notes to render');
    onProgress?.(0.05);
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) throw new Error('Invalid tempo for audio rendering');
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid audio duration');
    const renderDuration = durationSeconds + 1.5;
    let audioBuffer;

    try {
      audioBuffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;
        const percussionPolyphony = trackType === 'percs' ? getPercussionPolyphony(notes, bpm) : undefined;
        const monoVoiceCount = synthSettings?.instrumentType === 'MonoSynth' ? getMonoSynthVoiceCount(notes) : 1;
        const synth = await this._buildSynth(synthSettings, null, trackType, 0, percussionPolyphony, monoVoiceCount, genre);

        // Single-track master chain: light compressor → limiter
        const compressor = new Tone.Compressor({ threshold: -18, ratio: 2.5, attack: 0.01, release: 0.2 });
        const limiter = new Tone.Limiter(-1);
        synth.connect(compressor);
        compressor.connect(limiter);
        limiter.toDestination();

        new Tone.Part((time, event) => {
          for (const note of event.notes) {
            try { synth.triggerAttackRelease(note.note, note.duration, time, note.velocity); }
            catch (e) {}
          }
        }, groupNotesByStartTime(notes, bpm)).start(0);

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

    const stereo = audioBuffer.numberOfChannels >= 2
      ? measureStereoImage(audioBuffer.getChannelData(0), audioBuffer.getChannelData(1))
      : { correlation: null, midRms: null, sideRms: null, sideToMidDb: null, widthPercent: null };

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
      stereoCorrelation: stereo.correlation,
      stereoSideToMidDb: stereo.sideToMidDb,
      stereoWidthPercent: stereo.widthPercent,
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

  async _buildSynth(settings, destination = null, trackType = null, additionalGainDb = 0, percussionPolyphony = {}, monoVoiceCount = 1, genre = '') {
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
      if (itype === 'PluckSynth') {
        const pluck = settings?.pluck || {};
        const pluckOptions = {
          attackNoise: Math.max(0.1, Math.min(4, pluck.attackNoise ?? 1.2)),
          dampening: Math.max(1000, Math.min(12000, pluck.dampening ?? 4000)),
          resonance: Math.max(0.1, Math.min(0.98, pluck.resonance ?? 0.78))
        };
        // Tone.PluckSynth is a naturally decaying string voice, not an ADSR
        // PolySynth voice. Use a bounded round-robin pool and let each string
        // ring naturally; MIDI note duration does not gate a plucked string.
        // Tone.Volume exposes the AudioParam expected by the shared renderer
        // (instrument.volume.value and optional volume-LFO routing); Tone.Gain
        // exposes `gain` instead, which caused the guitar export to fail.
        const pluckBus = new Tone.Volume(0);
        const pluckVoices = Array.from({ length: 8 }, () =>
          new Tone.PluckSynth(pluckOptions).connect(pluckBus)
        );
        let nextPluckVoice = 0;
        instrument = {
          volume: pluckBus.volume,
          connect: destination => pluckBus.connect(destination),
          chain: (...nodes) => pluckBus.chain(...nodes),
          triggerAttackRelease: (note, _duration, time, velocity) => {
            const voice = pluckVoices[nextPluckVoice];
            nextPluckVoice = (nextPluckVoice + 1) % pluckVoices.length;
            voice.triggerAttack(note, time, velocity);
          }
        };
      } else if (trackType === 'percs') {
        // A MIDI percussion track can contain simultaneous hits assigned to the same role.
        // Use a small per-role synth pool sized to the actual maximum same-tick polyphony.
        const percussionBus = new Tone.Volume(0);
        const createVoicePool = (role, factory) => {
          const requestedCount = Math.max(1, Math.floor(percussionPolyphony?.[role] || 1));
          // MetalSynth's internal oscillator source is not safe to retrigger on
          // the same instance for dense hat/cymbal patterns. Keep two voices
          // available for metallic roles, even when hits are never simultaneous.
          const isMetallicRole = ['closedHat', 'openHat', 'ride', 'crash'].includes(role);
          const count = isMetallicRole ? Math.max(2, requestedCount) : requestedCount;
          return Array.from({ length: count }, () => factory().connect(percussionBus));
        };
        const profile = getPercussionProfile(genre);
        const voiceSettings = profile.voices;
        const voices = {
          kick: createVoicePool('kick', () => new Tone.MembraneSynth({
            pitchDecay: voiceSettings.kick.pitchDecay,
            octaves: voiceSettings.kick.octaves,
            envelope: { attack: 0.001, decay: voiceSettings.kick.decay, sustain: 0, release: voiceSettings.kick.release }
          })),
          tom: createVoicePool('tom', () => new Tone.MembraneSynth({
            pitchDecay: voiceSettings.tom.pitchDecay,
            octaves: voiceSettings.tom.octaves,
            envelope: { attack: 0.001, decay: voiceSettings.tom.decay, sustain: 0, release: voiceSettings.tom.release }
          })),
          snare: createVoicePool('snare', () => new Tone.NoiseSynth({
            noise: { type: voiceSettings.snare.noise },
            envelope: { attack: 0.001, decay: voiceSettings.snare.decay, sustain: 0, release: 0.025 }
          })),
          clap: createVoicePool('clap', () => new Tone.NoiseSynth({
            noise: { type: voiceSettings.clap.noise },
            envelope: { attack: 0.001, decay: voiceSettings.clap.decay, sustain: 0, release: 0.025 }
          })),
          shaker: createVoicePool('shaker', () => new Tone.NoiseSynth({
            noise: { type: voiceSettings.shaker.noise },
            envelope: { attack: 0.001, decay: voiceSettings.shaker.decay, sustain: 0, release: 0.015 }
          })),
          closedHat: createVoicePool('closedHat', () => new Tone.MetalSynth({
            frequency: voiceSettings.closedHat.frequency,
            harmonicity: voiceSettings.closedHat.harmonicity,
            modulationIndex: voiceSettings.closedHat.modulationIndex,
            resonance: voiceSettings.closedHat.resonance,
            octaves: voiceSettings.closedHat.octaves,
            envelope: { attack: 0.001, decay: voiceSettings.closedHat.decay, release: 0.015 }
          })),
          openHat: createVoicePool('openHat', () => new Tone.MetalSynth({
            frequency: voiceSettings.openHat.frequency,
            harmonicity: voiceSettings.openHat.harmonicity,
            modulationIndex: voiceSettings.openHat.modulationIndex,
            resonance: voiceSettings.openHat.resonance,
            octaves: voiceSettings.openHat.octaves,
            envelope: { attack: 0.001, decay: voiceSettings.openHat.decay, release: 0.08 }
          })),
          ride: createVoicePool('ride', () => new Tone.MetalSynth({
            frequency: voiceSettings.ride.frequency,
            harmonicity: voiceSettings.ride.harmonicity,
            modulationIndex: voiceSettings.ride.modulationIndex,
            resonance: voiceSettings.ride.resonance,
            octaves: voiceSettings.ride.octaves,
            envelope: { attack: 0.001, decay: voiceSettings.ride.decay, release: 0.12 }
          })),
          crash: createVoicePool('crash', () => new Tone.MetalSynth({
            frequency: voiceSettings.crash.frequency,
            harmonicity: voiceSettings.crash.harmonicity,
            modulationIndex: voiceSettings.crash.modulationIndex,
            resonance: voiceSettings.crash.resonance,
            octaves: voiceSettings.crash.octaves,
            envelope: { attack: 0.001, decay: voiceSettings.crash.decay, release: 0.2 }
          }))
        };
        const voiceCursors = {};

        const triggerVoice = (role, time, trigger) => {
          const pool = voices[role] || voices.crash;
          // Advance continuously across event times. Resetting to voice zero
          // for every new timestamp caused repeated retriggers of one
          // MetalSynth instance in otherwise valid sequential hat/cymbal hits.
          const nextVoice = voiceCursors[role] || 0;
          const voice = pool[nextVoice % pool.length];
          voiceCursors[role] = (nextVoice + 1) % pool.length;
          trigger(voice);
        };

        instrument = {
          volume: percussionBus.volume,
          chain: (...nodes) => percussionBus.chain(...nodes),
          connect: destination => percussionBus.connect(destination),
          triggerAttackRelease: (note, duration, time, velocity) => {
            const role = getPercussionVoice(note);
            const hitVelocity = Number.isFinite(velocity)
              ? Math.max(0.05, Math.min(1, velocity))
              : 0.7;
            const hitDuration = Number.isFinite(duration) && duration > 0 ? duration : 0.1;
            switch (role) {
              case 'kick':
                triggerVoice(role, time, voice => voice.triggerAttackRelease(note, Math.max(0.06, Math.min(0.35, hitDuration)), time, hitVelocity));
                break;
              case 'tom':
                triggerVoice(role, time, voice => voice.triggerAttackRelease(note, Math.max(0.08, Math.min(0.4, hitDuration)), time, hitVelocity));
                break;
              case 'snare':
                triggerVoice(role, time, voice => voice.triggerAttackRelease(Math.max(0.06, Math.min(0.2, hitDuration)), time, hitVelocity));
                break;
              case 'clap':
                triggerVoice(role, time, voice => voice.triggerAttackRelease(Math.max(0.05, Math.min(0.16, hitDuration)), time, hitVelocity));
                break;
              case 'shaker':
                triggerVoice(role, time, voice => voice.triggerAttackRelease(Math.max(0.025, Math.min(0.09, hitDuration)), time, hitVelocity));
                break;
              case 'closedHat':
                triggerVoice(role, time, voice => voice.triggerAttackRelease(Math.max(0.025, Math.min(0.09, hitDuration)), time, hitVelocity));
                break;
              case 'openHat':
                triggerVoice(role, time, voice => voice.triggerAttackRelease(Math.max(0.12, Math.min(0.55, hitDuration)), time, hitVelocity));
                break;
              case 'ride':
                triggerVoice(role, time, voice => voice.triggerAttackRelease(Math.max(0.18, Math.min(0.65, hitDuration)), time, hitVelocity));
                break;
              default:
                triggerVoice('crash', time, voice => voice.triggerAttackRelease(Math.max(0.3, Math.min(1, hitDuration)), time, hitVelocity));
            }
          }
        };
      } else if (itype === 'MembraneSynth') {
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
        const monoOptions = {
          oscillator: oscConfig,
          envelope: env,
          portamento,
          ...(filterSettings ? { filter: filterSettings } : {}),
          ...(filterEnvSettings ? { filterEnvelope: filterEnvSettings } : {}),
        };
        // Preserve overlapping MIDI notes instead of letting a monophonic voice
        // cut off the previous note. Keep genuinely monophonic parts unchanged.
        const voiceCount = Math.max(1, Math.min(16, Math.floor(monoVoiceCount) || 1));
        if (voiceCount > 1) {
          const polySynth = new Tone.PolySynth(Tone.MonoSynth, monoOptions);
          polySynth.maxPolyphony = voiceCount;
          instrument = polySynth;
        } else {
          instrument = new Tone.MonoSynth(monoOptions);
        }
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

    const panValue = ['bassline', 'percs'].includes(trackType) ? 0
      : typeof pan === 'number' ? Math.max(-1, Math.min(1, pan)) : 0;
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
      chord: -14,
      plucks: -14,
      strings: -16,
      guitar: -13,
      brass: -13,
      percs: -12
    };
    const roleTargetDb = roleTargetsDb[trackType];
    const roleTrimDb = Number.isFinite(roleTargetDb)
      ? Math.max(-3, Math.min(4, roleTargetDb - targetDb))
      : 0;

    const postFxGain = new Tone.Volume(roleTrimDb);
    chain.push(postFxGain);

    const finalDest = destination || Tone.getDestination();
    // Pan the dry instrument before stereo-producing effects. Putting a mono
    // StereoPanner after Chorus/PingPongDelay/Reverb downmixes their stereo image.
    if (panner) {
      if (chain.length > 0) instrument.chain(panner, ...chain, finalDest);
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
      ? Math.max(-6, Math.min(9, additionalGainDb))
      : 0;
    // The wider positive ceiling is used only by the Full Mix WAV arrangement
    // balancer; single-track rendering passes 0 dB and remains unchanged.
    postFxGain.volume.value = Math.max(-18, Math.min(15, fxComp + roleTrimDb + safeAdditionalGainDb));

    return instrument;
  }
}
