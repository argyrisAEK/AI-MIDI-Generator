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
        
        // 🔥 FIX: Αποθήκευση bound methods για σωστό cleanup
        this._boundResizeCanvas = this.resizeCanvas.bind(this);
        this._boundHandleTrackSelection = this.handleTrackSelection.bind(this);
        
        this.notes = [];
        this.maxTime = 0; 

        // 🔥 FIX: Παρακολούθηση κατάστασης για αποφυγή duplicate renders
        this._isRendering = false;
        this._lastFrameTime = 0;
        this._frameCount = 0;
        this._needsRedraw = true;

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

        // 🔥 FIX: Cache για επιδόσεις
        this._coordsBuf = { x: 0, y: 0, w: 0, h: 0 };
        this._filteredNotes = null;
        this._lastFilteredTrack = null;
        this._cachedBgGradient = null;
        this._cachedGradientHeight = null;
        this._activeNotes = [];
        this._lightenCache = new Map();
    }

    loadNotes(tracks, title = '', description = '', compositionDuration = null) {
        // 🔥 FIX: Καθαρισμός πριν τη φόρτωση νέων δεδομένων
        this.cleanupResources();
        
        this.generatedTracks = tracks;
        this.compositionTitle = title;
        this.compositionDescription = description;
        this.notes = [];
        this.maxTime = 0;
        
        let minPitch = 127;
        let maxPitch = 0;

        // Process notes and convert from seconds to beats if necessary
        tracks.forEach((trackData, trackType) => {
            const notesArray = trackData?.midi?.tracks?.[0]?.notes || trackData?.notes || [];
            
            if (notesArray.length > 0) {
                notesArray.forEach(note => {
                    let start, duration;
                    
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
                        midi: midi,
                        velocity: note.velocity !== undefined ? note.velocity : 0.8
                    });
                });
            }
        });

        // Use composition duration if provided
        if (compositionDuration && compositionDuration > this.maxTime) {
            this.maxTime = compositionDuration;
        }

        // Auto-adjust pitch range
        if (this.notes.length > 0) {
            const pitchPadding = 6;
            this.config.minPitch = Math.max(0, Math.floor(minPitch / 12) * 12 - pitchPadding);
            this.config.maxPitch = Math.min(127, Math.ceil(maxPitch / 12) * 12 + pitchPadding);
        }

        // 🔥 FIX: Ασφάλεια για κενά tracks
        this.maxTime = Math.max(Math.ceil(this.maxTime / 4) * 4, 4);

        // 🔥 FIX: Reset cache όταν αλλάζουν τα δεδομένα
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
        
        // 🔥 FIX: Καθαρισμός placeholder και προηγούμενων canvases αν υπάρχουν
        this.visualizerEl.innerHTML = '';
        this.destroyCanvases();
        
        this._isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
                         (navigator.maxTouchPoints > 1 && window.innerWidth < 768);

        // 1. Setup Main Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        this.visualizerEl.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d', { alpha: false });

        // 2. Setup Off-screen Buffer
        this.bgCanvas = document.createElement('canvas');
        this.bgCtx = this.bgCanvas.getContext('2d');

        // 3. Handle Resize - σωστή αφαίρεση παλιού listener
        window.addEventListener('resize', this._boundResizeCanvas);
        
        this.resizeCanvas();
    }

    // 🔥 FIX: Νέα μέθοδος για καθαρισμό canvases
    destroyCanvases() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;
        this.bgCanvas = null;
        this.bgCtx = null;
    }

    // 🔥 FIX: Νέα μέθοδος για καθαρισμό resources
    cleanupResources() {
        this.stopVisualization();
        this.clearCaches();
        
        if (this._boundResizeCanvas) {
            window.removeEventListener('resize', this._boundResizeCanvas);
        }
    }

    // 🔥 FIX: Νέα μέθοδος για καθαρισμό caches
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

        // 🔥 FIX: Έλεγχος για έγκυρες διαστάσεις
        if (width === 0 || height === 0) return;

        this.canvas.width = width;
        this.canvas.height = height;
        this.bgCanvas.width = width;
        this.bgCanvas.height = height;

        this.renderStaticBackground();
        this.drawFrame();
    }

    startVisualization(loopDurationBeats = null) {
        if (!this.canvas || this.isVisualizing) return;
        this.isVisualizing = true;
        this._lastFrameTime = performance.now();
        this._frameCount = 0;
        // Αποθηκεύουμε το AudioContext time τη στιγμή που ξεκινάει ο Transport (+0.1s delay)
        this._transportStartAudioTime = Tone.now() + 0.1;
        // Για loop sync: πόσα beats διαρκεί ένας κύκλος
        this._loopDurationBeats = loopDurationBeats;
        this.loop();
    }

    stopVisualization() {
        this.isVisualizing = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        // Draw one final static frame
        if (this.ctx && this.canvas) {
            this.drawFrame();
        }
    }

    loop() {
        if (!this.isVisualizing) return;
        
        // 🔥 FIX: Βελτιστοποίηση frame rate
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
        
        // 🔥 FIX: Έλεγχος για έγκυρες διαστάσεις
        if (w === 0 || h === 0) return;

        const { padding } = this.config;
        const drawHeight = h - padding.top - padding.bottom;
        const drawWidth = w - padding.left - padding.right;

        // Clear background
        this.bgCtx.fillStyle = this.config.bgColor;
        this.bgCtx.fillRect(0, 0, w, h);

        // 2. Draw Piano Roll Background
        this.drawPianoRollBackground(this.bgCtx, w, h, drawHeight);

        // 3. Draw Grid
        this.drawGrid(this.bgCtx, w, h, drawWidth, drawHeight);

        // 4. Draw Time Markers
        this.drawTimeMarkers(this.bgCtx, w, h, drawWidth);

        // 5. Draw Pitch Labels
        this.drawPitchLabels(this.bgCtx, h, drawHeight);

        // 6. Draw Idle Notes
        const pitchRange = this.config.maxPitch - this.config.minPitch;
        
        // Update filtered notes cache
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

     drawFrame() {
        if (!this.ctx || !this.canvas || !this.bgCtx) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        
        if (w === 0 || h === 0) return;

        const { padding } = this.config;
        const drawHeight = h - padding.top - padding.bottom;
        const drawWidth = w - padding.left - padding.right;
        
        // 1. Clear & Copy Background from Buffer
        this.ctx.clearRect(0, 0, w, h);
        this.ctx.drawImage(this.bgCanvas, 0, 0);

        // ✅ SYNC FIX: Υπολογισμός currentBeat βάσει AudioContext time
        // Αυτό είναι sample-accurate και συγχρονισμένο με τον πραγματικό ήχο.
        let currentBeat = 0;
        if (this.isVisualizing && this._transportStartAudioTime != null) {
            const bpm = Tone.Transport.bpm.value || 120;
            const elapsed = Tone.now() - this._transportStartAudioTime;
            const rawBeat = (elapsed * bpm) / 60;

            if (this._loopDurationBeats && this._loopDurationBeats > 0) {
                // Loop mode: επαναφορά στην αρχή μόλις τελειώσει ο κύκλος
                currentBeat = rawBeat % this._loopDurationBeats;
            } else {
                currentBeat = Math.max(0, rawBeat);
            }
        } else {
            // Στατική κατάσταση (παύση/stop): χρήση Transport ticks
            const ticksPerBeat = Tone.Transport.PPQ || 192;
            currentBeat = Tone.Transport.ticks / ticksPerBeat;
        }

        // 2. Highlight Currently Playing Notes
        const pitchRange = this.config.maxPitch - this.config.minPitch;
        
        // Clear and reuse array for performance
        this._activeNotes.length = 0;

        // Update filtered notes cache if needed
        if (!this._filteredNotes || this._lastFilteredTrack !== this.activeTrackType) {
            this._filteredNotes = this.activeTrackType === 'all' 
                ? this.notes 
                : this.notes.filter(n => n.trackType === this.activeTrackType);
            this._lastFilteredTrack = this.activeTrackType;
        }

        // Collect active notes
        for (let i = 0; i < this._filteredNotes.length; i++) {
            const note = this._filteredNotes[i];
            if (currentBeat >= note.start_beat && currentBeat <= note.end_beat) {
                this._activeNotes.push(note);
            }
        }

        // Draw active notes
        for (let i = 0; i < this._activeNotes.length; i++) {
            const note = this._activeNotes[i];
            const coords = this.getNoteCoordinates(note, drawWidth, drawHeight, pitchRange);
            
            const progress = (currentBeat - note.start_beat) / note.duration_beats;
            const scale = this.config.activeNoteScale;
            const pulse = 1 + Math.sin(progress * Math.PI) * 0.1;
            
            this.ctx.save();
            if (!this._isMobile) {
                this.ctx.shadowColor = note.color;
                this.ctx.shadowBlur = this.config.glowIntensity * pulse;
            }
            
            // Draw outer glow
            this.ctx.fillStyle = note.color;
            this.ctx.globalAlpha = 0.3;
            this.roundRect(
                this.ctx, 
                coords.x - 3, 
                coords.y - 3, 
                coords.w + 6, 
                coords.h + 6, 
                this.config.noteRadius + 2
            );
            this.ctx.fill();
            
            // Draw main note
            this.ctx.globalAlpha = 0.95;
            this.ctx.fillStyle = note.color;
            const scaledW = coords.w * scale;
            const scaledH = coords.h * scale;
            const offsetX = (scaledW - coords.w) / 2;
            const offsetY = (scaledH - coords.h) / 2;
            
            this.roundRect(
                this.ctx, 
                coords.x - offsetX, 
                coords.y - offsetY, 
                scaledW, 
                scaledH, 
                this.config.noteRadius
            );
            this.ctx.fill();
            
            // Bright border
            this.ctx.globalAlpha = 1.0;
            this.ctx.strokeStyle = this.lightenColor(note.color, 30);
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            
            // Progress bar
            if (coords.w > 10) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                this.ctx.fillRect(coords.x, coords.y, coords.w * progress, coords.h);
            }
            
            this.ctx.restore();
        }

        // 3. Draw Playhead
        this.drawPlayhead(this.ctx, currentBeat, w, h);
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
        
        // Horizontal lines (pitch)
        for (let pitch = minPitch; pitch <= maxPitch; pitch++) {
            const normalizedPitch = (pitch - minPitch) / pitchRange;
            const y = padding.top + drawHeight * (1 - normalizedPitch);
            
            ctx.beginPath();
            ctx.globalAlpha = gridOpacity;
            
            const isBlackKey = [1, 3, 6, 8, 10].includes(pitch % 12);
            if (isBlackKey) {
                 ctx.globalAlpha = gridOpacity / 2;
            }
            
            const isOctave = (pitch % 12 === 0);
            if (isOctave) {
                ctx.globalAlpha = gridOpacity * 1.5;
            }
            
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();
        }

        // Vertical lines (time)
        const beatsPerMeasure = 4;
        
        for (let beat = 0; beat <= this.maxTime; beat++) {
            const x = padding.left + (beat / this.maxTime) * drawWidth;
            
            ctx.beginPath();
            
            if (beat % beatsPerMeasure === 0) {
                ctx.globalAlpha = gridOpacity * 2;
            } else {
                ctx.globalAlpha = gridOpacity / 1.5;
            }
            
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, h - padding.bottom);
            ctx.stroke();
        }
        
        ctx.globalAlpha = 1.0;
    }

      drawPlayhead(ctx, currentBeat, w, h) {
        const { padding } = this.config;
        const drawWidth = w - padding.left - padding.right;
        const x = padding.left + (currentBeat / this.maxTime) * drawWidth;
        
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

            // ✅ FIX: Calculate time display from currentBeat (which is in beats)
            // Convert beats to seconds: seconds = beats * 60 / bpm
            const bpm = Tone.Transport.bpm.value || 120;
            const seconds = (currentBeat / bpm) * 60;
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
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
        
        // 🔥 FIX: Καθαρισμός προηγούμενων listeners πριν δημιουργήσουμε νέα buttons
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
            // All Tracks: uses CSS .active class only
            btn.style.borderColor = isActive ? 'var(--accent)' : 'rgba(84,183,110,0.3)';
        } else {
            // Individual tracks: border gets track color, text stays neutral
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
                    <div style="width: 10px; height: 10px; border-radius: 50%; background-color: ${color}; box-shadow: 0 0 8px ${color}"></div>
                    <h3 class="text-lg font-bold" style="color:${color}">${title}</h3>
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
                // Restore track color border only, text stays neutral
                const color = TRACK_COLORS[btn.dataset.trackType] || '#666';
                btn.style.borderColor = color;
                btn.style.color = 'var(--text-gray-400)';
            }
        });

        this.activeTrackType = trackType;
        this.updateMetadataDisplay(trackType);
        
        // Invalidate cache και redraw
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
        
        // Clear canvases
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        if (this.bgCtx && this.bgCanvas) {
            this.bgCtx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
        }

        // ✅ Επαναφορά του visualizer div στο αρχικό appearance
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
