import * as Tone from 'tone';
import { TRACK_COLORS, TRACK_INSTRUMENTS } from './config.js';

export class Visualizer {
  constructor(audioEngine, app) {
    this.visualizerEl = document.getElementById('visualizer');
    this.audioEngine = audioEngine;
    this.app = app;
    
    // Main Canvas (Display)
    this.canvas = null;
    this.ctx = null;

    // Off-screen Canvas (Buffer for static elements)
    this.bgCanvas = null;
    this.bgCtx = null;

    this.generatedTracks = new Map();
    this.compositionTitle = '';
    this.compositionDescription = '';
    this.activeTrackType = 'all';
    
    this.isVisualizing = false;
    this.animationFrameId = null;
    
    // Bound methods for proper cleanup
    this._boundResizeCanvas = this.resizeCanvas.bind(this);
    this._boundHandleTrackSelection = this.handleTrackSelection.bind(this);
    
    this.notes = [];
    this.maxTime = 0; // Σε beats για το στατικό φόντο
    this.totalDurationSeconds = 0; // Σε δευτερόλεπτα για τον συγχρονισμό

    // State tracking to avoid duplicate renders
    this._isRendering = false;
    this._lastFrameTime = 0;
    this._frameCount = 0;
    this._needsRedraw = true;
    this._shouldLoop = false;
    this._loopDurationSeconds = 0;

    // Visual Configuration
    this.config = {
      minPitch: 24,
      maxPitch: 96,
      padding: { top: 40, bottom: 50, left: 60, right: 40 },
      noteRadius: 4,
      bgColor: '#1F252A',
      playheadColor: '#08D9D6',
      gridOpacity: 0.05,
      gridColor: '#4DEE93',
      glowIntensity: 10,
      noteMinHeight: 6,
      noteMinWidth: 3,
      activeNoteScale: 1.15
    };

    // Performance cache
    this._coordsBuf = { x: 0, y: 0, w: 0, h: 0 };
    this._filteredNotes = null;
    this._lastFilteredTrack = null;
    this._cachedBgGradient = null;
    this._cachedGradientHeight = null;
    this._activeNotes = [];
    this._lightenCache = new Map();
  }

  loadNotes(tracks, title = '', description = '', compositionDuration = null) {
    this.cleanupResources();
    
    this.generatedTracks = tracks;
    this.compositionTitle = title;
    this.compositionDescription = description;
    this.notes = [];
    this.maxTime = 0;
    let maxTimeSec = 0;
    
    let minPitch = 127;
    let maxPitch = 0;

    tracks.forEach((trackData, trackType) => {
      const notesArray = trackData?.midi?.tracks?.[0]?.notes || trackData?.notes || [];
      
      if (notesArray.length > 0) {
        notesArray.forEach(note => {
          let start, duration, startSec, endSec;
          
          if (note.start_beat !== undefined) {
            start = note.start_beat;
            duration = note.duration_beats || note.duration || 0.5;
          } else if (note.time !== undefined) {
            const bpm = Tone.Transport.bpm.value || 120;
            start = (note.time * bpm) / 60;
            duration = ((note.duration || 0.5) * bpm) / 60;
          } else {
            start = 0;
            duration = 0.5;
          }

          // ✅ ΑΠΟΛΥΤΟΣ ΧΡΟΝΟΣ ΣΕ ΔΕΥΤΕΡΟΛΕΠΤΑ
          startSec = note.time || 0;
          endSec = startSec + (note.duration || 0.5);
          if (endSec > maxTimeSec) maxTimeSec = endSec;
          
          const endTime = start + duration;
          const midi = note.midi || 60;

          if (endTime > this.maxTime) this.maxTime = endTime;
          if (midi < minPitch) minPitch = midi;
          if (midi > maxPitch) maxPitch = midi;

          this.notes.push({
            ...note,
            trackType: trackType,
            color: TRACK_COLORS[trackType] || '#CCCCCC',
            start_beat: start,
            end_beat: endTime,
            duration_beats: duration,
            start_sec: startSec,
            end_sec: endSec,
            midi: midi,
            velocity: note.velocity !== undefined ? note.velocity : 0.8
          });
        });
      }
    });

    if (compositionDuration && compositionDuration > this.maxTime) {
      this.maxTime = compositionDuration;
    }

    this.totalDurationSeconds = maxTimeSec > 0 ? maxTimeSec + 0.5 : 8;
    this.maxTime = Math.max(Math.ceil(this.maxTime / 4) * 4, 4);

    if (this.notes.length > 0) {
      const pitchPadding = 6;
      this.config.minPitch = Math.max(0, Math.floor(minPitch / 12) * 12 - pitchPadding);
      this.config.maxPitch = Math.min(127, Math.ceil(maxPitch / 12) * 12 + pitchPadding);
    }

    this._filteredNotes = null;
    this._lastFilteredTrack = null;
    this._needsRedraw = true;

    this.updateTrackSelectors();
    this.updateMetadataDisplay('all');
    this.setupCanvas();
    this.renderStaticBackground();
    this.drawFrame();
  }

