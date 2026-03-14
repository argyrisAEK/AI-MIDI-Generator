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
        
        this.boundHandleTrackSelection = this.handleTrackSelection.bind(this);
        this.notes = [];
        this.maxTime = 0; 

        // Visual Configuration
        this.config = {
            minPitch: 24,
            maxPitch: 96,
            padding: { top: 8, bottom: 8, left: 8, right: 8 },
            noteRadius: 3,
            noteMinHeight: 4,
            noteMinWidth: 3,
            playheadColor: 'rgba(255,255,255,0.85)',
        };
    }

    loadNotes(tracks, title = '', description = '', compositionDuration = null) {
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
                    // Handle both beat-based and time-based notes
                    let start, duration;
                    
                    if (note.start_beat !== undefined) {
                        // Already in beats
                        start = note.start_beat;
                        duration = note.duration_beats || note.duration || 0.5;
                    } else if (note.time !== undefined) {
                        // Convert from seconds to beats (assuming standard tempo)
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

        // Use composition duration if provided, otherwise calculate from notes
        if (compositionDuration && compositionDuration > this.maxTime) {
            // Duration is already in beats
            this.maxTime = compositionDuration;
            console.log(`⏱️ Using composition duration: ${compositionDuration} beats (${(compositionDuration / 4).toFixed(1)} bars)`);
        }

        // Auto-adjust pitch range to fit all notes with some padding
        if (this.notes.length > 0) {
            const pitchPadding = 6; // Half octave padding
            this.config.minPitch = Math.max(0, Math.floor(minPitch / 12) * 12 - pitchPadding);
            this.config.maxPitch = Math.min(127, Math.ceil(maxPitch / 12) * 12 + pitchPadding);
            
            console.log(`🎹 Pitch range: ${this.config.minPitch} - ${this.config.maxPitch} (${this.notes.length} notes)`);
        }

        this.maxTime = Math.ceil(this.maxTime / 4) * 4;

// Ασφάλεια: Αν είναι 0 (κενό track), βάλε τουλάχιστον 4 beats
if (this.maxTime === 0) this.maxTime = 4;

        console.log(`✅ Visualizer loaded ${this.notes.length} notes from ${tracks.size} tracks. Timeline: ${this.maxTime.toFixed(2)} beats (${(this.maxTime / 4).toFixed(1)} bars)`);
        
        this.updateTrackSelectors();
        this.updateMetadataDisplay('all');
        this.setupCanvas();
    }

    setupCanvas() {
        if (!this.visualizerEl) return;
        // Detect mobile/low-power device — disable expensive effects
        this._isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
                         (navigator.maxTouchPoints > 1 && window.innerWidth < 768);

        // 1. Setup Main Canvas
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.visualizerEl.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d', { alpha: false }); // alpha:false = λιγότερο GPU load
        }

        // 2. Setup Off-screen Buffer (for static grid/notes)
        if (!this.bgCanvas) {
            this.bgCanvas = document.createElement('canvas');
            this.bgCtx = this.bgCanvas.getContext('2d');
        }

        // 3. Handle Resize — αποθηκεύουμε το bound reference για σωστή αφαίρεση
        if (this._boundResizeCanvas) {
            window.removeEventListener('resize', this._boundResizeCanvas);
        }
        this._boundResizeCanvas = () => this.resizeCanvas();
        window.addEventListener('resize', this._boundResizeCanvas);

        this.resizeCanvas();
    }
    
    resizeCanvas() {
        if (!this.canvas || !this.visualizerEl) return;

        // Get display size
        const width = this.visualizerEl.clientWidth;
        const height = this.visualizerEl.clientHeight;

        // Update Main Canvas
        this.canvas.width = width;
        this.canvas.height = height;

        // Update Buffer Canvas
        this.bgCanvas.width = width;
        this.bgCanvas.height = height;

        // Redraw the static background immediately
        this.renderStaticBackground();
        this.drawFrame(); // Draw one frame to update view
    }

    startVisualization() {
        if (!this.canvas) return;
        this.isVisualizing = true;
        this.loop();
    }

    stopVisualization() {
        this.isVisualizing = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        // Draw one final static frame
        requestAnimationFrame(() => this.drawFrame());
    }

    loop() {
        if (!this.isVisualizing) return;
        if (this._isMobile) {
            // Throttle to ~30fps on mobile to reduce main thread pressure
            const now = performance.now();
            if (!this._lastFrameTime || now - this._lastFrameTime >= 33) {
                this._lastFrameTime = now;
                this.drawFrame();
            }
        } else {
            this.drawFrame();
        }
        this.animationFrameId = requestAnimationFrame(() => this.loop());
    }

    /**
     * Renders the Grid and the "Idle" (inactive) notes to the off-screen buffer.
     * This is only called on resize or track selection change.
     */
    renderStaticBackground() {
        if (!this.bgCtx) return;

        const w = this.bgCanvas.width;
        const h = this.bgCanvas.height;
        const { padding } = this.config;
        const drawHeight = h - padding.top - padding.bottom;
        const drawWidth  = w - padding.left - padding.right;

        // Background
        this.bgCtx.fillStyle = '#1a1e22';
        this.bgCtx.fillRect(0, 0, w, h);

        // Idle notes — flat fill, no border, no glow
        const pitchRange = this.config.maxPitch - this.config.minPitch;
        this.bgCtx.globalAlpha = 1;

        this.notes.forEach(note => {
            if (this.activeTrackType !== 'all' && note.trackType !== this.activeTrackType) return;
            const coords = this.getNoteCoordinates(note, drawWidth, drawHeight, pitchRange);
            this.bgCtx.fillStyle = note.color;
            this.bgCtx.globalAlpha = 0.28;
            this.bgCtx.fillRect(coords.x, coords.y, Math.max(coords.w, this.config.noteMinWidth), Math.max(coords.h, this.config.noteMinHeight));
        });

        this.bgCtx.globalAlpha = 1;
    }

    /**
     * The Main Animation Loop
     * Draws the static buffer + Playhead + Active (Glowing) Notes
     */
    drawFrame() {
        if (!this.ctx || !this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const { padding } = this.config;
        const drawHeight = h - padding.top - padding.bottom;
        const drawWidth = w - padding.left - padding.right;
        
        // 1. Clear & Copy Background from Buffer
        this.ctx.clearRect(0, 0, w, h);
        this.ctx.drawImage(this.bgCanvas, 0, 0);

        // Calculate Current Position
        const bpm = Tone.Transport.bpm.value;
        // Προσθέτουμε το lookAhead offset ώστε το playhead να συγχρονίζεται με τον ήχο
        const lookAhead = Tone.Transport.lookAhead || 0.4;
        const currentBeat = (Tone.Transport.seconds + lookAhead) * (bpm / 60);

        // 2. Highlight Currently Playing Notes
        const pitchRange = this.config.maxPitch - this.config.minPitch;
        // Reuse array to avoid GC pressure — clear instead of reallocating
        if (!this._activeNotes) this._activeNotes = [];
        const activeNotes = this._activeNotes;
        activeNotes.length = 0;
        
        // First pass: collect active notes
        this.notes.forEach(note => {
            if (this.activeTrackType !== 'all' && note.trackType !== this.activeTrackType) return;
            if (currentBeat >= note.start_beat && currentBeat <= note.end_beat) {
                activeNotes.push(note);
            }
        });

        // Draw active notes — simple bright fill, single draw call per note
        this.ctx.globalAlpha = 1;
        activeNotes.forEach(note => {
            const coords = this.getNoteCoordinates(note, drawWidth, drawHeight, pitchRange);
            this.ctx.fillStyle = note.color;
            this.ctx.fillRect(
                coords.x,
                coords.y,
                Math.max(coords.w, this.config.noteMinWidth),
                Math.max(coords.h, this.config.noteMinHeight)
            );
        });
        this.ctx.globalAlpha = 1;

        // 3. Draw Playhead
        this.drawPlayhead(this.ctx, currentBeat, w, h);
    }

    getNoteCoordinates(note, drawWidth, drawHeight, pitchRange) {
        const { padding } = this.config;
        const x = padding.left + (note.start_beat / this.maxTime) * drawWidth;
        const noteWidth = Math.max(this.config.noteMinWidth, (note.duration_beats / this.maxTime) * drawWidth);
        
        const normalizedPitch = (note.midi - this.config.minPitch) / pitchRange;
        // Invert Y because canvas 0 is top
        const y = padding.top + (drawHeight * (1 - normalizedPitch));
        const noteHeight = Math.max(this.config.noteMinHeight, drawHeight / pitchRange);

        // Reuse coords object to avoid per-call allocation
        if (!this._coordsBuf) this._coordsBuf = { x: 0, y: 0, w: 0, h: 0 };
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
        
        // --- ΟΡΙΖΟΝΤΙΕΣ ΓΡΑΜΜΕΣ (Τόνοι/Νότες) ---
        // Σχεδιάζουμε γραμμές ανά ημιτόνιο
        for (let pitch = minPitch; pitch <= maxPitch; pitch++) {
            const normalizedPitch = (pitch - minPitch) / pitchRange;
            const y = padding.top + drawHeight * (1 - normalizedPitch);
            
            ctx.beginPath();
            ctx.globalAlpha = gridOpacity;
            
            // Πιο σκούρο χρώμα για τα μαύρα πλήκτρα (D#, F#, G#, A#)
            const isBlackKey = [1, 3, 6, 8, 10].includes(pitch % 12);
            if (isBlackKey) {
                 ctx.globalAlpha = gridOpacity / 2; // Μισή διαφάνεια για τα μαύρα πλήκτρα
            }
            
            // Πιο φωτεινό/έντονο χρώμα για τις οκτάβες (C)
            const isOctave = (pitch % 12 === 0);
            if (isOctave) {
                ctx.globalAlpha = gridOpacity * 1.5;
            }
            
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();
        }

        // --- ΚΑΘΕΤΕΣ ΓΡΑΜΜΕΣ (Χρόνος/Μέτρα) ---
        const beatsPerMeasure = 4; // Υποθέτουμε 4/4
        
        for (let beat = 0; beat <= this.maxTime; beat++) {
            const x = padding.left + (beat / this.maxTime) * drawWidth;
            
            ctx.beginPath();
            
            // Γραμμές Μέτρων (πιο έντονες)
            if (beat % beatsPerMeasure === 0) {
                ctx.globalAlpha = gridOpacity * 2; // Διπλή διαφάνεια για τα μέτρα
            } 
            // Γραμμές χτύπων (πιο αχνές)
            else {
                ctx.globalAlpha = gridOpacity / 1.5; // Λιγότερη διαφάνεια για τους χτύπους
            }
            
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, h - padding.bottom);
            ctx.stroke();
        }
    }

    drawPlayhead(ctx, currentBeat, w, h) {
        const { padding } = this.config;
        const drawWidth = w - padding.left - padding.right;
        const x = padding.left + (currentBeat / this.maxTime) * drawWidth;

        if (x >= padding.left && x <= padding.left + drawWidth) {
            // Simple playhead line — no shadow, no text, no triangle
            ctx.strokeStyle = this.config.playheadColor;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    // Utility for rounded rectangles
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
        
        // Draw alternating background for white/black keys
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const blackKeys = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#
        
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
        const { padding, gridColor, bgColor } = this.config;
        const beatsPerMeasure = 4; // Υποθέτουμε 4/4
        
        ctx.fillStyle = gridColor; // Χρησιμοποιούμε το πράσινο χρώμα του grid
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        const markerY = h - padding.bottom + 5;

        for (let beat = 0; beat <= this.maxTime; beat += beatsPerMeasure) {
            const measureNumber = Math.floor(beat / beatsPerMeasure) + 1;
            const x = padding.left + (beat / this.maxTime) * drawWidth;

            // Σχεδίαση της γραμμής δείκτη
            ctx.beginPath();
            ctx.moveTo(x, h - padding.bottom);
            ctx.lineTo(x, h - padding.bottom + 4);
            ctx.strokeStyle = gridColor;
            ctx.globalAlpha = 1;
            ctx.stroke();
            
            // Σχεδίαση του αριθμού του μέτρου
            ctx.globalAlpha = 1;
            ctx.fillText(`${measureNumber}`, x, markerY);
        }
    }
    

drawPitchLabels(ctx, h, drawHeight) {
    const { padding } = this.config;
    const pitchRange = this.config.maxPitch - this.config.minPitch;
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    
    ctx.font = '10px monospace'; // Λίγο μεγαλύτερη γραμματοσειρά
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    // ✅ Βρίσκουμε το πρώτο C (Ντο) που είναι μέσα ή μετά το minPitch
    // Το 12 είναι μια οκτάβα. Διαιρούμε, στρογγυλοποιούμε προς τα πάνω και πολλαπλασιάζουμε.
    const startPitch = Math.ceil(this.config.minPitch / 12) * 12;

    // Σχεδιάζουμε μόνο τα C (C1, C2, C3 etc)
    for (let pitch = startPitch; pitch <= this.config.maxPitch; pitch += 12) {
        const normalizedPitch = (pitch - this.config.minPitch) / pitchRange;
        const y = padding.top + drawHeight * (1 - normalizedPitch);
        
        // Υπολογισμός οκτάβας (στο MIDI το 12 είναι C0, το 24 είναι C1 κλπ)
        const octave = (pitch / 12) - 1;
        
        ctx.fillStyle = 'rgba(74, 222, 128, 0.3)';
        ctx.fillText(`C${octave}`, padding.left - 8, y);
        ctx.fillRect(padding.left, y, 4, 1);
    }
    // Επαναφορά fillStyle για να μην επηρεαστούν επόμενα draw calls
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
        // Cache results to avoid repeated string parsing per frame
        if (!this._lightenCache) this._lightenCache = new Map();
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
        btn.className = `track-selector px-3 py-1 rounded text-sm font-medium transition-colors mr-2 mb-2`;
        if (isActive) btn.classList.add('active');
        
        // Styling logic
        const color = TRACK_COLORS[trackType] || '#666';
        const baseStyle = `border: 1px solid ${color}; color: white;`;
        
        btn.style.cssText = baseStyle;
        btn.dataset.trackType = trackType;
        
        // Add simple hover effect via JS since we are inline styling
        btn.onmouseenter = () => btn.style.background = `${color}33`; // 20% opacity
        btn.onmouseleave = () => {
            if (!btn.classList.contains('active')) btn.style.background = 'transparent';
        };

        btn.addEventListener('click', this.boundHandleTrackSelection);
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
/**
 * 🔥 ΝΕΑ ΜΕΘΟΔΟΣ: Ορισμός ενεργού track programmatically (χρήσιμο για variations)
 */
setActiveTrack(trackType) {
    console.log('[VISUALIZER] Setting active track to:', trackType);
    
    // Update UI buttons
    document.querySelectorAll('.track-selector').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.trackType === trackType) {
            btn.classList.add('active');
        }
    });

    // Update state
    this.activeTrackType = trackType;
    
    // Update metadata display
    this.updateMetadataDisplay(trackType);
    
    // Re-render background because filtered notes changed
    this.renderStaticBackground();
    this.drawFrame();
    
    console.log('[VISUALIZER] Active track set to:', trackType);
}
    reset() {
        this.stopVisualization();
        this.notes = [];
        this.generatedTracks.clear();
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        if (this.bgCtx && this.bgCanvas) {
            this.bgCtx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
        }
        const sel = document.getElementById('track-selection');
        const meta = document.getElementById('track-metadata');
        if(sel) sel.innerHTML = '';
        if(meta) meta.innerHTML = '';
    }
}
