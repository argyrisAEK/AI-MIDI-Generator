import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { generateMultiTrackMIDIFromAPI, analyzeAndEnhancePrompt } from './midi-generator-api.js';
import { MusicalContext } from './musical-context.js';
import { PromptBuilder } from './prompt-builder.js';
import { JSONVariations } from './json-variations.js';
import { TutorialManager } from './tutorial.js';
import { Mixer } from './mixer.js';

// Lazy load audio engine to improve initial load time
let AudioEngine = null;
const loadAudioEngine = async () => {
    if (!AudioEngine) {
        const { AudioEngine: AE } = await import('./audio.js');
        AudioEngine = AE;
    }
    return AudioEngine;
};

class MIDIGeneratorApp {
    constructor() {
        this.audioEngine = null; // Initialize as null, load lazily
        this.ui = new UIManager(this);
        this.visualizer = new Visualizer(this.audioEngine, this);
        this.musicalContextManager = new MusicalContext();
        this.promptBuilder = new PromptBuilder();
        this.jsonVariations = new JSONVariations(this);
        this.tutorialManager = new TutorialManager(this);
        this.mixer = new Mixer(this);
        
        this.generatedTracks = new Map();
        this.compositionTitle = '';
        this.compositionDescription = '';
        this.mixerSettings = new Map(); // Store mixer settings for each track
        this.mixerVisible = false;
        
        this.initializeEventListeners();
        this.setupPageLifecycle();
        this.updateDurationTooltip(); // Initial update
        
        // Defer non-critical initialization
        this.deferredInit();
    }

    async deferredInit() {
        // Load service worker in background
        requestIdleCallback(() => {
            this.setupServiceWorker();
        });

        // Optionally, show tutorial on first visit
        if (!localStorage.getItem('tutorialCompleted')) {
            setTimeout(() => { // Give UI a moment to render
                this.tutorialManager.showTutorial();
            }, 500);
        }
    }

    async ensureAudioEngine() {
        if (!this.audioEngine) {
            const AE = await loadAudioEngine();
            this.audioEngine = new AE();
            this.visualizer.audioEngine = this.audioEngine;
        }
        return this.audioEngine;
    }

    initializeEventListeners() {
        document.getElementById('generate').addEventListener('click', () => this.handleGenerate());
        document.getElementById('play').addEventListener('click', () => this.handlePlay());
        document.getElementById('stop').addEventListener('click', () => this.handleStop());
        document.getElementById('download').addEventListener('click', () => this.handleDownload());
        document.getElementById('reset').addEventListener('click', () => this.handleReset());
        
        document.getElementById('text-tab').addEventListener('click', () => this.switchMode('text'));
        document.getElementById('examples-tab').addEventListener('click', () => this.switchMode('examples'));
        document.getElementById('form-tab').addEventListener('click', () => this.switchMode('form'));
        document.getElementById('variations-tab').addEventListener('click', () => this.switchMode('variations'));

        // Tutorial button listener
        document.getElementById('show-tutorial').addEventListener('click', () => this.tutorialManager.showTutorial());

        // Mixer is self-contained now, so the toggle listener is in mixer.js

        this.setupExamplePrompts();
        this.setupTrackTypeSelection();
        
        // Add listeners to update duration tooltip
        document.getElementById('bpm').addEventListener('input', () => this.updateDurationTooltip());
        document.getElementById('time-signature').addEventListener('change', () => this.updateDurationTooltip());
        document.getElementById('duration').addEventListener('change', () => this.updateDurationTooltip());
    }

    setupExamplePrompts() {
        document.getElementById('examples-grid').addEventListener('click', (e) => {
            if (e.target.classList.contains('example-btn')) {
                const promptText = e.target.dataset.prompt;
                document.getElementById('text-prompt').value = promptText;
                this.switchMode('text');
                this.ui.showTooltip('Prompt copied! You can now generate.', e.target);
            }
        });
    }

    setupTrackTypeSelection() {
        const trackTypeCheckboxes = document.querySelectorAll('input[name="track-type"]');
        const maxSelections = 5;

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
        if (this.audioEngine) {
            this.audioEngine.dispose();
        }
        this.ui.dispose();
    }

    switchMode(mode) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

        document.getElementById(`${mode}-tab`).classList.add('active');
        document.getElementById(`${mode}-panel`).classList.add('active');

