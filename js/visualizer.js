import * as Tone from 'tone';
import { TRACK_COLORS } from './config.js';

export class Visualizer {
    constructor(audioEngine, app) {
        this.visualizerEl = document.getElementById('visualizer');
        this.audioEngine = audioEngine;
        this.app = app; // Reference to the main app instance
        this.visualizerInterval = null;
        this.generatedTracks = new Map();
        // Will hold the composition-level metadata for All Tracks view
        this.compositionTitle = '';
        this.compositionDescription = '';
        this.activeTrackType = null;
        this.boundHandleTrackSelection = this.handleTrackSelection.bind(this);
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
        if (this.generatedTracks.size === 0) return;

        const staffContainer = this.createStaffContainer();
        
        // Determine which tracks to render
        let tracksToRender;
        if (trackType === 'all' || !this.generatedTracks.has(trackType)) {
            tracksToRender = Array.from(this.generatedTracks.entries());
        } else {
            tracksToRender = [[trackType, this.generatedTracks.get(trackType)]];
        }

        // Filter out invalid tracks and extract MIDI object
        const midiTracksToRender = tracksToRender.map(([type, trackData]) => {
            const midi = trackData?.midi;
            if (midi && midi.tracks?.[0]?.notes?.length > 0) {
                return [type, midi];
            }
            return null;
        }).filter(Boolean);

        if (midiTracksToRender.length === 0) {
            this.updateMetadataDisplay(trackType);
            return;
        }
        
        // Collect notes from selected tracks
        const currentNotes = midiTracksToRender.flatMap(([type, midi]) => {
            const notes = midi.tracks[0].notes || [];
            return notes.map(n => ({
                ...n,
                trackType: type,
                time: typeof n.time === 'number' ? n.time : 0,
                duration: typeof n.duration === 'number' ? n.duration : 0.25,
                midi: typeof n.midi === 'number' ? n.midi : this.noteNameToMidi(n.name || 'C4'),
                velocity: typeof n.velocity === 'number' ? n.velocity : 0.7,
                name: n.name || 'C4'
            }));
        });
        
        if (currentNotes.length === 0) return;

        // Calculate scale based on current notes to display
        const allPitches = currentNotes.map(n => n.midi).filter(p => typeof p === 'number' && !isNaN(p));
        
        const minPitch = allPitches.length > 0 ? Math.min(...allPitches) : 60;
        const maxPitch = allPitches.length > 0 ? Math.max(...allPitches) : 72;
        const pitchRange = maxPitch - minPitch || 12; // Minimum 1 octave

        const maxTime = Math.max(...currentNotes.map(n => n.time + n.duration));
        
        const paddingLeft = 60;
        const paddingRight = 20;
        const timeScale = (this.visualizerEl.clientWidth - paddingLeft - paddingRight) / Math.max(maxTime, 1);
        const pitchScale = (this.visualizerEl.clientHeight - 40) / Math.max(pitchRange, 1);

        // Add background grid
        this.addBackgroundGrid(staffContainer, maxTime, timeScale, minPitch, pitchRange, pitchScale, paddingLeft);

        // Create note elements
        currentNotes.forEach(note => {
            const noteEl = this.createNoteElement(note, timeScale, pitchScale, minPitch, paddingLeft);
            staffContainer.appendChild(noteEl);
        });

        // Add track labels when showing all tracks
        if ((trackType === 'all' || !this.generatedTracks.has(trackType)) && midiTracksToRender.length > 1) {
            this.addTrackLabels(staffContainer, midiTracksToRender, minPitch, pitchRange, pitchScale);
        }

        this.addTimeMarkers(staffContainer, maxTime, timeScale, paddingLeft);
        this.visualizerEl.appendChild(staffContainer);
        this.setupPlaybackSync(staffContainer, timeScale, paddingLeft);
        this.updateMetadataDisplay(trackType);
    }

