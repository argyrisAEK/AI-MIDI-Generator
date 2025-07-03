import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { AudioEngine } from './audio.js';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { generateMultiTrackMIDIFromAPI, getTrackTypesFromPrompt } from './midi-generator-api.js';
import { MusicalContext } from './musical-context.js';
import { PromptBuilder } from './prompt-builder.js';

class MIDIGeneratorApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.ui = new UIManager(this);
        this.visualizer = new Visualizer(this.audioEngine, this);
        this.musicalContextManager = new MusicalContext();
        this.promptBuilder = new PromptBuilder();
        
        this.generatedTracks = new Map();
        this.compositionTitle = '';
        this.compositionDescription = '';
        
        this.initializeEventListeners();
        this.setupPageLifecycle();
        this.setupServiceWorker();
        this.updateDurationTooltip(); // Initial update

        setTimeout(() => {
            this.ui.showTooltip('Tip: Use keyboard shortcuts - Space (Play/Stop), G (Generate), D (Download), R (Reset), T (Text mode), F (Form mode)', 
                document.querySelector('.container'), 5000);
        }, 2000);
    }

    initializeEventListeners() {
        document.getElementById('generate').addEventListener('click', () => this.handleGenerate());
        document.getElementById('play').addEventListener('click', () => this.handlePlay());
        document.getElementById('stop').addEventListener('click', () => this.handleStop());
        document.getElementById('download').addEventListener('click', () => this.handleDownload());
        document.getElementById('reset').addEventListener('click', () => this.handleReset());
        document.getElementById('text-mode').addEventListener('click', () => this.switchMode('text'));
        document.getElementById('form-mode').addEventListener('click', () => this.switchMode('form'));
        this.setupTrackTypeSelection();
        
        // Add listeners to update duration tooltip
        document.getElementById('duration').addEventListener('input', () => this.updateDurationTooltip());
        document.getElementById('bpm').addEventListener('input', () => this.updateDurationTooltip());
        document.getElementById('time-signature').addEventListener('change', () => this.updateDurationTooltip());
        document.getElementById('duration').addEventListener('change', () => this.updateDurationTooltip());
    }

    setupTrackTypeSelection() {
        const trackTypeCheckboxes = document.querySelectorAll('input[name="track-type"]');
        const maxSelections = 4;

        trackTypeCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const checkedCheckboxes = document.querySelectorAll('input[name="track-type"]:checked');
                if (checkedCheckboxes.length > maxSelections) {
                    this.ui.showMessage(`You can select up to ${maxSelections} track types.`, 'warning');
                    e.target.checked = false;
                }
            });
        });
    }

    updateDurationTooltip() {
        const durationInput = document.getElementById('duration');
        const durationInSeconds = this.musicalContextManager.calculateTotalDurationInSeconds();
        durationInput.title = `Total duration: ${durationInSeconds.toFixed(2)} seconds`;
    }

    setupPageLifecycle() {
        window.addEventListener('beforeunload', () => this.cleanup());
        document.addEventListener('visibilitychange', () => document.hidden && this.handleStop());
    }

    setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(error => {
                    console.log('ServiceWorker registration failed:', error);
                });
            });
        }
    }

    cleanup() {
        this.handleStop();
        this.audioEngine.dispose();
        this.ui.dispose();
    }

    switchMode(mode) {
        const textMode = document.getElementById('text-mode');
        const formMode = document.getElementById('form-mode');
        const textContainer = document.getElementById('text-prompt-container');
        const formContainer = document.getElementById('form-fields-container');

        if (mode === 'text') {
            textMode.classList.add('active');
            formMode.classList.remove('active');
            textContainer.classList.add('active');
            formContainer.classList.remove('active');
        } else {
            textMode.classList.remove('active');
            formMode.classList.add('active');
            textContainer.classList.remove('active');
            formContainer.classList.add('active');
        }
    }

    async handleGenerate() {
        try {
            this.ui.showLoading('Preparing generation...');
            
            const isTextMode = document.getElementById('text-prompt-container').classList.contains('active');
            let selectedTrackTypes;

            if (isTextMode) {
                const userPrompt = document.getElementById('text-prompt').value.trim();
                if (!userPrompt) {
                    throw new Error('Please enter a description for the MIDI you want to create.');
                }
                selectedTrackTypes = await getTrackTypesFromPrompt(userPrompt, this.ui);
            } else {
                selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);
                if (selectedTrackTypes.length === 0) {
                    throw new Error('Please select at least one track type in the form.');
                }
            }

            const musicalContext = this.musicalContextManager.generateContext(selectedTrackTypes);
            this.generatedTracks.clear();
            
            const prompt = this.promptBuilder.constructMultiTrackPrompt(musicalContext);
            this.ui.showMessage(`Generating ${selectedTrackTypes.length > 1 ? `${selectedTrackTypes.length} cohesive tracks...` : `a ${selectedTrackTypes[0]} track...`}`, 'loading');

            // Generate MIDI tracks and capture composition-level metadata
            const { tracks: generatedMidisMap, compositionTitle, compositionDescription } =
                await generateMultiTrackMIDIFromAPI(prompt, this.ui, selectedTrackTypes);
            
            // Store only valid tracks
            generatedMidisMap.forEach((trackData, trackType) => {
                if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                    this.generatedTracks.set(trackType, trackData);
                }
            });
            
            // Give the visualizer access to the composition title & explanation
            this.compositionTitle = compositionTitle;
            this.compositionDescription = compositionDescription;

            if (this.generatedTracks.size === 0) throw new Error('Failed to generate any valid MIDI tracks from the API response.');
            
            const tracksGenerated = Array.from(this.generatedTracks.keys());
            const missingTracks = selectedTrackTypes.filter(t => !tracksGenerated.includes(t));

            this.visualizer.setTracks(this.generatedTracks);
            this.ui.updateButtonStates(true);
            
            let successMessage = `Successfully generated: ${tracksGenerated.join(', ')}.`;
            if (missingTracks.length > 0) {
                successMessage += `\nCould not generate: ${missingTracks.join(', ')}.`;
            }
            this.ui.showMessage(successMessage, 'success');

        } catch (error) {
            console.error('Generation Error:', error);
            this.ui.showMessage(`Generation failed: ${error.message}`, 'error');
            this.ui.updateButtonStates(false);
        } finally {
            this.ui.hideLoading();
        }
    }

    async handlePlay() {
        if (this.generatedTracks.size === 0) return;
        
        // Stop any existing playback before starting a new one.
        this.handleStop();

        try {
            await this.audioEngine.start();
            const activeTrackType = this.visualizer.activeTrackType;
            const musicalContext = this.musicalContextManager.getContext();
            const totalDuration = musicalContext?.totalDurationInSeconds || 8;

            const tracksToPlay = new Map();
            if (activeTrackType === 'all') {
                this.generatedTracks.forEach((trackData, trackType) => {
                    if (trackData?.midi?.tracks?.[0]?.notes) {
                        tracksToPlay.set(trackType, trackData);
                    }
                });
            } else {
                const trackData = this.generatedTracks.get(activeTrackType);
                if (trackData?.midi?.tracks?.[0]?.notes) {
                    tracksToPlay.set(activeTrackType, trackData);
                }
            }

            if (tracksToPlay.size === 0) {
                this.ui.showMessage('No notes to play for this selection.', 'warning');
                return;
            }

            tracksToPlay.forEach((trackData, trackType) => {
                this.audioEngine.playNotes(trackData.midi.tracks[0].notes, Tone.now(), trackType, totalDuration);
            });
            
            const playMode = document.getElementById('play-mode')?.value || 'loop';
            if (playMode === 'single' && totalDuration > 0) {
                 Tone.Transport.scheduleOnce(() => {
                    this.handleStop();
                }, totalDuration + 0.1);
            }

            this.ui.showMessage(`Playing ${activeTrackType === 'all' ? 'all tracks' : activeTrackType}...`, 'success');
        } catch (error) {
            console.error('Playback Error:', error);
            this.ui.showMessage('Playback failed: ' + error.message, 'error');
            this.handleStop();
        }
    }

    handleStop() {
        this.audioEngine.stop();
        document.querySelectorAll('.note.active').forEach(n => n.classList.remove('active'));
        const playhead = document.querySelector('.playhead');
        if (playhead) playhead.style.left = '20px'; // Reset to start
        this.ui.showMessage('Playback stopped.', 'info');
    }

    handleDownload() {
        if (this.generatedTracks.size === 0) return;
        
        try {
            const activeTrackType = this.visualizer.activeTrackType;
            let midiToDownload, filename;
            
            if (activeTrackType && activeTrackType !== 'all') {
                const trackData = this.generatedTracks.get(activeTrackType);
                midiToDownload = trackData.midi;
                filename = trackData.title || activeTrackType;
            } else {
                midiToDownload = new Midi();
                const musicalContext = this.musicalContextManager.getContext();
                midiToDownload.header.setTempo(musicalContext?.tempo || 120);

                const instrumentMap = {
                    bassline: 38, // Synth Bass 1
                    melody: 81,   // Lead 2 (sawtooth)
                    chord: 89,    // Pad 2 (warm)
                    arpeggio: 98, // FX 3 (crystal)
                    strings: 48,  // String Ensemble 1
                    lead: 80, // Lead 1 (square)
                    plucks: 7, // Harpsichord (often used for pluck sounds)
                };

                // Handle drums first on channel 9
                if (this.generatedTracks.has('drums')) {
                    const trackData = this.generatedTracks.get('drums');
                    if (trackData?.midi?.tracks?.[0]?.notes) {
                        const track = midiToDownload.addTrack();
                        track.name = 'drums';
                        track.channel = 9; // Crucial for drums
                        trackData.midi.tracks[0].notes.forEach(note => {
                            if (note?.name) track.addNote(note);
                        });
                    }
                }
                
                let currentChannel = 0;
                this.generatedTracks.forEach((type, trackData) => {
                    if (type === 'drums') return; // Already handled

                    if (trackData?.midi?.tracks?.[0]?.notes) {
                        if (currentChannel === 9) currentChannel++; // Skip drum channel

                        const track = midiToDownload.addTrack();
                        track.name = type;
                        track.channel = currentChannel;
                        if (instrumentMap[type] !== undefined) {
                            track.instrument.number = instrumentMap[type];
                        }

                        trackData.midi.tracks[0].notes.forEach(note => {
                            if (note?.name) track.addNote(note);
                        });
                        
                        currentChannel++;
                    }
                });
                // Use composition title for the filename, with a fallback
                filename = this.compositionTitle || 'combined-tracks';
            }
            
            if (!midiToDownload || midiToDownload.tracks.length === 0) {
                 this.ui.showMessage('No data to download.', 'warning');
                 return;
            }
            
            const blob = new Blob([midiToDownload.toArray()], { type: 'audio/midi' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}.mid`;
            a.click();
            URL.revokeObjectURL(url);
            
            this.ui.showMessage('MIDI file downloaded successfully!', 'success');
        } catch (error) {
            console.error('Download Error:', error);
            this.ui.showMessage('Download failed: ' + error.message, 'error');
        }
    }

    handleReset() {
        this.handleStop();
        this.generatedTracks.clear();
        this.compositionTitle = '';
        this.compositionDescription = '';
        this.musicalContextManager.generateContext([]); // Reset context
        this.ui.updateButtonStates(false);
        this.visualizer.reset();
        
        document.getElementById('text-prompt').value = '';
        document.querySelectorAll('input[name="track-type"]').forEach((cb, i) => cb.checked = i === 0);
        document.getElementById('style').value = 'house';
        document.getElementById('mood').value = 'uplifting';
        document.getElementById('key').value = 'C';
        document.getElementById('bpm').value = '120';
        document.getElementById('duration').value = '4';
        
        this.ui.showMessage('Application reset.', 'success');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});
