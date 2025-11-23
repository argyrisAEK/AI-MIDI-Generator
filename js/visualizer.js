import * as Tone from 'tone';
import { TRACK_COLORS, TRACK_INSTRUMENTS } from './config.js';

export class Visualizer {
    constructor(audioEngine, app) {
        this.visualizerEl = document.getElementById('visualizer');
        this.audioEngine = audioEngine;
        this.app = app;
        this.canvas = null;
        this.ctx = null;
        this.generatedTracks = new Map();
        this.compositionTitle = '';
        this.compositionDescription = '';
        this.activeTrackType = null;
        
        // Flag για το animation loop
        this.isVisualizing = false;
        
        this.boundHandleTrackSelection = this.handleTrackSelection.bind(this);
        this.notes = [];
        this.maxTime = 0; // Σε Beats
    }

    loadNotes(tracks, title = '', description = '') {
        this.generatedTracks = tracks;
        this.compositionTitle = title;
        this.compositionDescription = description;
        this.notes = [];
        this.maxTime = 0;

        tracks.forEach((trackData, trackType) => {
            const notesArray = trackData?.midi?.tracks?.[0]?.notes || trackData?.notes || [];
            
            if (notesArray.length > 0) {
                notesArray.forEach(note => {
                    const endTime = (note.start_beat || note.time || 0) + (note.duration_beats || note.duration || 0);
                    if (endTime > this.maxTime) {
                        this.maxTime = endTime;
                    }

                    this.notes.push({
                        ...note,
                        trackType: trackType,
                        color: TRACK_COLORS[trackType] || '#CCCCCC',
                        start_beat: note.start_beat || note.time || 0,
                        duration_beats: note.duration_beats || note.duration || 0.5,
                        midi: note.midi || 60,
                        velocity: note.velocity !== undefined ? note.velocity : 0.8
                    });
                });
            }
        });

        if (this.maxTime === 0) this.maxTime = 32;

        console.log(`✅ Visualizer loaded ${this.notes.length} notes, maxTime: ${this.maxTime}`);
        
        this.updateTrackSelectors();
        this.updateMetadataDisplay('all');
        this.setupCanvas();
    }

    setupCanvas() {
        // ✅ Reuse existing canvas to avoid DOM thrashing
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            this.visualizerEl.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');
            
            // Listen to resize only once
            window.addEventListener('resize', () => this.resizeCanvas());
        }
        