    addBackgroundGrid(container, maxTime, timeScale, minPitch, pitchRange, pitchScale, paddingLeft) {
        const gridContainer = document.createElement('div');
        gridContainer.className = 'visualization-grid';
        gridContainer.style.position = 'absolute';
        gridContainer.style.inset = '0';
        gridContainer.style.pointerEvents = 'none';

        // Vertical beat grid lines
        const bpmEl = document.getElementById('bpm');
        const timeSignatureEl = document.getElementById('time-signature');
        if (bpmEl && timeSignatureEl) {
            const bpm = parseInt(bpmEl.value) || 120;
            const timeSignature = timeSignatureEl.value;
            const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
            const beatDuration = 60 / bpm;

            for (let i = 0; i <= maxTime; i += beatDuration) {
                const line = document.createElement('div');
                line.style.position = 'absolute';
                line.style.left = `${paddingLeft + i * timeScale}px`;
                line.style.top = '0';
                line.style.width = '1px';
                line.style.height = '100%';
                line.style.background = (i % (beatDuration * beatsPerBar) === 0) 
                    ? 'rgba(84, 183, 110, 0.15)' 
                    : 'rgba(84, 183, 110, 0.05)';
                gridContainer.appendChild(line);
            }
        }

        // Horizontal pitch grid lines
        for (let i = 0; i <= pitchRange; i += 2) {
            const line = document.createElement('div');
            line.style.position = 'absolute';
            line.style.top = `${20 + i * pitchScale}px`;
            line.style.left = '0';
            line.style.width = '100%';
            line.style.height = '1px';
            line.style.background = 'rgba(84, 183, 110, 0.08)';
            gridContainer.appendChild(line);
        }

        container.appendChild(gridContainer);
    }
    
    addTrackLabels(container, tracksToRender, minPitch, pitchRange, pitchScale) {
        const labelsContainer = document.createElement('div');
        labelsContainer.className = 'track-labels-container';
        
        tracksToRender.forEach(([trackType], index) => {
            const label = document.createElement('div');
            label.className = `track-label track-label-${trackType}`;
            label.textContent = trackType.charAt(0).toUpperCase() + trackType.slice(1);
            label.style.position = 'absolute';
            label.style.left = '5px';
            label.style.top = `${5 + index * (this.visualizerEl.clientHeight / Math.max(tracksToRender.length, 1))}px`;
            container.appendChild(label);
        });
    }
    
    createStaffContainer() {
        const container = document.createElement('div');
        container.className = 'staff-container';
        container.style.position = 'relative';
        container.style.width = '100%';
        container.style.height = '100%';
        
        const playhead = document.createElement('div');
        playhead.className = 'playhead';
        playhead.style.position = 'absolute';
        playhead.style.top = '0';
        playhead.style.left = '20px';
        playhead.style.width = '2px';
        playhead.style.height = '100%';
        container.appendChild(playhead);
        
        return container;
    }

    createNoteElement(note, timeScale, pitchScale, minPitch, paddingLeft) {
        const noteEl = document.createElement('div');
        noteEl.className = 'note';
        const color = TRACK_COLORS[note.trackType] || '#00ff9d';
        
        const time = typeof note.time === 'number' ? note.time : 0;
        const duration = typeof note.duration === 'number' && note.duration > 0 ? note.duration : 0.25;
        const midi = typeof note.midi === 'number' ? note.midi : 60;
        const velocity = typeof note.velocity === 'number' ? Math.max(0, Math.min(1, note.velocity)) : 0.7;

        const noteTop = Math.max(5, Math.min(
            this.visualizerEl.clientHeight - 20,
            this.visualizerEl.clientHeight - ((midi - minPitch) * pitchScale) - 16
        ));

        const noteWidth = Math.max(4, duration * timeScale);
        const noteLeft = paddingLeft + time * timeScale;

        Object.assign(noteEl.style, {
            left: `${noteLeft}px`,
            width: `${noteWidth}px`,
            top: `${noteTop}px`,
            background: color,
            opacity: `${0.5 + velocity * 0.5}`,
            boxShadow: `0 0 ${4 + velocity * 4}px ${color}80`
        });
        
        noteEl.title = `${note.trackType.charAt(0).toUpperCase() + note.trackType.slice(1)} • ${note.name} • ${(time).toFixed(2)}s • Vel: ${(velocity * 100).toFixed(0)}%`;
        noteEl.dataset.time = time.toString();
        noteEl.dataset.duration = duration.toString();
        
        noteEl.addEventListener('click', () => {
            if (this.audioEngine) {
                this.audioEngine.playNote(note.trackType, note.name || 'C4', duration, velocity);
            }
        }, { passive: true });

        return noteEl;
    }

