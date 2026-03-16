import * as Tone from 'tone';
import { TRACK_COLORS, TRACK_INSTRUMENTS } from './config.js';

export class Visualizer {  // ✅ Export με το ίδιο όνομα
    constructor(audioEngine, app) {
        this.visualizerEl = document.getElementById('visualizer');
        this.audioEngine = audioEngine;
        this.app = app;
        
        this.generatedTracks = new Map();
        this.compositionTitle = '';
        this.compositionDescription = '';
        this.activeTrackType = 'all';
        
        this.isPlaying = false;
        this.animationFrameId = null;
        
        this.boundHandleTrackSelection = this.handleTrackSelection.bind(this);
        this.notes = [];
        this.maxTime = 0;
        
        this.config = {
            minPitch: 24,
            maxPitch: 96,
            noteHeight: 4,  // Pixels per semitone
            pixelsPerBeat: 60
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

        if (compositionDuration && compositionDuration > this.maxTime) {
            this.maxTime = compositionDuration;
        }

        if (this.notes.length > 0) {
            const pitchPadding = 6;
            this.config.minPitch = Math.max(0, Math.floor(minPitch / 12) * 12 - pitchPadding);
            this.config.maxPitch = Math.min(127, Math.ceil(maxPitch / 12) * 12 + pitchPadding);
        }

        this.maxTime = Math.ceil(this.maxTime / 4) * 4;
        if (this.maxTime === 0) this.maxTime = 4;

        this.updateTrackSelectors();
        this.updateMetadataDisplay('all');
        this.render();
    }

    render() {
        if (!this.visualizerEl) return;
        
        // Clear previous content
        this.visualizerEl.innerHTML = '';
        
        // Create container with CSS Grid
        const container = document.createElement('div');
        container.style.cssText = `
            position: relative;
            width: 100%;
            height: 100%;
            background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%);
            overflow: hidden;
        `;
        
        // Create notes container
        const notesContainer = document.createElement('div');
        const pitchRange = this.config.maxPitch - this.config.minPitch;
        const totalHeight = pitchRange * this.config.noteHeight;
        const totalWidth = this.maxTime * this.config.pixelsPerBeat;
        
        notesContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: ${totalWidth}px;
            height: ${totalHeight}px;
            transform-origin: top left;
        `;
        
        // Add grid lines (lightweight CSS)
        this.addGridLines(notesContainer, totalWidth, totalHeight, pitchRange);
        
        // Add notes as DOM elements
        this.renderNotes(notesContainer, pitchRange);
        
        // Create playhead
        this.playhead = document.createElement('div');
        this.playhead.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 2px;
            height: 100%;
            background: #08D9D6;
            box-shadow: 0 0 8px rgba(8, 217, 214, 0.8);
            z-index: 1000;
            display: none;
            pointer-events: none;
        `;
        
        // Wrapper for scrolling
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            position: relative;
            width: 100%;
            height: 100%;
            overflow: auto;
        `;
        
        wrapper.appendChild(notesContainer);
        wrapper.appendChild(this.playhead);
        container.appendChild(wrapper);
        this.visualizerEl.appendChild(container);
        
        this.notesContainer = notesContainer;
        this.wrapper = wrapper;
    }

    addGridLines(container, width, height, pitchRange) {
        // Horizontal lines (pitch)
        const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gridSvg.setAttribute('width', width);
        gridSvg.setAttribute('height', height);
        gridSvg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            opacity: 0.15;
        `;
        
        // Only draw octave lines (C notes) for performance
        for (let pitch = this.config.minPitch; pitch <= this.config.maxPitch; pitch += 12) {
            const y = height - ((pitch - this.config.minPitch) * this.config.noteHeight);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', 0);
            line.setAttribute('y1', y);
            line.setAttribute('x2', width);
            line.setAttribute('y2', y);
            line.setAttribute('stroke', '#4DEE93');
            line.setAttribute('stroke-width', '1');
            gridSvg.appendChild(line);
        }
        
        // Vertical lines (beats) - only measure lines
        for (let beat = 0; beat <= this.maxTime; beat += 4) {
            const x = beat * this.config.pixelsPerBeat;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x);
            line.setAttribute('y1', 0);
            line.setAttribute('x2', x);
            line.setAttribute('y2', height);
            line.setAttribute('stroke', '#4DEE93');
            line.setAttribute('stroke-width', '1');
            gridSvg.appendChild(line);
        }
        
        container.appendChild(gridSvg);
    }

