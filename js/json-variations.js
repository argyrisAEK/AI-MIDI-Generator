import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { trackAbbreviations } from './track-config.js';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';
import { MIDIGenerator } from './midi-generator-api.js';
import { getByopKey, clearByopSession } from './byop-session.js';

function formatAudioDiagnostics(metrics) {
  if (!metrics) return '';
  const peak = Number.isFinite(metrics.peakDbfs) ? metrics.peakDbfs.toFixed(1) : 'silent';
  const rms = Number.isFinite(metrics.rmsDbfs) ? metrics.rmsDbfs.toFixed(1) : 'silent';
  const correlation = Number.isFinite(metrics.stereoCorrelation)
    ? ` · stereo corr ${metrics.stereoCorrelation.toFixed(2)}`
    : '';
  const bands = metrics.spectrum?.bandEnergyPercent;
  const bassShare = Number.isFinite(bands?.bass60To120Hz)
    ? ` · 60–120 Hz ${bands.bass60To120Hz.toFixed(1)}%`
    : '';
  const centroid = Number.isFinite(metrics.spectrum?.spectralCentroidHz) && metrics.spectrum.spectralCentroidHz > 0
    ? ` · centroid ${Math.round(metrics.spectrum.spectralCentroidHz)} Hz`
    : '';
  const flags = [];
  if (Number.isFinite(bands?.bass60To120Hz) && bands.bass60To120Hz > 55) flags.push('low-end dominant');
  if (Number.isFinite(metrics.stereoCorrelation) && metrics.stereoCorrelation > 0.98) flags.push('very narrow stereo');
  const quality = flags.length ? ` · CHECK: ${flags.join(', ')}` : '';
  return `Peak ${peak} dBFS · RMS ${rms} dBFS · clipped samples ${metrics.clippedSamples ?? 0}${correlation}${bassShare}${centroid}${quality}`;
}

function formatTrackDiagnostics(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return '';
  const summary = tracks.map(track => {
    const relative = Number.isFinite(track.relativeRmsDb)
      ? `${track.relativeRmsDb > 0 ? '+' : ''}${track.relativeRmsDb.toFixed(1)} dB`
      : 'n/a';
    const bassShare = track.spectrum?.bandEnergyPercent?.bass60To120Hz;
    const bass = Number.isFinite(bassShare) ? `, 60–120 Hz ${bassShare.toFixed(1)}%` : '';
    const gain = Number.isFinite(track.appliedGainDb)
      ? `, gain ${track.appliedGainDb > 0 ? '+' : ''}${track.appliedGainDb.toFixed(1)} dB`
      : '';
    const projected = Number.isFinite(track.projectedRmsDbfs)
      ? `, projected ${track.projectedRmsDbfs.toFixed(1)} dBFS`
      : '';
    const rms = Number.isFinite(track.rmsDbfs) ? track.rmsDbfs.toFixed(1) : 'n/a';
    return `${track.trackType} ${rms} dBFS (${relative}${bass}${gain}${projected})`;
  });
  return ` · solo tracks (pre-master): ${summary.join(' | ')}`;
}

