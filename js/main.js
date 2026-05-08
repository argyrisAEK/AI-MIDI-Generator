import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { analyzeAndEnhancePrompt } from './prompt-analyzer.js';
import { generateMultiTrackMIDIFromAPI } from './midi-generator-api.js';
import { MusicalContext } from './musical-context.js';
import { JSONVariations } from './json-variations.js';
import { TutorialManager } from './tutorial.js';
import { ProDemosManager } from './pro-demos.js';
import { MidiBuilder } from './midi-builder.js';

const DEFAULT_PROGRESSIONS = {
    major: ['I', 'V', 'vi', 'IV'],
    minor: ['i', 'VI', 'III', 'VII'],
    jazz: ['ii7', 'V7', 'Imaj7', 'vi7'],
    pop: ['I', 'V', 'vi', 'IV']
};

let AudioEngine = null;
const loadAudioEngine = async () => {
    if (!AudioEngine) {
        const { AudioEngine: AE } = await import('./audio.js');
        AudioEngine = AE;
    }
    return AudioEngine;
};

// ✅ FIX: ΠΛΗΡΗΣ StorageManager με ΟΛΕΣ τις μεθόδους
class StorageManager {
    static async setTutorialCompleted() {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('tutorialCompleted', 'true');
            }
        } catch (error) {
            console.warn('Storage write failed:', error);
        }
    }

    static async getTutorialCompleted() {
        try {
            if (typeof localStorage !== 'undefined') {
                return localStorage.getItem('tutorialCompleted') === 'true';
            }
        } catch (error) {
            console.warn('Storage read failed:', error);
        }
        return false;
    }

    static getUserId() {
        try {
            if (typeof localStorage !== 'undefined') {
                let userId = localStorage.getItem('midi_user_id');
                if (!userId) {
                    userId = 'usr_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2));
                    localStorage.setItem('midi_user_id', userId);
                    console.log('[STORAGE] Created user ID:', userId);
                }
                return userId;
            }
        } catch (error) {
            console.warn('Storage getUserId failed:', error);
        }
        return null;
    }

    static saveRemainingGenerations(remaining, resetAt) {
        try {
            if (typeof localStorage !== 'undefined' && remaining !== undefined) {
                const data = {
                    remaining: remaining,
                    resetAt: resetAt,
                    timestamp: Date.now()
                };
                localStorage.setItem('free_generations_data', JSON.stringify(data));
                console.log('[STORAGE] Saved remaining:', remaining);
            }
        } catch (error) {
            console.warn('Storage save failed:', error);
        }
    }

    static getRemainingGenerations() {
        try {
            if (typeof localStorage !== 'undefined') {
                const dataStr = localStorage.getItem('free_generations_data');
                if (dataStr) {
                    const data = JSON.parse(dataStr);
                    if (data.resetAt && Date.now() > data.resetAt) {
                        localStorage.removeItem('free_generations_data');
                        return { remaining: 10, resetAt: 0 };
                    }
                    return { remaining: data.remaining, resetAt: data.resetAt };
                }
            }
        } catch (error) {
            console.warn('Storage read failed:', error);
        }
        return { remaining: 10, resetAt: 0 };
    }

    static decrementRemainingGenerations() {
        try {
            if (typeof localStorage !== 'undefined') {
                const dataStr = localStorage.getItem('free_generations_data');
                if (dataStr) {
                    const data = JSON.parse(dataStr);
                    if (data.remaining > 0) {
                        data.remaining--;
                        data.timestamp = Date.now();
                        localStorage.setItem('free_generations_data', JSON.stringify(data));
                        console.log('[STORAGE] Decremented to:', data.remaining);
                        return data.remaining;
                    }
                }
            }
        } catch (error) {
            console.warn('Storage decrement failed:', error);
        }
        return null;
    }

    static clearGenerationsData() {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem('free_generations_data');
            }
        } catch (error) {
            console.warn('Storage clear failed:', error);
        }
    }
}

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

