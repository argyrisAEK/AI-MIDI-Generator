import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { analyzeAndEnhancePrompt } from './prompt-analyzer.js';
import { generateMultiTrackMIDIFromAPI } from './midi-generator-api.js';
import { MusicalContext } from './musical-context.js';
import { JSONVariations } from './json-variations.js';
import { TutorialManager } from './tutorial.js';
import { MidiBuilder } from './midi-builder.js';

// FIX: Default progressions fallback
const DEFAULT_PROGRESSIONS = {
    major: ['I', 'V', 'vi', 'IV'], 
    minor: ['i', 'VI', 'III', 'VII'], 
    jazz: ['ii7', 'V7', 'Imaj7', 'vi7'],
    pop: ['I', 'V', 'vi', 'IV']
};

// Lazy load audio engine
let AudioEngine = null;
const loadAudioEngine = async () => {
    if (!AudioEngine) {
        const { AudioEngine: AE } = await import('./audio.js');
        AudioEngine = AE;
    }
    return AudioEngine;
};

// Safe storage wrapper
class StorageManager {
    static async setTutorialCompleted() {
        try {
            if (typeof window.storage !== 'undefined' && window.storage.set) {
                await window.storage.set('tutorialCompleted', 'true');
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem('tutorialCompleted', 'true');
            }
        } catch (error) {
            console.warn('Storage write failed (non-critical):', error);
        }
    }

    static async getTutorialCompleted() {
        try {
            if (typeof window.storage !== 'undefined' && window.storage.get) {
                const result = await window.storage.get('tutorialCompleted');
                return result?.value === 'true';
            } else if (typeof localStorage !== 'undefined') {
                return localStorage.getItem('tutorialCompleted') === 'true';
            }
        } catch (error) {
            console.warn('Storage read failed (non-critical):', error);
        }
        return false;
    }
}

// Safe DOM element getter
function safeGetElement(id, fallbackValue = null) {
    try {
        const el = document.getElementById(id);
        if (!el) {
            console.warn(`DOM element not found: #${id}`);
            return fallbackValue;
        }
        return el;
    } catch (error) {
        console.error(`Error accessing DOM element #${id}:`, error);
        return fallbackValue;
    }
}

// Safe event listener attachment
function safeAddEventListener(selector, event, handler, useCapture = false) {
    try {
        const element = typeof selector === 'string' 
            ? safeGetElement(selector) 
            : selector;
        
        if (element) {
            element.addEventListener(event, handler, useCapture);
            return true;
        } else {
            console.warn(`Cannot attach event listener: element not found for selector: ${selector}`);
            return false;
        }
    } catch (error) {
        console.error(`Error attaching event listener:`, error);
        return false;
    }
}

class MIDIGeneratorApp {
    constructor() {
        this.audioEngine = null;
        this.audioEngineLoading = false;
        
        this.ui = new UIManager(this);
        // Bridge: midi-generator-api calls ui.updateFreeGenerations(n)
        this.ui.updateFreeGenerations = (n) => this.updateFreeGenerationsDisplay(n);
        this.visualizer = new Visualizer(this.audioEngine, this);
        this.musicalContextManager = new MusicalContext();
        this.jsonVariations = new JSONVariations(this);
        this.tutorialManager = new TutorialManager(this);
        
        this.generatedTracks = new Map();
        this.compositionTitle = '';
        this.compositionDescription = '';

        this.downloadOptionsModal = safeGetElement('download-options-modal');
        
        this.initializeEventListeners();
        this.setupPageLifecycle();
        this.updateDurationTooltip();
        this.initializeTutorial();
    }

    async initializeTutorial() {
        try {
            const completed = await StorageManager.getTutorialCompleted();
            if (!completed) {
                this.tutorialManager.showTutorial();
            }
        } catch (error) {
            console.warn('Tutorial initialization failed:', error);
        }
    }