function assertAudibleRender(metrics) {
  if (!metrics || !Number.isFinite(metrics.peakDbfs) || metrics.peakDbfs < -80) {
    throw new Error('Audio rendering produced silence or an almost-silent file. No WAV was exported.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Creative context: the composition itself (JSON title/desc, original prompt) decides the genre.
// The Genre/Mood form fields are only a fallback. Pasted or imported JSON often disagrees with the
// form (e.g. "progressive rock" JSON while the form still says "house"), and the synthesizer and the
// renderer (sidechain pumping!) must follow the music, not a stale dropdown.
// ─────────────────────────────────────────────────────────────────────────────
const GENRE_PATTERNS = [
  ['progressive-rock', /progressive[\s-]rock|prog[\s-]rock|\bprog\b/],
  ['drum-and-bass', /drum\s*(?:and|&|n)\s*bass|\bdnb\b|\bd&b\b|jungle|neurofunk/],
  ['hip-hop', /hip[\s-]?hop|boom[\s-]?bap|\brap\b/],
  ['trap', /\btrap\b/],
  ['synthwave', /synthwave|retrowave|outrun|vaporwave/],
  ['downtempo', /downtempo|trip[\s-]hop|chill[\s-]?out|lo-?fi/],
  ['trance', /\btrance\b/],
  ['techno', /\btechno\b/],
  ['disco', /\bdisco\b/],
  ['house', /\bhouse\b/],
  ['funk', /\bfunk(?:y)?\b/],
  ['reggae', /\breggae\b|\bdub\b/],
  ['jazz', /\bjazz(?:y)?\b/],
  ['cinematic', /cinematic|film score|orchestral|soundtrack/],
  ['classical', /\bclassical\b|baroque|chamber/],
  ['ambient', /\bambient\b|\bdrone\b/],
  ['rock', /\brock\b|\bmetal\b|\bpunk\b|grunge/],
  ['pop', /\bpop\b/]
];
const MOOD_WORDS = ['peaceful', 'energetic', 'melancholic', 'happy', 'dark', 'mysterious', 'dreamy', 'intense', 'ethereal', 'groovy'];

function detectGenres(text) {
  let t = ` ${String(text || '').toLowerCase()} `;
  const found = [];
  for (const [genre, re] of GENRE_PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    found.push({ genre, at: m.index });
    t = t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length); // "progressive rock" must not also count as "rock"
  }
  return found.sort((a, b) => a.at - b.at).map(f => f.genre);
}

function detectMood(text) {
  const t = String(text || '').toLowerCase();
  return MOOD_WORDS.find(w => new RegExp(`\\b${w}\\b`).test(t)) || null;
}

function detectKey(text) {
  const m = /\b([A-G](?:#|b)?)\s*[- ]?(major|minor|dorian|phrygian|lydian|mixolydian|aeolian|locrian)\b/i.exec(String(text || ''));
  return m ? { key: m[1][0].toUpperCase() + m[1].slice(1), scale: m[2].toLowerCase() } : null;
}

export function resolveCreativeContext(app, parsed) {
  const el = (id) => document.getElementById(id)?.value;
  const formGenre = el('style') || 'house';
  const title = String(parsed?.title || app?.compositionTitle || '').trim();
  const description = String(parsed?.desc || parsed?.description || parsed?.explanation || app?.compositionDescription || '').trim();
  const userPrompt = String(app?.lastUserPrompt || '').trim();

  let genres = detectGenres(`${title}. ${description}`);
  if (!genres.length) genres = detectGenres(userPrompt);
  const overridden = genres.length > 0 && !genres.includes(formGenre);
  const genre = overridden ? genres[0] : formGenre;

  const textMood = detectMood(`${title}. ${description}. ${userPrompt}`);
  const mood = textMood || (overridden ? 'neutral' : (el('mood') || 'neutral'));
  const km = detectKey(`${title}. ${description}`);

  return {
    genre, mood, formGenre, overridden,
    key: km?.key || el('key') || 'C',
    scale: km?.scale || el('scale-type') || 'minor',
    brief: { title: title.slice(0, 120), description: description.slice(0, 500), userPrompt: userPrompt.slice(0, 600) }
  };
}

const VALID_SYNTH_TYPES = new Set(['MonoSynth', 'PolySynth', 'FMSynth', 'AMSynth', 'MembraneSynth', 'MetalSynth']);
const VALID_OSCILLATOR_TYPES = new Set(['sine', 'triangle', 'sawtooth', 'fatsawtooth', 'fatsine', 'fatsquare', 'square', 'pwm', 'fmsine', 'fmsquare', 'fmsawtooth']);
const VALID_FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass', 'notch']);
const VALID_FX_TYPES = new Set(['Distortion', 'Chebyshev', 'BitCrusher', 'AutoFilter', 'Chorus', 'Phaser', 'Tremolo', 'PingPongDelay', 'Delay', 'Reverb']);

function validateSynthPatch(trackType, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error(`AI returned an invalid synth patch for ${trackType}.`);
  }
  if (!VALID_SYNTH_TYPES.has(patch.instrumentType)) {
    throw new Error(`AI returned an unsupported instrument type for ${trackType}.`);
  }
  const envelope = patch.envelope;
  const envelopeKeys = ['attack', 'decay', 'sustain', 'release'];
  if (!envelope || envelopeKeys.some(key => !Number.isFinite(envelope[key]))) {
    throw new Error(`AI returned an incomplete envelope for ${trackType}.`);
  }
  if (envelope.attack < 0 || envelope.decay < 0 || envelope.sustain < 0 || envelope.sustain > 1 || envelope.release < 0) {
    throw new Error(`AI returned out-of-range envelope values for ${trackType}.`);
  }
  if (!Number.isFinite(patch.volume) || !Number.isFinite(patch.pan) || patch.pan < -1 || patch.pan > 1) {
    throw new Error(`AI returned invalid level or pan settings for ${trackType}.`);
  }
  if (patch.oscillator != null && (typeof patch.oscillator !== 'object' || Array.isArray(patch.oscillator))) {
    throw new Error(`AI returned invalid oscillator settings for ${trackType}.`);
  }
  if (!['MembraneSynth', 'MetalSynth'].includes(patch.instrumentType) &&
      !VALID_OSCILLATOR_TYPES.has(patch.oscillator?.type)) {
    throw new Error(`AI returned an unsupported or missing oscillator type for ${trackType}.`);
  }
  if (patch.filter != null && (!VALID_FILTER_TYPES.has(patch.filter.type) || !Number.isFinite(patch.filter.frequency))) {
    throw new Error(`AI returned invalid filter settings for ${trackType}.`);
  }
  if (patch.effects != null && !Array.isArray(patch.effects)) {
    throw new Error(`AI returned an invalid effects list for ${trackType}.`);
  }
  if (Array.isArray(patch.effects)) {
    for (const effect of patch.effects) {
      if (!effect || !VALID_FX_TYPES.has(effect.type) || !Number.isFinite(effect.wet) || effect.wet < 0 || effect.wet > 1) {
        throw new Error(`AI returned an unsupported or invalid effect for ${trackType}.`);
      }
    }
  }
  if (['bassline', 'lead'].includes(trackType) && patch.instrumentType !== 'MonoSynth') {
    throw new Error(`AI must use MonoSynth for ${trackType}.`);
  }
  if (patch.instrumentType === 'MonoSynth' && ['bassline', 'lead'].includes(trackType)) {
    const filterEnvelope = patch.filterEnvelope;
    const required = ['attack', 'decay', 'sustain', 'release', 'baseFrequency', 'octaves', 'exponent'];
    if (!filterEnvelope || required.some(key => !Number.isFinite(filterEnvelope[key])) || !Number.isFinite(patch.portamento)) {
      throw new Error(`AI omitted the required filter envelope or portamento for ${trackType}.`);
    }
  }
  if (patch.instrumentType !== 'MonoSynth' && (patch.filterEnvelope != null || patch.portamento != null)) {
    throw new Error(`AI returned MonoSynth-only settings for ${trackType}.`);
  }
  const oscillatorType = patch.oscillator?.type;
  if (['fatsawtooth', 'fatsine', 'fatsquare'].includes(oscillatorType) &&
      (!Number.isFinite(patch.oscillator.count) || !Number.isFinite(patch.oscillator.spread))) {
    throw new Error(`AI omitted fat-oscillator voice settings for ${trackType}.`);
  }
  if (oscillatorType === 'pwm' && !Number.isFinite(patch.oscillator.modulationFrequency)) {
    throw new Error(`AI omitted PWM modulation frequency for ${trackType}.`);
  }
  return patch;
}

// Read the complete NDJSON stream and fail closed on any missing or invalid patch.
async function fetchSynthStream(endpoint, payload, onTrackComplete) {
  if (!payload.userApiKey) {
    throw Object.assign(new Error('Connect your Pollinations account (Pollinations Pay) to use AI synthesis.'), { requiresByop: true });
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.message || data.error || `HTTP ${res.status}: ${res.statusText}`), { status: res.status });
  }
  if (!res.body) throw new Error('Synthesis server returned an empty response stream.');

  const expectedTracks = payload.tracks?.length
    ? payload.tracks.map(track => track.trackType)
    : [payload.trackType];
  const patches = {};
  const errors = [];
  let completed = false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  const processLine = line => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      throw new Error('Synthesis server returned malformed streaming data.');
    }

    if (msg.status === 'fatal_error') {
      throw new Error(msg.error || 'Synthesis failed on the server.');
    }
    if (msg.status === 'complete') {
      completed = true;
      return;
    }
    if (!msg.trackType) throw new Error('Synthesis server returned an unrecognized response.');
    if (msg.status === 'error') {
      errors.push(`${msg.trackType}: ${msg.error || 'synthesis failed'}`);
      return;
    }
    if (msg.status !== 'done') throw new Error(`Unexpected synthesis status for ${msg.trackType}.`);
    if (patches[msg.trackType]) throw new Error(`Duplicate synthesis result for ${msg.trackType}.`);

    patches[msg.trackType] = validateSynthPatch(msg.trackType, msg.patch);
    onTrackComplete?.(msg.trackType, msg.patch);
  };

  try {
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) processLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);
  } catch (error) {
    try { await reader.cancel(error); } catch {}
    throw error;
  }

  if (!completed) throw new Error('Synthesis stream ended before completion was confirmed.');
  if (errors.length) throw new Error(`AI synthesis failed: ${errors.join('; ')}`);
  const missing = expectedTracks.filter(trackType => !patches[trackType]);
  if (missing.length) throw new Error(`AI did not return valid synth patches for: ${missing.join(', ')}.`);
  return patches;
}

export class JSONVariations {
  constructor(app) {
    this.app = app;
    this.sourceJson = null;
    this.versions = [];
    this.setupEventListeners();

    this.reverseAbbrev = Object.fromEntries(
      Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
    );
  }

