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
        this.visualizerInterval = null;
        this.boundHandleTrackSelection = this.handleTrackSelection.bind(this);
        this.notes = [];
        this.maxTime = 0; // Σε Beats
    }

    /**
     * Φορτώνει τις νότες και προετοιμάζει τον οπτικοποιητή.
     * Καλείται από το main.js μετά τη δημιουργία MIDI.
     */
  /**
     * Φορτώνει τις νότες και προετοιμάζει τον οπτικοποιητή.
     * Καλείται από το main.js μετά τη δημιουργία MIDI.
     */
    loadNotes(tracks, title = '', description = '') {
        this.generatedTracks = tracks;
        this.compositionTitle = title;
        this.compositionDescription = description;
        this.notes = [];
        this.maxTime = 0;

        // Μετατροπή του Map σε ενιαίο πίνακα για γρήγορη σχεδίαση
        tracks.forEach((trackData, trackType) => {
            // ✅ Σωστή διαδρομή προς τις νότες
            const notesArray = trackData?.midi?.tracks?.[0]?.notes || trackData?.notes || [];
            
            if (notesArray.length > 0) {
                notesArray.forEach(note => {
                    // Υπολογισμός συνολικής διάρκειας σε Beats
                    const endTime = (note.start_beat || note.time || 0) + (note.duration_beats || note.duration || 0);
                    if (endTime > this.maxTime) {
                        this.maxTime = endTime;
                    }

                    this.notes.push({
                        ...note,
                        trackType: trackType,
                        // Αποθηκεύουμε το χρώμα για γρήγορη πρόσβαση
                        color: TRACK_COLORS[trackType] || '#CCCCCC',
                        // ✅ Βεβαίωση ότι υπάρχουν τα βασικά πεδία
                        start_beat: note.start_beat || note.time || 0,
                        duration_beats: note.duration_beats || note.duration || 0.5,
                        midi: note.midi || 60,
                        velocity: note.velocity !== undefined ? note.velocity : 0.8
                    });
                });
            }
        });

        // Αν δεν βρέθηκαν νότες, βάλε ένα default μήκος για να μην κρασάρει
        if (this.maxTime === 0) this.maxTime = 32;

        console.log(`✅ Visualizer loaded ${this.notes.length} notes, maxTime: ${this.maxTime}`);
        
        this.updateTrackSelectors();
        this.updateMetadataDisplay('all');
        
        // Δημιουργία Canvas
        this.setupCanvas();
    }

    setupCanvas() {
        if (this.canvas) {
            this.canvas.remove();
        }
        
        this.canvas = document.createElement('canvas');
        // Γεμίζει τον γονικό container
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        this.visualizerEl.appendChild(this.canvas);
        
        this.ctx = this.canvas.getContext('2d');
        
        // Ρύθμιση εσωτερικής ανάλυσης (Resolution)
        this.resizeCanvas();
        
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Αρχική σχεδίαση (στατική)
        this.draw();
    }
    
    resizeCanvas() {
        if (this.canvas && this.visualizerEl) {
            this.canvas.width = this.visualizerEl.clientWidth;
            this.canvas.height = this.visualizerEl.clientHeight;
            this.draw();
        }
    }

    // =======================================================
    // PLAYBACK LOOP
    // =======================================================

    startVisualization() {
        if (!this.canvas) return;
        
        if (this.visualizerInterval) {
            Tone.Transport.clear(this.visualizerInterval);
        }

        // Ανανέωση κάθε ~30ms (περίπου 30fps) για ομαλή κίνηση playhead
        this.visualizerInterval = Tone.Transport.scheduleRepeat(() => {
            requestAnimationFrame(() => this.draw());
        }, 0.03); 
        
        this.draw();
    }

    stopVisualization() {
        if (this.visualizerInterval) {
            Tone.Transport.clear(this.visualizerInterval);
            this.visualizerInterval = null;
        }
        this.draw(); // Σχεδίαση μια τελευταία φορά (σταματημένο)
    }


    // =======================================================
    // DRAWING LOGIC
    // =======================================================

    draw() {
        if (!this.ctx || !this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // Περιθώρια
        const padding = { top: 20, bottom: 30, left: 0, right: 0 };
        const drawHeight = h - padding.top - padding.bottom;

        // Καθαρισμός
        this.ctx.fillStyle = '#1a1a1a'; // Dark background
        this.ctx.fillRect(0, 0, w, h);

        // Υπολογισμός τρέχουσας θέσης (Beat)
        // Tone.Transport.seconds = δευτερόλεπτα από την αρχή
        // BPM / 60 = Beats ανά δευτερόλεπτο
        const bpm = Tone.Transport.bpm.value;
        const currentBeat = Tone.Transport.seconds * (bpm / 60);

        // Σχεδίαση Πλέγματος (Grid)
        this.drawGrid(w, h, padding, drawHeight);

        // Σχεδίαση Νοτών
        // Εύρος Πίσσας: C1 (24) έως C7 (96)
        const minPitch = 24;
        const maxPitch = 96;
        const pitchRange = maxPitch - minPitch;

        this.notes.forEach(note => {
            // Αν έχουμε επιλέξει συγκεκριμένο track, αγνόησε τα άλλα
            if (this.activeTrackType && this.activeTrackType !== 'all' && note.trackType !== this.activeTrackType) {
                return;
            }

            // X: Θέση στο χρόνο
            const x = (note.start_beat / this.maxTime) * w;
            const noteWidth = Math.max(2, (note.duration_beats / this.maxTime) * w);

            // Y: Θέση στο ύψος (Ψηλές νότες πάνω)
            // 1.0 - (...) για να αντιστρέψουμε τον άξονα Y
            const normalizedPitch = (note.midi - minPitch) / pitchRange;
            const y = padding.top + (drawHeight * (1 - normalizedPitch));
            const noteHeight = Math.max(4, drawHeight / pitchRange);

            // Χρώμα & Διαφάνεια (Mix Volume Integration)
            const mixVol = TRACK_INSTRUMENTS[note.trackType]?.mixVolume || 0.7;
            
            this.ctx.fillStyle = note.color;
            
            // Η διαφάνεια εξαρτάται από το Velocity ΚΑΙ το MixVolume
            // Τα Pads (low mixVol) θα είναι πιο αχνά.
            this.ctx.globalAlpha = (0.4 + (note.velocity * 0.6)) * mixVol;

            // Αν το track δεν είναι active αλλά βλέπουμε "all", κάντο λίγο πιο αχνό
            if (this.activeTrackType === 'all') {
                 this.ctx.globalAlpha *= 0.8;
            } else {
                 this.ctx.globalAlpha = 1.0; // Full opacity σε solo mode
            }

            // Σχεδίαση ορθογωνίου
            this.ctx.fillRect(x, y - (noteHeight/2), noteWidth, noteHeight);
            
            // Reset Alpha
            this.ctx.globalAlpha = 1.0;
        });

        // Σχεδίαση Playhead
        this.drawPlayhead(currentBeat, w, h);
    }

    drawGrid(w, h, padding, drawHeight) {
        // Κάθετη γραμμή ανά Bar (4 beats)
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
        // Υπολογισμός X θέσης
        const x = (currentBeat / this.maxTime) * w;

        if (x >= 0 && x <= w) {
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, h);
            this.ctx.stroke();
            
            // Glow effect
            this.ctx.shadowColor = 'white';
            this.ctx.shadowBlur = 10;
            this.ctx.stroke();
            this.ctx.shadowBlur = 0;
        }
    }

    // =======================================================
    // UI INTERACTION
    // =======================================================

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
        
        // Κουμπί All Tracks
        const allBtn = this.createSelectorButton('all', 'All Tracks', true);
        trackSelectionDiv.appendChild(allBtn);

        // Κουμπιά για κάθε όργανο
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
        
        // Στυλ με βάση το χρώμα του track
        const color = TRACK_COLORS[trackType] || '#666';
        btn.style.border = `1px solid ${color}`;
        btn.style.color = 'white'; // Default text
        btn.dataset.trackType = trackType;
        
        // CSS class logic handled externally usually, but basic style here:
        btn.addEventListener('click', this.boundHandleTrackSelection);
        
        // Hover effect logic could go here
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
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        document.getElementById('track-selection').innerHTML = '';
        document.getElementById('track-metadata').innerHTML = '';
    }
}