        this.resizeCanvas();
        this.draw(); // Initial static draw
    }
    
    resizeCanvas() {
        if (this.canvas && this.visualizerEl) {
            // Match internal resolution to display size
            this.canvas.width = this.visualizerEl.clientWidth;
            this.canvas.height = this.visualizerEl.clientHeight;
            this.draw();
        }
    }

    startVisualization() {
        if (!this.canvas) return;
        
        // ✅ Stop any previous loop just in case
        this.isVisualizing = true;

        // ✅ Native Animation Loop (smoother than Tone.Transport event)
        const loop = () => {
            if (!this.isVisualizing) return;
            this.draw();
            requestAnimationFrame(loop);
        };
        
        requestAnimationFrame(loop);
    }

    stopVisualization() {
        this.isVisualizing = false;
        // Μια τελευταία σχεδίαση για να μείνει στατικό το playhead ή να γυρίσει
        requestAnimationFrame(() => this.draw());
    }

    draw() {
        if (!this.ctx || !this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const padding = { top: 20, bottom: 30, left: 0, right: 0 };
        const drawHeight = h - padding.top - padding.bottom;

        // Background
        this.ctx.fillStyle = '#1a1a1a'; 
        this.ctx.fillRect(0, 0, w, h);

        // Current Playhead Position
        const bpm = Tone.Transport.bpm.value;
        const currentBeat = Tone.Transport.seconds * (bpm / 60);

        this.drawGrid(w, h, padding, drawHeight);

        // Draw Notes
        const minPitch = 24;
        const maxPitch = 96;
        const pitchRange = maxPitch - minPitch;

        this.notes.forEach(note => {
            if (this.activeTrackType && this.activeTrackType !== 'all' && note.trackType !== this.activeTrackType) {
                return;
            }

            const x = (note.start_beat / this.maxTime) * w;
            const noteWidth = Math.max(2, (note.duration_beats / this.maxTime) * w);
            const normalizedPitch = (note.midi - minPitch) / pitchRange;
            const y = padding.top + (drawHeight * (1 - normalizedPitch));
            const noteHeight = Math.max(4, drawHeight / pitchRange);
            
            const mixVol = TRACK_INSTRUMENTS[note.trackType]?.mixVolume || 0.7;
            this.ctx.fillStyle = note.color;
            this.ctx.globalAlpha = (0.4 + (note.velocity * 0.6)) * mixVol;

            if (this.activeTrackType === 'all') {
                 this.ctx.globalAlpha *= 0.8;
            } else {
                 this.ctx.globalAlpha = 1.0; 
            }

            this.ctx.fillRect(x, y - (noteHeight/2), noteWidth, noteHeight);
            this.ctx.globalAlpha = 1.0;
        });

        this.drawPlayhead(currentBeat, w, h);
    }

    drawGrid(w, h, padding, drawHeight) {
        const beatsPerBar = 4; 
        const totalBars = this.maxTime / beatsPerBar;
        
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 1;

        for (let i = 0; i <= totalBars; i++) {
            const x = (i / totalBars) * w;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, h);
            this.ctx.stroke();
        }
    }

    drawPlayhead(currentBeat, w, h) {
        const x = (currentBeat / this.maxTime) * w;
        if (x >= 0 && x <= w) {
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, h);
            this.ctx.stroke();
            
            this.ctx.shadowColor = 'white';
            this.ctx.shadowBlur = 10;
            this.ctx.stroke();
            this.ctx.shadowBlur = 0;
        }
    }

    handleTrackSelection(event) {
        const trackType = event.target.dataset.trackType;
        this.setActiveTrack(trackType);
    }

    setActiveTrack(trackType) {
        document.querySelectorAll('.track-selector').forEach(btn => btn.classList.remove('active'));
        const activeButton = document.querySelector(`.track-selector[data-track-type="${trackType}"]`);
        if (activeButton) activeButton.classList.add('active');
        
        this.activeTrackType = trackType;
        this.updateMetadataDisplay(trackType);
        this.draw();
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
        const color = TRACK_COLORS[trackType] || '#666';
        btn.style.border = `1px solid ${color}`;
        btn.style.color = 'white';
        btn.dataset.trackType = trackType;
        btn.addEventListener('click', this.boundHandleTrackSelection);
        btn.textContent = label;
        return btn;
    }

    updateMetadataDisplay(trackType) {
        const metadataEl = document.getElementById('track-metadata');
        if (!metadataEl) return;

        if (trackType === 'all') {
            metadataEl.innerHTML = `
                <h3 class="text-lg font-bold text-white">${this.compositionTitle || 'Composition'}</h3>
                <p class="text-sm text-gray-400">${this.compositionDescription || ''}</p>
            `;
        } else {
            const trackData = this.generatedTracks.get(trackType);
            const title = trackData?.title || trackType;
            const desc = trackData?.description || `Solo track for ${trackType}`;
            const color = TRACK_COLORS[trackType];
            
            metadataEl.innerHTML = `
                <h3 class="text-lg font-bold" style="color:${color}">${title}</h3>
                <p class="text-sm text-gray-400">${desc}</p>
            `;
        }
    }

    reset() {
        this.stopVisualization();
        this.notes = [];
        this.generatedTracks.clear();
        if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        document.getElementById('track-selection').innerHTML = '';
        document.getElementById('track-metadata').innerHTML = '';
    }
}