    // FIXED: Better race condition prevention
    async ensureAudioEngine() {
        if (this.audioEngine) {
            return this.audioEngine;
        }

        // Prevent multiple concurrent loads
        if (this.audioEngineLoading) {
            let attempts = 0;
            while (this.audioEngineLoading && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            if (this.audioEngine) {
                return this.audioEngine;
            }
            throw new Error('Audio engine failed to initialize after timeout');
        }

        this.audioEngineLoading = true;
        
        try {
            const AE = await loadAudioEngine();
            this.audioEngine = new AE();
            this.visualizer.audioEngine = this.audioEngine;
            return this.audioEngine;
        } catch (error) {
            console.error('Failed to load AudioEngine:', error);
            throw new Error('Audio engine initialization failed: ' + error.message);
        } finally {
            this.audioEngineLoading = false;
        }
    }

    initializeEventListeners() {
        const listeners = [
            ['generate', 'click', () => this.handleGenerate()],
            ['play', 'click', () => this.handlePlay()],
            ['stop', 'click', () => this.handleStop()],
            ['download', 'click', () => this.handleDownload()],
            ['reset', 'click', () => this.handleReset()],
            ['text-tab', 'click', () => this.switchMode('text')],
            ['examples-tab', 'click', () => this.switchMode('examples')],
            ['form-tab', 'click', () => this.switchMode('form')],
            ['variations-tab', 'click', () => this.switchMode('variations')],
            ['show-tutorial', 'click', () => this.tutorialManager.showTutorial()],
            ['bpm', 'input', () => this.updateDurationTooltip()],
            ['time-signature', 'change', () => this.updateDurationTooltip()],
            ['duration', 'change', () => this.updateDurationTooltip()],
            ['style', 'change', () => this.updateTracksForGenre()],
            ['text-prompt', 'input', () => this.validateTextPromptLength()]
        ];

        listeners.forEach(([id, event, handler]) => {
            safeAddEventListener(id, event, handler);
        });

        // Download modal listeners
        if (this.downloadOptionsModal) {
            safeAddEventListener('download-multitrack', 'click', () => this.executeDownload('multitrack'));
            safeAddEventListener('download-zip-individual', 'click', () => this.executeDownload('zip'));
            
            const closeButton = this.downloadOptionsModal.querySelector('.close-button');
            if (closeButton) {
                closeButton.addEventListener('click', () => this.hideDownloadOptions());
            }

            window.addEventListener('click', (event) => {
                if (event.target === this.downloadOptionsModal) {
                    this.hideDownloadOptions();
                }
            });
        } else {
            console.warn('Download modal not found');
        }

        this.setupExamplePrompts();
        this.setupTrackTypeSelection();
    }

    setupExamplePrompts() {
        const examplesGrid = safeGetElement('examples-grid');
        if (!examplesGrid) return;

        examplesGrid.addEventListener('click', (e) => {
            if (e.target.classList.contains('example-btn')) {
                const promptText = e.target.dataset.prompt;
                const textPromptEl = safeGetElement('text-prompt');
                if (textPromptEl) {
                    textPromptEl.value = promptText;
                    this.switchMode('text');
                    this.ui.showTooltip('Prompt copied! You can now generate.', e.target);
                }
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

    validateTextPromptLength() {
        const textPromptEl = safeGetElement('text-prompt');
        if (!textPromptEl) return;

        const MAX_CHARS = 600;
        const currentLength = textPromptEl.value.length;

        if (currentLength > MAX_CHARS) {
            textPromptEl.value = textPromptEl.value.substring(0, MAX_CHARS);
            this.ui.showMessage(`Character limit exceeded. Maximum ${MAX_CHARS} characters allowed. Prompt has been trimmed.`, 'warning');
        }
    }

    updateDurationTooltip() {
        const durationInput = safeGetElement('duration');
        if (!durationInput) return;

        try {
            const durationInSeconds = this.musicalContextManager.calculateTotalDurationInSeconds();
            durationInput.title = `Total duration: ${durationInSeconds.toFixed(2)} seconds`;
        } catch (error) {
            console.warn('Error updating duration tooltip:', error);
        }
    }

    setupPageLifecycle() {
        window.addEventListener('beforeunload', () => this.cleanup());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.handleStop();
            }
        });
    }

    cleanup() {
        try {
            this.handleStop();
            if (this.audioEngine) {
                this.audioEngine.dispose();
                this.audioEngine = null;
            }
            if (this.ui && typeof this.ui.dispose === 'function') {
                this.ui.dispose();
            }
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    switchMode(mode) {
        try {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

            const tabBtn = safeGetElement(`${mode}-tab`);
            const tabPanel = safeGetElement(`${mode}-panel`);

            if (tabBtn) tabBtn.classList.add('active');
            if (tabPanel) tabPanel.classList.add('active');

            const generateButton = safeGetElement('generate');
            if (generateButton) {
                generateButton.style.display = mode === 'variations' ? 'none' : 'block';
            }
        } catch (error) {
            console.error(`Error switching to mode ${mode}:`, error);
        }
    }

    updateField(id, value) {
        const el = safeGetElement(id);
        if (!el || value === null || value === undefined) return;

        try {
            if (el.tagName === 'SELECT') {
                const optionExists = [...el.options].some(opt => opt.value === String(value));
                if (optionExists) el.value = value;
            } else {
                el.value = value;
            }
        } catch (error) {
            console.warn(`Error updating field #${id}:`, error);
        }
    }

    updateUIFromTextPrompt(params) {
        if (!params) return;

        try {
            const keyRoot = params.key?.replace('m', '');
            const scaleType = params.key?.includes('m') ? 'minor' : 'major';
            
            this.updateField('key', keyRoot);
            this.updateField('scale-type', scaleType);
            this.updateField('bpm', params.bpm);
            this.updateField('duration', params.duration_bars);
            this.updateField('style', params.style);
            this.updateField('mood', params.mood);
            this.updateField('rhythmic-complexity', params.rhythmicComplexity);
            this.updateField('time-signature', params.timeSignature);
            this.updateField('structure', params.structure);
            
            if (params.trackTypes && Array.isArray(params.trackTypes)) {
                document.querySelectorAll('input[name="track-type"]').forEach(cb => {
                    cb.checked = params.trackTypes.includes(cb.value);
                });
            }
            
            this.updateDurationTooltip();
        } catch (error) {
            console.error('Error updating UI from text prompt:', error);
        }
    }

    async handleGenerate() {
        const activeTab = document.querySelector('.tab-btn.active');
        const isTextMode = activeTab?.dataset?.tab === 'text';
        let selectedTrackTypes;
        let enhancedUserPrompt = '';

        try {
            this.ui.showLoading('Analyzing your request...');

            if (isTextMode) {
                const userPrompt = safeGetElement('text-prompt')?.value?.trim();
                if (!userPrompt) {
                    throw new Error('Please enter a description for the MIDI you want to create.');
                }
                
                try {
                    this.ui.showMessage('Analyzing your creative prompt...', 'loading');
                    const { extractedParams, enhancedPrompt } = await analyzeAndEnhancePrompt(userPrompt, this.ui);
                    
                    // Log the analyzer output for debugging
                    console.log('=== PROMPT ANALYZER OUTPUT ===');
                    console.log('User Input:', userPrompt);
                    console.log('Extracted Params:', extractedParams);
                    console.log('Enhanced Prompt:', enhancedPrompt);
                    console.log('==============================');
                    
                    this.updateUIFromTextPrompt(extractedParams);
                    selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);
                    
                    if (selectedTrackTypes.length === 0) {
                        this.ui.showMessage('No tracks detected in prompt. Adding: melody & bassline', 'info');
                        const melodyCheckbox = safeGetElement('melody-track');
                        const basslineCheckbox = safeGetElement('bassline-track');
                        if (melodyCheckbox) melodyCheckbox.checked = true;
                        if (basslineCheckbox) basslineCheckbox.checked = true;
                        selectedTrackTypes = ['melody', 'bassline'];
                    }
                    
                    // Store enhanced prompt for later use
                    enhancedUserPrompt = enhancedPrompt;
                } catch (analysisError) {
                    console.warn('Prompt analysis failed, using original prompt:', analysisError);
                    selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);
                    if (selectedTrackTypes.length === 0) {
                        this.ui.showMessage('Please select at least one track type or describe your music in text mode', 'warning');
                        throw new Error('No track types selected and auto-detection failed');
                    }
                }
            } else {
                selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);
                if (selectedTrackTypes.length === 0) {
                    throw new Error('Please select at least one track type in the form.');
                }
            }

            this.clearGeneratedTracks();

            const musicalContext = this.musicalContextManager.generateContext(selectedTrackTypes);

            // Add enhanced prompt to musical context
            if (enhancedUserPrompt) {
                musicalContext.enhancedPrompt = enhancedUserPrompt;
            }

            musicalContext.duration = parseInt(musicalContext.duration) || 4;

            if (!musicalContext.chordProgression || musicalContext.chordProgression.length === 0) {
                const scaleKey = musicalContext.scale === 'minor' ? 'minor' : 'major';
                const styleKey = (musicalContext.style || '').toLowerCase();
                
                if (styleKey.includes('jazz')) {
                    musicalContext.chordProgression = DEFAULT_PROGRESSIONS.jazz;
                } else {
                    musicalContext.chordProgression = DEFAULT_PROGRESSIONS[scaleKey] || DEFAULT_PROGRESSIONS.major;
                }
                console.log('Injected fallback chord progression:', musicalContext.chordProgression);
            }

            this.ui.showMessage(`Composing ${selectedTrackTypes.length > 1 ? `${selectedTrackTypes.length} harmonized tracks` : `a ${selectedTrackTypes[0]} track`}...`, 'loading');

            // Prompt is built server-side from musicalContext — no prompt string exposed to client
            const { tracks: generatedMidisMap, compositionTitle, compositionDescription, rawJson } =
                await generateMultiTrackMIDIFromAPI(musicalContext, this.ui, selectedTrackTypes);
            
            generatedMidisMap.forEach((trackData, trackType) => {
                if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                    this.generatedTracks.set(trackType, trackData);
                }
            });
            
            this.compositionTitle = compositionTitle;
            this.compositionDescription = compositionDescription;
            this.visualizer.compositionTitle = compositionTitle;
            this.visualizer.compositionDescription = compositionDescription;
            
            // FIXED: Pass rawJson to variations
            if (rawJson) {
                this.jsonVariations.setSourceComposition(rawJson, { title: compositionTitle, explanation: compositionDescription }, musicalContext);
            } else {
                console.warn('No raw JSON returned from generation');
            }

            if (this.generatedTracks.size === 0) {
                throw new Error('No valid musical content was generated. Please try adjusting your prompt or settings.');
            }
            
            const tracksGenerated = Array.from(this.generatedTracks.keys());
            const missingTracks = selectedTrackTypes.filter(t => !tracksGenerated.includes(t));

            this.visualizer.loadNotes(
                this.generatedTracks,
                this.compositionTitle,
                this.compositionDescription
            );

            this.ui.updateButtonStates(true);
            
            let successMessage = `✓ Successfully created: ${tracksGenerated.join(', ')}`;
            if (missingTracks.length > 0) {
                successMessage += `\n⚠️ Could not generate: ${missingTracks.join(', ')}`;
            }
            this.ui.showMessage(successMessage, 'success');

        } catch (error) {
            console.error('Generation Error:', error);
            this.ui.updateButtonStates(false);

            // Daily limit reached → show BYOP modal instead of generic error
            if (error.requiresByop) {
                this.ui.hideLoading();
                this.showByopModal(error.resetAt);
                return;
            }

            this.ui.showMessage(`Generation failed: ${error.message}`, 'error');
        } finally {
            this.ui.hideLoading();
        }
    }