    renderNotes(container, pitchRange) {
        const filteredNotes = this.activeTrackType === 'all' 
            ? this.notes 
            : this.notes.filter(n => n.trackType === this.activeTrackType);
        
        const containerHeight = pitchRange * this.config.noteHeight;
        
        // Create DocumentFragment for batch DOM insertion (faster)
        const fragment = document.createDocumentFragment();
        
        filteredNotes.forEach(note => {
            const noteEl = document.createElement('div');
            
            const x = note.start_beat * this.config.pixelsPerBeat;
            const width = note.duration_beats * this.config.pixelsPerBeat;
            const y = containerHeight - ((note.midi - this.config.minPitch) * this.config.noteHeight);
            const height = this.config.noteHeight - 1;
            
            const mixVol = TRACK_INSTRUMENTS[note.trackType]?.mixVolume || 0.7;
            const opacity = (0.3 + (note.velocity * 0.4)) * mixVol;
            
            noteEl.className = 'piano-note';
            noteEl.dataset.trackType = note.trackType;
            noteEl.dataset.startBeat = note.start_beat;
            noteEl.dataset.endBeat = note.end_beat;
            
            noteEl.style.cssText = `
                position: absolute;
                left: ${x}px;
                top: ${y}px;
                width: ${Math.max(2, width)}px;
                height: ${height}px;
                background: ${note.color};
                opacity: ${opacity};
                border-radius: 2px;
                border: 1px solid ${note.color};
                transition: opacity 0.1s, transform 0.1s;
                will-change: opacity, transform;
            `;
            
            fragment.appendChild(noteEl);
        });
        
        container.appendChild(fragment);
    }

    startVisualization() {
        this.isPlaying = true;
        this.playhead.style.display = 'block';
        this.loop();
    }

    stopVisualization() {
        this.isPlaying = false;
        this.playhead.style.display = 'none';
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        
        // Reset all note highlights
        const activeNotes = this.notesContainer.querySelectorAll('.piano-note.active');
        activeNotes.forEach(el => {
            el.classList.remove('active');
            el.style.opacity = el.dataset.originalOpacity;
            el.style.transform = '';
        });
    }

    loop() {
        if (!this.isPlaying) return;
        
        // Update only at 20 FPS (not 60!)
        const now = performance.now();
        if (!this._lastUpdate || now - this._lastUpdate >= 50) {
            this._lastUpdate = now;
            this.updatePlayhead();
        }
        
        this.animationFrameId = requestAnimationFrame(() => this.loop());
    }

    updatePlayhead() {
        const bpm = Tone.Transport.bpm.value;
        const lookAhead = Tone.Transport.lookAhead || 0.4;
        const currentBeat = (Tone.Transport.seconds + lookAhead) * (bpm / 60);
        
        const x = currentBeat * this.config.pixelsPerBeat;
        this.playhead.style.transform = `translateX(${x}px)`;
        
        // Auto-scroll to follow playhead
        const wrapperWidth = this.wrapper.clientWidth;
        const scrollPos = this.wrapper.scrollLeft;
        if (x > scrollPos + wrapperWidth - 100) {
            this.wrapper.scrollLeft = x - wrapperWidth / 2;
        }
        
        // Highlight active notes using CSS class toggle (GPU accelerated)
        const allNotes = this.notesContainer.querySelectorAll('.piano-note');
        allNotes.forEach(noteEl => {
            const start = parseFloat(noteEl.dataset.startBeat);
            const end = parseFloat(noteEl.dataset.endBeat);
            const isActive = currentBeat >= start && currentBeat <= end;
            
            if (isActive && !noteEl.classList.contains('active')) {
                noteEl.classList.add('active');
                if (!noteEl.dataset.originalOpacity) {
                    noteEl.dataset.originalOpacity = noteEl.style.opacity;
                }
                noteEl.style.opacity = '1';
                noteEl.style.transform = 'scale(1.1)';
            } else if (!isActive && noteEl.classList.contains('active')) {
                noteEl.classList.remove('active');
                noteEl.style.opacity = noteEl.dataset.originalOpacity;
                noteEl.style.transform = '';
            }
        });
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
        
        const color = TRACK_COLORS[trackType] || '#666';
        btn.style.cssText = `border: 1px solid ${color}; color: white;`;
        btn.dataset.trackType = trackType;
        
        btn.onmouseenter = () => btn.style.background = `${color}33`;
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

    setActiveTrack(trackType) {
        document.querySelectorAll('.track-selector').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.trackType === trackType) {
                btn.classList.add('active');
            }
        });

        this.activeTrackType = trackType;
        this.updateMetadataDisplay(trackType);
        this.render();
    }

    reset() {
        this.stopVisualization();
        this.notes = [];
        this.generatedTracks.clear();
        if (this.visualizerEl) {
            this.visualizerEl.innerHTML = '';
        }
        const sel = document.getElementById('track-selection');
        const meta = document.getElementById('track-metadata');
        if(sel) sel.innerHTML = '';
        if(meta) meta.innerHTML = '';
    }
}