        const generateButton = document.getElementById('generate');
        if (mode === 'variations') {
            generateButton.style.display = 'none';
        } else {
            generateButton.style.display = 'block';
        }
    }

    updateField(id, value) {
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
    }

    updateUIFromTextPrompt(params) {
        if (!params) return;

        const keyRoot = params.key?.replace('m', '');
        const scaleType = params.key?.includes('m') ? 'minor' : 'major';
        this.updateField('key', keyRoot);
        this.updateField('scale-type', scaleType);
        this.updateField('bpm', params.bpm);
        this.updateField('duration', params.duration_bars);
        this.updateField('style', params.style);
        this.updateField('mood', params.mood);
        this.updateField('rhythmic-complexity', params.rhythmicComplexity);
        
        // Update track type checkboxes
        if (params.trackTypes && Array.isArray(params.trackTypes)) {
            document.querySelectorAll('input[name="track-type"]').forEach(cb => {
                cb.checked = params.trackTypes.includes(cb.value);
            });
        }
        
        this.updateDurationTooltip(); // Recalculate duration text
    }

    updateUIFromContext(context, trackTypes) {
        this.updateField('style', context.style);
        this.updateField('key', context.key);
        this.updateField('scale-type', context.scale);
        this.updateField('mood', context.mood);
        this.updateField('bpm', context.tempo);
        this.updateField('duration', context.duration);
        this.updateField('rhythmic-complexity', context.rhythmicComplexity);
        this.updateField('time-signature', context.timeSignature);
        this.updateField('structure', context.structure || '');

        // Update track type checkboxes based on the tracks in this specific version
        if (trackTypes && Array.isArray(trackTypes)) {
            document.querySelectorAll('input[name="track-type"]').forEach(cb => {
                cb.checked = trackTypes.includes(cb.value);
            });
        }

        this.updateDurationTooltip();
    }

    async handleGenerate() {
        try {
            this.ui.showLoading('Analyzing your request...');
            
            const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
            const isTextMode = activeTab === 'text';
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
            } else { // Form or Examples mode
                selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);
                if (selectedTrackTypes.length === 0) {
                    throw new Error('Please select at least one track type in the form.');
                }
            }

            const musicalContext = this.musicalContextManager.generateContext(selectedTrackTypes);

            // Clear previous tracks
            this.generatedTracks.clear();
            this.mixer.reset(); // Clear mixer settings
            
            // Build the prompt with enhanced context if available
            let prompt;
            if (isTextMode) {
                const currentPrompt = document.getElementById('text-prompt').value;
                if (enhancedUserPrompt && enhancedUserPrompt !== currentPrompt) {
                    const textarea = document.getElementById('text-prompt');
                    const originalText = textarea.value;
                    textarea.value = enhancedUserPrompt; // Temporarily use enhanced for context
                    prompt = this.promptBuilder.constructMultiTrackPrompt(musicalContext);
                    textarea.value = originalText; // Restore original text
                } else {
                    prompt = this.promptBuilder.constructMultiTrackPrompt(musicalContext);
                }
            } else {
                prompt = this.promptBuilder.constructMultiTrackPrompt(musicalContext);
            }

            this.ui.showMessage(`Composing ${selectedTrackTypes.length > 1 ? `${selectedTrackTypes.length} harmonized tracks` : `a ${selectedTrackTypes[0]} track`}...`, 'loading');

            // Generate MIDI tracks
            const { tracks: generatedMidisMap, compositionTitle, compositionDescription, rawJson } =
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
            
            // Update the JSON Variations tab with the new source material
            if (rawJson) {
                this.jsonVariations.setSourceComposition(rawJson, { title: compositionTitle, explanation: compositionDescription }, musicalContext);
            }

            if (this.generatedTracks.size === 0) {
                throw new Error('No valid musical content was generated. Please try adjusting your prompt or settings.');
            }
            
            const tracksGenerated = Array.from(this.generatedTracks.keys());
            const missingTracks = selectedTrackTypes.filter(t => !tracksGenerated.includes(t));

            this.visualizer.setTracks(this.generatedTracks);
            this.ui.updateButtonStates(true);
            
            // Update mixer panel with the new tracks
            this.mixer.setTracks(this.generatedTracks);
            
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
            // Ensure audio engine is loaded
            await this.ensureAudioEngine();
            
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
            
            this.mixer.startVolumeMeter();
            this.ui.showMessage(`Playing ${activeTrackType === 'all' ? 'all tracks' : activeTrackType}...`, 'success');
        } catch (error) {
            console.error('Playback Error:', error);
            this.ui.showMessage('Playback failed: ' + error.message, 'error');
            this.handleStop();
        }
    }

    handleStop() {
        if (this.audioEngine) {
            this.audioEngine.stop();
        }
        this.mixer.stopVolumeMeter();
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

        const sanitizeFilename = (name) => {
            // Remove illegal characters for filenames and trim whitespace
            return name.replace(/[\/\\?%*:|"<>]/g, '-').trim() || 'untitled';
        };
        
        try {
            const activeTrackType = this.visualizer.activeTrackType;
            let midiToDownload, filename;
            
            if (activeTrackType && activeTrackType !== 'all') {
                const trackData = this.generatedTracks.get(activeTrackType);
                if (!trackData || !trackData.midi) {
                    this.ui.showMessage('Selected track data is not available.', 'error');
                    return;
                }
                midiToDownload = this.mixer.applySettingsToMidi(trackData.midi, activeTrackType);
                filename = sanitizeFilename(this.compositionTitle ? `${this.compositionTitle} - ${activeTrackType}` : activeTrackType);
            } else {
                // Create combined MIDI file with mixer settings
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

                    // Check if any track is soloed
                    const mixerSettingsMap = this.mixer.getSettings();
                    const hasSoloedTracks = Array.from(mixerSettingsMap.values()).some(settings => settings.solo);

                    // Handle drums first on channel 9
                    if (this.generatedTracks.has('drums')) {
                        const trackData = this.generatedTracks.get('drums');
                        const mixerSettings = mixerSettingsMap.get('drums');
                        const shouldInclude = this.mixer.shouldIncludeTrackInDownload('drums');
                        
                        if (shouldInclude && trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                            const track = midiToDownload.addTrack();
                            track.name = 'drums';
                            track.channel = 9; // Crucial for drums
                            
                            // Apply pan setting via Control Change message at the start of the track
                            if (mixerSettings?.pan !== undefined) {
                                const panValue = Math.round(((mixerSettings.pan + 1) / 2) * 127);
                                track.addCC({ number: 10, value: panValue, time: 0 });
                            }

                            // Apply mixer settings to notes
                            trackData.midi.tracks[0].notes.forEach(note => {
                                if (note?.name) {
                                    try {
                                        const modifiedNote = this.mixer.applySettingsToNote(note, 'drums');
                                        track.addNote(modifiedNote);
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

                        const shouldInclude = this.mixer.shouldIncludeTrackInDownload(type);

                        if (shouldInclude && trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                            if (currentChannel === 9) currentChannel++; // Skip drum channel

                            const track = midiToDownload.addTrack();
                            track.name = type;
                            track.channel = currentChannel;
                            if (instrumentMap[type] !== undefined) {
                                track.instrument.number = instrumentMap[type];
                            }
                            
                            // Apply pan setting via Control Change message
                            const mixerSettings = mixerSettingsMap.get(type);
                            if (mixerSettings?.pan !== undefined) {
                                const panValue = Math.round(((mixerSettings.pan + 1) / 2) * 127);
                                track.addCC({ number: 10, value: panValue, time: 0 });
                            }

                            // Apply mixer settings to notes
                            trackData.midi.tracks[0].notes.forEach(note => {
                                if (note?.name) {
                                    try {
                                        const modifiedNote = this.mixer.applySettingsToNote(note, type);
                                        track.addNote(modifiedNote);
                                    } catch (noteError) {
                                        console.warn('Failed to add note:', note, noteError);
                                    }
                                }
                            });
                            
                            currentChannel++;
                        }
                    });
                    
                    filename = sanitizeFilename(this.compositionTitle || 'combined-tracks');
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
                
                this.ui.showMessage('MIDI file downloaded successfully with mixer settings applied!', 'success');
            } catch (downloadError) {
                console.error('Download operation failed:', downloadError);
                // Ensure a proper error message is shown, even if the caught error is not an Error object
                const message = (downloadError instanceof Error) ? downloadError.message : String(downloadError);
                this.ui.showMessage(`Failed to create download file: ${message || 'Unknown error'}`, 'error');
            }
            
        } catch (error) {
            console.error('Download Error:', error);
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            this.ui.showMessage(`Download failed: ${errorMessage || 'Unknown error occurred during download'}`, 'error');
        }
    }

    handleReset() {
        this.handleStop();
        
        // Clear all generated data
        this.generatedTracks.clear();
        this.compositionTitle = '';
        this.compositionDescription = '';
        this.musicalContextManager.generateContext([]); // Reset context
        
        // Reset UI components
        this.ui.updateButtonStates(false);
        this.visualizer.reset();
        this.jsonVariations.reset();
        this.mixer.reset();
        
        // Reset form to its initial state
        this.switchMode('text');
        document.getElementById('text-prompt').value = '';
        
        // Reset track type checkboxes to default (bassline checked)
        document.querySelectorAll('input[name="track-type"]').forEach(cb => {
            cb.checked = cb.value === 'bassline';
        });

        // Reset all form controls to their default values
        document.getElementById('style').value = 'house';
        document.getElementById('mood').value = 'uplifting';
        document.getElementById('key').value = 'C';
        document.getElementById('scale-type').value = 'major';
        document.getElementById('bpm').value = '120';
        document.getElementById('duration').value = '4';
        document.getElementById('rhythmic-complexity').value = 'simple';
        document.getElementById('time-signature').value = '4/4';
        document.getElementById('structure').value = '';
        
        this.updateDurationTooltip();
        this.ui.showMessage('Application reset to initial state.', 'success');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});