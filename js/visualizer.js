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

    // =======================================================
    // 🛠️ ΔΙΟΡΘΩΣΗ 1: ΦΟΡΤΩΣΗ ΚΑΙ ΥΠΟΛΟΓΙΣΜΟΣ ΝΟΤΩΝ/ΧΡΟΝΟΥ
    // =======================================================
    /**
     * Φορτώνει όλες τις νότες από όλα τα tracks και υπολογίζει τη μέγιστη διάρκεια.
     * @param {Map} tracks - Το Map με τα generated MIDI tracks.
     * @param {string} title - Ο τίτλος της σύνθεσης.
     * @param {string} description - Η περιγραφή της σύνθεσης.
     */
    loadNotes(tracks, title = '', description = '') {
        this.generatedTracks = tracks;
        this.compositionTitle = title;
        this.compositionDescription = description;
        this.notes = [];
        this.maxTime = 0; // Σε Beats

        tracks.forEach((trackData, trackType) => {
            trackData.notes.forEach(note => {
                // Υπολογισμός του μέγιστου χρόνου για την κλίμακα
                const endTime = note.start_beat + note.duration_beats;
                if (endTime > this.maxTime) {
                    this.maxTime = endTime;
                }

                this.notes.push({
                    ...note,
                    trackType: trackType,
                    color: TRACK_COLORS[trackType] || '#CCCCCC'
                });
            });
        });

        this.updateTrackSelectors();
        this.updateMetadataDisplay('all');
        
        // Καθαρισμός και προετοιμασία του canvas
        if (!this.canvas) {
            this.setupCanvas();
        } else {
            this.drawInitialState();
        }
    }


    // =======================================================
    // 🛠️ ΔΙΟΡΘΩΣΗ 2: ΔΗΜΙΟΥΡΓΙΑ ΚΑΝΒΑ (CANVAS SETUP)
    // =======================================================
    setupCanvas() {
        // Αφαίρεση προηγούμενου canvas αν υπάρχει
        if (this.canvas) {
            this.canvas.remove();
        }
        
        // Δημιουργία και προσθήκη του canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.visualizerEl.clientWidth;
        // Ορίζουμε ένα σταθερό ύψος για το piano roll
        this.canvas.height = 300; 
        this.visualizerEl.appendChild(this.canvas);
        
        this.ctx = this.canvas.getContext('2d');
        
        window.addEventListener('resize', this.handleResize.bind(this));
        this.drawInitialState();
    }
    
    handleResize() {
        if (this.canvas) {
            this.canvas.width = this.visualizerEl.clientWidth;
            this.drawInitialState();
        }
    }

    // =======================================================
    // PLAYBACK & DRAWING
    // =======================================================

    /**
     * Ξεκινά την οπτικοποίηση (piano roll view) συγχρονισμένη με το Tone.js Transport.
     */
    startVisualization() {
        if (!this.canvas) return;
        
        if (this.visualizerInterval) {
            Tone.Transport.clear(this.visualizerInterval);
        }

        // Σχεδίαση κάθε 16ο νότα (συνήθως 150-200ms, ανάλογα το BPM)
        this.visualizerInterval = Tone.Transport.scheduleRepeat(time => {
            this.drawNotes();
        }, '16n'); 
        
        this.drawNotes(); // Σχεδιάζουμε αμέσως
    }

    /**
     * Σταματά την οπτικοποίηση και επιστρέφει στην αρχική κατάσταση.
     */
    stopVisualization() {
        if (this.visualizerInterval) {
            Tone.Transport.clear(this.visualizerInterval);
            this.visualizerInterval = null;
        }
        this.drawInitialState();
    }
    
    drawInitialState() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGrid();
        this.drawNotes();
    }


    // =======================================================
    // VISUALIZATION LOGIC
    // =======================================================

    drawGrid() {
        if (!this.ctx) return;

        const { width, height } = this.canvas;
        const totalBars = this.maxTime / 4; // Υποθέτοντας 4/4
        const barWidth = width / totalBars;
        
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.ctx.lineWidth = 1;

        // Σχεδίαση κάθε μπάρας
        for (let i = 0; i < totalBars; i++) {
            const x = i * barWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
            this.ctx.stroke();
        }
    }

    drawNotes() {
        if (!this.ctx || this.notes.length === 0) return;

        const { width, height } = this.canvas;
        const totalBeats = this.maxTime;
        const minPitch = 24; // C1 (βάση)
        const maxPitch = 96; // C7 (κορυφή)
        const pitchRange = maxPitch - minPitch;
        
        this.ctx.clearRect(0, 0, width, height);
        this.drawGrid(); // Ξανασχεδίαση του πλέγματος
        
        const currentBeat = Tone.Transport.seconds * (Tone.Transport.bpm.value / 60);

        this.notes.forEach(note => {
            // Φιλτράρισμα βάσει activeTrackType
            if (this.activeTrackType && this.activeTrackType !== 'all' && note.trackType !== this.activeTrackType) {
                return;
            }

            // Υπολογισμός θέσης και μεγέθους της νότας
            const x = (note.start_beat / totalBeats) * width;
            const noteWidth = (note.duration_beats / totalBeats) * width;
            // Η πίσσα είναι αντίστροφη (ψηλότερη νότα = χαμηλότερο y)
            const y = height - (((note.midi - minPitch) / pitchRange) * height);
            const noteHeight = height / pitchRange;
            
            // Χρώμα και σκίαση
            this.ctx.fillStyle = note.color;
            this.ctx.globalAlpha = (this.activeTrackType && this.activeTrackType !== 'all' && note.trackType !== this.activeTrackType) ? 0.3 : (0.4 + (note.velocity * 0.6));

            // Σχεδίαση ορθογωνίου (νότα)
            this.ctx.fillRect(x, y, noteWidth, noteHeight);
        });

        // Σχεδίαση Playhead
        this.drawPlayhead(currentBeat, totalBeats);
    }

    drawPlayhead(currentBeat, totalBeats) {
        if (!this.ctx) return;
        
        const { width, height } = this.canvas;
        
        // Υπολογισμός της θέσης του playhead
        const playheadX = (currentBeat / totalBeats) * width;

        this.ctx.globalAlpha = 1.0;
        this.ctx.fillStyle = 'white'; 
        
        // Σχεδίαση γραμμής
        this.ctx.fillRect(playheadX - 1, 0, 2, height);
    }
    
    // =======================================================
    // UI HANDLERS
    // =======================================================

    setTracks(tracks) {
        // Η setTracks αντικαθίσταται από τη loadNotes, αλλά την κρατάμε για συμβατότητα
        this.loadNotes(tracks);
    }

    handleTrackSelection(event) {
        const trackType = event.target.dataset.trackType;
        this.setActiveTrack(trackType);
    }

    setActiveTrack(trackType) {
        document.querySelectorAll('.track-selector').forEach(btn => btn.classList.remove('active'));
        const activeButton = document.querySelector(`.track-selector[data-track-type=\"${trackType}\"]`);
        if (activeButton) activeButton.classList.add('active');
        
        this.activeTrackType = trackType;
        this.updateMetadataDisplay(trackType);
        this.drawNotes(); // Ξανασχεδιάζουμε μόνο το ενεργό track
    }

    updateTrackSelectors() {
        const trackSelectionDiv = document.getElementById('track-selection');
        trackSelectionDiv.innerHTML = '';
        
        // Προσθήκη του "All Tracks"
        const allBtn = this.createSelectorButton('all', 'All Tracks', true);
        trackSelectionDiv.appendChild(allBtn);

        this.generatedTracks.forEach((_, trackType) => {
            const btn = this.createSelectorButton(trackType, trackType.toUpperCase());
            trackSelectionDiv.appendChild(btn);
        });
        
        // Επανασύνδεση listeners
        document.querySelectorAll('.track-selector').forEach(btn => {
            btn.removeEventListener('click', this.boundHandleTrackSelection);
            btn.addEventListener('click', this.boundHandleTrackSelection);
        });
    }
    
    createSelectorButton(trackType, label, isInitial = false) {
        const btn = document.createElement('button');
        btn.classList.add('track-selector', 'p-2', 'rounded-lg', 'text-sm', 'font-medium', 'text-white');
        if (isInitial) {
            btn.classList.add('active');
            this.activeTrackType = trackType;
        }
        btn.style.backgroundColor = TRACK_COLORS[trackType] || '#CCCCCC';
        btn.dataset.trackType = trackType;
        btn.textContent = label;
        return btn;
    }

    clear() {
        this.generatedTracks.clear();
        this.compositionTitle = '';
        this.compositionDescription = '';
        this.activeTrackType = null;
        this.notes = [];
        this.maxTime = 0;

        // Αφαίρεση του canvas από το DOM
        if (this.canvas) {
            this.canvas.remove();
            this.canvas = null;
            this.ctx = null;
        }
        
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
            metadataEl.innerHTML = `<h3 class=\"text-lg font-semibold text-white mb-1\">${title}</h3><p class=\"text-sm text-gray-400\">${description}</p>`;
            return;
        }
        
        const trackData = this.generatedTracks.get(trackType);
        const title = trackData?.title || (trackType.charAt(0).toUpperCase() + trackType.slice(1));
        const description = trackData?.description || `The ${trackType} part for the composition.`;
        metadataEl.innerHTML = `<h3 class=\"text-lg font-semibold text-accent mb-1\">${title} (Solo)</h3><p class=\"text-sm text-gray-400\">${description}</p>`;
    }
}