  setupEventListeners() {
    const downloadBtn = document.getElementById('download-all-zip');
    const rawInput = document.getElementById('raw-json-input');
    const editTypeSelect = document.getElementById('edit-type');
    const intensitySlider = document.getElementById('intensity-slider');
    const applyEditBtn = document.getElementById('apply-track-edit');
    const loadJsonBtn = document.getElementById('load-json-btn');
    const mp3Btn = document.getElementById('export-mp3-btn');
    const fullMixBtn = document.getElementById('export-fullmix-btn');

    if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadAllAsZip());
    if (rawInput) rawInput.addEventListener('input', (e) => this.handleJsonInputChange(e));
    if (loadJsonBtn) loadJsonBtn.addEventListener('click', () => this.loadJsonIntoPreview());
    if (mp3Btn) mp3Btn.addEventListener('click', () => this.exportActiveTrackAsMP3());
    if (fullMixBtn) fullMixBtn.addEventListener('click', () => this.exportFullMixAsWav());
    if (editTypeSelect) editTypeSelect.addEventListener('change', (e) => this.handleEditTypeChange(e));
    if (intensitySlider) intensitySlider.addEventListener('input', (e) => this.handleIntensityChange(e));
    if (applyEditBtn) applyEditBtn.addEventListener('click', () => this.applyTrackEdit());
  }

  async exportActiveTrackAsMP3() {
    const mp3Btn = document.getElementById('export-mp3-btn');
    const progressContainer = document.getElementById('mp3-progress-container');
    const progressBar = document.getElementById('mp3-progress-bar');
    const progressLabel = document.getElementById('mp3-progress-label');

    const activeTrack = this.app.visualizer?.activeTrackType || 'all';
    if (activeTrack === 'all') {
      this.app.ui.showMessage('Select a specific track in the visualizer first.', 'warning');
      return;
    }

    const trackData = this.app.generatedTracks?.get(activeTrack);
    if (!trackData?.midi?.tracks?.[0]?.notes?.length) {
      this.app.ui.showMessage('No notes found for the active track.', 'warning');
      return;
    }

    const notes = trackData.midi.tracks[0].notes;
    const bpm = this.app.musicalContextManager?.getContext()?.tempo || 120;
    const durationSeconds = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);

    const parsed = this.sourceJson ? JSON.parse(this.sourceJson) : {};
    const { genre, mood, scale, key, brief, overridden, formGenre } = resolveCreativeContext(this.app, parsed);
    if (overridden) this.app.ui.showMessage(`Using “${genre}” from the composition description (the Genre field says “${formGenre}”).`, 'info');

    this.app.setByopAiButtonReady?.(mp3Btn, false);
    progressContainer.style.display = 'block';
    progressLabel.textContent = 'Asking AI for synthesis settings...';
    progressBar.style.width = '5%';

    try {
      const userApiKey = getByopKey();
      const synthSettings = await fetchSynthStream('/api/synthesize', {
        trackType: activeTrack, genre, mood, scale, key, brief, notes, userApiKey
      }, (track, data) => {
        progressLabel.textContent = `✅ ${track} ready!`;
        progressBar.style.width = '15%';
      });

      if (!synthSettings[activeTrack]) throw new Error('Failed to get synth settings');
      const finalSettings = validateSynthPatch(activeTrack, synthSettings[activeTrack]);

      progressLabel.textContent = 'Rendering audio offline...';
      progressBar.style.width = '15%';

      const { AudioRenderer } = await import('./audio-renderer.js');
      const renderer = new AudioRenderer();

      const mp3Blob = await renderer.render({
        trackType: activeTrack,
        notes,
        synthSettings: finalSettings,
        bpm,
        durationSeconds,
        onProgress: (p) => {
          progressBar.style.width = `${Math.round(15 + p * 85)}%`;
          if (p < 0.15) progressLabel.textContent = 'Rendering audio offline...';
          else if (p < 0.6) progressLabel.textContent = 'Processing audio...';
          else if (p < 0.95) progressLabel.textContent = 'Encoding WAV...';
          else progressLabel.textContent = 'Done!';
        }
      });

      assertAudibleRender(renderer.lastRenderMetrics);
      const title = parsed.title || 'composition';
      const filename = `${title}-${activeTrack}.wav`.replace(/[^a-z0-9\-_.]/gi, '_');

      if ('showSaveFilePicker' in window) {
        try {
          const fh = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'WAV Audio', accept: { 'audio/wav': ['.wav'] } }]
          });
          const w = await fh.createWritable();
          await w.write(mp3Blob);
          await w.close();
        } catch (e) { if (e.name === 'AbortError') return; throw e; }
      } else {
        const url = URL.createObjectURL(mp3Blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      this.app.ui.showToast(`${activeTrack} exported as WAV · ${formatAudioDiagnostics(renderer.lastRenderMetrics)}`, 'success');
      this.showDawGuide({ [activeTrack]: finalSettings }, 'single');
    } catch (err) {
      console.error('[MP3 Export]', err);
      this.app.ui.showMessage(`Export failed: ${err.message}`, 'error');
    } finally {
      this.app.setByopAiButtonReady?.(mp3Btn, true);
      setTimeout(() => {
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
      }, 2000);
    }
  }

  async exportFullMixAsWav() {
    const fullMixBtn = document.getElementById('export-fullmix-btn');
    const progressContainer = document.getElementById('mp3-progress-container');
    const progressBar = document.getElementById('mp3-progress-bar');
    const progressLabel = document.getElementById('mp3-progress-label');

    if (!this.app.generatedTracks || this.app.generatedTracks.size === 0) {
      this.app.ui.showMessage('No tracks to export.', 'warning');
      return;
    }

    const bpm = this.app.musicalContextManager?.getContext()?.tempo || 120;
    const userApiKey = getByopKey();
    const parsed = this.sourceJson ? JSON.parse(this.sourceJson) : {};
    const { genre, mood, scale, key, brief, overridden, formGenre } = resolveCreativeContext(this.app, parsed);
    if (overridden) this.app.ui.showMessage(`Using “${genre}” from the composition description (the Genre field says “${formGenre}”).`, 'info');

    const tracksData = [];
    let maxDuration = 0;
    this.app.generatedTracks.forEach((trackData, trackType) => {
      const notes = trackData?.midi?.tracks?.[0]?.notes || [];
      if (notes.length === 0) return;
      const lastNote = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);
      if (lastNote > maxDuration) maxDuration = lastNote;
      tracksData.push({ trackType, notes });
    });

    if (tracksData.length === 0) {
      this.app.ui.showMessage('No notes found in any track.', 'warning');
      return;
    }

    this.app.setByopAiButtonReady?.(fullMixBtn, false);
    progressContainer.style.display = 'block';
    progressBar.style.width = '5%';
    progressLabel.textContent = `Designing ${tracksData.length} instruments with AI...`;

    try {
      let completedCount = 0;
      const patches = await fetchSynthStream('/api/synthesize', {
        genre, mood, scale, key, brief, userApiKey,
        tracks: tracksData.map(t => ({ trackType: t.trackType, notes: t.notes }))
      }, (track) => {
        completedCount++;
        const pct = 5 + Math.round((completedCount / tracksData.length) * 15);
        progressLabel.textContent = `🎛️ ${track} ready (${completedCount}/${tracksData.length})`;
        progressBar.style.width = `${pct}%`;
      });

      const tracksWithPatches = tracksData.map(t => ({
        ...t,
        synthSettings: patches[t.trackType]
      }));

      const { AudioRenderer } = await import('./audio-renderer.js');
      const renderer = new AudioRenderer();

      // Measure the unchanged AI patches first; use these solo renders to calculate
      // bounded role-aware trims before the shared master bus is rendered.
      progressLabel.textContent = 'Measuring instruments for mix balance...';
      progressBar.style.width = '20%';
      const trackDiagnostics = await renderer.analyzeTracksIndividually({
        tracks: tracksWithPatches,
        bpm,
        durationSeconds: maxDuration,
        onProgress: (p) => {
          progressBar.style.width = `${Math.round(20 + p * 15)}%`;
        }
      });
      const trackGainDbByType = renderer.calculateTrackGainAdjustments(trackDiagnostics);

      console.table(trackDiagnostics.map(track => ({
        track: track.trackType,
        notes: track.noteCount,
        soloRmsDbfs: Number.isFinite(track.rmsDbfs) ? track.rmsDbfs.toFixed(1) : 'n/a',
        relativeRmsDb: Number.isFinite(track.relativeRmsDb) ? track.relativeRmsDb.toFixed(1) : 'n/a',
        appliedGainDb: Number.isFinite(track.appliedGainDb) ? track.appliedGainDb.toFixed(1) : 'n/a',
        projectedRmsDbfs: Number.isFinite(track.projectedRmsDbfs) ? track.projectedRmsDbfs.toFixed(1) : 'n/a',
        bass60To120HzPercent: Number.isFinite(track.spectrum?.bandEnergyPercent?.bass60To120Hz)
          ? track.spectrum.bandEnergyPercent.bass60To120Hz.toFixed(1)
          : 'n/a'
      })));

      // Export only the balanced mix: it uses measured, bounded role-aware gain trims.
      progressLabel.textContent = 'Rendering balanced full mix...';
      progressBar.style.width = '55%';
      const balancedBlob = await renderer.renderMultitrack({
        tracks: tracksWithPatches,
        bpm,
        durationSeconds: maxDuration,
        genre,
        trackGainDbByType,
        onProgress: (p) => {
          progressBar.style.width = `${Math.round(55 + p * 35)}%`;
          if (p < 0.85) progressLabel.textContent = 'Rendering balanced full mix...';
          else progressLabel.textContent = 'Finishing balanced WAV...';
        }
      });
      const balancedMetrics = renderer.lastRenderMetrics;
      assertAudibleRender(balancedMetrics);

      progressLabel.textContent = 'Saving balanced WAV...';
      progressBar.style.width = '95%';
      const safeTitle = (parsed.title || 'composition').replace(/[^a-z0-9\-_.]/gi, '_');
      const filename = `${safeTitle}-balanced.wav`;
      // Suno Prompt Studio analyzes the same balanced render offered to the user.
      try { this.app.sunoStudio?.registerWav({ blob: balancedBlob, filename }); } catch (e) { console.warn('[Suno] registerWav failed', e); }

      if ('showSaveFilePicker' in window) {
        try {
          const fh = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }]
          });
          const w = await fh.createWritable();
          await w.write(balancedBlob);
          await w.close();
        } catch (e) { if (e.name === 'AbortError') return; throw e; }
      } else {
        const url = URL.createObjectURL(balancedBlob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      this.app.ui.showToast(
        `Balanced WAV exported · ${tracksData.length} tracks · ${formatAudioDiagnostics(balancedMetrics)}${formatTrackDiagnostics(trackDiagnostics)}`,
        'success'
      );
      // Show DAW guide with all track patches
      this.showDawGuide(patches, 'fullmix');
    } catch (err) {
      console.error('[Full Mix WAV]', err);
      this.app.ui.showMessage(`Full mix export failed: ${err.message}`, 'error');
    } finally {
      this.app.setByopAiButtonReady?.(fullMixBtn, true);
      setTimeout(() => {
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
      }, 2000);
    }
  }

  // ⬇️ ΥΠΟΛΟΙΠΕΣ ΜΕΘΟΔΟΙ (ΚΑΘΑΡΕΣ & ΛΕΙΤΟΥΡΓΙΚΕΣ)
  showDawGuide(patches, mode) {
    const panel = document.getElementById('daw-guide-panel');
    const cardsEl = document.getElementById('daw-guide-cards');
    if (!panel || !cardsEl) return;

    // TRACK_COLORS from config — fallback palette
    const COLORS = {
        bassline: '#FF1744', brass: '#FF9100', arpeggio: '#FFD600',
        plucks: '#00E676', keys: '#00B8D4', melody: '#2979FF',
        strings: '#AA00FF', 'pad-textures': '#F50057', lead: '#FFFFFF',
        chord: '#78909C', guitar: '#FFAB91', percs: '#69FF47'
    };

    cardsEl.innerHTML = '';

    Object.entries(patches).forEach(([trackType, patch]) => {
        if (!patch || patch.error) return;

        const color = COLORS[trackType] || '#54B76E';
        const { instrumentType, oscillator, envelope, filter, portamento, pan, effects, volume, designRationale } = patch;

        // Format envelope values
        const fmtNum = (v, d = 2) => typeof v === 'number' ? v.toFixed(d) : '—';

        // Build effects pills
        const effectsList = Array.isArray(effects) ? effects : [];
        const effectPills = effectsList
            .filter(fx => fx?.wet > 0.02)
            .map(fx => {
                const wet = Math.round((fx.wet || 0) * 100);
                return `<span class="daw-effect-pill">${fx.type} ${wet}%</span>`;
            }).join('');

        const card = document.createElement('div');
        card.className = 'daw-instrument-card';
        card.innerHTML = `
            <div class="daw-instrument-header">
                <div class="daw-instrument-dot" style="background:${color}; box-shadow:0 0 6px ${color}66;"></div>
                <span class="daw-instrument-name">${trackType.replace('-', ' ')}</span>
                <span class="daw-instrument-type">${instrumentType || 'PolySynth'}</span>
            </div>
            ${designRationale ? `<p class="daw-instrument-rationale">${designRationale}</p>` : ''}
            <div class="daw-params-grid">
                <div class="daw-param"><span class="daw-param-key">OSC</span><span class="daw-param-val">${oscillator?.type || '—'}${oscillator?.count ? ` ×${oscillator.count}` : ''}</span></div>
                <div class="daw-param"><span class="daw-param-key">VOL</span><span class="daw-param-val">${fmtNum(volume, 1)} dB</span></div>
                <div class="daw-param"><span class="daw-param-key">ATK</span><span class="daw-param-val">${fmtNum(envelope?.attack)}s</span></div>
                <div class="daw-param"><span class="daw-param-key">DEC</span><span class="daw-param-val">${fmtNum(envelope?.decay)}s</span></div>
                <div class="daw-param"><span class="daw-param-key">SUS</span><span class="daw-param-val">${fmtNum(envelope?.sustain)}</span></div>
                <div class="daw-param"><span class="daw-param-key">REL</span><span class="daw-param-val">${fmtNum(envelope?.release)}s</span></div>
                ${filter ? `<div class="daw-param"><span class="daw-param-key">FILTER</span><span class="daw-param-val">${filter.type} ${filter.frequency}Hz</span></div>` : ''}
                ${filter?.Q ? `<div class="daw-param"><span class="daw-param-key">Q</span><span class="daw-param-val">${filter.Q}</span></div>` : ''}
                ${portamento > 0 ? `<div class="daw-param"><span class="daw-param-key">GLIDE</span><span class="daw-param-val">${fmtNum(portamento)}s</span></div>` : ''}
                ${typeof pan === 'number' && pan !== 0 ? `<div class="daw-param"><span class="daw-param-key">PAN</span><span class="daw-param-val">${pan > 0 ? 'R' : 'L'} ${Math.abs(Math.round(pan*100))}%</span></div>` : ''}
            </div>
            ${effectPills ? `<div class="daw-effects-row">${effectPills}</div>` : ''}
        `;
        cardsEl.appendChild(card);
    });

    if (cardsEl.children.length === 0) return;
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  handleEditTypeChange(e) {
    const value = e.target.value;
    const intensitySection = document.getElementById('intensity-slider-section');
    const customSection = document.getElementById('custom-edit-section');

    if (intensitySection) {
      const isIntensity = value === 'intensity_up' || value === 'intensity_down';
      intensitySection.style.display = isIntensity ? 'block' : 'none';
      if (isIntensity) this.configureSliderForDirection(value);
    }
    if (customSection) customSection.style.display = value === 'custom' ? 'block' : 'none';
    this.app.updateByopAiControls?.();
  }

  configureSliderForDirection(direction) {
    const slider = document.getElementById('intensity-slider');
    const minLabel = document.getElementById('intensity-min-label');
    const maxLabel = document.getElementById('intensity-max-label');
    if (!slider) return;

    if (direction === 'intensity_up') {
      slider.min = 10; slider.max = 100; slider.value = 30;
      if (minLabel) minLabel.textContent = 'Subtle';
      if (maxLabel) maxLabel.textContent = 'Max 🔥';
    } else {
      slider.min = 10; slider.max = 80; slider.value = 30;
      if (minLabel) minLabel.textContent = 'Subtle';
      if (maxLabel) maxLabel.textContent = 'Minimal ❄️';
    }
    this.updateIntensityDisplay(direction, parseInt(slider.value));
  }

  handleIntensityChange(e) {
    const value = parseInt(e.target.value);
    const direction = document.getElementById('edit-type')?.value;
    this.updateIntensityDisplay(direction, value);
  }

  updateIntensityDisplay(direction, value) {
    const display = document.getElementById('intensity-value');
    const preview = document.getElementById('intensity-preview');
    if (!display) return;

    if (direction === 'intensity_up') {
      let label, previewText, color;
      if (value <= 20) { label = 'Subtle'; color = '#a78bfa'; previewText = '🎵 Light fills · 🔊 Vel 6 · ⏱️ Slightly shorter notes'; }
      else if (value <= 40) { label = 'Moderate'; color = '#60a5fa'; previewText = '🎵 More fills · 🔊 Vel 6-7 · ⏱️ Shorter notes'; }
      else if (value <= 60) { label = 'Strong'; color = '#34d399'; previewText = '🎵 Dense notes · 🔊 Vel 7-8 · ⏱️ Fast bursts'; }
      else if (value <= 80) { label = 'Dramatic'; color = '#f59e0b'; previewText = '🎵 Very dense · 🔊 Vel 8 · ⏱️ 16th notes dominant'; }
      else { label = 'Max 🔥'; color = '#ef4444'; previewText = '🎵 Maximum notes · 🔊 Vel 8-9 · ⏱️ Fastest possible'; }
      display.textContent = `↑ ${label}: +${value}%`;
      display.style.color = color;
      if (preview) { preview.textContent = previewText; preview.style.display = 'block'; }
    } else if (direction === 'intensity_down') {
      let label, previewText, color;
      if (value <= 20) { label = 'Subtle'; color = '#a78bfa'; previewText = '🎵 Few fewer notes · 🔊 Vel 5 · ⏱️ Slightly longer notes'; }
      else if (value <= 40) { label = 'Moderate'; color = '#60a5fa'; previewText = '🎵 Remove fills · 🔊 Vel 4-5 · ⏱️ Longer notes'; }
      else if (value <= 60) { label = 'Strong'; color = '#f59e0b'; previewText = '🎵 Sparse texture · 🔊 Vel 3-4 · ⏱️ Half notes'; }
      else { label = 'Minimal ❄️'; color = '#94a3b8'; previewText = '🎵 Skeleton only · 🔊 Vel 3 · ⏱️ Long sustained notes'; }
      display.textContent = `↓ ${label}: -${value}%`;
      display.style.color = color;
      if (preview) { preview.textContent = previewText; preview.style.display = 'block'; }
    }
  }

  // Resolve abbreviated track keys → full names before populating checkboxes
  resolveTrackNames(trackKeys) {
    return trackKeys.map(k => this.reverseAbbrev[k] || k);
  }

  updateEditTrackCheckboxes(availableTracks) {
    const container = document.getElementById('edit-track-checkboxes');
    if (!container) return;
    if (!availableTracks || availableTracks.length === 0) {
      container.innerHTML = '<span class="sub-text" style="font-size: 0.75rem;">Load a composition to see available tracks...</span>';
      return;
    }

    container.innerHTML = '';
    const priorityOrder = ['bassline', 'chord', 'melody', 'lead', 'arpeggio', 'plucks', 'keys', 'strings', 'pad-textures', 'guitar', 'brass', 'percs'];
    const sortedTracks = [...availableTracks].sort((a, b) => {
      const idxA = priorityOrder.indexOf(a);
      const idxB = priorityOrder.indexOf(b);
      if (idxA === -1 && idxB === -1) return a.localeCompare(b);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });

    const colors = {
      'bassline': '#E74C3C', 'chord': '#E67E22', 'keys': '#F1C40F', 'plucks': '#F39C12',
      'arpeggio': '#2ECC71', 'melody': '#1ABC9C', 'strings': '#3498DB', 'pad-textures': '#9B59B6',
      'lead': '#E91E63', 'guitar': '#8E44AD', 'brass': '#F1C40F', 'percs': '#BDC3C7'
    };

    sortedTracks.forEach(track => {
      const label = document.createElement('label');
      label.style.cssText = `display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: #0f0f1a; border: 2px solid ${colors[track] || '#4c4c6d'}; border-radius: 16px; cursor: pointer; font-size: 0.75rem; color: #e2e8f0; transition: all 0.2s;`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.value = track; checkbox.className = 'edit-track-checkbox';
      checkbox.style.cssText = 'accent-color: #7c3aed; cursor: pointer;';

      const icon = document.createElement('span'); icon.textContent = this.getTrackIcon(track); icon.style.fontSize = '0.9rem';
      const text = document.createElement('span'); text.textContent = track.charAt(0).toUpperCase() + track.slice(1);

      label.appendChild(checkbox); label.appendChild(icon); label.appendChild(text);
      container.appendChild(label);

      label.addEventListener('mouseenter', () => label.style.background = colors[track] ? `${colors[track]}20` : '#1a1a2e');
      label.addEventListener('mouseleave', () => label.style.background = '#0f0f1a');
    });
  }

  getTrackIcon(track) {
    const icons = { 'bassline': '🎸', 'chord': '🎹', 'keys': '🎹', 'plucks': '🎸', 'arpeggio': '🎵', 'melody': '🎤', 'strings': '🎻', 'pad-textures': '🌊', 'lead': '⭐', 'guitar': '🎸', 'brass': '🎺', 'percs': '🥁' };
    return icons[track] || '🎵';
  }

  getSelectedEditTracks() {
    const checkboxes = document.querySelectorAll('.edit-track-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
  }

  async applyTrackEdit() {
    const targetTracks = this.getSelectedEditTracks();
    const editType = document.getElementById('edit-type')?.value;
    const customInstructions = document.getElementById('custom-edit-instructions')?.value;
    const intensityValue = parseInt(document.getElementById('intensity-slider')?.value || 0) / 100;

    if (targetTracks.length === 0) { this.app.ui.showMessage('Please select at least one track to edit.', 'warning'); return; }
    if (!editType) { this.app.ui.showMessage('Please select an edit type.', 'warning'); return; }
    if (!this.sourceJson) { this.app.ui.showMessage('No composition loaded. Please generate or paste JSON first.', 'warning'); return; }

    const parsedJson = JSON.parse(this.sourceJson);
    const normalizedTracks = {};
    for (const [rawName, notation] of Object.entries(parsedJson.tracks || {})) {
      const canonicalName = this.reverseAbbrev[rawName] || rawName;
      if (Object.prototype.hasOwnProperty.call(normalizedTracks, canonicalName)) {
        this.app.ui.showMessage(`Duplicate track aliases resolve to "${canonicalName}". Keep only one track key and try again.`, 'error');
        return;
      }
      normalizedTracks[canonicalName] = notation;
    }
    const originalJson = { ...parsedJson, tracks: normalizedTracks };
    const canonicalTargets = [...new Set(targetTracks.map(t => this.reverseAbbrev[t] || t))];
    const availableTracks = Object.keys(normalizedTracks);
    const creativeContext = resolveCreativeContext(this.app, originalJson);

    const editParams = {
      originalJson, targetTracks: canonicalTargets,
      unchangedTracks: availableTracks.filter(t => !canonicalTargets.includes(t)),
      editType,
      customInstructions: editType === 'custom' ? customInstructions : null,
      intensityChange: Math.abs(intensityValue),
      genre: creativeContext.genre,
      bpm: parseInt(document.getElementById('bpm')?.value, 10) || 120,
      key: creativeContext.key,
      scale: creativeContext.scale,
      musicalBrief: creativeContext.brief,
      duration: parseInt(document.getElementById('duration')?.value, 10) || 4,
      timeSignature: document.getElementById('time-signature')?.value || '4/4'
    };

    if (editType === 'transpose_up' || editType === 'transpose_down') {
      await this.applyDeterministicTranspose(editParams, editType === 'transpose_up' ? 12 : -12);
      return;
    }

    if (!getByopKey()) {
      this.app.showByopModal?.('connect');
      return;
    }
    await this.editTrackSelectively(editParams);
  }

  async applyDeterministicTranspose(editParams, semitones) {
    const { originalJson, targetTracks } = editParams;
    const updatedTracks = { ...originalJson.tracks };
    let changedNotes = 0;

    try {
      for (const trackName of targetTracks) {
        const notation = updatedTracks[trackName];
        if (typeof notation !== 'string' || !notation.trim()) {
          throw new Error(`Track "${trackName}" has no note data.`);
        }

        const separator = notation.includes('|') ? '|' : '\\n';
        const records = notation.split(separator);
        const transformed = records.map(record => {
          const trimmed = record.trim();
          if (!trimmed || /^(pitch|note|midi|#)/i.test(trimmed)) return record;

          const fields = trimmed.split(':');
          if (fields.length < 4) {
            throw new Error(`Invalid note record in "${trackName}": "${trimmed}". Expected pitch:start:duration:velocity.`);
          }

          const pitchText = fields[0].trim();
          const midiPitch = /^\\d+(?:\\.\\d+)?$/.test(pitchText)
            ? Number(pitchText)
            : Tone.Frequency(pitchText).toMidi();

          if (!Number.isFinite(midiPitch) || !Number.isInteger(midiPitch) || midiPitch < 0 || midiPitch > 127) {
            throw new Error(`Invalid MIDI pitch "${pitchText}" in "${trackName}".`);
          }

          const transposedPitch = midiPitch + semitones;
          if (transposedPitch < 0 || transposedPitch > 127) {
            throw new Error(`Transpose would move a note in "${trackName}" outside the MIDI range (0–127). No changes were applied.`);
          }

          fields[0] = String(transposedPitch);
          changedNotes++;
          return fields.join(':');
        });

        updatedTracks[trackName] = transformed.join(separator);
      }

      if (changedNotes === 0) throw new Error('No valid notes were found in the selected tracks.');

      const direction = semitones > 0 ? 'up one octave' : 'down one octave';
      const mergedResult = {
        title: originalJson.title || 'Untitled',
        desc: `${originalJson.desc || originalJson.description || 'Composition'} — ${targetTracks.join(', ')} transposed ${direction}.`,
        tracks: updatedTracks
      };
      await this.commitEditedResult(mergedResult, {
        ...editParams,
        operation: 'transpose',
        semitones,
        changedNotes
      }, `Transpose ${direction}`);
      this.app.ui.showMessage(`Transposed ${changedNotes} notes ${direction}. No AI request was made.`, 'success');
    } catch (error) {
      console.error('[Deterministic Transpose]', error);
      this.app.ui.showMessage(error.message || 'Transpose failed. No changes were applied.', 'error');
    }
  }

  async commitEditedResult(mergedResult, editDetails, structure) {
    await this.updateMainAppAfterEdit(mergedResult);

    this.versions.push({
      apiResponse: mergedResult,
      context: this.versions[0]?.context || {},
      isOriginal: false,
      structure: structure || `Edit: ${editDetails.targetTracks.join(', ')}`,
      editDetails
    });
    this.renderVersionsList();

    this.sourceJson = JSON.stringify({
      title: mergedResult.title,
      desc: mergedResult.desc,
      tracks: mergedResult.tracks
    });
    const rawInput = document.getElementById('raw-json-input');
    if (rawInput) rawInput.value = JSON.stringify({
      title: mergedResult.title,
      desc: mergedResult.desc,
      tracks: mergedResult.tracks
    }, null, 2);
  }

  async editTrackSelectively(editParams) {
    const { targetTracks } = editParams;
    const MAX_RETRIES = 2;
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.app.ui.showLoading(`Editing ${targetTracks.join(', ')}${attempt > 1 ? ` (retry ${attempt-1})` : ''}...`);
        const userApiKey = getByopKey();

        const response = await fetchWithModelFallbacks('/api/variations', 
          ['midijourney', 'claude-fast', 'openai'], this.app.ui, 
          { editParams, seed: Math.floor(Math.random() * 100000) + attempt }, userApiKey || null
        );

        const responseText = await response.text();
        const generator = new MIDIGenerator();
        const bpm = editParams.bpm;
        const { tracks: editedTracksMap, title, description } = generator.parseApiResponse(responseText, targetTracks, bpm);

        if (editedTracksMap.size === 0) throw new Error('No tracks returned from AI');
        const missingTracks = targetTracks.filter(t => !editedTracksMap.has(t));
        if (missingTracks.length > 0) throw new Error(`Missing tracks: ${missingTracks.join(', ')}`);

        const mergedResult = this.mergeWithUnchanged({ originalJson: editParams.originalJson, editedTracks: editedTracksMap, targetTracks, title, description });
        await this.commitEditedResult(mergedResult, editParams);
        this.app.ui.showMessage(`Successfully edited ${targetTracks.join(', ')}.`, 'success');
        return;
      } catch (error) {
        lastError = error;
        console.error(`Edit attempt ${attempt} failed:`, error);
        if (error.requiresByop) { this.app.ui.hideLoading(); this.app.showByopModal?.('connect'); return; }
        if (error.insufficientPollen) { this.app.ui.hideLoading(); this.app.showByopModal?.('balance'); return; }
        if (error.requiresByopReauth) { this.app.ui.hideLoading(); clearByopSession(); this.app.checkByopStatus?.(); this.app.showByopModal?.('expired'); return; }
        if (attempt < MAX_RETRIES) { this.app.ui.showMessage(`${error.message}. Retrying...`, 'warning'); await new Promise(resolve => setTimeout(resolve, 1500 * attempt)); }
      }
    }

    this.app.ui.hideLoading();
    let userMessage = `Edit failed after ${MAX_RETRIES} attempts: ${lastError.message}`;
    if (lastError.message?.includes('timeout')) userMessage = 'Edit timed out. Try a simpler edit or fewer tracks.';
    this.app.ui.showMessage(userMessage, 'error');
  }

  mergeWithUnchanged({ originalJson, editedTracks, targetTracks, title, description }) {
    const mergedTracks = { ...originalJson.tracks };
    for (const [trackName, trackData] of editedTracks.entries()) {
      mergedTracks[trackName] = this.notesToCompactFormat(trackData.notes);
    }
    return { title: title || `${originalJson.title || 'Untitled'} [${targetTracks.join(', ')} edit]`, desc: description || `Edited ${targetTracks.join(', ')}`, tracks: mergedTracks };
  }

  notesToCompactFormat(notes) {
    if (!notes || notes.length === 0) return '';
    const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
    const secondsPerBeat = 60 / bpm;
    return notes.map(n => {
      const vel = Math.max(1, Math.min(9, Math.round(n.velocity * 10)));
      const beat = (n.time / secondsPerBeat).toFixed(2);
      const dur = (n.duration / secondsPerBeat).toFixed(2);
      return `${n.midi}:${beat}:${dur}:${vel}`;
    }).join('|');
  }

  async updateMainAppAfterEdit(mergedResult) {
    try {
      const tracks = this.mergedTracksToTrackMap(mergedResult.tracks);
      this.app.generatedTracks = tracks;
      this.app.compositionTitle = mergedResult.title;
      this.app.compositionDescription = mergedResult.desc;
      this.app.visualizer.compositionTitle = mergedResult.title;
      this.app.visualizer.compositionDescription = mergedResult.desc;
      this.app.visualizer.loadNotes(tracks, mergedResult.title, mergedResult.desc);
      this.app.visualizer.updateTrackSelectors();
      this.app.visualizer.stopVisualization();
      this.app.visualizer.renderStaticBackground();
      this.app.visualizer.drawFrame();
      this.app.ui.updateButtonStates(true);
      this.setVisualizerToAllTracks();
    } catch (error) { console.error('[UPDATE-MAIN] Failed:', error); throw error; }
  }

  mergedTracksToTrackMap(mergedTracks) {
    const tracks = new Map();
    const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

    for (const [trackName, notesStr] of Object.entries(mergedTracks)) {
      if (!notesStr || typeof notesStr !== 'string' || !notesStr.trim()) continue;

      // Resolve abbreviated name → full name (e.g. 'bass' → 'bassline')
      const fullName = this.reverseAbbrev[trackName] || trackName;

      const notes = [];
      const separator = notesStr.includes('|') ? '|' : '\n';
      const lines = notesStr.split(separator).map(l => l.trim()).filter(l => l);
      for (const line of lines) {
        if (line.match(/^(pitch|note|midi|#)/i)) continue;
        const note = this.parseCompactNoteLine(line, bpm);
        if (note) notes.push(note);
      }
      if (notes.length > 0) {
        const midi = this.createMidiFromNotes(notes, bpm);
        const displayName = fullName.charAt(0).toUpperCase() + fullName.slice(1).replace('-', ' ');
        tracks.set(fullName, {
          midi,
          title: displayName,
          description: `${displayName} sequence`
        });
      }
    }
    return tracks;
  }

  parseCompactNoteLine(line, bpm) {
    try {
      const parts = line.split(':').map(p => p.trim());
      if (parts.length < 4) return null;
      const secondsPerBeat = 60 / bpm;
      const pitchStr    = parts[0];
      const startBeat   = parseFloat(parts[1]);
      const durationBeats = parseFloat(parts[2]);
      const velocityRaw = parseInt(parts[3]);
      if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocityRaw)) return null;

      // ✅ Velocity: LLM outputs 1-9 → map to 0.0-1.0 for @tonejs/midi
      // /9 gives full range 0.11–1.0 (maps to MIDI 14–127)
      // Clamp to 0.08–1.0 so even ghost notes (vel:1) register in DAWs
      const normalizedVelocity = Math.max(0.08, Math.min(1.0, velocityRaw / 9));

      // Quantize to nearest musical grid: 16th note (0.25) or triplet (0.333...)
      // Triplets: 1/3 = 0.333, 2/3 = 0.667, 4/3 = 1.333 etc.
      // Strategy: snap to whichever grid point is closer.
      const quantizeBeat = (val) => {
          if (val <= 0) return 0;
          const snap16th    = Math.round(val * 4)  / 4;         // nearest 16th
          const snap8thTri  = Math.round(val * 3)  / 3;         // nearest 8th-triplet
          const snap16thTri = Math.round(val * 6)  / 6;         // nearest 16th-triplet (1/6)
          // Pick the grid that val is closest to
          const d16  = Math.abs(val - snap16th);
          const d8t  = Math.abs(val - snap8thTri);
          const d16t = Math.abs(val - snap16thTri);
          const best = Math.min(d16, d8t, d16t);
          // Prefer 16th grid on tie (most common)
          if (best === d16)  return snap16th;
          if (best === d8t)  return snap8thTri;
          return snap16thTri;
      };

      const quantizedStart    = Math.max(0, quantizeBeat(startBeat));
      const quantizedDuration = Math.max(0.0625, quantizeBeat(durationBeats));

      let midiNote = isNaN(parseInt(pitchStr)) ? Tone.Frequency(pitchStr).toMidi() : parseInt(pitchStr);
      if (isNaN(midiNote)) return null;

      // ✅ MIDI pitch clamp: valid range 0-127
      midiNote = Math.max(0, Math.min(127, midiNote));

      return {
        midi:     midiNote,
        name:     Tone.Frequency(midiNote, 'midi').toNote(),
        time:     quantizedStart * secondsPerBeat,
        duration: quantizedDuration * secondsPerBeat,
        velocity: normalizedVelocity
      };
    } catch (e) { return null; }
  }

  createMidiFromNotes(notes, bpm) {
    const midi = new Midi();
    const track = midi.addTrack();
    midi.header.setTempo(bpm);
    notes.sort((a, b) => a.time - b.time).forEach(note => track.addNote({ name: note.name, midi: note.midi, time: note.time, duration: note.duration, velocity: note.velocity }));
    return midi;
  }

  setVisualizerToAllTracks() {
    try {
      document.querySelectorAll('.track-selector').forEach(btn => btn.classList.remove('active'));
      const allTracksBtn = document.querySelector('.track-selector[data-track-type="all"]');
      if (allTracksBtn) allTracksBtn.classList.add('active');
      this.app.visualizer.activeTrackType = 'all';
      this.app.visualizer.renderStaticBackground();
      this.app.visualizer.drawFrame();
    } catch (error) { console.error('[SET-ALL-TRACKS] Error:', error); this.app.visualizer.activeTrackType = 'all'; }
  }

  handleJsonInputChange(e) {
    const newJsonString = e.target.value;
    const rawJsonInput = document.getElementById('raw-json-input');
    const loadJsonBtn  = document.getElementById('load-json-btn');
    try {
      const parsedJson = JSON.parse(newJsonString);
      this.sourceJson = JSON.stringify(parsedJson);
      if (parsedJson.tracks) this.updateEditTrackCheckboxes(this.resolveTrackNames(Object.keys(parsedJson.tracks)));
      const originalVersion = this.versions.find(v => v.isOriginal);
      if (originalVersion) {
        originalVersion.apiResponse = parsedJson;
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');
        if (sourceTitle) sourceTitle.textContent = parsedJson.title || 'Custom Composition';
        if (sourceExplanation) sourceExplanation.textContent = parsedJson.desc || parsedJson.explanation || '';
      }
      // Show Load button when valid JSON with tracks is pasted
      if (loadJsonBtn) loadJsonBtn.style.display = parsedJson.tracks ? 'block' : 'none';
      this.app.ui.showMessage('Valid JSON — click "Load into Preview" to visualize.', 'info');
      const applyEditBtn = document.getElementById('apply-track-edit');
      this.app.setByopAiButtonReady?.(applyEditBtn, true);
      if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--accent)';
    } catch (error) {
      if (loadJsonBtn) loadJsonBtn.style.display = 'none';
      if (rawJsonInput) rawJsonInput.style.borderColor = newJsonString.trim() ? '#ef4444' : '';
      const applyEditBtn = document.getElementById('apply-track-edit');
      this.app.setByopAiButtonReady?.(applyEditBtn, false);
    }
  }

  async loadJsonIntoPreview() {
    if (!this.sourceJson) return;
    try {
      const parsed = JSON.parse(this.sourceJson);
      if (!parsed.tracks || Object.keys(parsed.tracks).length === 0) {
        this.app.ui.showMessage('No tracks found in JSON.', 'warning');
        return;
      }

      this.app.ui.showLoading('Loading composition...');

      // Apply BPM from JSON context if available
      const jsonBpm = parsed.bpm || parsed.context?.tempo;
      if (jsonBpm) {
        const bpmEl = document.getElementById('bpm');
        if (bpmEl) bpmEl.value = jsonBpm;
      }

      const apiResponse = {
        title:  parsed.title || 'Loaded Composition',
        desc:   parsed.desc  || parsed.explanation || '',
        tracks: parsed.tracks
      };

      await this.updateMainAppAfterEdit(apiResponse);

      // Add as original version if not already there
      if (!this.versions.find(v => v.isOriginal)) {
        this.versions.push({ apiResponse, context: {}, isOriginal: true, structure: 'Loaded' });
        this.renderVersionsList();
      }

      // Update source composition display
      const sourceTitle = document.getElementById('source-composition-title');
      const sourceExplanation = document.getElementById('source-composition-explanation');
      const sourceDetails = document.getElementById('source-composition-details');
      if (sourceTitle) sourceTitle.textContent = apiResponse.title;
      if (sourceExplanation) sourceExplanation.textContent = apiResponse.desc;
      if (sourceDetails?.querySelector('p')) sourceDetails.querySelector('p').style.display = 'none';

      // Mark AI actions ready; BYOP gating remains independently enforced.
      const applyEditBtn = document.getElementById('apply-track-edit');
      this.app.setByopAiButtonReady?.(applyEditBtn, true);
      const mp3Btn = document.getElementById('export-mp3-btn');
      this.app.setByopAiButtonReady?.(mp3Btn, true);
      const fullMixBtn = document.getElementById('export-fullmix-btn');
      this.app.setByopAiButtonReady?.(fullMixBtn, true);

      // Update checkboxes with resolved full track names from generatedTracks
      if (this.app.generatedTracks?.size > 0) {
        this.updateEditTrackCheckboxes([...this.app.generatedTracks.keys()]);
      }

      // Hide load button after successful load
      const loadJsonBtn = document.getElementById('load-json-btn');
      if (loadJsonBtn) loadJsonBtn.style.display = 'none';

      this.app.ui.hideLoading();
      this.app.ui.showToast(`"${apiResponse.title}" loaded — ready to play & export.`, 'success');

    } catch (err) {
      console.error('[loadJsonIntoPreview]', err);
      this.app.ui.hideLoading();
      this.app.ui.showMessage(`Failed to load: ${err.message}`, 'error');
    }
  }


  reset() {
    this.sourceJson = null; this.versions = [];
    const rawJsonInput = document.getElementById('raw-json-input');
    const sourceDetails = document.getElementById('source-composition-details');
    const downloadBtn = document.getElementById('download-all-zip');
    const applyEditBtn = document.getElementById('apply-track-edit');
    const versionsList = document.getElementById('versions-list');
    const sourceTitle = document.getElementById('source-composition-title');
    const sourceExplanation = document.getElementById('source-composition-explanation');
    const editType = document.getElementById('edit-type');
    const intensitySlider = document.getElementById('intensity-slider');
    const intensityValue = document.getElementById('intensity-value');
    const intensityPreview = document.getElementById('intensity-preview');
    const intensitySection = document.getElementById('intensity-slider-section');
    const customSection = document.getElementById('custom-edit-section');
    const customPrompt = document.getElementById('custom-edit-prompt');

    if (rawJsonInput) rawJsonInput.value = '';
    if (sourceTitle) sourceTitle.textContent = '';
    if (sourceExplanation) sourceExplanation.textContent = '';
    if (sourceDetails && sourceDetails.querySelector('p')) sourceDetails.querySelector('p').style.display = 'block';
    if (versionsList) versionsList.innerHTML = '<p>Your edited versions will appear here.</p>';
    this.app.setByopAiButtonReady?.(applyEditBtn, false);
    if (downloadBtn) downloadBtn.disabled = true;
    if (editType) editType.value = 'intensity_up';
    if (intensitySlider) { intensitySlider.value = 30; intensitySlider.min = 10; intensitySlider.max = 100; }
    if (intensityValue) intensityValue.textContent = '↑ Subtle: +30%';
    if (intensityPreview) { intensityPreview.textContent = ''; intensityPreview.style.display = 'none'; }
    if (intensitySection) intensitySection.style.display = 'none';
    if (customSection) customSection.style.display = 'none';
    if (customPrompt) customPrompt.value = '';
    this.updateEditTrackCheckboxes([]);
  }

  setSourceComposition(rawJson, metadata, context) {
    this.reset();
    this.sourceJson = rawJson; this.versions = [];
    const rawJsonInput = document.getElementById('raw-json-input');
    const sourceDetails = document.getElementById('source-composition-details');
    const sourceTitle = document.getElementById('source-composition-title');
    const sourceExplanation = document.getElementById('source-composition-explanation');

    try {
      const parsedSource = JSON.parse(rawJson);
      if (rawJsonInput) rawJsonInput.value = JSON.stringify(parsedSource, null, 2);
      if (parsedSource.tracks) this.updateEditTrackCheckboxes(this.resolveTrackNames(Object.keys(parsedSource.tracks)));
      const originalVersion = { apiResponse: { title: metadata.title, desc: metadata.explanation || metadata.desc, tracks: parsedSource.tracks || {} }, context: context, isOriginal: true, structure: 'Original' };
      this.versions.push(originalVersion);
      this.renderVersionsList();
      if (sourceTitle) sourceTitle.textContent = metadata.title;
      if (sourceExplanation) sourceExplanation.textContent = metadata.explanation || metadata.desc;
      if (sourceDetails && sourceDetails.querySelector('p')) sourceDetails.querySelector('p').style.display = 'none';
      const applyEditBtn = document.getElementById('apply-track-edit');
      if (applyEditBtn) applyEditBtn.disabled = false;
      const mp3Btn = document.getElementById('export-mp3-btn');
      if (mp3Btn) mp3Btn.disabled = false;
      const fullMixBtn = document.getElementById('export-fullmix-btn');
      if (fullMixBtn) fullMixBtn.disabled = false;
      this.app.ui.showMessage('Composition loaded. Select tracks to edit!', 'info');
    } catch (error) {
      console.error('Failed to parse source composition:', error);
      this.app.ui.showMessage('Error loading source composition.', 'error');
      this.reset();
    }
  }

  renderVersionsList() {
    const listEl = document.getElementById('versions-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (this.versions.length === 0) {
      listEl.innerHTML = '<p>Your edited versions will appear here.</p>';
      const downloadBtn = document.getElementById('download-all-zip');
      if (downloadBtn) downloadBtn.disabled = true;
      return;
    }
    this.versions.forEach((version, index) => {
      const card = document.createElement('div'); card.className = 'variation-card';
      const editBadge = version.editDetails ? `<span class="edit-badge">EDIT</span>` : '';
      const deleteBtn = !version.isOriginal ? `<button class="btn btn-delete" data-index="${index}">✕</button>` : '';
      card.innerHTML = `<div class="variation-card-info"><h4>${version.apiResponse.title} ${version.isOriginal ? '(Original)' : ''}${editBadge}</h4><p>${version.apiResponse.desc || version.apiResponse.explanation}</p></div><div class="variation-card-actions"><button class="btn btn-accent btn-load" data-index="${index}">Load</button>${deleteBtn}</div>`;
      listEl.appendChild(card);
    });
    const downloadBtn = document.getElementById('download-all-zip');
    if (downloadBtn) downloadBtn.disabled = this.versions.length < 1;
    listEl.querySelectorAll('.btn-load').forEach(btn => btn.addEventListener('click', (e) => { this.loadVersion(e.target.dataset.index); }));
    listEl.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', (e) => { this.deleteVersion(parseInt(e.target.dataset.index)); }));
  }

  deleteVersion(index) {
    const version = this.versions[index];
    if (!version || version.isOriginal) return;
    this.versions.splice(index, 1);
    this.renderVersionsList();
    this.app.ui.showMessage(`Deleted "${version.apiResponse.title}".`, 'success');
  }

  loadVersion(index) {
    try {
      const version = this.versions[index];
      if (!version) { this.app.ui.showMessage('Version not found.', 'error'); return; }
      const versionJson = JSON.stringify({ title: version.apiResponse.title, desc: version.apiResponse.desc || version.apiResponse.explanation || '', tracks: version.apiResponse.tracks || {} }, null, 2);
      this.sourceJson = JSON.stringify({ title: version.apiResponse.title, desc: version.apiResponse.desc || version.apiResponse.explanation || '', tracks: version.apiResponse.tracks || {} });
      const rawJsonInput = document.getElementById('raw-json-input');
      if (rawJsonInput) rawJsonInput.value = versionJson;
      if (version.apiResponse.tracks) this.updateEditTrackCheckboxes(this.resolveTrackNames(Object.keys(version.apiResponse.tracks)));
      this.updateMainAppAfterEdit(version.apiResponse);
      this.app.ui.showMessage(`Loaded "${version.apiResponse.title}" into the main player.`, 'success');
    } catch (error) { console.error('Error loading version:', error); this.app.ui.showMessage(`Failed to load version: ${error.message}`, 'error'); }
  }

  async downloadAllAsZip() {
    if (this.versions.length === 0) { this.app.ui.showMessage('No versions to download.', 'warning'); return; }
    this.app.ui.showLoading('Preparing ZIP...');
    try {
      const zip = new JSZip();
      const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
      const sourceTitle = this.versions[0]?.apiResponse?.title.replace(/ \(.+\)/, '') || 'composition';
      for (const version of this.versions) {
        const tracks = this.mergedTracksToTrackMap(version.apiResponse.tracks);
        if (tracks.size > 0) {
          const combinedMidi = MidiBuilder.createCombinedMidi(tracks, bpm);
          if (combinedMidi) {
            const midiBytes = combinedMidi.toArray();
            const sanitizedTitle = version.apiResponse.title.replace(/[\/\\?%*:"<>]/g, '-').trim();
            zip.file(`${sanitizedTitle}.mid`, midiBytes);
          }
        }
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const sanitizedSourceTitle = sourceTitle.replace(/[\/\\?%*:"<>]/g, '-').trim();
      const zipFilename = `${sanitizedSourceTitle}-edits.zip`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content); link.download = zipFilename; a.click();
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      this.app.ui.showMessage('All versions downloaded as ZIP.', 'success');
    } catch (error) { console.error('ZIP failed:', error); this.app.ui.showMessage(`Error creating ZIP: ${error.message}`, 'error'); }
    finally { this.app.ui.hideLoading(); }
  }
}
