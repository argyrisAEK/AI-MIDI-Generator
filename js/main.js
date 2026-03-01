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
        
        // 🔥 FIX: Add updateFreeGenerations method to UI
        this.ui.updateFreeGenerations = (n) => this.updateFreeGenerationsDisplay(n);
        
        this.visualizer = new Visualizer(this.audioEngine, this);
        this.musicalContextManager = new MusicalContext();
        this.jsonVariations = new JSONVariations(this);
        this.tutorialManager = new TutorialManager(this);
        
        // 🔥 FIX: Ensure generatedTracks is always a Map
        this.generatedTracks = new Map();
        this.compositionTitle = '';
        this.compositionDescription = '';

        this.downloadOptionsModal = safeGetElement('download-options-modal');
        
        this.initializeEventListeners();
        this.setupPageLifecycle();
        this.updateDurationTooltip();
        this.initializeTutorial();
        this.initOAuthCallback();
        this.checkByopStatus();
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

    // FIX: Better race condition prevention
    async ensureAudioEngine() {
        if (this.audioEngine) {
            return this.audioEngine;
        }

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

            // 🔥 FIX: Hide generate button only in variations tab
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

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔥 MAIN GENERATION - ΧΡΗΣΙΜΟΠΟΙΕΙΤΑΙ ΚΑΙ ΑΠΟ ΤΟ VARIATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

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

            const { tracks: generatedMidisMap, compositionTitle, compositionDescription, rawJson } =
                await generateMultiTrackMIDIFromAPI(musicalContext, this.ui, selectedTrackTypes);
            
            // 🔥 FIX: Store as Map
            this.generatedTracks = generatedMidisMap;
            this.compositionTitle = compositionTitle;
            this.compositionDescription = compositionDescription;
            
            // Update visualizer
            this.visualizer.compositionTitle = compositionTitle;
            this.visualizer.compositionDescription = compositionDescription;
            
            // 🔥 FIX: Pass rawJson to variations
            if (rawJson) {
                this.jsonVariations.setSourceComposition(rawJson, { 
                    title: compositionTitle, 
                    explanation: compositionDescription 
                }, musicalContext);
            } else {
                console.warn('No raw JSON returned from generation');
            }

            if (this.generatedTracks.size === 0) {
                throw new Error('No valid musical content was generated. Please try adjusting your prompt or settings.');
            }
            
            const tracksGenerated = Array.from(this.generatedTracks.keys());
            const missingTracks = selectedTrackTypes.filter(t => !tracksGenerated.includes(t));

            // Update visualizer
            this.visualizer.loadNotes(
                this.generatedTracks,
                this.compositionTitle,
                this.compositionDescription
            );
            
            // 🔥 FIX: Ensure track selectors are updated
            this.visualizer.updateTrackSelectors();

            this.ui.updateButtonStates(true);
            
            let successMessage = `✓ Successfully created: ${tracksGenerated.join(', ')}`;
            if (missingTracks.length > 0) {
                successMessage += `\n⚠️ Could not generate: ${missingTracks.join(', ')}`;
            }
            this.ui.showMessage(successMessage, 'success');

        } catch (error) {
            console.error('Generation Error:', error);
            this.ui.updateButtonStates(false);

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
            this.generatedTracks = new Map(); // 🔥 FIX: Always use Map
            this.compositionTitle = '';
            this.compositionDescription = '';
        } catch (error) {
            console.error('Error clearing generated tracks:', error);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BYOP (Bring Your Own Pollen)
    // ═══════════════════════════════════════════════════════════════════════════════

    checkByopStatus() {
        this.updateByopBadge();
    }


        initOAuthCallback() {
        try {
            const hash = window.location.hash;
            if (!hash || !hash.includes('api_key=')) {
                console.log('[BYOP] No api_key in hash, skipping OAuth callback');
                return;
            }

            const hashContent = hash.substring(1);
            const apiKeyMatch = hashContent.match(/api_key=([^&]+)/);
            
            if (!apiKeyMatch || !apiKeyMatch[1]) {
                console.warn('[BYOP] No api_key found in hash fragment');
                return;
            }
            
            const apiKey = decodeURIComponent(apiKeyMatch[1]);

            if (!apiKey.startsWith('sk_')) {
                console.warn('[BYOP] Invalid API key format');
                return;
            }

            localStorage.setItem('byop_pollinations_key', apiKey);

            const remainingHash = hashContent.replace(/api_key=[^&]+&?/, '').replace(/&$/, '');
            const newHash = remainingHash ? `#${remainingHash}` : '';
            const newUrl = window.location.pathname + window.location.search + newHash;
            
            window.history.replaceState({}, document.title, newUrl);

            this.ui.showMessage('✅ Pollinations key saved! You can now generate unlimited tracks.', 'success');
            console.log('[BYOP] OAuth key received and saved from hash fragment');

            this.updateByopBadge();
            
        } catch (e) {
            console.warn('[BYOP] OAuth callback error:', e);
        }
    }

    /**
     * Ενιαία συνάρτηση ενημέρωσης badge — single source of truth.
     * Καλείται από: checkByopStatus(), updateFreeGenerations() (UI callback), OAuth callback.
     * @param {number|null} remaining - αριθμός δωρεάν generations που απομένουν (null = άγνωστο)
     */
    updateByopBadge(remaining = null) {
        try {
            const hasKey = localStorage.getItem('byop_pollinations_key');
            const badge = document.getElementById('free-gen-badge');
            const subtext = document.getElementById('byop-subtext');

            if (hasKey) {
                if (badge) {
                    badge.innerHTML = '🔓 BYOP Active';
                    badge.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                    badge.style.color = 'white';
                    badge.style.fontWeight = '600';
                    badge.style.padding = '4px 12px';
                    badge.style.borderRadius = '20px';
                    badge.style.border = '1px solid transparent';
                }
                if (subtext) subtext.style.display = 'none';
            } else {
                if (badge) {
                    // Αν έχουμε αριθμό remaining από το server, τον εμφανίζουμε
                    const label = (remaining !== null && remaining !== undefined)
                        ? `${remaining} free left this month`
                        : '3 free generations/month';
                    badge.textContent = label;
                    badge.style.background = '#f1f5f9';
                    badge.style.color = '#64748b';
                    badge.style.fontWeight = '600';
                    badge.style.padding = '6px 16px';
                    badge.style.borderRadius = '20px';
                    badge.style.border = '1px solid transparent';
                }
                if (subtext) subtext.style.display = 'inline';
            }
        } catch (e) {
            console.warn('[BYOP] updateByopBadge error:', e);
        }
    }

    // Καλείται από midi-generator-api.js μέσω ui.updateFreeGenerations
    updateFreeGenerationsDisplay(remaining) {
        this.updateByopBadge(remaining);
    }

        showByopModal(resetAt) {
        const existingKey = localStorage.getItem('byop_pollinations_key');
        if (existingKey) {
            this.ui.showMessage('BYOP key already connected! Try generating again.', 'info');
            return;
        }

        document.getElementById('byop-modal')?.remove();

        const appUrl = encodeURIComponent(window.location.href.split('#')[0]);
        const pollinationsAuthUrl = `https://enter.pollinations.ai/authorize?redirect_url=${appUrl}`;

        let resetText = '';
        if (resetAt) {
            const resetDate = new Date(resetAt);
            resetText = `<br>Resets: <strong>${resetDate.toLocaleDateString()}</strong>`;
        }

        const modal = document.createElement('div');
        modal.id = 'byop-modal';
        modal.style.cssText = `
            position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
            background:rgba(0,0,0,.7);backdrop-filter:blur(6px);
        `;
        modal.innerHTML = `
            <div style="
                background:#1a1a2e;border:1px solid #7c3aed;border-radius:16px;
                padding:32px;max-width:440px;width:90%;color:#e2e8f0;font-family:inherit;
                box-shadow:0 20px 60px rgba(124,58,237,.4);text-align:center;
            ">
                <div style="font-size:2.5rem;margin-bottom:12px;">🌸</div>
                <h2 style="margin:0 0 10px;font-size:1.3rem;color:#a78bfa;">Free Limit Reached</h2>
                <p style="margin:0 0 24px;font-size:.9rem;color:#94a3b8;line-height:1.6;">
                    You've used your <strong style="color:#c4b5fd">free generations</strong> for this period.${resetText}<br>
                    Get a free Pollinations key to continue — takes 10 seconds.
                </p>

                <a href="${pollinationsAuthUrl}" style="
                    display:block;padding:13px 24px;border-radius:10px;
                    background:linear-gradient(135deg,#7c3aed,#4f46e5);
                    color:#fff;text-decoration:none;font-size:1rem;font-weight:600;
                    margin-bottom:12px;transition:opacity .2s;
                " onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
                    🔑 Get My Free Key via Pollinations
                </a>

                <p style="margin:0 0 20px;font-size:.8rem;color:#64748b;line-height:1.5;">
                    You'll be redirected to Pollinations to authorize with GitHub.<br>
                    You'll return here automatically with your key saved.
                </p>

                <button id="byop-cancel" style="
                    padding:8px 20px;border-radius:8px;border:1px solid #312e81;
                    background:transparent;color:#64748b;cursor:pointer;font-size:.82rem;
                ">Maybe later</button>

                <p style="margin:16px 0 0;font-size:.72rem;color:#374151;">
                    🔒 Your key is stored only in your browser — never on our servers
                </p>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('byop-cancel').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { 
            if (e.target === modal) modal.remove(); 
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PLAYBACK & CONTROLS
    // ═══════════════════════════════════════════════════════════════════════════════

    async handlePlay() {
        // 🔥 FIX: Check if Map and has entries
        if (!this.generatedTracks || !(this.generatedTracks instanceof Map) || this.generatedTracks.size === 0) {
            this.ui.showMessage('No tracks available to play. Generate a composition first.', 'warning');
            return;
        }
        
        this.handleStop();

        try {
            await this.ensureAudioEngine();
            await this.audioEngine.start();

            // 🔥 FIX: Πάντα sync το BPM του Tone.Transport με το DOM πριν παίξεις
            const bpm = parseInt(safeGetElement('bpm')?.value, 10) || 120;
            Tone.Transport.bpm.value = bpm;
            
            const activeTrackType = this.visualizer.activeTrackType;

            // 🔥 FIX: Υπολόγισε totalDuration από musicalContext ΚΑΙ fallback από τα πραγματικά notes
            let totalDuration = this.musicalContextManager.calculateTotalDurationInSeconds();
            if (!totalDuration || totalDuration <= 0) {
                let maxTime = 0;
                this.generatedTracks.forEach((trackData) => {
                    const notes = trackData?.midi?.tracks?.[0]?.notes || [];
                    notes.forEach(n => {
                        const end = (n.time || 0) + (n.duration || 0);
                        if (end > maxTime) maxTime = end;
                    });
                });
                totalDuration = maxTime > 0 ? maxTime + 0.5 : 8;
                console.log(`[PLAY] musicalContext duration was 0, using notes-based fallback: ${totalDuration.toFixed(2)}s`);
            }
            
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
        // 🔥 FIX: Check if Map and has entries
        if (!this.generatedTracks || !(this.generatedTracks instanceof Map) || this.generatedTracks.size === 0) {
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

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});
