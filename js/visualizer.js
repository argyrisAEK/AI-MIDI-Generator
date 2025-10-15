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
        this.noteElements = [];
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
        this.noteElements = [];
        
        // Determine which tracks to render
        let tracksToRender;
        if (trackType === 'all' || !this.generatedTracks.has(trackType)) {
            tracksToRender = Array.from(this.generatedTracks.entries());
        } else {
            tracksToRender = [[trackType, this.generatedTracks.get(trackType)]];
        }

        // Filter out invalid tracks and extract MIDI object
        const midiTracksToRender = tracksToRender.map(([type, trackData]) => {
            const midi = trackData?.midi; // Always access the .midi property
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
                // Ensure we have all required properties with safe defaults
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

        const maxTime = Math.max(...currentNotes.map(n => n.time + n.duration));
        
        const timeScale = (this.visualizerEl.clientWidth - 40) / Math.max(maxTime, 1);
        const pitchScale = this.visualizerEl.clientHeight > 40 && maxPitch > minPitch
            ? (this.visualizerEl.clientHeight - 40) / (maxPitch - minPitch)
            : 20; // Default pitch scale

        // Create note elements
        currentNotes.forEach(note => {
            const noteEl = this.createNoteElement(note, timeScale, pitchScale, minPitch);
            staffContainer.appendChild(noteEl);
            this.noteElements.push(noteEl);
        });

        // Add track labels when showing all tracks
        if ((trackType === 'all' || !this.generatedTracks.has(trackType)) && midiTracksToRender.length > 1) {
            this.addTrackLabels(staffContainer, midiTracksToRender);
        }

        this.addTimeMarkers(staffContainer, maxTime, timeScale);
        this.visualizerEl.appendChild(staffContainer);
        this.setupPlaybackSync(staffContainer, timeScale);
        // Update metadata display for the active track
        this.updateMetadataDisplay(trackType);
    }
    
    addTrackLabels(container, tracksToRender) {
        tracksToRender.forEach(([trackType], index) => {
            const label = document.createElement('div');
            label.className = `track-label ${trackType}`;
            label.textContent = trackType.charAt(0).toUpperCase() + trackType.slice(1);
            label.style.position = 'absolute';
            label.style.left = '5px';
            // Simple vertical distribution. A more complex layout might be needed for many tracks.
            label.style.top = `${10 + index * 25}px`;
            label.style.fontSize = '12px';
            label.style.zIndex = '5';
            container.appendChild(label);
        });
    }
    
    createStaffContainer() {
        const container = document.createElement('div');
        container.className = 'staff-container';
        for (let i = 0; i < 5; i++) {
            const line = document.createElement('div');
            line.className = 'staff-line';
            line.style.top = `${20 + i * 20}%`;
            container.appendChild(line);
        }
        const playhead = document.createElement('div');
        playhead.className = 'playhead';
        container.appendChild(playhead);
        return container;
    }

    createNoteElement(note, timeScale, pitchScale, minPitch) {
        const noteEl = document.createElement('div');
        noteEl.className = 'note';
        const color = TRACK_COLORS[note.trackType] || '#00ff9d';
        
        // All properties are now guaranteed to exist from visualize() method
        const noteTop = Math.max(5, Math.min(
            this.visualizerEl.clientHeight - 25,
            this.visualizerEl.clientHeight - ((note.midi - minPitch) * pitchScale) - 28
        ));

        Object.assign(noteEl.style, {
            left: `${note.time * timeScale + 20}px`,
            width: `${Math.max(20, note.duration * timeScale)}px`,
            top: `${noteTop}px`,
            background: color,
            opacity: 0.4 + (note.velocity * 0.6)
        });
        
        noteEl.title = `Track: ${note.trackType}\nNote: ${note.name}\nTime: ${note.time.toFixed(2)}s\nDuration: ${note.duration.toFixed(2)}s`;
        noteEl.dataset.time = note.time.toString();
        noteEl.dataset.duration = note.duration.toString();
        
        // Use passive listener for better performance
        noteEl.addEventListener('click', () => {
            if (this.audioEngine) {
                this.audioEngine.playNote(note.trackType, note.name, note.duration, note.velocity);
            }
        }, { passive: true });

        return noteEl;
    }

    noteNameToMidi(noteName) {
        try {
            // Convert note name to MIDI number using Tone.js
            return Tone.Frequency(noteName).toMidi();
        } catch (error) {
            console.warn('Could not convert note name to MIDI:', noteName);
            return 60; // Default to C4
        }
    }
    
    addTimeMarkers(container, maxTime, timeScale) {
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

    setupPlaybackSync(container, timeScale) {
        if (this.visualizerInterval) {
            Tone.Transport.clear(this.visualizerInterval);
            this.visualizerInterval = null;
        }

        const playhead = container.querySelector('.playhead');
        if (!playhead) return;

        this.visualizerInterval = Tone.Transport.scheduleRepeat(() => {
            const currentTime = Tone.Transport.seconds;
            requestAnimationFrame(() => {
                playhead.style.left = `${(currentTime * timeScale) + 20}px`;
                
                // Optimized note highlighting
                this.noteElements.forEach(note => {
                    const noteTime = parseFloat(note.dataset.time) || 0;
                    const noteDuration = parseFloat(note.dataset.duration) || 0.25;
                    const isActive = currentTime >= noteTime && currentTime < noteTime + noteDuration;
                    
                    if (note.classList.contains('active') !== isActive) {
                        note.classList.toggle('active', isActive);
                    }
                });
            });
        }, 0.1);
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
