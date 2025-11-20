import * as Tone from 'tone';
import { TRACK_COLORS } from './config.js';

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
        this.visualizerInterval = null;
        this.boundHandleTrackSelection = this.handleTrackSelection.bind(this);
        this.notes = [];
        this.maxTime = 0;
    }

    setTracks(tracks) {
        this.generatedTracks = tracks;
        this.updateTrackSelectors();
        if (this.generatedTracks.size > 0) {
            this.visualize('all');
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
        this.visualize(trackType);
    }

    updateTrackSelectors() {
        const trackSelectionDiv = document.getElementById('track-selection');
        trackSelectionDiv.innerHTML = '';
        
        if (this.generatedTracks.size > 1) {
            const allButton = this.createSelectorButton('All Tracks', 'all');
            allButton.classList.add('active');
            trackSelectionDiv.appendChild(allButton);
        }
        
        this.generatedTracks.forEach((_, trackType) => {
            const button = this.createSelectorButton(trackType.charAt(0).toUpperCase() + trackType.slice(1), trackType);
            trackSelectionDiv.appendChild(button);
        });

        this.activeTrackType = this.generatedTracks.size > 1 ? 'all' : (this.generatedTracks.keys().next().value || null);
        if (this.generatedTracks.size === 1) {
            const singleButton = trackSelectionDiv.querySelector('.track-selector');
            if (singleButton) singleButton.classList.add('active');
        } else if (this.generatedTracks.size > 1) {
            const allButton = trackSelectionDiv.querySelector('.track-selector[data-track-type="all"]');
            if (allButton) allButton.classList.add('active');
        }
    }

    createSelectorButton(text, trackType) {
        const button = document.createElement('button');
        button.className = 'track-selector';
        button.textContent = text;
        button.dataset.trackType = trackType;
        button.addEventListener('click', this.boundHandleTrackSelection);
        return button;
    }

    visualize(trackType = 'all') {
        this.visualizerEl.innerHTML = '';
        
        if (this.generatedTracks.size === 0) {
            this.updateMetadataDisplay(trackType);
            return;
        }

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        this.visualizerEl.appendChild(this.canvas);
        
        this.ctx = this.canvas.getContext('2d');
        
        // Set canvas resolution
        this.canvas.width = this.visualizerEl.clientWidth;
        this.canvas.height = this.visualizerEl.clientHeight;

        // Determine which tracks to render
        let tracksToRender;
        if (trackType === 'all' || !this.generatedTracks.has(trackType)) {
            tracksToRender = Array.from(this.generatedTracks.entries());
        } else {
            tracksToRender = [[trackType, this.generatedTracks.get(trackType)]];
        }

        // Collect and prepare notes
        this.notes = [];
        this.maxTime = 0;
        
        tracksToRender.forEach(([type, trackData]) => {
            const midi = trackData?.midi;
            if (midi && midi.tracks?.[0]?.notes?.length > 0) {
                midi.tracks[0].notes.forEach(n => {
                    const noteObj = {
                        trackType: type,
                        time: typeof n.time === 'number' ? n.time : 0,
                        duration: typeof n.duration === 'number' ? n.duration : 0.25,
                        midi: typeof n.midi === 'number' ? n.midi : 60,
                        velocity: typeof n.velocity === 'number' ? n.velocity : 0.7,
                        name: n.name || 'C4'
                    };
                    this.notes.push(noteObj);
                    this.maxTime = Math.max(this.maxTime, noteObj.time + noteObj.duration);
                });
            }
        });

        if (this.notes.length === 0) {
            this.updateMetadataDisplay(trackType);
            return;
        }

        // Calculate pitch range
        const pitches = this.notes.map(n => n.midi).filter(p => !isNaN(p));
        this.minPitch = Math.min(...pitches);
        this.maxPitch = Math.max(...pitches);
        this.pitchRange = Math.max(this.maxPitch - this.minPitch, 12);

        // Draw initial visualization
        this.draw();
        
        // Setup playback sync
        this.setupPlaybackSync();
        this.updateMetadataDisplay(trackType);
    }

    draw() {
        if (!this.ctx || !this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const padding = { top: 20, bottom: 20, left: 60, right: 20 };
        const drawArea = {
            x: padding.left,
            y: padding.top,
            width: w - padding.left - padding.right,
            height: h - padding.top - padding.bottom
        };

        // Clear canvas
        this.ctx.fillStyle = 'rgba(32, 38, 43, 0.7)';
        this.ctx.fillRect(0, 0, w, h);

        // Draw grid lines
        this.drawGrid(drawArea);

        // Draw notes
        this.notes.forEach(note => {
            this.drawNote(note, drawArea);
        });

        // Draw playhead
        this.drawPlayhead(drawArea);

        // Draw time markers
        this.drawTimeMarkers(drawArea);
    }

    drawGrid(area) {
        const bpmEl = document.getElementById('bpm');
        const timeSignatureEl = document.getElementById('time-signature');
        if (!bpmEl || !timeSignatureEl) return;

        const bpm = parseInt(bpmEl.value) || 120;
        const timeSignature = timeSignatureEl.value;
        const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
        const beatDuration = 60 / bpm;

        // Vertical beat lines
        for (let i = 0; i <= this.maxTime; i += beatDuration) {
            const x = area.x + (i / this.maxTime) * area.width;
            const isBarLine = (i % (beatDuration * beatsPerBar)) < 0.001;
            
            this.ctx.strokeStyle = isBarLine ? 'rgba(84, 183, 110, 0.15)' : 'rgba(84, 183, 110, 0.05)';
            this.ctx.lineWidth = isBarLine ? 1.5 : 1;
            this.ctx.beginPath();
            this.ctx.moveTo(x, area.y);
            this.ctx.lineTo(x, area.y + area.height);
            this.ctx.stroke();
        }

        // Horizontal pitch lines
        for (let i = 0; i <= this.pitchRange; i += 2) {
            const y = area.y + (i / this.pitchRange) * area.height;
            this.ctx.strokeStyle = 'rgba(84, 183, 110, 0.08)';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(area.x, y);
            this.ctx.lineTo(area.x + area.width, y);
            this.ctx.stroke();
        }
    }

    drawNote(note, area) {
        const x = area.x + (note.time / this.maxTime) * area.width;
        const width = Math.max(3, (note.duration / this.maxTime) * area.width);
        const y = area.y + area.height - ((note.midi - this.minPitch) / this.pitchRange) * area.height;
        const height = 14;

        const color = TRACK_COLORS[note.trackType] || '#54B76E';
        
        // Draw note rectangle
        this.ctx.fillStyle = color;
        this.ctx.globalAlpha = 0.5 + note.velocity * 0.5;
        this.ctx.fillRect(x, y - height / 2, width, height);
        
        // Draw border
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 0.8;
        this.ctx.strokeRect(x, y - height / 2, width, height);
        
        this.ctx.globalAlpha = 1;
    }

    drawPlayhead(area) {
        const currentTime = Tone.Transport.seconds;
        const x = area.x + (currentTime / this.maxTime) * area.width;
        
        this.ctx.strokeStyle = '#54B76E';
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 0.95;
        this.ctx.beginPath();
        this.ctx.moveTo(x, area.y);
        this.ctx.lineTo(x, area.y + area.height);
        this.ctx.stroke();
        
        // Glow effect
        this.ctx.shadowColor = '#54B76E';
        this.ctx.shadowBlur = 10;
        this.ctx.strokeStyle = '#54B76E';
        this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 0.5;
        this.ctx.beginPath();
        this.ctx.moveTo(x, area.y);
        this.ctx.lineTo(x, area.y + area.height);
        this.ctx.stroke();
        
        this.ctx.globalAlpha = 1;
        this.ctx.shadowColor = 'transparent';
    }

    drawTimeMarkers(area) {
        this.ctx.fillStyle = 'rgba(213, 220, 224, 0.5)';
        this.ctx.font = '11px Inter, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';

        const step = this.maxTime > 20 ? 5 : 1;
        for (let i = 0; i <= this.maxTime; i += step) {
            const x = area.x + (i / this.maxTime) * area.width;
            this.ctx.fillText(i.toFixed(0) + 's', x, area.y + area.height + 5);
        }
    }

    setupPlaybackSync() {
        if (this.visualizerInterval) {
            Tone.Transport.clear(this.visualizerInterval);
            this.visualizerInterval = null;
        }

        this.visualizerInterval = Tone.Transport.scheduleRepeat(() => {
            requestAnimationFrame(() => this.draw());
        }, 0.1); // Update every 100ms - lightweight
    }

    reset() {
        this.generatedTracks.clear();
        this.compositionTitle = '';
        this.compositionDescription = '';
        this.activeTrackType = null;
        this.notes = [];
        this.maxTime = 0;

        this.visualizerEl.innerHTML = '';
        document.getElementById('track-selection').innerHTML = '';
        
        if (this.visualizerInterval) {
            Tone.Transport.clear(this.visualizerInterval);
            this.visualizerInterval = null;
        }

        this.updateMetadataDisplay('all');
    }

    
    updateMetadataDisplay(trackType) {
        const metadataEl = document.getElementById('track-metadata');
        if (!metadataEl) return;

        if (trackType === 'all') {
            const title = this.compositionTitle || 'Composition';
            const description = this.compositionDescription || 'Select tracks below or generate a new composition.';
            metadataEl.innerHTML = `<h3 class="text-lg font-semibold text-light mb-1">${title}</h3><p class="text-sm text-gray-400">${description}</p>`;
            return;
        }
        
        const trackData = this.generatedTracks.get(trackType);
        const title = trackData?.title || (trackType.charAt(0).toUpperCase() + trackType.slice(1));
        const description = trackData?.description || `The ${trackType} part for the composition.`;
        metadataEl.innerHTML = `<h3 class="text-lg font-semibold text-accent mb-1">${title} (Solo)</h3><p class="text-sm text-gray-400">${description}</p>`;
    }
}