  setupCanvas() {
    if (!this.visualizerEl) return;
    
    this.visualizerEl.innerHTML = '';
    this.destroyCanvases();
    
    this._isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
                     (navigator.maxTouchPoints > 1 && window.innerWidth < 768);

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.visualizerEl.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    this.bgCanvas = document.createElement('canvas');
    this.bgCtx = this.bgCanvas.getContext('2d');

    window.addEventListener('resize', this._boundResizeCanvas);
    
    this.resizeCanvas();
  }

  destroyCanvases() {
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.bgCanvas = null;
    this.bgCtx = null;
  }

  cleanupResources() {
    this.stopVisualization();
    this.clearCaches();
    
    if (this._boundResizeCanvas) {
      window.removeEventListener('resize', this._boundResizeCanvas);
    }
  }

  clearCaches() {
    this._filteredNotes = null;
    this._lastFilteredTrack = null;
    this._cachedBgGradient = null;
    this._cachedGradientHeight = null;
    this._lightenCache.clear();
    this._activeNotes = [];
  }

  resizeCanvas() {
    if (!this.canvas || !this.visualizerEl || !this.ctx || !this.bgCtx) return;

    const width = this.visualizerEl.clientWidth;
    const height = this.visualizerEl.clientHeight;

    if (width === 0 || height === 0) return;

    this.canvas.width = width;
    this.canvas.height = height;
    this.bgCanvas.width = width;
    this.bgCanvas.height = height;

    this.renderStaticBackground();
    this.drawFrame();
  }

  // ✅ ΔΙΟΡΘΩΜΕΝΟ: Δέχεται δευτερόλεπτα & loop flag
  startVisualization(durationSeconds = null, shouldLoop = false) {
    if (!this.canvas || this.isVisualizing) return;
    this.isVisualizing = true;
    this._lastFrameTime = performance.now();
    this._frameCount = 0;
    this._loopDurationSeconds = durationSeconds || this.totalDurationSeconds;
    this._shouldLoop = shouldLoop;
    
    this.loop();
  }

