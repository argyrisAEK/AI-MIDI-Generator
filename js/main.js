import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { generateMultiTrackMIDIFromAPI, analyzeAndEnhancePrompt } from './midi-generator-api.js';
import { MusicalContext } from './musical-context.js';
import { PromptBuilder } from './prompt-builder.js';
import { JSONVariations } from './json-variations.js';
import { TutorialManager } from './tutorial.js';
import { MidiBuilder } from './midi-builder.js';

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
        this.audioEngine = null;
        this.ui = new UIManager(this);
        this.visualizer = new Visualizer(this.audioEngine, this);
        this.musicalContextManager = new MusicalContext();
        this.promptBuilder = new PromptBuilder();
        this.jsonVariations = new JSONVariations(this);
        this.tutorialManager = new TutorialManager(this);
        
        this.generatedTracks = new Map();
        this.compositionTitle = '';
        this.compositionDescription = '';

        this.downloadOptionsModal = document.getElementById('download-options-modal');
        
        this.initializeEventListeners();
        this.setupPageLifecycle();
        this.updateDurationTooltip();
        
        // Show tutorial on first visit
        if (!localStorage.getItem('tutorialCompleted')) {
            this.tutorialManager.showTutorial();
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

        // Download options modal listeners
        document.getElementById('download-multitrack').addEventListener('click', () => this.executeDownload('multitrack'));
        document.getElementById('download-zip-individual').addEventListener('click', () => this.executeDownload('zip'));
        this.downloadOptionsModal.querySelector('.close-button').addEventListener('click', () => this.hideDownloadOptions());
        window.addEventListener('click', (event) => {
            if (event.target === this.downloadOptionsModal) {
                this.hideDownloadOptions();
            }
        });

        this.setupExamplePrompts();
        this.setupTrackTypeSelection();
        
        // Add listeners to update duration tooltip
        document.getElementById('bpm').addEventListener('input', () => this.updateDurationTooltip());
        document.getElementById('time-signature').addEventListener('change', () => this.updateDurationTooltip());
        document.getElementById('duration').addEventListener('change', () => this.updateDurationTooltip());
        
        // Add genre change listener to auto-update track selection
        document.getElementById('style').addEventListener('change', () => this.updateTracksForGenre());
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
                        // Fallback if analysis failed to find tracks - suggest defaults
                        this.ui.showMessage('No tracks detected in prompt. Adding: melody & bassline', 'info');
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
                        this.ui.showMessage('Please select at least one track type or describe your music in text mode', 'warning');
                        throw new Error('No track types selected and auto-detection failed');
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
            
            let successMessage = `🎵 Successfully created: ${tracksGenerated.join(', ')}`;
            if (missingTracks.length > 0) {
                successMessage += `\n⚠️ Could not generate: ${missingTracks.join(', ')}`;
            }
            this.ui.showMessage(successMessage, 'success');

            // After generation, show validation report
            const validationStrictness = document.getElementById('scale-validation-strictness')?.value || 'medium';
            
            if (this.generatedTracks.size > 0) {
                this.ui.showMessage(
                    `✅ Generated ${Array.from(this.generatedTracks.keys()).join(', ')} with ${validationStrictness} scale validation`,
                    'success'
                );
            }

        } catch (error) {
            console.error('Generation Error:', error);
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
        // document.querySelectorAll('.note.active').forEach(n => n.classList.remove('active')); // Removing expensive DOM query for performance
        const playhead = document.querySelector('.playhead');
        if (playhead) playhead.style.left = '20px'; // Reset to start
        this.ui.showMessage('Playback stopped.', 'info');
    }

    showDownloadOptions() {
        this.downloadOptionsModal.classList.add('active');
        document.body.classList.add('no-scroll');
    }

    hideDownloadOptions() {
        this.downloadOptionsModal.classList.remove('active');
        document.body.classList.remove('no-scroll');
    }

    handleDownload() {
        if (this.generatedTracks.size === 0) {
            this.ui.showMessage('No tracks available to download.', 'warning');
            return;
        }

        const activeTrackType = this.visualizer.activeTrackType;
        
        if (activeTrackType && activeTrackType !== 'all') {
            // If a single track is selected, download it directly.
            this.executeDownload('single');
        } else {
            // If "All Tracks" is selected, show the options modal.
            this.showDownloadOptions();
        }
    }

    async executeDownload(type) {
        if (type === 'zip' || type === 'multitrack') {
            this.hideDownloadOptions();
        }
    
        const sanitizeFilename = (name) => {
            return name.replace(/[\/\\?%*:|"<>]/g, '-').trim() || 'untitled';
        };

        try {
            if (type === 'zip') {
                await this.downloadIndividualTracksAsZip(sanitizeFilename);
                return;
            }

            let midiToDownload, filename;
            const activeTrackType = this.visualizer.activeTrackType;

            if (type === 'single') {
                const trackData = this.generatedTracks.get(activeTrackType);
                if (!trackData || !trackData.midi) {
                    this.ui.showMessage('Selected track data is not available.', 'error');
                    return;
                }
                // Determine BPM for MIDI header
                const musicalContext = this.musicalContextManager.getContext();
                const bpm = musicalContext?.tempo || 120;

                // Fix: Use MidiBuilder to wrap the single track correctly into a new Midi object
                midiToDownload = MidiBuilder.createCombinedMidi(new Map([[activeTrackType, trackData]]), bpm);
                filename = sanitizeFilename(this.compositionTitle ? `${this.compositionTitle} - ${activeTrackType}` : activeTrackType);
            } else { // 'multitrack'
                const musicalContext = this.musicalContextManager.getContext();
                const bpm = musicalContext?.tempo || 120;
                // Fix: Assign to outer scoped variable midiToDownload (removed const keyword here)
                midiToDownload = MidiBuilder.createCombinedMidi(this.generatedTracks, bpm);
                filename = sanitizeFilename(this.compositionTitle || 'combined-tracks');
            }
            
            this.downloadMidiFile(midiToDownload, filename);

        } catch (error) {
            console.error('Download Error:', error);
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            this.ui.showMessage(`Download failed: ${errorMessage || 'Unknown error occurred'}`, 'error');
        }
    }

    downloadMidiFile(midi, filename) {
        if (!midi || !midi.tracks || midi.tracks.length === 0 || !midi.tracks.some(t => t.notes.length > 0)) {
            this.ui.showMessage('Cannot download empty MIDI file.', 'warning');
            return;
        }
        
        try {
            const midiArray = midi.toArray();
            if (!midiArray || midiArray.length === 0) throw new Error('Generated MIDI array is empty');
            
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
            const message = (downloadError instanceof Error) ? downloadError.message : String(downloadError);
            this.ui.showMessage(`Failed to create download file: ${message || 'Unknown error'}`, 'error');
        }
    }
    
    async downloadIndividualTracksAsZip(sanitizeFn) {
        this.ui.showLoading('Creating ZIP file of individual tracks...');
        try {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            
            const musicalContext = this.musicalContextManager.getContext();
            const bpm = musicalContext?.tempo || 120;
            const mixerSettings = undefined; // removed

            const tracksToInclude = Array.from(this.generatedTracks.keys()); // include all

            if (tracksToInclude.length === 0) {
                this.ui.showMessage('No tracks are audible to include in the ZIP file. (Check mute/solo buttons)', 'warning');
                return;
            }

            // 1. Add individual tracks
            for (const trackType of tracksToInclude) {
                const trackData = this.generatedTracks.get(trackType);
                if (trackData?.midi?.tracks?.[0]?.notes.length > 0) {
                    // Create a MIDI object containing only this one track (necessary for proper MIDI formatting)
                    const singleTrackMidi = MidiBuilder.createCombinedMidi(new Map([[trackType, trackData]]), bpm);
                    const filename = sanitizeFn(this.compositionTitle ? `${this.compositionTitle} - ${trackType}` : trackType);
                    zip.file(`${filename}.mid`, singleTrackMidi.toArray());
                }
            }

            // 2. Add the combined multi-track MIDI file
            const combinedMidi = MidiBuilder.createCombinedMidi(this.generatedTracks, bpm);
            const combinedFilename = sanitizeFn(this.compositionTitle || 'combined-tracks');
            
            if (combinedMidi && combinedMidi.tracks.some(t => t.notes.length > 0)) {
                zip.file(`${combinedFilename}-MULTITRACK.mid`, combinedMidi.toArray());
            }

            // 3. Include the raw JSON data file in the zip
            const rawJsonContent = this.jsonVariations.sourceJson;
            if (rawJsonContent) {
                const rawJsonFilename = sanitizeFn(this.compositionTitle || 'composition') + '-raw-data.txt';
                zip.file(rawJsonFilename, rawJsonContent);
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const zipFilename = `${sanitizeFn(this.compositionTitle || 'composition')}-tracks.zip`;
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = zipFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            
            this.ui.showMessage('ZIP file downloaded successfully!', 'success');
        } catch (error) {
            console.error('Failed to create ZIP:', error);
            this.ui.showMessage(`Failed to create ZIP file: ${error.message}`, 'error');
        } finally {
            this.ui.hideLoading();
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
        
        // Reset form to its initial state
        this.switchMode('text');
        document.getElementById('text-prompt').value = '';
        
        // Reset track type checkboxes to default (bassline checked)
        document.querySelectorAll('input[name="track-type"]').forEach(cb => {
            cb.checked = cb.value === 'bassline';
        });

        // Reset all form controls to their default values
        document.getElementById('style').value = 'house';
        document.getElementById('mood').value = 'mysterious';
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

    async updateTracksForGenre() {
        const { GENRE_TRACK_RECOMMENDATIONS } = await import('./config.js');
        const selectedGenre = document.getElementById('style').value;
        const recommendedTracks = GENRE_TRACK_RECOMMENDATIONS[selectedGenre] || [];
        
        // Uncheck all track types
        document.querySelectorAll('input[name="track-type"]').forEach(cb => {
            cb.checked = false;
        });
        
        // Check only the recommended ones (up to 5)
        let checked = 0;
        for (const track of recommendedTracks) {
            if (checked >= 5) break;
            const checkbox = document.querySelector(`input[name="track-type"][value="${track}"]`);
            if (checkbox) {
                checkbox.checked = true;
                checked++;
            }
        }
        
        this.ui.showMessage(`✓ Tracks updated for ${selectedGenre}`, 'success');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});