    clearGeneratedTracks() {
        try {
            this.generatedTracks.clear();
            this.compositionTitle = '';
            this.compositionDescription = '';
        } catch (error) {
            console.error('Error clearing generated tracks:', error);
        }
    }

    // ── BYOP (Bring Your Own Pollen) ─────────────────────────────────────────

    /**
     * Shows a modal asking the user to enter their own Pollinations API key.
     * On save, the key is stored in localStorage and used for all future requests.
     * @param {number} resetAt  Unix timestamp (ms) when the free limit resets.
     */
    showByopModal(resetAt) {
        // Remove existing modal if any
        document.getElementById('byop-modal')?.remove();

        const resetTimeStr = resetAt
            ? new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'midnight UTC';

        const existing = localStorage.getItem('byop_pollinations_key') || '';

        const modal = document.createElement('div');
        modal.id = 'byop-modal';
        modal.style.cssText = `
            position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
            background:rgba(0,0,0,.65);backdrop-filter:blur(4px);
        `;
        modal.innerHTML = `
            <div style="
                background:#1a1a2e;border:1px solid #7c3aed;border-radius:16px;
                padding:32px;max-width:460px;width:90%;color:#e2e8f0;font-family:inherit;
                box-shadow:0 20px 60px rgba(124,58,237,.35);
            ">
                <h2 style="margin:0 0 8px;font-size:1.3rem;color:#a78bfa;">🌸 Daily Limit Reached</h2>
                <p style="margin:0 0 20px;font-size:.9rem;color:#94a3b8;line-height:1.5;">
                    You've used your <strong style="color:#c4b5fd">${FREE_DAILY_LIMIT} free generations</strong> for today.
                    Free quota resets at <strong style="color:#c4b5fd">${resetTimeStr}</strong>.<br><br>
                    Or enter your own <a href="https://enter.pollinations.ai" target="_blank"
                        style="color:#818cf8;text-decoration:underline">Pollinations API key</a>
                    (free to obtain) to continue generating now.
                </p>
                <label style="display:block;font-size:.85rem;color:#94a3b8;margin-bottom:6px;">
                    Your Pollinations API Key
                </label>
                <input id="byop-key-input" type="password" placeholder="sk_... or pk_..."
                    value="${existing}"
                    style="
                        width:100%;box-sizing:border-box;padding:10px 14px;
                        background:#0f0f1a;border:1px solid #4c1d95;border-radius:8px;
                        color:#e2e8f0;font-size:.9rem;outline:none;margin-bottom:16px;
                    "
                />
                <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
                    <button id="byop-cancel" style="
                        padding:8px 18px;border-radius:8px;border:1px solid #4c1d95;
                        background:transparent;color:#94a3b8;cursor:pointer;font-size:.9rem;
                    ">Wait until ${resetTimeStr}</button>
                    <button id="byop-save" style="
                        padding:8px 18px;border-radius:8px;border:none;
                        background:linear-gradient(135deg,#7c3aed,#4f46e5);
                        color:#fff;cursor:pointer;font-size:.9rem;font-weight:600;
                    ">Save Key &amp; Generate</button>
                </div>
                <p style="margin:14px 0 0;font-size:.75rem;color:#475569;">
                    🔒 Your key is stored only in your browser (localStorage) and sent directly to Pollinations.
                    It is never logged or stored on our servers.
                </p>
            </div>
        `;

        // Inject FREE_DAILY_LIMIT as a local value since it's defined in generate.js
        const FREE_DAILY_LIMIT = 3;

        document.body.appendChild(modal);

        document.getElementById('byop-cancel').addEventListener('click', () => modal.remove());

        document.getElementById('byop-save').addEventListener('click', () => {
            const key = document.getElementById('byop-key-input').value.trim();
            if (!key) {
                document.getElementById('byop-key-input').style.border = '1px solid #ef4444';
                return;
            }
            localStorage.setItem('byop_pollinations_key', key);
            modal.remove();
            // Re-trigger generation with the new key
            this.handleGenerate();
        });

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    /**
     * Updates the free generations counter badge in the UI (if it exists).
     * Called by midi-generator-api.js via ui.updateFreeGenerations(n).
     */
    updateFreeGenerationsDisplay(remaining) {
        const badge = document.getElementById('free-gen-badge');
        if (!badge) return;
        badge.textContent = `${remaining} free left today`;
        badge.style.display = remaining > 0 ? 'inline-block' : 'none';
    }

    async handlePlay() {
        if (this.generatedTracks.size === 0) {
            this.ui.showMessage('No tracks available to play. Generate a composition first.', 'warning');
            return;
        }
        
        this.handleStop();

        try {
            await this.ensureAudioEngine();
            await this.audioEngine.start();
            
            const activeTrackType = this.visualizer.activeTrackType;
            const totalDuration = this.musicalContextManager.calculateTotalDurationInSeconds();
            
            const playMode = safeGetElement('play-mode')?.value || 'loop';
            const shouldLoop = playMode === 'loop';

            const tracksToPlay = new Map();
            if (activeTrackType === 'all') {
                this.generatedTracks.forEach((trackData, trackType) => {
                    if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                        tracksToPlay.set(trackType, trackData);
                    }
                });
            } else {
                const trackData = this.generatedTracks.get(activeTrackType);
                if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                    tracksToPlay.set(activeTrackType, trackData);
                }
            }

            if (tracksToPlay.size === 0) {
                this.ui.showMessage('No notes to play for this selection.', 'warning');
                return;
            }

            tracksToPlay.forEach((trackData, trackType) => {
                this.audioEngine.playNotes(
                    trackData.midi.tracks[0].notes, 
                    Tone.now(), 
                    trackType, 
                    totalDuration,
                    shouldLoop
                );
            });
            
            Tone.Transport.scheduleOnce(() => {
                this.visualizer.startVisualization();
            }, 0);
            
            if (!shouldLoop && totalDuration > 0) {
                Tone.Transport.scheduleOnce(() => {
                    this.handleStop();
                }, totalDuration + 0.1);
            }
            
            this.ui.showMessage(`Playing ${activeTrackType === 'all' ? 'all tracks' : activeTrackType} (${shouldLoop ? 'Loop' : 'Single'})...`, 'success');

        } catch (error) {
            console.error('Playback Error:', error);
            this.ui.showMessage('Playback failed: ' + error.message, 'error');
            this.handleStop();
        }
    }

    handleStop() {
        try {
            if (this.audioEngine) {
                this.audioEngine.stop();
            }
            
            this.visualizer.stopVisualization();
            
            const playhead = document.querySelector('.playhead');
            if (playhead) playhead.style.left = '20px';
            this.ui.showMessage('Playback stopped.', 'info');
        } catch (error) {
            console.error('Error stopping playback:', error);
        }
    }

    showDownloadOptions() {
        if (!this.downloadOptionsModal) {
            console.warn('Download modal not found');
            return;
        }

        try {
            this.downloadOptionsModal.classList.add('active');
            document.body.classList.add('no-scroll');
        } catch (error) {
            console.error('Error showing download options:', error);
        }
    }

    hideDownloadOptions() {
        if (!this.downloadOptionsModal) return;

        try {
            this.downloadOptionsModal.classList.remove('active');
            document.body.classList.remove('no-scroll');
        } catch (error) {
            console.error('Error hiding download options:', error);
        }
    }

    handleDownload() {
        if (this.generatedTracks.size === 0) {
            this.ui.showMessage('No tracks available to download.', 'warning');
            return;
        }

        const activeTrackType = this.visualizer.activeTrackType;
        
        if (activeTrackType && activeTrackType !== 'all') {
            this.executeDownload('single');
        } else {
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
            const musicalContext = this.musicalContextManager.getContext();
            const bpm = musicalContext?.tempo || 120;

            if (type === 'single') {
                const trackData = this.generatedTracks.get(activeTrackType);
                if (!trackData || !trackData.midi) {
                    this.ui.showMessage('Selected track data is not available.', 'error');
                    return;
                }
                midiToDownload = MidiBuilder.createCombinedMidi(new Map([[activeTrackType, trackData]]), bpm);
                filename = sanitizeFilename(this.compositionTitle ? `${this.compositionTitle} - ${activeTrackType}` : activeTrackType);
            } else { 
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
            
            this.ui.showMessage('MIDI file downloaded successfully!', 'success');
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

            const tracksToInclude = Array.from(this.generatedTracks.keys());

            if (tracksToInclude.length === 0) {
                this.ui.showMessage('No tracks are audible to include in the ZIP file.', 'warning');
                return;
            }

            for (const trackType of tracksToInclude) {
                const trackData = this.generatedTracks.get(trackType);
                if (trackData?.midi?.tracks?.[0]?.notes.length > 0) {
                    const singleTrackMidi = MidiBuilder.createCombinedMidi(new Map([[trackType, trackData]]), bpm);
                    const filename = sanitizeFn(this.compositionTitle ? `${this.compositionTitle} - ${trackType}` : trackType);
                    zip.file(`${filename}.mid`, singleTrackMidi.toArray());
                }
            }

            const combinedMidi = MidiBuilder.createCombinedMidi(this.generatedTracks, bpm);
            const combinedFilename = sanitizeFn(this.compositionTitle || 'combined-tracks');
            
            if (combinedMidi && combinedMidi.tracks.some(t => t.notes.length > 0)) {
                zip.file(`${combinedFilename}-MULTITRACK.mid`, combinedMidi.toArray());
            }

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
        try {
            this.handleStop();
            
            this.clearGeneratedTracks();
            this.musicalContextManager.generateContext([]); 
            
            this.ui.updateButtonStates(false);
            this.visualizer.reset();
            this.jsonVariations.reset();
            
            this.switchMode('text');
            
            const textPrompt = safeGetElement('text-prompt');
            if (textPrompt) textPrompt.value = '';
            
            document.querySelectorAll('input[name="track-type"]').forEach(cb => {
                cb.checked = cb.value === 'bassline';
            });

            const fields = {
                'style': 'house',
                'mood': 'mysterious',
                'key': 'C',
                'scale-type': 'major',
                'bpm': '120',
                'duration': '4',
                'rhythmic-complexity': 'simple',
                'time-signature': '4/4',
                'structure': ''
            };

            Object.entries(fields).forEach(([id, value]) => {
                this.updateField(id, value);
            });
            
            this.updateDurationTooltip();
            this.ui.showMessage('Application reset to initial state.', 'success');
        } catch (error) {
            console.error('Error during reset:', error);
            this.ui.showMessage('Reset failed: ' + error.message, 'error');
        }
    }

    async updateTracksForGenre() {
        try {
            const { GENRE_TRACK_RECOMMENDATIONS } = await import('./config.js');
            const selectedGenre = document.getElementById('style').value;
            const recommendedTracks = GENRE_TRACK_RECOMMENDATIONS[selectedGenre] || [];
            
            document.querySelectorAll('input[name="track-type"]').forEach(cb => {
                cb.checked = false;
            });
            
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
        } catch (error) {
            console.error('Error updating tracks for genre:', error);
            this.ui.showMessage('Could not update tracks automatically', 'warning');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});
