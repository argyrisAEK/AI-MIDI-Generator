import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { AudioEngine } from './audio.js';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { generateMultiTrackMIDIFromAPI, analyzeAndEnhancePrompt } from './midi-generator-api.js';
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
        if (!durationInput) return;
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

    updateUIFromTextPrompt(params) {
        if (!params) return;

        const updateField = (id, value) => {
            const el = document.getElementById(id);
            if (el && value) {
                // Check if the value is a valid option for selects
                if (el.tagName === 'SELECT') {
                    const optionExists = [...el.options].some(opt => opt.value === value);
                    if (optionExists) el.value = value;
                } else {
                    el.value = value;
                }
            }
        };

        updateField('key', params.key);
        updateField('bpm', params.bpm);
        updateField('duration', params.duration_bars);
        updateField('style', params.style);
        updateField('mood', params.mood);
        
        // Update track type checkboxes
        if (params.trackTypes && Array.isArray(params.trackTypes)) {
            document.querySelectorAll('input[name="track-type"]').forEach(cb => {
                cb.checked = params.trackTypes.includes(cb.value);
            });
        }
        
        this.updateDurationTooltip(); // Recalculate duration text
    }

    async handleGenerate() {
        try {
            this.ui.showLoading('Analyzing your request...');
            
            const isTextMode = document.getElementById('text-prompt-container').classList.contains('active');
            let selectedTrackTypes;
            let enhancedUserPrompt = '';

            if (isTextMode) {
                const userPrompt = document.getElementById('text-prompt').value.trim();
                if (!userPrompt) {
                    throw new Error('Please enter a description for the MIDI you want to create.');
                }
                
                try {
                    this.ui.showMessage('Analyzing your creative prompt...', 'loading');
                    const { extractedParams, enhancedPrompt } = await analyzeAndEnhancePrompt(userPrompt, this.ui);
                    
                    // Update UI form fields based on what was extracted from the text
                    this.updateUIFromTextPrompt(extractedParams);

                    // Now get the definitive list of tracks from the (potentially updated) UI
                    selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);
                    
                    if (selectedTrackTypes.length === 0) {
                         // Fallback if analysis failed to find tracks
                        this.ui.showMessage('Adding default tracks: melody & bassline', 'info');
                        document.getElementById('melody-track').checked = true;
                        document.getElementById('bassline-track').checked = true;
                        selectedTrackTypes = ['melody', 'bassline'];
                    }
                    
                    enhancedUserPrompt = enhancedPrompt;
                } catch (analysisError) {
                    console.warn('Prompt analysis failed, using original prompt:', analysisError);
                    // Continue with original prompt and current form settings
                    selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);
                    if (selectedTrackTypes.length === 0) {
                        document.getElementById('melody-track').checked = true;
                        document.getElementById('bassline-track').checked = true;
                        selectedTrackTypes = ['melody', 'bassline'];
                    }
                }
            } else {
                selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);
                if (selectedTrackTypes.length === 0) {
                    throw new Error('Please select at least one track type in the form.');
                }
            }

            const musicalContext = this.musicalContextManager.generateContext(selectedTrackTypes);

            // Clear previous tracks
            this.generatedTracks.clear();
            
            // Build the prompt with enhanced context if available
            let prompt;
            if (isTextMode && enhancedUserPrompt) {
                const textarea = document.getElementById('text-prompt');
                const originalText = textarea.value;
                textarea.value = enhancedUserPrompt;
                prompt = this.promptBuilder.constructMultiTrackPrompt(musicalContext);
                textarea.value = originalText; // Restore original text
            } else {
                prompt = this.promptBuilder.constructMultiTrackPrompt(musicalContext);
            }

            this.ui.showMessage(`Composing ${selectedTrackTypes.length > 1 ? `${selectedTrackTypes.length} harmonized tracks` : `a ${selectedTrackTypes[0]} track`}...`, 'loading');

            // Generate MIDI tracks
            const { tracks: generatedMidisMap, compositionTitle, compositionDescription } =
                await generateMultiTrackMIDIFromAPI(prompt, this.ui, selectedTrackTypes);
            
            // Store valid tracks
            generatedMidisMap.forEach((trackData, trackType) => {
                if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                    this.generatedTracks.set(trackType, trackData);
                }
            });
            
            // Set composition metadata
            this.compositionTitle = compositionTitle;
            this.compositionDescription = compositionDescription;
            this.visualizer.compositionTitle = compositionTitle;
            this.visualizer.compositionDescription = compositionDescription;

            if (this.generatedTracks.size === 0) {
                throw new Error('No valid musical content was generated. Please try adjusting your prompt or settings.');
            }
            
            const tracksGenerated = Array.from(this.generatedTracks.keys());
            const missingTracks = selectedTrackTypes.filter(t => !tracksGenerated.includes(t));

            this.visualizer.setTracks(this.generatedTracks);
            this.ui.updateButtonStates(true);
            
            let successMessage = `🎵 Successfully created: ${tracksGenerated.join(', ')}`;
            if (missingTracks.length > 0) {
                successMessage += `\n⚠️ Could not generate: ${missingTracks.join(', ')}`;
            }
            this.ui.showMessage(successMessage, 'success');

        } catch (error) {
            console.error('Generation Error:', error);
            const errorMessage = error.message.includes('timeout') 
                ? 'Generation timed out. The AI service may be busy - please try again in a moment.'
                : `Generation failed: ${error.message}`;
            this.ui.showMessage(errorMessage, 'error');
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
                    if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) { // Ensure notes exist
                        tracksToPlay.set(trackType, trackData);
                    }
                });
            } else {
                const trackData = this.generatedTracks.get(activeTrackType);
                if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) { // Ensure notes exist
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
        if (this.generatedTracks.size === 0) {
            this.ui.showMessage('No tracks available to download.', 'warning');
            return;
        }
        
        try {
            const activeTrackType = this.visualizer.activeTrackType;
            let midiToDownload, filename;
            
            if (activeTrackType && activeTrackType !== 'all') {
                const trackData = this.generatedTracks.get(activeTrackType);
                if (!trackData || !trackData.midi) {
                    this.ui.showMessage('Selected track data is not available.', 'error');
                    return;
                }
                midiToDownload = trackData.midi;
                filename = this.compositionTitle ? `${this.compositionTitle} - ${activeTrackType}` : activeTrackType;
            } else {
                // Create combined MIDI file
                try {
                    midiToDownload = new Midi();
                    const musicalContext = this.musicalContextManager.getContext();
                    const bpm = musicalContext?.tempo || 120;
                    midiToDownload.header.setTempo(bpm);

                    const instrumentMap = {
                        bassline: 38, // Synth Bass 1
                        melody: 81,   // Lead 2 (sawtooth)
                        chord: 89,    // Pad 2 (warm)
                        arpeggio: 98, // FX 3 (crystal)
                        strings: 48,  // String Ensemble 1
                        lead: 80, // Lead 1 (square)
                        plucks: 7, // Harpsichord (often used for pluck sounds)
                        keys: 4, // Electric Piano 1
                        brass: 61, // Brass Section
                        percussion: 118, // Synth Drum
                        guitar: 24, // Acoustic Guitar (nylon)
                        drums: 1 // Standard kit on channel 9
                    };

                    // Handle drums first on channel 9
                    if (this.generatedTracks.has('drums')) {
                        const trackData = this.generatedTracks.get('drums');
                        if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                            const track = midiToDownload.addTrack();
                            track.name = 'drums';
                            track.channel = 9; // Crucial for drums
                            trackData.midi.tracks[0].notes.forEach(note => {
                                if (note?.name) {
                                    try {
                                        track.addNote(note);
                                    } catch (noteError) {
                                        console.warn('Failed to add drum note:', note, noteError);
                                    }
                                }
                            });
                        }
                    }
                    
                    let currentChannel = 0;
                    this.generatedTracks.forEach((trackData, type) => {
                        if (type === 'drums') return; // Already handled

                        if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                            if (currentChannel === 9) currentChannel++; // Skip drum channel

                            const track = midiToDownload.addTrack();
                            track.name = type;
                            track.channel = currentChannel;
                            if (instrumentMap[type] !== undefined) {
                                track.instrument.number = instrumentMap[type];
                            }

                            trackData.midi.tracks[0].notes.forEach(note => {
                                if (note?.name) {
                                    try {
                                        track.addNote(note);
                                    } catch (noteError) {
                                        console.warn('Failed to add note:', note, noteError);
                                    }
                                }
                            });
                            
                            currentChannel++;
                        }
                    });
                    
                    filename = this.compositionTitle || 'combined-tracks';
                } catch (midiCreationError) {
                    console.error('Failed to create combined MIDI:', midiCreationError);
                    this.ui.showMessage('Failed to create combined MIDI file: ' + midiCreationError.message, 'error');
                    return;
                }
            }
            
            if (!midiToDownload) {
                this.ui.showMessage('No MIDI data available for download.', 'error');
                return;
            }
            
            // Validate MIDI has content
            if (!midiToDownload.tracks || midiToDownload.tracks.length === 0) {
                this.ui.showMessage('MIDI file contains no tracks.', 'error');
                return;
            }

            // Check if any track has notes
            const hasNotes = midiToDownload.tracks.some(track => track.notes && track.notes.length > 0);
            if (!hasNotes) {
                this.ui.showMessage('MIDI file contains no musical notes.', 'error');
                return;
            }
            
            // Create and download the file
            try {
                const midiArray = midiToDownload.toArray();
                if (!midiArray || midiArray.length === 0) {
                    throw new Error('Generated MIDI array is empty');
                }
                
                const blob = new Blob([midiArray], { type: 'audio/midi' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${filename}.mid`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                this.ui.showMessage('MIDI file downloaded successfully!', 'success');
            } catch (downloadError) {
                console.error('Download operation failed:', downloadError);
                this.ui.showMessage('Failed to create download file: ' + downloadError.message, 'error');
            }
            
        } catch (error) {
            console.error('Download Error:', error);
            const errorMessage = error?.message || 'Unknown error occurred during download';
            this.ui.showMessage('Download failed: ' + errorMessage, 'error');
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
        document.getElementById('structure').value = '';
        
        this.updateDurationTooltip();
        this.ui.showMessage('Application reset.', 'success');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});