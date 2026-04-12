import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { trackAbbreviations } from './track-config.js';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';
import { MIDIGenerator } from './midi-generator-api.js';

// 🔥 NDJSON STREAMING HELPER
async function fetchSynthStream(endpoint, payload, onTrackComplete) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const patches = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.trackType) {
          if (msg.status === 'done') {
            patches[msg.trackType] = msg.patch;
            onTrackComplete?.(msg.trackType, msg.patch);
          }
        } else if (msg.status === 'fatal_error') {
          throw new Error(msg.error);
        }
      } catch (e) { /* ignore partial chunks */ }
    }
  }
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
    const genre = document.getElementById('style')?.value || 'house';
    const mood  = document.getElementById('mood')?.value || 'neutral';
    const scale = document.getElementById('scale-type')?.value || 'minor';
    const key   = document.getElementById('key')?.value || 'C';

    mp3Btn.disabled = true;
    progressContainer.style.display = 'block';
    progressLabel.textContent = 'Asking AI for synthesis settings...';
    progressBar.style.width = '5%';

    try {
      const userApiKey = localStorage.getItem('byop_pollinations_key') || null;
      const synthSettings = await fetchSynthStream('/api/synthesize', {
        trackType: activeTrack, genre, mood, scale, key, notes, userApiKey
      }, (track, data) => {
        progressLabel.textContent = `✅ ${track} ready!`;
        progressBar.style.width = '15%';
      });

      if (!synthSettings[activeTrack]) throw new Error('Failed to get synth settings');
      const finalSettings = synthSettings[activeTrack];

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
        URL.revokeObjectURL(url);
      }

      this.app.ui.showToast(`${activeTrack} exported as WAV!`, 'success');
      // Show DAW guide with single track patch
      this.showDawGuide({ [activeTrack]: synthSettings }, 'single');
    } catch (err) {
      console.error('[MP3 Export]', err);
      this.app.ui.showMessage(`Export failed: ${err.message}`, 'error');
    } finally {
      mp3Btn.disabled = false;
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
    const genre = document.getElementById('style')?.value || 'house';
    const mood  = document.getElementById('mood')?.value || 'neutral';
    const scale = document.getElementById('scale-type')?.value || 'minor';
    const key   = document.getElementById('key')?.value || 'C';
    const userApiKey = localStorage.getItem('byop_pollinations_key') || null;
    const parsed = this.sourceJson ? JSON.parse(this.sourceJson) : {};

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

    fullMixBtn.disabled = true;
    progressContainer.style.display = 'block';
    progressBar.style.width = '5%';
    progressLabel.textContent = `Designing ${tracksData.length} instruments with AI...`;

    try {
      const patches = await fetchSynthStream('/api/synthesize', {
        genre, mood, scale, key, userApiKey,
        tracks: tracksData.map(t => ({ trackType: t.trackType, notes: t.notes }))
      }, (track, data) => {
        const doneCount = Object.keys(patches).length + 1;
        const pct = 5 + Math.round((doneCount / tracksData.length) * 15);
        progressLabel.textContent = `🎛️ ${track} ready (${doneCount}/${tracksData.length})`;
        progressBar.style.width = `${pct}%`;
      });

      progressLabel.textContent = 'Rendering full mix offline...';
      progressBar.style.width = '20%';

      const tracksWithPatches = tracksData.map(t => ({
        ...t,
        synthSettings: patches[t.trackType] || {}
      }));

      const { AudioRenderer } = await import('./audio-renderer.js');
      const renderer = new AudioRenderer();

      const wavBlob = await renderer.renderMultitrack({
        tracks: tracksWithPatches,
        bpm,
        durationSeconds: maxDuration,
        genre,
        onProgress: (p) => {
          progressBar.style.width = `${Math.round(20 + p * 80)}%`;
          if (p < 0.5) progressLabel.textContent = 'Rendering full mix offline...';
          else if (p < 0.85) progressLabel.textContent = 'Processing audio...';
          else progressLabel.textContent = 'Writing WAV...';
        }
      });

      const title = parsed.title || 'composition';
      const filename = `${title}-fullmix.wav`.replace(/[^a-z0-9\-_.]/gi, '_');

      if ('showSaveFilePicker' in window) {
        try {
          const fh = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'WAV Audio', accept: { 'audio/wav': ['.wav'] } }]
          });
          const w = await fh.createWritable();
          await w.write(wavBlob);
          await w.close();
        } catch (e) { if (e.name === 'AbortError') return; throw e; }
      } else {
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }

      this.app.ui.showToast(`Full mix exported as WAV! (${tracksData.length} tracks)`, 'success');
      // Show DAW guide with all track patches
      this.showDawGuide(patches, 'fullmix');
    } catch (err) {
      console.error('[Full Mix WAV]', err);
      this.app.ui.showMessage(`Full mix export failed: ${err.message}`, 'error');
    } finally {
      fullMixBtn.disabled = false;
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
    'bassline':     '#D50000', // pure deep red
    'brass':        '#FF6F00', // amber-orange
    'arpeggio':     '#FFD600', // yellow
    'plucks':       '#00C853', // green
    'keys':         '#00BFA5', // teal (shifted away from blue)
    'melody':       '#2962FF', // strong blue
    'strings':      '#6200EA', // violet
    'pad-textures': '#FF4081', // pink (far from red now)
    'lead':         '#FFFFFF', // white
    'chord':        '#5D4037', // dark brown
    'guitar':       '#A1887F', // light brown
    'percs':        '#00E5FF'  // bright cyan (distinct from keys)
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

    const originalJson = JSON.parse(this.sourceJson);
    const availableTracks = Object.keys(originalJson.tracks || {});

    const editParams = {
      originalJson, targetTracks,
      unchangedTracks: availableTracks.filter(t => !targetTracks.includes(t)),
      editType,
      customInstructions: editType === 'custom' ? customInstructions : null,
      intensityChange: Math.abs(intensityValue),
      genre: document.getElementById('style')?.value || 'house',
      bpm: parseInt(document.getElementById('bpm')?.value, 10) || 120,
      key: document.getElementById('key')?.value || 'C',
      scale: document.getElementById('scale-type')?.value || 'major',
      duration: parseInt(document.getElementById('duration')?.value, 10) || 4,
      timeSignature: document.getElementById('time-signature')?.value || '4/4'
    };

    await this.editTrackSelectively(editParams);
  }

  async editTrackSelectively(editParams) {
    const { targetTracks } = editParams;
    const MAX_RETRIES = 2;
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.app.ui.showLoading(`Editing ${targetTracks.join(', ')}${attempt > 1 ? ` (retry ${attempt-1})` : ''}...`);
        const userApiKey = localStorage.getItem('byop_pollinations_key');

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
        await this.updateMainAppAfterEdit(mergedResult);

        const newVersion = { apiResponse: mergedResult, context: this.versions[0]?.context || {}, isOriginal: false, structure: `Edit: ${targetTracks.join(', ')}`, editDetails: editParams };
        this.versions.push(newVersion);
        this.renderVersionsList();

        this.sourceJson = JSON.stringify({ title: mergedResult.title, desc: mergedResult.desc, tracks: mergedResult.tracks });
        const rawInput = document.getElementById('raw-json-input');
        if (rawInput) rawInput.value = JSON.stringify({ title: mergedResult.title, desc: mergedResult.desc, tracks: mergedResult.tracks }, null, 2);

        this.app.ui.showMessage(`Successfully edited ${targetTracks.join(', ')}.`, 'success');
        return;
      } catch (error) {
        lastError = error;
        console.error(`Edit attempt ${attempt} failed:`, error);
        if (error.requiresByop || error.message?.includes('daily_limit_reached')) { this.app.ui.hideLoading(); this.app.showByopModal?.(error.resetAt); return; }
        if (error.requiresByopReauth) { this.app.ui.hideLoading(); localStorage.removeItem('byop_pollinations_key'); this.app.checkByopStatus?.(); this.app.showByopModal?.(null); return; }
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
      if (!notesStr || typeof notesStr !== 'string') continue;
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
        tracks.set(trackName, { midi, title: trackName.charAt(0).toUpperCase() + trackName.slice(1), description: `Generated ${trackName}` });
      }
    }
    return tracks;
  }

  parseCompactNoteLine(line, bpm) {
    try {
      const parts = line.split(':').map(p => p.trim());
      if (parts.length < 4) return null;
      const secondsPerBeat = 60 / bpm;
      const pitchStr = parts[0]; const startBeat = parseFloat(parts[1]); const durationBeats = parseFloat(parts[2]); const velocityRaw = parseInt(parts[3]);
      if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocityRaw)) return null;
      const normalizedVelocity = Math.max(0.1, Math.min(0.9, velocityRaw / 10));
      let midiNote = isNaN(parseInt(pitchStr)) ? Tone.Frequency(pitchStr).toMidi() : parseInt(pitchStr);
      if (isNaN(midiNote)) return null;
      return { midi: midiNote, name: Tone.Frequency(midiNote, "midi").toNote(), time: startBeat * secondsPerBeat, duration: durationBeats * secondsPerBeat, velocity: normalizedVelocity };
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
    try {
      const parsedJson = JSON.parse(newJsonString);
      this.sourceJson = JSON.stringify(parsedJson);
      if (parsedJson.tracks) this.updateEditTrackCheckboxes(Object.keys(parsedJson.tracks));
      const originalVersion = this.versions.find(v => v.isOriginal);
      if (originalVersion) {
        originalVersion.apiResponse = parsedJson;
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');
        if (sourceTitle) sourceTitle.textContent = parsedJson.title || 'Custom Composition';
        if (sourceExplanation) sourceExplanation.textContent = parsedJson.explanation || parsedJson.desc || '';
      }
      this.app.ui.showMessage('JSON is valid. Ready to edit.', 'success');
      const applyEditBtn = document.getElementById('apply-track-edit');
      if (applyEditBtn) applyEditBtn.disabled = false;
      if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--accent)';
    } catch (error) {
      console.error('Invalid JSON input:', error);
      this.app.ui.showMessage('Invalid JSON format.', 'error');
      const applyEditBtn = document.getElementById('apply-track-edit');
      if (applyEditBtn) applyEditBtn.disabled = true;
      if (rawJsonInput) rawJsonInput.style.borderColor = '#ef4444';
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
    if (applyEditBtn) applyEditBtn.disabled = true;
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
      if (parsedSource.tracks) this.updateEditTrackCheckboxes(Object.keys(parsedSource.tracks));
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
      if (version.apiResponse.tracks) this.updateEditTrackCheckboxes(Object.keys(version.apiResponse.tracks));
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