  stopVisualization() {
    this.isVisualizing = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.ctx && this.canvas) {
      this.drawFrame();
    }
  }

  loop() {
    if (!this.isVisualizing) return;
    
    const now = performance.now();
    const targetFPS = this._isMobile ? 20 : 30;
    const frameInterval = 1000 / targetFPS;
    
    if (now - this._lastFrameTime >= frameInterval) {
      this._lastFrameTime = now - ((now - this._lastFrameTime) % frameInterval);
      this.drawFrame();
    }
    
    this.animationFrameId = requestAnimationFrame(() => this.loop());
  }

  renderStaticBackground() {
    if (!this.bgCtx || !this.bgCanvas) return;

    const w = this.bgCanvas.width;
    const h = this.bgCanvas.height;
    if (w === 0 || h === 0) return;

    const { padding } = this.config;
    const drawHeight = h - padding.top - padding.bottom;
    const drawWidth = w - padding.left - padding.right;

    this.bgCtx.fillStyle = this.config.bgColor;
    this.bgCtx.fillRect(0, 0, w, h);
    this.drawPianoRollBackground(this.bgCtx, w, h, drawHeight);
    this.drawGrid(this.bgCtx, w, h, drawWidth, drawHeight);
    this.drawTimeMarkers(this.bgCtx, w, h, drawWidth);
    this.drawPitchLabels(this.bgCtx, h, drawHeight);

    const pitchRange = this.config.maxPitch - this.config.minPitch;
    
    if (!this._filteredNotes || this._lastFilteredTrack !== this.activeTrackType) { 
      this._filteredNotes = this.activeTrackType === 'all' 
        ? this.notes 
        : this.notes.filter(n => n.trackType === this.activeTrackType);
      this._lastFilteredTrack = this.activeTrackType;
    }

    for (let i = 0; i < this._filteredNotes.length; i++) {
      const note = this._filteredNotes[i];
      const coords = this.getNoteCoordinates(note, drawWidth, drawHeight, pitchRange);
      
      const mixVol = TRACK_INSTRUMENTS[note.trackType]?.mixVolume || 0.7;
      let alpha = (0.25 + (note.velocity * 0.25)) * mixVol;
      if (this.activeTrackType === 'all') alpha *= 0.7;

      this.bgCtx.fillStyle = note.color;
      this.bgCtx.globalAlpha = alpha;
      this.roundRect(this.bgCtx, coords.x, coords.y, coords.w, coords.h, this.config.noteRadius);
      this.bgCtx.fill();
      
      this.bgCtx.globalAlpha = alpha * 0.5;
      this.bgCtx.strokeStyle = note.color;
      this.bgCtx.lineWidth = 1; 
      this.bgCtx.stroke();
    }

    this.bgCtx.globalAlpha = 1.0;
  }

  // ✅ ΔΙΟΡΘΩΜΕΝΟ: Απόλυτος συγχρονισμός με Tone.Transport.seconds
  drawFrame() {
    if (!this.ctx || !this.canvas || !this.bgCtx) return;

    const w = this.canvas.width; 
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    const { padding } = this.config;
    const drawHeight = h - padding.top - padding.bottom;
    const drawWidth = w - padding.left - padding.right;
    
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(this.bgCanvas, 0, 0);

    // ✅ ΧΡΗΣΗ ΤΟΥ ΕΣΩΤΕΡΙΚΟΥ ΧΡΟΝΟΜΕΤΡΟΥ ΤΟΥ TRANSPORT
    const transportSec = Tone.Transport.seconds || 0;
    
    let playheadProgress = 0;
    if (this._shouldLoop && this._loopDurationSeconds) {
      playheadProgress = ((transportSec % this._loopDurationSeconds) + this._loopDurationSeconds) % this._loopDurationSeconds;
      playheadProgress /= this._loopDurationSeconds;
    } else {
      playheadProgress = Math.min(1, transportSec / (this.totalDurationSeconds || 1));
    }

    const pitchRange = this.config.maxPitch - this.config.minPitch;
    this._activeNotes.length = 0;

    if (!this._filteredNotes || this._lastFilteredTrack !== this.activeTrackType) {
      this._filteredNotes = this.activeTrackType === 'all'  
        ? this.notes 
        : this.notes.filter(n => n.trackType === this.activeTrackType);
      this._lastFilteredTrack = this.activeTrackType;
    }

    // ✅ ΕΝΕΡΓΕΣ ΝΟΤΕΣ ΒΑΣΙΣΜΕΝΕΣ ΣΕ ΔΕΥΤΕΡΟΛΕΠΤΑ
    for (let i = 0; i < this._filteredNotes.length; i++) {
      const note = this._filteredNotes[i];
      if (transportSec >= note.start_sec && transportSec <= note.end_sec) {
        this._activeNotes.push(note);
      }
    }

    for (let i = 0; i < this._activeNotes.length; i++) {
      const note = this._activeNotes[i];
      const coords = this.getNoteCoordinates(note, drawWidth, drawHeight, pitchRange);
      
      const progress = (transportSec - note.start_sec) / (note.end_sec - note.start_sec || 1);
      const scale = this.config.activeNoteScale;
      const pulse = 1 + Math.sin(progress * Math.PI) * 0.1;
      
      this.ctx.save();
      if (!this._isMobile) {
        this.ctx.shadowColor = note.color;
        this.ctx.shadowBlur = this.config.glowIntensity * pulse;
      }
      
      this.ctx.fillStyle = note.color;
      this.ctx.globalAlpha = 0.3;
      this.roundRect(this.ctx, coords.x - 3, coords.y - 3, coords.w + 6, coords.h + 6, this.config.noteRadius + 2);
      this.ctx.fill();
      
      this.ctx.globalAlpha = 0.95;
      this.ctx.fillStyle = note.color;
      const scaledW = coords.w * scale;
      const scaledH = coords.h * scale;
      const offsetX = (scaledW - coords.w) / 2;
      const offsetY = (scaledH - coords.h) / 2;
      
      this.roundRect(this.ctx, coords.x - offsetX, coords.y - offsetY, scaledW, scaledH, this.config.noteRadius);
      this.ctx.fill();
      
      this.ctx.globalAlpha = 1.0;
      this.ctx.strokeStyle = this.lightenColor(note.color, 30);
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
      
      if (coords.w > 10) {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.fillRect(coords.x, coords.y, coords.w * progress, coords.h);
      }
      
      this.ctx.restore();
    }

    this.drawPlayhead(this.ctx, playheadProgress, w, h);
  }

  getNoteCoordinates(note, drawWidth, drawHeight, pitchRange) {
    const { padding } = this.config;
    const x = padding.left + (note.start_beat / this.maxTime) * drawWidth;
    const noteWidth = Math.max(this.config.noteMinWidth, (note.duration_beats / this.maxTime) * drawWidth);
    
    const normalizedPitch = (note.midi - this.config.minPitch) / pitchRange;
    const y = padding.top + (drawHeight * (1 - normalizedPitch));
    const noteHeight = Math.max(this.config.noteMinHeight, drawHeight / pitchRange);

    this._coordsBuf.x = x;
    this._coordsBuf.y = y;
    this._coordsBuf.w = noteWidth;
    this._coordsBuf.h = noteHeight;
    return this._coordsBuf;
  }

  drawGrid(ctx, w, h, drawWidth, drawHeight) {
    const { padding, gridOpacity, gridColor, minPitch, maxPitch } = this.config;
    const pitchRange = maxPitch - minPitch;
    
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    
    for (let pitch = minPitch; pitch <= maxPitch; pitch++) {
      const normalizedPitch = (pitch - minPitch) / pitchRange;
      const y = padding.top + drawHeight * (1 - normalizedPitch);
      
      ctx.beginPath();
      ctx.globalAlpha = gridOpacity;
      
      const isBlackKey = [1, 3, 6, 8, 10].includes(pitch % 12);
      if (isBlackKey) ctx.globalAlpha = gridOpacity / 2;
      
      const isOctave = (pitch % 12 === 0);
      if (isOctave) ctx.globalAlpha = gridOpacity * 1.5;
      
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }

    const beatsPerMeasure = 4;
    for (let beat = 0; beat <= this.maxTime; beat++) {
      const x = padding.left + (beat / this.maxTime) * drawWidth;
      ctx.beginPath();
      ctx.globalAlpha = (beat % beatsPerMeasure === 0) ? gridOpacity * 2 : gridOpacity / 1.5;
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, h - padding.bottom);
      ctx.stroke();
    }
    
    ctx.globalAlpha = 1.0;
  }

  // ✅ ΔΙΟΡΘΩΜΕΝΟ: Χρήση прогресс (0-1) και απόλυτου χρόνου
  drawPlayhead(ctx, progress, w, h) {
    const { padding } = this.config;
    const drawWidth = w - padding.left - padding.right;
    const x = padding.left + progress * drawWidth;
    
    if (x >= padding.left && x <= padding.left + drawWidth) {
      ctx.save();
      if (!this._isMobile) {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
        ctx.shadowBlur = 15;
      }
      
      ctx.strokeStyle = this.config.playheadColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, h - padding.bottom);
      ctx.stroke();

      ctx.shadowBlur = 8;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(x - 6, padding.top);
      ctx.lineTo(x + 6, padding.top);
      ctx.lineTo(x, padding.top + 12);
      ctx.closePath();
      ctx.fill();

      // ✅ ΑΚΡΙΒΗΣ ΧΡΟΝΟΣ ΑΠΟ ΤΟ TRANSPORT
      const totalSec = this.totalDurationSeconds || 8;
      const transportSec = Tone.Transport.seconds || 0;
      const currentSec = this._shouldLoop ? (transportSec % totalSec) : Math.min(transportSec, totalSec);
      
      const mins = Math.floor(currentSec / 60);
      const secs = Math.floor(currentSec % 60);
      const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
      
      ctx.shadowBlur = 0;
      ctx.font = '11px monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(timeStr, x, padding.top - 8);
      ctx.restore();
    }
  }

  roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  drawPianoRollBackground(ctx, w, h, drawHeight) {
    const { padding } = this.config;
    const pitchRange = this.config.maxPitch - this.config.minPitch;
    const blackKeys = [1, 3, 6, 8, 10];
    
    for (let pitch = this.config.minPitch; pitch <= this.config.maxPitch; pitch++) {
      const noteIndex = pitch % 12;
      const isBlackKey = blackKeys.includes(noteIndex);
      
      if (isBlackKey) {
        const normalizedPitch = (pitch - this.config.minPitch) / pitchRange;
        const y = padding.top + drawHeight * (1 - normalizedPitch);
        const rowHeight = drawHeight / pitchRange;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fillRect(padding.left, y, w - padding.left - padding.right, rowHeight);
      }
    }
  }

  drawTimeMarkers(ctx, w, h, drawWidth) {
    const { padding, gridColor } = this.config;
    const beatsPerMeasure = 4;
    
    ctx.fillStyle = gridColor;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    const markerY = h - padding.bottom + 5;

    for (let beat = 0; beat <= this.maxTime; beat += beatsPerMeasure) {
      const measureNumber = Math.floor(beat / beatsPerMeasure) + 1;
      const x = padding.left + (beat / this.maxTime) * drawWidth;

      ctx.beginPath();
      ctx.moveTo(x, h - padding.bottom);
      ctx.lineTo(x, h - padding.bottom + 4);
      ctx.strokeStyle = gridColor;
      ctx.globalAlpha = 1;
      ctx.stroke();
      
      ctx.globalAlpha = 1;
      ctx.fillText(`${measureNumber}`, x, markerY);
    }
  }

  drawPitchLabels(ctx, h, drawHeight) {
    const { padding } = this.config;
    const pitchRange = this.config.maxPitch - this.config.minPitch;
    
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    const startPitch = Math.ceil(this.config.minPitch / 12) * 12;

    for (let pitch = startPitch; pitch <= this.config.maxPitch; pitch += 12) {
      const normalizedPitch = (pitch - this.config.minPitch) / pitchRange;
      const y = padding.top + drawHeight * (1 - normalizedPitch);
      const octave = (pitch / 12) - 1;
      
      ctx.fillStyle = 'rgba(74, 222, 128, 0.3)';
      ctx.fillText(`C${octave}`, padding.left - 8, y);
      ctx.fillRect(padding.left, y, 4, 1);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  }

  drawActiveNoteIndicator(ctx, count, w) {
    ctx.save();
    ctx.font = 'bold 12px sans-serif'; 
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'right';
    ctx.fillText(`♪ ${count}`, w - 20, 25);
    ctx.restore();
  }

  lightenColor(color, percent) {
    const key = `${color}_${percent}`;
    if (this._lightenCache.has(key)) return this._lightenCache.get(key);
    
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, (num >> 8 & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    const result = `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
    
    this._lightenCache.set(key, result);
    return result;
  }

  handleTrackSelection(event) {
    const trackType = event.target.dataset.trackType;
    if (trackType) this.setActiveTrack(trackType);
  }

  updateTrackSelectors() {
    const trackSelectionDiv = document.getElementById('track-selection');
    if (!trackSelectionDiv) return;
    
    const oldButtons = trackSelectionDiv.querySelectorAll('.track-selector');
    oldButtons.forEach(btn => {
      btn.removeEventListener('click', this._boundHandleTrackSelection);
    });
    
    trackSelectionDiv.innerHTML = '';
    
    const allBtn = this.createSelectorButton('all', 'All Tracks', true);
    trackSelectionDiv.appendChild(allBtn);

    this.generatedTracks.forEach((_, trackType) => {
      const label = trackType.charAt(0).toUpperCase() + trackType.slice(1);
      const btn = this.createSelectorButton(trackType, label);
      trackSelectionDiv.appendChild(btn);
    });
    
    this.activeTrackType = 'all';
  }

  createSelectorButton(trackType, label, isActive = false) {
    const btn = document.createElement('button');
    btn.className = 'track-selector';
    if (isActive) btn.classList.add('active');
    
    const color = TRACK_COLORS[trackType] || '#666';

    if (trackType === 'all') {
      btn.style.borderColor = isActive ? 'var(--accent)' : 'rgba(84,183,110,0.3)';
    } else {
      btn.style.borderColor = color;
      btn.style.color = isActive ? '#fff' : 'var(--text-gray-400)';
      if (isActive) {
        btn.style.background = `${color}33`;
        btn.style.boxShadow = `0 0 8px ${color}55`;
      }
    }
    
    btn.dataset.trackType = trackType;
    
    btn.onmouseenter = () => {
      if (!btn.classList.contains('active')) {
        btn.style.background = `${color}33`;
      }
    };
    btn.onmouseleave = () => {
      if (!btn.classList.contains('active')) {
        btn.style.background = 'transparent';
      }
    };

    btn.addEventListener('click', this._boundHandleTrackSelection);
    btn.textContent = label;
    return btn;
  }

  updateMetadataDisplay(trackType) {
    const metadataEl = document.getElementById('track-metadata');
    if (!metadataEl) return;

    let htmlContent = '';
    
    if (trackType === 'all') {
      htmlContent = `
        <h3 class="text-lg font-bold text-white tracking-wide">${this.compositionTitle || 'Composition'}</h3>
        <p class="text-sm text-gray-400">${this.compositionDescription || ''}</p>
      `;
    } else {
      const trackData = this.generatedTracks.get(trackType);
      const title = trackData?.title || trackType;
      const desc = trackData?.description || `Sequence for ${trackType}`;
      const color = TRACK_COLORS[trackType];
      
      htmlContent = `
        <div class="flex items-center gap-2">
          <div style="width: 10px; height: 10px; border-radius: 50%; background-color: ${color}; box-shadow: 0 0 8px ${color}; flex-shrink:0;"></div>
          <h3 class="text-lg font-bold" style="color: var(--light);">${title}</h3>
        </div>
        <p class="text-sm text-gray-400 mt-1">${desc}</p>
      `;
    }
    metadataEl.innerHTML = htmlContent;
  }

  setActiveTrack(trackType) {
    if (trackType !== 'all' && !this.generatedTracks.has(trackType)) {
      console.warn(`[VISUALIZER] Invalid track type: ${trackType}`);
      return;
    }
    
    document.querySelectorAll('.track-selector').forEach(btn => {
      btn.classList.remove('active');
      btn.style.background = '';
      btn.style.boxShadow = '';

      if (btn.dataset.trackType === trackType) {
        btn.classList.add('active');
        if (trackType !== 'all') {
          const color = TRACK_COLORS[trackType] || '#666';
          btn.style.background = `${color}33`;
          btn.style.borderColor = color;
          btn.style.color = '#fff';
          btn.style.boxShadow = `0 0 10px ${color}66`;
        }
      } else if (btn.dataset.trackType !== 'all') {
        const color = TRACK_COLORS[btn.dataset.trackType] || '#666'; 
        btn.style.borderColor = color;
        btn.style.color = 'var(--text-gray-400)';
      }
    });

    this.activeTrackType = trackType;
    this.updateMetadataDisplay(trackType);
    
    this._filteredNotes = null;
    this._lastFilteredTrack = null;
    this.renderStaticBackground();
    this.drawFrame();
  }

  reset() {
    this.stopVisualization();
    this.cleanupResources();
    
    this.notes = [];
    this.generatedTracks.clear();
    this._filteredNotes = null;
    this._lastFilteredTrack = null;
    this._cachedBgGradient = null;
    this._cachedGradientHeight = null;
    this._activeNotes = [];
    this._lightenCache.clear();
    this._needsRedraw = true;
    
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.bgCtx && this.bgCanvas) {
      this.bgCtx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
    }

    if (this.visualizerEl) {
      this.visualizerEl.style.background = '';
      this.visualizerEl.style.backgroundColor = '';
      this.visualizerEl.innerHTML = `
        <div class="visualizer-placeholder">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <span>Generate a track to preview</span>
        </div>
      `;
    }
    
    const sel = document.getElementById('track-selection');
    const meta = document.getElementById('track-metadata');
    if(sel) sel.innerHTML = '';
    if(meta) meta.innerHTML = '';
    
    this.activeTrackType = 'all';
    this.compositionTitle = '';
    this.compositionDescription = '';
    this._needsRedraw = true;
  }
}