function safeAddEventListener(selector, event, handler, useCapture = false) {
    try {
        const element = typeof selector === 'string' ? safeGetElement(selector) : selector;
        if (element) {
            element.addEventListener(event, handler, useCapture);
            return true;
        } else {
            console.warn(`Cannot attach event listener: ${selector}`);
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
        
        this.ui.updateFreeGenerations = (n) => this.updateFreeGenerationsDisplay(n);
        
        this.visualizer = new Visualizer(this.audioEngine, this);
        this.musicalContextManager = new MusicalContext();
        this.jsonVariations = new JSONVariations(this);
        this.tutorialManager = new TutorialManager(this);
        this.proDemosManager = new ProDemosManager(this);
        
        this.generatedTracks = new Map();
        this.compositionTitle = '';
        this.compositionDescription = '';

        this.downloadOptionsModal = safeGetElement('download-options-modal');
        
        this._boundCleanup = this.cleanup.bind(this);
        this._boundVisibilityChange = this.handleVisibilityChange.bind(this);
        
        // Loop engagement tracking
        this.loopCount = 0;
        this.activeLoopEventId = null;
        
        this.initializeEventListeners();
        this.setupPageLifecycle();
        this.updateDurationTooltip();
        this.initializeTutorial();
        this.initOAuthCallback();
        this.checkByopStatus();
        this.initByopHeaderButton();
        
        this.loadRemainingFromStorage();
    }

    loadRemainingFromStorage() {
        const hasByop = localStorage.getItem('byop_pollinations_key');
        if (hasByop) {
            this.updateFreeGenerationsDisplay('BYOP');
            return;
        }
        
        const { remaining, resetAt } = StorageManager.getRemainingGenerations();
        this.updateFreeGenerationsDisplay(remaining, resetAt);
    }

    handleVisibilityChange() {
        if (document.hidden) {
            this.handleStop();
        }
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

    async ensureAudioEngine() {
        if (this.audioEngine) return this.audioEngine;
        if (this.audioEngineLoading) {
            let attempts = 0;
            while (this.audioEngineLoading && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            if (this.audioEngine) return this.audioEngine;
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

        // Pro Demos opened event (if element exists)
        const proDemosBtn = document.querySelector('.pro-demos-btn') || document.getElementById('show-pro-demos');
        if (proDemosBtn) {
            proDemosBtn.addEventListener('click', () => {
                if (typeof gtag !== 'undefined') {
                    gtag('event', 'pro_demos_opened', {
                        event_category: 'engagement'
                    });
                }
            });
        }
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
            this.ui.showMessage(`Character limit exceeded. Maximum ${MAX_CHARS} characters allowed.`, 'warning');
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
        window.addEventListener('beforeunload', this._boundCleanup);
        document.addEventListener('visibilitychange', this._boundVisibilityChange);
    }

    cleanup() {
        try {
            this.handleStop();
            window.removeEventListener('beforeunload', this._boundCleanup);
            document.removeEventListener('visibilitychange', this._boundVisibilityChange);
            
            if (this.audioEngine) {
                this.audioEngine.dispose();
                this.audioEngine = null;
            }
            if (this.visualizer) {
                this.visualizer.reset();
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

            const generateSection = safeGetElement('generate-section');
            if (generateSection) {
                generateSection.style.display = mode === 'variations' ? 'none' : '';
            }

            const editHint = document.getElementById('edit-hint-banner');
            if (editHint) {
                editHint.style.display = mode === 'variations' ? 'none' : '';
            }

            // GA4: variations_opened
            if (mode === 'variations' && typeof gtag !== 'undefined') {
                gtag('event', 'variations_opened', {
                    event_category: 'engagement'
                });
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

        if (typeof gtag !== 'undefined') {
            gtag('event', 'generate_click', {
                event_category: 'engagement',
                input_mode: activeTab?.dataset?.tab || 'unknown'
            });
        }

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
                        this.ui.showMessage('Please select at least one track type', 'warning');
                        throw new Error('No track types selected');
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

            if (!musicalContext.scale || !musicalContext.scaleType) {
                const scaleTypeEl = document.getElementById('scale-type');
                musicalContext.scale = scaleTypeEl?.value || 'major';
                musicalContext.scaleType = musicalContext.scale;
            }

            if (!musicalContext.chordProgression || musicalContext.chordProgression.length === 0) {
                const scaleKey = musicalContext.scale === 'minor' ? 'minor' : 'major';
                const styleKey = (musicalContext.style || '').toLowerCase();
                
                if (styleKey.includes('jazz')) {
                    musicalContext.chordProgression = DEFAULT_PROGRESSIONS.jazz;
                } else {
                    musicalContext.chordProgression = DEFAULT_PROGRESSIONS[scaleKey] || DEFAULT_PROGRESSIONS.major;
                }
            }

            this.ui.showMessage(`Composing ${selectedTrackTypes.length > 1 ? `${selectedTrackTypes.length} harmonized tracks` : `a ${selectedTrackTypes[0]} track`}...`, 'loading');

            const { tracks: generatedMidisMap, compositionTitle, compositionDescription, rawJson } =
                await generateMultiTrackMIDIFromAPI(musicalContext, this.ui, selectedTrackTypes);
            
            if (!(generatedMidisMap instanceof Map)) {
                console.error('API did not return a Map:', generatedMidisMap);
                throw new Error('Invalid response format from API');
            }
            
            this.generatedTracks = generatedMidisMap;
            this.compositionTitle = compositionTitle;
            this.compositionDescription = compositionDescription;
            
            this.visualizer.compositionTitle = compositionTitle;
            this.visualizer.compositionDescription = compositionDescription;
            
            if (rawJson) {
                this.jsonVariations.setSourceComposition(rawJson, { 
                    title: compositionTitle, 
                    explanation: compositionDescription 
                }, musicalContext);
            }

            if (this.generatedTracks.size === 0) {
                throw new Error('No valid musical content was generated.');
            }
            
            const tracksGenerated = Array.from(this.generatedTracks.keys());
            const missingTracks = selectedTrackTypes.filter(t => !tracksGenerated.includes(t));

            this.visualizer.loadNotes(this.generatedTracks, this.compositionTitle, this.compositionDescription);
            this.visualizer.updateTrackSelectors();
            this.ui.updateButtonStates(true);
            
            this.ui.showToast(`Track ready: ${tracksGenerated.join(', ')}`, 'success');
            this.ui.showEditHint();

            if (typeof gtag !== 'undefined') {
                const musicalCtx = this.musicalContextManager.getContext();
                gtag('event', 'generate_success', {
                    event_category: 'engagement',
                    tracks: tracksGenerated.join(','),
                    track_count: tracksGenerated.length,
                    genre: musicalCtx?.style || 'unknown',
                    bpm: musicalCtx?.tempo || 0,
                    input_mode: document.querySelector('.tab-btn.active')?.dataset?.tab || 'unknown'
                });
            }

            const newRemaining = StorageManager.decrementRemainingGenerations();
            if (newRemaining !== null) {
                this.updateFreeGenerationsDisplay(newRemaining);
            }

        } catch (error) {
            console.error('Generation Error:', error);
            this.ui.updateButtonStates(false);

            // GA4: generate_error
            if (typeof gtag !== 'undefined') {
                let errorType = 'unknown';
                if (error.message?.includes('API')) errorType = 'api_error';
                else if (error.message?.includes('No track types')) errorType = 'validation_error';
                else if (error.message?.includes('network')) errorType = 'network_error';
                else if (error.requiresByop) errorType = 'rate_limit';
                else if (error.message?.includes('timeout')) errorType = 'timeout';
                gtag('event', 'generate_error', {
                    event_category: 'error',
                    error_type: errorType,
                    error_message: error.message?.slice(0, 100) || 'unknown'
                });
            }

            if (error.requiresByop || error.requiresByopReauth) {
                this.ui.hideLoading();
                if (error.requiresByopReauth) {
                    localStorage.removeItem('byop_pollinations_key');
                    StorageManager.clearGenerationsData();
                    this.checkByopStatus();
                }
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
            this.generatedTracks = new Map();
            this.compositionTitle = '';
            this.compositionDescription = '';
        } catch (error) {
            console.error('Error clearing generated tracks:', error);
        }
    }

    initByopHeaderButton() {
        const btn = document.getElementById('byop-header-btn');
        if (!btn) return;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const hasKey = localStorage.getItem('byop_pollinations_key');
            if (!hasKey) {
                const cleanUrl = window.location.origin + window.location.pathname;
                window.location.href = `https://enter.pollinations.ai/authorize?redirect_url=${encodeURIComponent(cleanUrl)}&app_key=pk_2Of4YNHliSnwikUE`;
            }
        });

        this.updateByopHeaderButton();
    }

    updateByopHeaderButton() {
        const btn = document.getElementById('byop-header-btn');
        const label = document.getElementById('byop-header-label');
        if (!btn || !label) return;

        const hasKey = localStorage.getItem('byop_pollinations_key');

        if (hasKey) {
            label.textContent = 'Your Pollinations key is active';
            btn.classList.remove('byop-inactive');
            btn.style.cursor = 'default';
            btn.title = 'Your Pollinations key is active — unlimited generations';
        } else {
            label.textContent = 'Bring Your Own Pollen';
            btn.classList.add('byop-inactive');
            btn.style.cursor = 'pointer';
            btn.title = 'Connect your free Pollinations key for unlimited generations';
        }

        this.updateModelSelector(!!hasKey);
    }

    updateModelSelector(hasKey) {
        const selector = document.getElementById('model-selector');
        const selectorLocked = document.getElementById('model-selector-locked');

        if (selector) selector.style.display = hasKey ? 'block' : 'none';
        if (selectorLocked) selectorLocked.style.display = hasKey ? 'none' : 'block';

        if (hasKey && selector && !selector.dataset.initialized) {
            selector.dataset.initialized = 'true';

            const saved = localStorage.getItem('preferred_model') || 'default';
            selector.querySelectorAll('.model-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.model === saved);
                tab.addEventListener('click', () => {
                    selector.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    const model = tab.dataset.model;
                    if (model === 'default') {
                        localStorage.removeItem('preferred_model');
                    } else {
                        localStorage.setItem('preferred_model', model);
                    }
                });
            });
        }
    }

    getSelectedModel() {
        const activeTab = document.querySelector('.model-tab.active');
        return activeTab?.dataset.model || 'default';
    }

    checkByopStatus() {
        try {
            const hasKey = localStorage.getItem('byop_pollinations_key');
            this.updateByopHeaderButton();
            const badge = document.getElementById('free-gen-badge');
            const subtext = document.getElementById('byop-subtext');

            if (hasKey) {
                if (badge) badge.style.display = 'none';
                if (subtext) subtext.style.display = 'none';
                StorageManager.clearGenerationsData();
            } else {
                if (badge) {
                    badge.style.display = 'inline-block';
                    const { remaining, resetAt } = StorageManager.getRemainingGenerations();
                    this.updateFreeGenerationsDisplay(remaining, resetAt);
                }
                if (subtext) subtext.style.display = 'inline';
            }
        } catch (e) {
            console.warn('[BYOP] Error checking status:', e);
        }
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
            StorageManager.clearGenerationsData();

            const remainingHash = hashContent.replace(/api_key=[^&]+&?/, '').replace(/&$/, '');
            const newHash = remainingHash ? `#${remainingHash}` : '';
            const newUrl = window.location.pathname + window.location.search + newHash;
            
            window.history.replaceState({}, document.title, newUrl);

            this.ui.showMessage('Pollinations key saved — unlimited generations unlocked.', 'success');

            if (typeof gtag !== 'undefined') {
                gtag('event', 'byop_connected', {
                    event_category: 'monetization'
                });
            }

            this.checkByopStatus();
            
        } catch (e) {
            console.warn('[BYOP] OAuth callback error:', e);
        }
    }

    updateFreeGenerationsDisplay(remaining, resetAt = null) {
        const badge = document.getElementById('free-gen-badge');
        if (!badge) return;

        const hasByop = localStorage.getItem('byop_pollinations_key');
        if (hasByop) {
            badge.style.display = 'none';
            return;
        }

        badge.style.display = 'inline-block';

        if (remaining === Infinity || remaining === null || remaining === undefined) {
            const stored = StorageManager.getRemainingGenerations();
            remaining = stored.remaining;
            resetAt = stored.resetAt;
        }

        if (resetAt !== null && resetAt !== undefined) {
            StorageManager.saveRemainingGenerations(remaining, resetAt);
        }

        badge.style.transition = 'all 0.4s ease';
        badge.style.fontWeight = '600';
        badge.style.fontSize = '0.9rem';
        badge.style.padding = '8px 20px';
        badge.style.borderRadius = '0.5rem';
        badge.style.letterSpacing = '0.01em';
        badge.style.textTransform = 'none';
        badge.style.display = 'inline-block';

        if (remaining >= 2) {
            badge.textContent = `${remaining} free generations left`;
            badge.style.background = 'rgba(0, 184, 212, 0.12)';
            badge.style.color = '#00B8D4';
            badge.style.border = '1px solid rgba(0, 184, 212, 0.35)';
            badge.style.boxShadow = '0 0 16px rgba(0, 184, 212, 0.15)';
            badge.style.borderRadius = '2rem';
        } else if (remaining === 1) {
            badge.textContent = `${remaining} free generation left`;
            badge.style.background = 'var(--warning)';
            badge.style.color = 'var(--dark-bg)';
            badge.style.border = '1px solid rgba(255,255,255,0.15)';
            badge.style.boxShadow = '0 0 16px rgba(255,183,77,0.3)';
        } else {
            badge.textContent = 'No free generations left';
            badge.style.background = 'var(--error)';
            badge.style.color = 'white';
            badge.style.border = '1px solid rgba(255,255,255,0.15)';
            badge.style.boxShadow = '0 0 16px rgba(229,115,115,0.3)';
        }
    }

    showByopModal(resetAt) {
        const existingKey = localStorage.getItem('byop_pollinations_key');
        if (existingKey) {
            this.ui.showMessage('BYOP key already connected! Try generating again.', 'info');
            return;
        }

        document.getElementById('byop-modal')?.remove();

        const appUrl = encodeURIComponent(window.location.origin + window.location.pathname);
        const pollinationsAuthUrl = `https://enter.pollinations.ai/authorize?redirect_url=${appUrl}&app_key=pk_2Of4YNHliSnwikUE`;

        let resetText = '';
        if (resetAt) {
            const resetDate = new Date(resetAt);
            resetText = `<br>Resets: <strong>${resetDate.toLocaleDateString()}</strong>`;
        }

        const modal = document.createElement('div');
        modal.id = 'byop-modal';
        modal.style.cssText = `
            position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
            background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);
        `;
        modal.innerHTML = `
            <div style="
                background:var(--dark-surface);border:1px solid rgba(84,183,110,0.3);border-radius:0.75rem;
                padding:32px;max-width:440px;width:90%;color:#e2e8f0;font-family:inherit;
                box-shadow:0 10px 25px rgba(0,0,0,0.5);text-align:center;
            ">
                <div style="font-size:2rem;margin-bottom:12px;">🌸</div>
                <h2 style="margin:0 0 10px;font-size:1.3rem;color:var(--accent);">Free Limit Reached</h2>
                <p style="margin:0 0 24px;font-size:.9rem;color:#94a3b8;line-height:1.6;">
                    You've used your <strong style="color:var(--accent)">free generations</strong> for this period.${resetText}<br>
                    Get a free Pollinations key to continue — takes 10 seconds.
                </p>

                <a href="${pollinationsAuthUrl}" id="byop-auth-link" style="
                    display:block;padding:13px 24px;border-radius:10px;
                    background:var(--accent);
                    color:var(--dark-bg);text-decoration:none;font-size:1rem;font-weight:700;
                    margin-bottom:12px;transition:opacity .2s;
                " onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
                    Get My Free Key via Pollinations
                </a>

                <p style="margin:0 0 20px;font-size:.8rem;color:var(--text-gray-400);line-height:1.5;">
                    You'll be redirected to Pollinations to authorize with GitHub.<br>
                    You'll return here automatically with your key saved.
                </p>

                <button id="byop-cancel" style="
                    padding:8px 20px;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.1);
                    background:transparent;color:var(--text-gray-400);cursor:pointer;font-size:.82rem;
                ">Maybe later</button>

                <p style="margin:16px 0 0;font-size:.72rem;color:var(--text-gray-500);">
                    Your key is stored only in your browser — never on our servers
                </p>
            </div>
        `;

        document.body.appendChild(modal);

        // GA4: byop_prompt_shown
        if (typeof gtag !== 'undefined') {
            gtag('event', 'byop_prompt_shown', {
                event_category: 'conversion',
                reset_at: resetAt || null
            });
        }

        const authLink = modal.querySelector('#byop-auth-link');
        if (authLink) {
            authLink.addEventListener('click', () => {
                if (typeof gtag !== 'undefined') {
                    gtag('event', 'byop_link_clicked', {
                        event_category: 'conversion'
                    });
                }
            });
        }

        document.getElementById('byop-cancel').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { 
            if (e.target === modal) modal.remove(); 
        });
    }

    async handlePlay() {
        if (!this.generatedTracks || !(this.generatedTracks instanceof Map) || this.generatedTracks.size === 0) {
            this.ui.showMessage('No tracks available to play. Generate a composition first.', 'warning');
            return;
        }
        
        this.handleStop();

        try {
            await this.ensureAudioEngine();
            await this.audioEngine.start();

            const bpmInput = safeGetElement('bpm');
            const bpm = bpmInput ? parseInt(bpmInput.value, 10) || 120 : 120;
            Tone.Transport.bpm.value = bpm;
            
            const activeTrackType = this.visualizer.activeTrackType;

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

            // GA4: track_played
            if (typeof gtag !== 'undefined') {
                gtag('event', 'track_played', {
                    event_category: 'engagement',
                    active_track_type: activeTrackType,
                    play_mode: playMode,
                    track_count: tracksToPlay.size,
                    loop_duration_beats: shouldLoop ? this.visualizer.maxTime : null
                });
            }

            // Reset loop counter and clear previous loop event
            this.loopCount = 0;
            if (this.activeLoopEventId) {
                Tone.Transport.clear(this.activeLoopEventId);
                this.activeLoopEventId = null;
            }

            tracksToPlay.forEach((trackData, trackType) => {
                this.audioEngine.playNotes(
                    trackData.midi.tracks[0].notes,
                    0,
                    trackType,
                    totalDuration,
                    shouldLoop
                );
            });

            const loopDurationBeats = shouldLoop ? this.visualizer.maxTime : null;
            this.visualizer.startVisualization(loopDurationBeats);

            // Schedule loop counting if looping
            if (shouldLoop && loopDurationBeats && loopDurationBeats > 0) {
                this.activeLoopEventId = Tone.Transport.scheduleRepeat((time) => {
                    this.loopCount++;
                    if (typeof gtag !== 'undefined') {
                        gtag('event', 'track_loop_count', {
                            event_category: 'engagement',
                            loop_number: this.loopCount,
                            active_track_type: activeTrackType
                        });
                    }
                }, `${loopDurationBeats}i`);
            }

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
            if (this.activeLoopEventId) {
                Tone.Transport.clear(this.activeLoopEventId);
                this.activeLoopEventId = null;
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
            return name.replace(/[\/\\?%*:|"<>\n]/g, '-').trim() || 'untitled';
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

            let exportFormat = 'midi';
            if (type === 'multitrack') exportFormat = 'multitrack';
            else if (type === 'single') exportFormat = 'midi';

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
                exportFormat = 'multitrack';
            }
            
            this.downloadMidiFile(midiToDownload, filename, exportFormat, bpm);

        } catch (error) {
            console.error('Download Error:', error);
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            this.ui.showMessage(`Download failed: ${errorMessage || 'Unknown error occurred'}`, 'error');
        }
    }

    async downloadMidiFile(midi, filename, exportFormat = 'midi', bpm = 120) {
        if (!midi || !midi.tracks || midi.tracks.length === 0 || !midi.tracks.some(t => t.notes.length > 0)) {
            this.ui.showMessage('Cannot download empty MIDI file.', 'warning');
            return;
        }
        
        try {
            const midiArray = midi.toArray();
            if (!midiArray || midiArray.length === 0) throw new Error('Generated MIDI array is empty');
            
            const blob = new Blob([midiArray], { type: 'audio/midi' });

            if ('showSaveFilePicker' in window) {
                try {
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: `${filename}.mid`,
                        types: [{
                            description: 'MIDI File',
                            accept: { 'audio/midi': ['.mid', '.midi'] }
                        }]
                    });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    if (typeof gtag !== 'undefined') {
                        gtag('event', 'export_midi', { 
                            event_category: 'engagement', 
                            format: exportFormat, 
                            method: 'save_dialog', 
                            bpm 
                        });
                    }
                    this.ui.showToast(`Saved! Set your DAW to ${bpm} BPM.`, 'success');
                    return;
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.warn('showSaveFilePicker failed, falling back:', err);
                }
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}.mid`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (typeof gtag !== 'undefined') {
                gtag('event', 'export_midi', { 
                    event_category: 'engagement', 
                    format: exportFormat, 
                    method: 'fallback', 
                    bpm 
                });
            }
            this.ui.showToast(`Exported! Set your DAW to ${bpm} BPM.`, 'success');

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

            let trackIndex = 1;
            for (const trackType of tracksToInclude) {
                const trackData = this.generatedTracks.get(trackType);
                if (trackData?.midi?.tracks?.[0]?.notes.length > 0) {
                    const singleTrackMidi = MidiBuilder.createCombinedMidi(new Map([[trackType, trackData]]), bpm);
                    const prefix = String(trackIndex).padStart(2, '0');
                    const trackLabel = trackType.charAt(0).toUpperCase() + trackType.slice(1);
                    const filename = sanitizeFn(this.compositionTitle 
                        ? `${prefix}_${trackLabel}` 
                        : `${prefix}_${trackLabel}`);
                    zip.file(`${filename}.mid`, singleTrackMidi.toArray());
                    trackIndex++;
                }
            }

            const combinedMidi = MidiBuilder.createCombinedMidi(this.generatedTracks, bpm);
            const combinedFilename = sanitizeFn(this.compositionTitle || 'combined-tracks');
            
            if (combinedMidi && combinedMidi.tracks.some(t => t.notes.length > 0)) {
                zip.file(`00_${combinedFilename}-MULTITRACK.mid`, combinedMidi.toArray());
            }

            const rawJsonContent = this.jsonVariations.sourceJson;
            if (rawJsonContent) {
                const rawJsonFilename = sanitizeFn(this.compositionTitle || 'composition') + '-raw-data.txt';
                zip.file(rawJsonFilename, rawJsonContent);
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const zipFilename = `${sanitizeFn(this.compositionTitle || 'composition')}-tracks.zip`;

            if ('showSaveFilePicker' in window) {
                try {
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: zipFilename,
                        types: [{
                            description: 'ZIP Archive',
                            accept: { 'application/zip': ['.zip'] }
                        }]
                    });
                    const writable = await fileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                    if (typeof gtag !== 'undefined') {
                        gtag('event', 'export_midi', { 
                            event_category: 'engagement', 
                            format: 'zip', 
                            method: 'save_dialog', 
                            bpm, 
                            track_count: tracksToInclude.length 
                        });
                    }
                    this.ui.showToast(`Saved! Set your DAW to ${bpm} BPM.`, 'success');
                    return;
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.warn('showSaveFilePicker failed, falling back:', err);
                }
            }

            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = zipFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            if (typeof gtag !== 'undefined') {
                gtag('event', 'export_midi', { 
                    event_category: 'engagement', 
                    format: 'zip', 
                    method: 'fallback', 
                    bpm, 
                    track_count: tracksToInclude.length 
                });
            }
            this.ui.showToast(`Exported! Set your DAW to ${bpm} BPM.`, 'success');
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
            this.visualizer.reset();
            this.jsonVariations.reset();
            this.ui.updateButtonStates(false);
            
            const downloadBtn = safeGetElement('download');
            const playBtn = safeGetElement('play');
            const stopBtn = safeGetElement('stop');
            if (downloadBtn) {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Export MIDI';
            }
            if (playBtn) playBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = true; 
            
            const compositionInfo = safeGetElement('composition-info');
            if (compositionInfo) {
                compositionInfo.innerHTML = '';
                compositionInfo.style.display = 'none';
            }
            
            const trackMetadata = safeGetElement('track-metadata');
            if (trackMetadata) trackMetadata.innerHTML = '';
            const trackSelection = safeGetElement('track-selection');
            if (trackSelection) trackSelection.innerHTML = '';
            const variationsList = safeGetElement('variations-list');
            if (variationsList) variationsList.innerHTML = '';
            
            this.switchMode('text');

            const editHint = document.getElementById('edit-hint-banner');
            if (editHint) editHint.remove();

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
            
            const playMode = safeGetElement('play-mode');
            if (playMode) playMode.value = 'loop';
            
            StorageManager.clearGenerationsData();
            
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

            if (this.audioEngine) {
                this.audioEngine.updateGenreSettings();
            }
            
            this.ui.showMessage(`Tracks updated for ${selectedGenre}.`, 'success');
        } catch (error) {
            console.error('Error updating tracks for genre:', error);
            this.ui.showMessage('Could not update tracks automatically', 'warning');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});
