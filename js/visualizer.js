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
            padding: { top: 20, bottom: 30, left: 0, right: 0 },
            noteRadius: 3,
            playheadColor: '#ffffff',
            bgColor: '#1a1a1a'
        };
    }

    loadNotes(tracks, title = '', description = '') {
        this.generatedTracks = tracks;
        this.compositionTitle = title;
        this.compositionDescription = description;
        this.notes = [];
        this.maxTime = 0;

        // Process notes
        tracks.forEach((trackData, trackType) => {
            const notesArray = trackData?.midi?.tracks?.[0]?.notes || trackData?.notes || [];
            
            if (notesArray.length > 0) {
                notesArray.forEach(note => {
                    const start = note.start_beat || note.time || 0;
                    const duration = note.duration_beats || note.duration || 0.5;
                    const endTime = start + duration;

                    if (endTime > this.maxTime) this.maxTime = endTime;

                    this.notes.push({
                        ...note,
                        trackType: trackType,
                        color: TRACK_COLORS[trackType] || '#CCCCCC',
                        start_beat: start,
                        end_beat: endTime, // Pre-calculate end time for faster lookups
                        duration_beats: duration,
                        midi: note.midi || 60,
                        velocity: note.velocity !== undefined ? note.velocity : 0.8
                    });
                });
            }
        });

        // Minimum timeline length
        if (this.maxTime < 32) this.maxTime = 32;

        console.log(`✅ Visualizer loaded ${this.notes.length} notes.`);
        
        this.updateTrackSelectors();
        this.updateMetadataDisplay('all');
        this.setupCanvas();
    }

    setupCanvas() {
        if (!this.visualizerEl) return;

        // 1. Setup Main Canvas
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.visualizerEl.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');
        }

        // 2. Setup Off-screen Buffer (for static grid/notes)
        if (!this.bgCanvas) {
            this.bgCanvas = document.createElement('canvas');
            this.bgCtx = this.bgCanvas.getContext('2d');
        }

        // 3. Handle Resize
        // Remove old listener to prevent duplicates if setupCanvas is called multiple times
        window.removeEventListener('resize', this.resizeCanvas); 
        window.addEventListener('resize', () => this.resizeCanvas());
        
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
        this.drawFrame();
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

        // 1. Fill Background with subtle gradient
        const bgGradient = this.bgCtx.createLinearGradient(0, 0, 0, h);
        bgGradient.addColorStop(0, '#1a1a1a');
        bgGradient.addColorStop(1, '#111111');
        this.bgCtx.fillStyle = bgGradient;
        this.bgCtx.fillRect(0, 0, w, h);

        // 2. Draw Grid
        this.drawGrid(this.bgCtx, w, h);

        // 3. Draw Idle Notes
        const pitchRange = this.config.maxPitch - this.config.minPitch;

        this.notes.forEach(note => {
            // Filter check
            if (this.activeTrackType !== 'all' && note.trackType !== this.activeTrackType) return;

            const coords = this.getNoteCoordinates(note, w, drawHeight, pitchRange);
            
            // Mix volume affects opacity
            const mixVol = TRACK_INSTRUMENTS[note.trackType]?.mixVolume || 0.7;
            
            this.bgCtx.fillStyle = note.color;
            
            // Idle notes are semi-transparent
            let alpha = (0.3 + (note.velocity * 0.3)) * mixVol;
            if (this.activeTrackType === 'all') alpha *= 0.6; // Dim more if showing all

            this.bgCtx.globalAlpha = alpha;
            this.roundRect(this.bgCtx, coords.x, coords.y, coords.w, coords.h, this.config.noteRadius);
            this.bgCtx.fill();
        });

        this.bgCtx.globalAlpha = 1.0;
    }

    /**
     * The Main Animation Loop
     * Draws the static buffer + Playhead + Active (Glowing) Notes
     */
    drawFrame() {
        if (!this.ctx || !this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const drawHeight = h - this.config.padding.top - this.config.padding.bottom;
        
        // 1. Clear & Copy Background from Buffer
        this.ctx.clearRect(0, 0, w, h);
        this.ctx.drawImage(this.bgCanvas, 0, 0);

        // Calculate Current Position
        const bpm = Tone.Transport.bpm.value;
        const currentBeat = Tone.Transport.seconds * (bpm / 60);

        // 2. Highlight Currently Playing Notes
        const pitchRange = this.config.maxPitch - this.config.minPitch;

        // Optimization: We iterate, but only do expensive drawing for active notes
        this.ctx.globalCompositeOperation = 'source-over'; // Default
        
        this.notes.forEach(note => {
            if (this.activeTrackType !== 'all' && note.trackType !== this.activeTrackType) return;

            // Check intersection with playhead
            if (currentBeat >= note.start_beat && currentBeat <= note.end_beat) {
                const coords = this.getNoteCoordinates(note, w, drawHeight, pitchRange);

                this.ctx.fillStyle = note.color;
                this.ctx.globalAlpha = 1.0;
                
                // Add Glow
                this.ctx.shadowColor = note.color;
                this.ctx.shadowBlur = 15;
                
                // Draw slightly larger for "pop" effect
                this.roundRect(this.ctx, coords.x - 1, coords.y - 1, coords.w + 2, coords.h + 2, this.config.noteRadius);
                this.ctx.fill();
                
                // Reset Shadow
                this.ctx.shadowBlur = 0;
            }
        });

        // 3. Draw Playhead
        this.drawPlayhead(this.ctx, currentBeat, w, h);
    }

    getNoteCoordinates(note, w, drawHeight, pitchRange) {
        const x = (note.start_beat / this.maxTime) * w;
        const noteWidth = Math.max(2, (note.duration_beats / this.maxTime) * w);
        
        const normalizedPitch = (note.midi - this.config.minPitch) / pitchRange;
        // Invert Y because canvas 0 is top
        const y = this.config.padding.top + (drawHeight * (1 - normalizedPitch));
        const noteHeight = Math.max(4, drawHeight / pitchRange); // Ensure visibility

        return { x, y, w: noteWidth, h: noteHeight };
    }

    drawGrid(ctx, w, h) {
        const beatsPerBar = 4; 
        const totalBars = Math.ceil(this.maxTime / beatsPerBar);
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let i = 0; i <= totalBars; i++) {
            const x = (i * beatsPerBar / this.maxTime) * w;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
        }
        ctx.stroke();
    }

    drawPlayhead(ctx, currentBeat, w, h) {
        const x = (currentBeat / this.maxTime) * w;
        
        if (x >= 0 && x <= w) {
            ctx.save();
            
            // Glow effect
            ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
            ctx.shadowBlur = 10;
            ctx.strokeStyle = this.config.playheadColor;
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();

            // Add a "Head" triangle at the top
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(x - 4, 0);
            ctx.lineTo(x + 4, 0);
            ctx.lineTo(x, 8);
            ctx.fill();

            ctx.restore();
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

    handleTrackSelection(event) {
        const trackType = event.target.dataset.trackType;
        if (trackType) this.setActiveTrack(trackType);
    }

    setActiveTrack(trackType) {
        document.querySelectorAll('.track-selector').forEach(btn => btn.classList.remove('active'));
        const activeButton = document.querySelector(`.track-selector[data-track-type="${trackType}"]`);
        if (activeButton) activeButton.classList.add('active');
        
        this.activeTrackType = trackType;
        this.updateMetadataDisplay(trackType);
        
        // Re-render background because filtered notes changed
        this.renderStaticBackground();
        this.drawFrame();
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
