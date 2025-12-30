import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';

class MIDIGeneratorApp {
    constructor() {
        this.ui = new UIManager();
        this.visualizer = new Visualizer(document.getElementById('midi-visualizer'));
        this.audioEngine = null;
        this.currentComposition = null;
        
        this.initEventListeners();
    }
    initEventListeners() {
        // Κουμπί Generate
        const genBtn = document.getElementById('generate-btn');
        if (genBtn) genBtn.addEventListener('click', () => this.handleGenerate());

        // Κουμπί Play/Stop
        const playBtn = document.getElementById('play-btn');
        if (playBtn) playBtn.addEventListener('click', () => this.togglePlayback());

        // Κουμπί Download
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadMidi());
    }

    async loadAudio() {
        if (!this.audioEngine) {
            const { AudioEngine } = await import('./audio.js');
            this.audioEngine = new AudioEngine();
            await this.audioEngine.init();
        }
        return this.audioEngine;
    }

    async handleGenerate() {
        const userPrompt = document.getElementById('text-prompt').value;
        if (!userPrompt) return this.ui.showMessage("Please enter a prompt", "error");

        try {
            this.ui.setLoading(true);
            this.ui.showMessage("Analyzing your musical idea...", "info");

            // --- ΒΗΜΑ 1: ΑΝΑΛΥΣΗ (Edge Function) ---
            const analysisRes = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userPrompt })
            });
            
            if (!analysisRes.ok) throw new Error("Analysis failed");
            const analysisData = await analysisRes.json();
            
            // Ενημέρωση των UI fields (BPM, Key, κλπ) από την ανάλυση
            this.updateUIFromAnalysis(analysisData.extractedParams);
            this.ui.showMessage(`Style detected: ${analysisData.extractedParams.style}`, "success");

            // --- ΒΗΜΑ 2: ΔΗΜΙΟΥΡΓΙΑ (Edge Function) ---
            this.ui.showMessage("Generating MIDI notation...", "loading");
            
            const generateRes = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...analysisData.extractedParams,
                    durationBars: parseInt(document.getElementById('duration').value) || 4,
                    tracks: this.getSelectedTracks()
                })
            });

            if (!generateRes.ok) throw new Error("Generation failed");
            const composition = await generateRes.json();

            // --- ΒΗΜΑ 3: ΕΠΕΞΕΡΓΑΣΙΑ & ΑΝΑΠΑΡΑΓΩΓΗ ---
            await this.processComposition(composition);
            
            this.ui.setLoading(false);
            this.ui.showMessage("Composition ready!", "success");

        } catch (error) {
            console.error(error);
            this.ui.showMessage(error.message, "error");
            this.ui.setLoading(false);
        }
    }

    updateUIFromAnalysis(params) {
        if (params.tempo) document.getElementById('bpm').value = params.tempo;
        if (params.style) document.getElementById('style').value = params.style;
        if (params.key) document.getElementById('key').value = params.key;
        if (params.timeSignature) document.getElementById('time-signature').value = params.timeSignature;
        
        // Επιλογή tracks
        if (params.trackTypes) {
            document.querySelectorAll('input[name="track-type"]').forEach(cb => {
                cb.checked = params.trackTypes.includes(cb.value);
            });
        }
    }

    getSelectedTracks() {
        return Array.from(document.querySelectorAll('input[name="track-type"]:checked'))
                    .map(cb => cb.value);
    }

    async processComposition(data) {
        this.currentComposition = data;
        const engine = await this.loadAudio();
        
        // 1. Καθαρισμός προηγούμενου playback
        engine.stopAll();
        this.visualizer.clear();

        // 2. Φόρτωση των tracks στο Audio Engine και Visualizer
        Object.entries(data.tracks).forEach(([trackName, notes]) => {
            // Προγραμματισμός ήχων
            engine.loadTrack(trackName, notes);
            
            // Σχεδίαση στο visualizer
            this.visualizer.drawNotes(notes, trackName);
        });

        // Ενημέρωση τίτλου στο UI
        document.getElementById('composition-title').innerText = data.title;
        document.getElementById('composition-info').innerText = data.explanation;
    }

    async togglePlayback() {
        const engine = await this.loadAudio();
        if (Tone.Transport.state === 'started') {
            engine.stopAll();
            document.getElementById('play-btn').innerText = "Play";
        } else {
            await Tone.start();
            engine.startAll();
            document.getElementById('play-btn').innerText = "Stop";
        }
    }

    downloadMidi() {
        if (!this.currentComposition) return;

        const midi = new Midi();
        midi.header.setTempo(this.currentComposition.metadata.tempo);

        Object.entries(this.currentComposition.tracks).forEach(([name, notes]) => {
            const track = midi.addTrack();
            track.name = name;
            notes.forEach(n => {
                track.addNote({
                    midi: n.midi,
                    time: n.time,
                    duration: n.duration,
                    velocity: n.velocity
                });
            });
        });

        const blob = new Blob([midi.toArray()], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentComposition.title || 'composition'}.mid`;
        a.click();
    }
}

// Εκκίνηση της εφαρμογής
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});