    noteNameToMidi(noteName) {
        try {
            return Tone.Frequency(noteName).toMidi();
        } catch (error) {
            console.warn('Could not convert note name to MIDI:', noteName);
            return 60;
        }
    }
    
    addTimeMarkers(container, maxTime, timeScale, paddingLeft) {
        const timeSignatureEl = document.getElementById('time-signature');
        const bpmEl = document.getElementById('bpm');
        if (!timeSignatureEl || !bpmEl) return;
        const timeSignature = timeSignatureEl.value;
        const bpmValue = bpmEl.value;

        const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
        const bpm = parseInt(bpmValue) || 120;
        const beatDuration = 60 / bpm;
        const totalBeats = Math.ceil(maxTime / beatDuration);

        for (let i = 0; i <= totalBeats; i++) {
            const marker = document.createElement('div');
            marker.className = 'staff-line';
            Object.assign(marker.style, {
                left: `${(i * beatDuration * timeScale) + 20}px`,
                width: '1px', height: '100%',
                background: i % beatsPerBar === 0 ? 'rgba(0, 255, 157, 0.3)' : 'rgba(0, 255, 157, 0.1)'
            });
            container.appendChild(marker);
        }
    }

    setupPlaybackSync(container, timeScale, paddingLeft) {
        if (this.visualizerInterval) {
            Tone.Transport.clear(this.visualizerInterval);
            this.visualizerInterval = null;
        }

        const playhead = container.querySelector('.playhead');
        if (!playhead) return;

        this.visualizerInterval = Tone.Transport.scheduleRepeat(() => {
            const currentTime = Tone.Transport.seconds;
            requestAnimationFrame(() => {
                playhead.style.left = `${paddingLeft + (currentTime * timeScale)}px`;
                
                // Update note highlighting - REMOVED FOR PERFORMANCE
                /*
                const notes = container.querySelectorAll('.note');
                notes.forEach(note => {
                    const noteTime = parseFloat(note.dataset.time) || 0;
                    const noteDuration = parseFloat(note.dataset.duration) || 0.25;
                    const isActive = currentTime >= noteTime && currentTime < noteTime + noteDuration;
                    
                    if (note.classList.contains('active') !== isActive) {
                        note.classList.toggle('active', isActive);
                    }
                });
                */
            });
        }, 0.05);
    }
    
    reset() {
        // Clear internal state
        this.generatedTracks.clear();
        this.compositionTitle = '';
        this.compositionDescription = '';
        this.activeTrackType = null;

        // Clear UI elements
        this.visualizerEl.innerHTML = '';
        document.getElementById('track-selection').innerHTML = '';
        
        // Stop playback updates
        if (this.visualizerInterval) {
            Tone.Transport.clear(this.visualizerInterval);
            this.visualizerInterval = null;
        }

        // Reset metadata display to its initial placeholder state
        this.updateMetadataDisplay('all'); 
    }

    /** 
     * Update the metadata display above the visualizer.
     */
    updateMetadataDisplay(trackType) {
        const metadataEl = document.getElementById('track-metadata');
        if (!metadataEl) return;

        if (trackType === 'all') {
            // Show the overall composition title & explanation when viewing all tracks
            const title = this.compositionTitle || 'Composition';
            const description = this.compositionDescription || '';
            metadataEl.innerHTML = `<h2>${title}</h2><p>${description}</p>`;
            return;
        }
        
        const trackData = this.generatedTracks.get(trackType);
        // If trackData.title or trackData.description are undefined (as per new API behavior),
        // they will naturally fall back to the track type as title and an empty string for description.
        const title = trackData?.title || (trackType.charAt(0).toUpperCase() + trackType.slice(1));
        const description = trackData?.description || '';
        metadataEl.innerHTML = `<h2>${title}</h2><p>${description}</p>`;
    }
}
