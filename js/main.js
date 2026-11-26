import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { analyzeAndEnhancePrompt } from './prompt-analyzer.js';
import { getExplicitTrackTypes, extractExplicitPercussionAvoids } from '../lib/track-intent.mjs';
import { getGenreTrackRecommendations } from '../lib/genre-track-recommendations.mjs';
import { generateMultiTrackMIDIFromAPI } from './midi-generator-api.js';
import { SunoStudio } from './suno-prompt.js';
import {
    getByopKey, setByopSession, setByopUser, getByopUser, clearByopSession,
    saveOAuthState, readOAuthState, clearOAuthState, purgeLegacyByopStorage,
    getByopExpiresAt, setByopInitialBudget, getByopInitialBudget
} from './byop-session.js';
import { MusicalContext } from './musical-context.js';
import { JSONVariations } from './json-variations.js';
import { TutorialManager } from './tutorial.js';
import { ProDemosManager } from './pro-demos.js';
import { MidiBuilder } from './midi-builder.js';
import { MidiImportManager } from './midi-import-manager.js';

const DEFAULT_PROGRESSIONS = {
    major: ['I', 'V', 'vi', 'IV'],
    minor: ['i', 'VI', 'III', 'VII'],
    jazz: ['ii7', 'V7', 'Imaj7', 'vi7'],
    pop: ['I', 'V', 'vi', 'IV']
};

// ─────────────────────────────────────────────────────────────
// BYOP OAuth 2.1 – Authorization Code + PKCE helpers
// ─────────────────────────────────────────────────────────────

const BYOP_CLIENT_ID = 'pk_2Of4YNHliSnwikUE';
const BYOP_AUTHORIZE_URL = 'https://enter.pollinations.ai/authorize';
const BYOP_TOKEN_URL = 'https://enter.pollinations.ai/api/oauth/token';
const BYOP_USERINFO_URL = 'https://enter.pollinations.ai/api/oauth/userinfo';
const BYOP_BALANCE_URL = 'https://gen.pollinations.ai/account/balance'; // για budgeted key: το υπόλοιπο του key

function base64UrlEncode(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function generateCodeVerifier() {
    const array = new Uint8Array(32); // 32 bytes → 43 chars base64url (εντός ορίου 43–128)
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(digest);
}

function generateState() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}

let AudioEngine = null;
const loadAudioEngine = async () => {
    if (!AudioEngine) {
        const { AudioEngine: AE } = await import('./audio.js');
        AudioEngine = AE;
    }
    return AudioEngine;
};

// StorageManager – μόνο tutorial flag (το Pollinations key ζει στο byop-session.js / sessionStorage)
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
        // Load opt-in diagnostics only when explicitly requested (?audioDebug=1).
        this.audioDiagnostics = null;
        this.audioDiagnosticsPromise = new URLSearchParams(window.location.search).get('audioDebug') === '1'
            ? import('./audio-diagnostics.js')
                .then(({ AudioDiagnostics }) => {
                    this.audioDiagnostics = new AudioDiagnostics(Tone);
                    return this.audioDiagnostics;
                })
                .catch(error => {
                    console.warn('Audio diagnostics could not be loaded:', error);
                    return null;
                })
            : Promise.resolve(null);
        this.ui = new UIManager(this);

        this.visualizer = new Visualizer(this.audioEngine, this);
        this.musicalContextManager = new MusicalContext();
        this.jsonVariations = new JSONVariations(this);
        this.tutorialManager = new TutorialManager(this);
        this.proDemosManager = new ProDemosManager(this);
        this.midiImportManager = new MidiImportManager(this);

        this.generatedTracks = new Map();
        this.previewSubgenreManuallySelected = false;
        this.trackSelectionManuallyEdited = false;
        this.compositionTitle = '';
        this.compositionDescription = '';

        this.downloadOptionsModal = safeGetElement('download-options-modal');

        this._boundCleanup = this.cleanup.bind(this);
        this._boundVisibilityChange = this.handleVisibilityChange.bind(this);

        this.initializeEventListeners();
        this.restorePromptAfterByop();
        this.setupPageLifecycle();
        this.updateDurationTooltip();
        purgeLegacyByopStorage(); // καθάρισε παλιά localStorage keys / free-tier δεδομένα
        this.handleByopCallback(); // OAuth code + PKCE callback
        this.checkByopStatus();
        this.initByopHeaderButton();

        // Import MIDI feature — injects tab + panel into DOM automatically
        this.midiImportManager.mount();

        // Suno Prompt Studio (MIDI + WAV → Suno title/style/tags/lyrics)
        this.sunoStudio = new SunoStudio(this);
        this.sunoStudio.mount();
        this.updateByopAiControls();
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
            this.audioDiagnostics = await this.audioDiagnosticsPromise;
            this.audioEngine = new AE();
            this.audioEngine.diagnostics = this.audioDiagnostics;
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
            ['download', 'click', () => this.handleDownload()],
            ['reset', 'click', () => this.handleReset()],
            ['reset-edit-tracks', 'click', () => this.handleReset()],
            ['text-tab', 'click', () => this.switchMode('text')],
            ['examples-tab', 'click', () => this.switchMode('examples')],
            ['form-tab', 'click', () => this.switchMode('form')],
            ['variations-tab', 'click', () => this.switchMode('variations')],
            ['import-tab',    'click', () => this.switchMode('import')],
            ['show-tutorial', 'click', () => this.tutorialManager.showTutorial()],
            ['bpm', 'input', () => this.updateDurationTooltip()],
            ['preview-bpm', 'change', () => this.handlePreviewBpmChange()],
            ['play-mode', 'change', () => this.handlePlaybackModeChange()],
            ['time-signature', 'change', () => this.updateDurationTooltip()],
            ['duration', 'change', () => this.updateDurationTooltip()],
            ['style', 'change', () => {
                this.syncPreviewSubgenreWithStyle();
                this.updateTracksForGenre();
                if (this.audioEngine) this.audioEngine.updateGenreSettings();
            }],
            ['audio-style', 'change', () => {
                this.previewSubgenreManuallySelected = Boolean(safeGetElement('audio-style')?.value);
                if (this.audioEngine) this.audioEngine.updateGenreSettings();
            }],
            ['sound-profile-mode', 'change', () => {
                if (this.audioEngine) this.audioEngine.updateGenreSettings();
            }],
            ['text-prompt', 'input', () => {
                this.validateTextPromptLength();
                this.updatePreviewSubgenreFromPrompt(safeGetElement('text-prompt')?.value || '');
            }]
        ];

        listeners.forEach(([id, event, handler]) => {
            safeAddEventListener(id, event, handler);
        });

        // BYOP subtext link → start authorization
        safeAddEventListener('byop-subtext-btn', 'click', async (e) => {
            e.preventDefault();
            if (getByopKey()) return;
            await this.startByopAuthorization();
        });

        // BYOP model selector locked → start authorization
        safeAddEventListener('byop-model-locked-btn', 'click', async (e) => {
            e.preventDefault();
            if (getByopKey()) return;
            await this.startByopAuthorization();
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
        this.updateTracksForGenre();
        this.updateTextPromptCounter();
        this.syncPreviewSubgenreWithStyle();
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
                    this.validateTextPromptLength();
                    this.updatePreviewSubgenreFromPrompt(promptText);
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
                    return;
                }
                this.trackSelectionManuallyEdited = true;
            });
        });
    }

    updateTracksForGenre() {
        if (this.trackSelectionManuallyEdited) return false;

        const genre = safeGetElement('style')?.value;
        const recommendedTracks = getGenreTrackRecommendations(genre);
        if (!recommendedTracks.length) return false;

        document.querySelectorAll('input[name="track-type"]').forEach(checkbox => {
            checkbox.checked = recommendedTracks.includes(checkbox.value);
        });
        return true;
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

        this.updateTextPromptCounter();
    }

    updateTextPromptCounter() {
        const textPromptEl = safeGetElement('text-prompt');
        const counterEl = safeGetElement('text-prompt-char-count');
        if (!textPromptEl || !counterEl) return;

        const MAX_CHARS = 600;
        counterEl.textContent = `${textPromptEl.value.length} / ${MAX_CHARS} characters`;
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
                generateSection.style.display = (mode === 'variations' || mode === 'import') ? 'none' : '';
            }

            const editHint = document.getElementById('edit-hint-banner');
            if (editHint) {
                editHint.style.display = (mode === 'variations' || mode === 'import') ? 'none' : '';
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

    syncPreviewSubgenreWithStyle() {
        const style = safeGetElement('style')?.value;
        const subgenre = safeGetElement('audio-style');
        if (!subgenre) return false;

        // Keep the selector focused on the currently selected broad genre.
        // Every optgroup contains options tagged with the matching style value.
        subgenre.querySelectorAll('optgroup').forEach(group => {
            const firstOption = group.querySelector('option[data-genre]');
            group.hidden = !firstOption || firstOption.dataset.genre !== style;
        });

        const selectedOption = subgenre.selectedOptions?.[0];
        if (
            selectedOption?.dataset?.genre &&
            selectedOption.dataset.genre !== style
        ) {
            subgenre.value = '';
            this.previewSubgenreManuallySelected = false;
            return true;
        }

        return false;
    }

    updatePreviewSubgenreFromPrompt(prompt, preferredSubgenre = '') {
        const subgenreSelect = safeGetElement('audio-style');
        const styleSelect = safeGetElement('style');
        if (!subgenreSelect || !styleSelect || this.previewSubgenreManuallySelected) return false;

        const normalize = value => String(value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');

        const source = normalize(prompt);
        const preferred = normalize(preferredSubgenre);
        const options = [...subgenreSelect.options].filter(option =>
            option.value && option.dataset.genre
        );
        if (!source && !preferred) return false;

        // Prefer a model-detected subgenre, then look for an explicit option name in the prompt.
        let match = preferred
            ? options.find(option =>
                normalize(option.value) === preferred ||
                normalize(option.textContent) === preferred
            )
            : null;

        if (!match && source) {
            const explicitMatches = options
                .filter(option => {
                    const labels = [option.textContent, option.value]
                        .map(normalize)
                        .filter(Boolean);
                    return labels.some(label =>
                        (' ' + source + ' ').includes(' ' + label + ' ')
                    );
                })
                .sort((a, b) => normalize(b.textContent).length - normalize(a.textContent).length);
            match = explicitMatches[0] || null;
        }

        // If the analyzer identifies a close but unsupported label (for example a minor spelling
        // variation), use a conservative edit-distance match within the available selector options.
        if (!match && preferred) {
            const distance = (a, b) => {
                const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
                for (let row = 1; row <= a.length; row++) {
                    let diagonal = previous[0];
                    previous[0] = row;
                    for (let column = 1; column <= b.length; column++) {
                        const above = previous[column];
                        previous[column] = Math.min(
                            previous[column] + 1,
                            previous[column - 1] + 1,
                            diagonal + (a[row - 1] === b[column - 1] ? 0 : 1)
                        );
                        diagonal = above;
                    }
                }
                return previous[b.length];
            };
            const ranked = options
                .filter(option => option.dataset.genre === styleSelect.value)
                .map(option => {
                    const label = normalize(option.textContent);
                    const score = 1 - distance(preferred, label) / Math.max(preferred.length, label.length, 1);
                    return { option, score };
                })
                .sort((a, b) => b.score - a.score);
            // The analyzer has already identified a subgenre; when it is not offered verbatim,
            // choose the closest available option within the same parent genre.
            if (ranked.length) match = ranked[0].option;
        }

        if (!match) return false;

        const parentGenre = match.dataset.genre;
        const genreExists = [...styleSelect.options].some(option => option.value === parentGenre);
        if (genreExists && styleSelect.value !== parentGenre) {
            styleSelect.value = parentGenre;
            this.syncPreviewSubgenreWithStyle();
        }

        // Only select a subgenre belonging to the active parent genre.
        if (match.dataset.genre !== styleSelect.value) return false;
        subgenreSelect.value = match.value;
        this.audioEngine?.updateGenreSettings();
        return true;
    }

    updateUIFromTextPrompt(params) {
        if (!params) return;

        try {
            const keyRoot = String(params.key || 'C').trim().replace(/\s*(?:m|min|minor|major)$/i, '');
            const scaleType = params.scale || (/(?:m|min|minor)$/i.test(String(params.key || '')) ? 'minor' : 'major');

            this.updateField('key', keyRoot);
            this.updateField('scale-type', scaleType);
            this.updateField('bpm', params.bpm);
            this.updateField('duration', params.duration_bars);
            this.updateField('style', params.style);
            this.syncPreviewSubgenreWithStyle();
            this.updatePreviewSubgenreFromPrompt(
                safeGetElement('text-prompt')?.value || '',
                params.subgenre || ''
            );
            this.audioEngine?.updateGenreSettings();
            this.updateField('mood', params.mood);
            this.updateField('rhythmic-complexity', params.rhythmicComplexity);
            this.updateField('time-signature', params.timeSignature);
            this.updateField('structure', params.structure ?? '');

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
        let capturedUserPrompt = '';
        let detectedSubgenre = null;
        let detectedMusicalIntent = null;
        let detectedMustInclude = [];
        let detectedMustAvoid = [];

        // Pollinations Pay μόνο: χωρίς συνδεδεμένο key δεν γίνεται καμία κλήση.
        if (!getByopKey()) {
            this.showByopModal('connect');
            return;
        }

        if (typeof gtag !== 'undefined') {
            gtag('event', 'generate_click', {
                event_category: 'engagement',
                input_mode: activeTab?.dataset?.tab || 'unknown'
            });
        }

        try {
            this.visualizer.showGenerationStatus('Preparing your arrangement…', 'Analyzing your prompt and musical settings.');
            this.ui.showLoading('Analyzing your request...');

            if (isTextMode) {
                const userPrompt = safeGetElement('text-prompt')?.value?.trim();
                if (!userPrompt) {
                    throw new Error('Please enter a description for the MIDI you want to create.');
                }
                capturedUserPrompt = userPrompt;
                const customizeTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);

                try {
                    this.ui.showMessage('Analyzing your creative prompt...', 'loading');
                    const { extractedParams, enhancedPrompt } = await analyzeAndEnhancePrompt(userPrompt, this.ui, customizeTrackTypes);
                    detectedSubgenre = extractedParams.subgenre || null;
                    detectedMusicalIntent = extractedParams.musicalIntent || null;
                    detectedMustInclude = extractedParams.mustInclude || [];
                    detectedMustAvoid = extractedParams.mustAvoid || [];

                    this.updateUIFromTextPrompt(extractedParams);
                    selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);

                    if (selectedTrackTypes.length === 0) {
                        throw new Error('The analysis did not identify any usable tracks. Select tracks in Customize or specify them in Describe.');
                    }

                    enhancedUserPrompt = enhancedPrompt;
                } catch (analysisError) {
                    console.warn('Prompt analysis failed, using original prompt and current controls:', analysisError);
                    this.ui.showMessage('Prompt analysis was unavailable. Continuing with your original description and current track selections.', 'warning');
                    enhancedUserPrompt = userPrompt;
                    detectedMustAvoid = extractExplicitPercussionAvoids(userPrompt);
                    const explicitTrackTypes = getExplicitTrackTypes(userPrompt);
                    selectedTrackTypes = explicitTrackTypes.length
                        ? explicitTrackTypes
                        : customizeTrackTypes;
                    document.querySelectorAll('input[name="track-type"]').forEach(cb => {
                        cb.checked = selectedTrackTypes.includes(cb.value);
                    });
                    if (selectedTrackTypes.length === 0) {
                        this.ui.showMessage('Please select at least one track type or specify tracks in Describe.', 'warning');
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
            this.lastUserPrompt = capturedUserPrompt;      // used by the Suno Prompt Studio
            this.lastEnhancedPrompt = enhancedUserPrompt;

            const musicalContext = this.musicalContextManager.generateContext(selectedTrackTypes);

            // Keep the detected techno subgenre as a compact structured parameter.
            musicalContext.subgenre = isTextMode ? detectedSubgenre : null;
            musicalContext.musicalIntent = isTextMode ? detectedMusicalIntent : null;
            musicalContext.mustInclude = isTextMode ? detectedMustInclude : [];
            musicalContext.mustAvoid = isTextMode ? detectedMustAvoid : [];

            if (enhancedUserPrompt) {
                musicalContext.enhancedPrompt = enhancedUserPrompt;
            }

            musicalContext.duration = parseInt(musicalContext.duration) || 4;
            musicalContext.trackTypes = selectedTrackTypes;

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

            this.visualizer.showGenerationStatus(
                'Composing your MIDI…',
                `Generating ${selectedTrackTypes.length > 1 ? `${selectedTrackTypes.length} harmonized tracks` : `your ${selectedTrackTypes[0]} track`}. This may take a moment.`
            );
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

            if (missingTracks.length) throw new Error(`Missing generated tracks: ${missingTracks.join(', ')}`);

            this.visualizer.hideGenerationStatus();
            const signature = String(musicalContext.timeSignature || document.getElementById('time-signature')?.value || '4/4');
            const signatureMatch = /^(\d+)\/(2|4|8|16)$/.exec(signature);
            const beatsPerBar = signatureMatch ? Number(signatureMatch[1]) * 4 / Number(signatureMatch[2]) : 4;
            const selectedBars = [4, 8].includes(Number(document.getElementById('duration')?.value))
                ? Number(document.getElementById('duration').value)
                : 4;
            this.visualizer.loadNotes(
                this.generatedTracks,
                this.compositionTitle,
                this.compositionDescription,
                selectedBars * beatsPerBar,
                musicalContext.tempo
            );
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


        } catch (error) {
            console.error('Generation Error:', error);
            this.ui.updateButtonStates(false);

            if (error.requiresByop || error.requiresByopReauth || error.insufficientPollen) {
                this.ui.hideLoading();
                if (error.requiresByopReauth) {
                    clearByopSession();
                    this.checkByopStatus();
                    this.showByopModal('expired');
                } else if (error.insufficientPollen) {
                    this.showByopModal('balance');
                } else {
                    this.showByopModal('connect');
                }
                return;
            }

            this.ui.showMessage(`Generation failed: ${error.message}`, 'error');
        } finally {
            this.visualizer.hideGenerationStatus();
            this.ui.hideLoading();
            this.refreshByopBalance(); // η κλήση μόλις χρεώθηκε: ενημέρωσε το υπόλοιπο
        }
    }

    clearGeneratedTracks() {
        try {
            const previewBpmInput = safeGetElement('preview-bpm');
            if (previewBpmInput) previewBpmInput.disabled = true;
            this.generatedTracks = new Map();
            this.compositionTitle = '';
            this.compositionDescription = '';
            this.lastUserPrompt = '';
            this.lastEnhancedPrompt = '';
            this.sunoStudio?.reset();
        } catch (error) {
            console.error('Error clearing generated tracks:', error);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // BYOP – OAuth 2.1 Authorization Code + PKCE
    // ─────────────────────────────────────────────────────────────

    initByopHeaderButton() {
        const btn = document.getElementById('byop-header-btn');
        if (!btn) return;

        btn.addEventListener('click', async (e) => {
            e.preventDefault();

            if (getByopKey()) {
                if (confirm('Disconnect from Pollinations? You will need to reconnect to generate.')) {
                    this.disconnectByop();
                }
                return;
            }

            await this.startByopAuthorization();
        });

        this.updateByopHeaderButton();

        // Ξανα-διάβασε το υπόλοιπο όταν ο χρήστης γυρίσει στο tab (π.χ. μετά από top-up).
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && getByopKey()) this.refreshByopBalance();
        });
    }

    restorePromptAfterByop() {
        try {
            const storageKey = 'byop_pending_text_prompt';
            const prompt = sessionStorage.getItem(storageKey);
            if (prompt === null) return;

            const promptField = document.getElementById('text-prompt');
            if (promptField) {
                promptField.value = prompt;
                promptField.dispatchEvent(new Event('input', { bubbles: true }));
            }
            sessionStorage.removeItem(storageKey);
        } catch (err) {
            console.warn('[BYOP] Could not restore pending prompt:', err);
        }
    }

    async startByopAuthorization() {
        try {
            // Preserve the user's prompt across the full-page Pollinations OAuth redirect.
            // sessionStorage is same-origin and survives navigation away and back in this tab.
            const prompt = document.getElementById('text-prompt')?.value;
            if (typeof prompt === 'string' && prompt.length) {
                sessionStorage.setItem('byop_pending_text_prompt', prompt);
            } else {
                sessionStorage.removeItem('byop_pending_text_prompt');
            }

            // ── 1. PKCE verifier + challenge + state ──
            const codeVerifier = generateCodeVerifier();
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            const state = generateState();

            // sessionStorage (ανά tab), όπως στα επίσημα Pollinations Pay docs.
            saveOAuthState(codeVerifier, state);

            // ── 2. Authorize URL ──
            // Το redirect_uri πρέπει να ταιριάζει ακριβώς με ένα Redirect URI του App Key.
            const redirectUri = window.location.origin + '/';
            const params = new URLSearchParams({
                response_type: 'code',
                client_id: BYOP_CLIENT_ID,
                redirect_uri: redirectUri,
                scope: 'profile usage',
                state: state,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256'
                // Προαιρετικά: models, budget (default 5), expiry (default 7 ημέρες)
            });

            window.location.href = `${BYOP_AUTHORIZE_URL}?${params.toString()}`;
        } catch (err) {
            console.error('[BYOP] Failed to start authorization:', err);
            this.ui.showMessage('Could not start Pollinations authorization. Please try again.', 'error');
        }
    }

    updateByopHeaderButton() {
        const btn = document.getElementById('byop-header-btn');
        const label = document.getElementById('byop-header-label');
        if (!btn || !label) return;

        const hasKey = !!getByopKey();

        if (hasKey) {
            let displayName = 'Connected to Pollinations';
            const info = getByopUser();
            const username = info.preferred_username || info.name;
            if (username) displayName = `Connected · ${username}`;

            label.textContent = displayName;
            btn.classList.remove('byop-inactive');
            btn.style.cursor = 'pointer';
            btn.title = 'Pollinations Pay is active — click to disconnect';
        } else {
            label.textContent = 'Bring Your Own Pollen';
            btn.classList.add('byop-inactive');
            btn.style.cursor = 'pointer';
            btn.title = 'Connect Pollinations Pay — generations use your own Pollen';
        }

        this.updateModelSelector(hasKey);
    }

    updateModelSelector(hasKey) {
        const selector = document.getElementById('model-selector');
        const selectorLocked = document.getElementById('model-selector-locked');

        if (selector) selector.style.display = hasKey ? 'block' : 'none';
        if (selectorLocked) selectorLocked.style.display = hasKey ? 'none' : 'block';

        if (hasKey && selector && !selector.dataset.initialized) {
            selector.dataset.initialized = 'true';

            const modelSelect = document.getElementById('generation-model-select');
            const modelNote = document.getElementById('generation-model-note');
            const modelGroups = {
                standard: [
                    'openai/gpt-6.1-terra',
                    'openai/gpt-6-luna',
                    'openai/gpt-6.1-sol'
                ],
                pro: [
                    'openai/gpt-6.2-sol',
                    'google/gemini-4-neon',
                    'google/gemini-4-argon',
                    'google/gemini-3.8-flash',
                    'anthropic/claude-opus-5.5',
                    'anthropic/claude-sonnet-5.5'
                ]
            };

            const saved = localStorage.getItem('preferred_model');
            const selectedTier = saved === 'pro' ||
                (saved && saved !== 'standard' && saved !== 'default') ? 'pro' : 'standard';

            const populateModels = (tier) => {
                const models = modelGroups[tier];
                if (!modelSelect) return;
                const savedForTier = localStorage.getItem(`preferred_model_${tier}_selection`);
                const selected = models.includes(savedForTier) ? savedForTier : models[0];
                modelSelect.replaceChildren(...models.map(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    return option;
                }));
                modelSelect.value = selected;
                localStorage.setItem('selected_generation_model', selected);
                if (modelNote) {
                    modelNote.textContent = tier === 'pro'
                        ? 'Pro models may consume more Pollen. Only the selected model will be used.'
                        : 'Only the selected model will be used for this generation.';
                }
            };

            selector.querySelectorAll('.model-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.model === selectedTier);
                tab.addEventListener('click', () => {
                    const tier = tab.dataset.model;
                    selector.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    localStorage.setItem('preferred_model', tier);
                    populateModels(tier);
                });
            });

            if (modelSelect) {
                modelSelect.addEventListener('change', () => {
                    const selected = modelSelect.value;
                    const tier = selector.querySelector('.model-tab.active')?.dataset.model || 'standard';
                    localStorage.setItem('selected_generation_model', selected);
                    localStorage.setItem(`preferred_model_${tier}_selection`, selected);
                });
            }

            localStorage.setItem('preferred_model', selectedTier);
            populateModels(selectedTier);
        }
    }

    getSelectedModel() {
        return document.getElementById('generation-model-select')?.value || 'openai/gpt-6.1-terra';
    }

    // ─────────────────────────────────────────────────────────────
    // BYOP – υπόλοιπο budget του key (GET /account/balance)
    // Για budgeted key επιστρέφει το υπόλοιπο του key, χωρίς επιπλέον scope.
    // ─────────────────────────────────────────────────────────────

    async refreshByopBalance({ markAsInitial = false } = {}) {
        const key = getByopKey();
        if (!key) { this.renderByopBalance(null); return; }

        try {
            const res = await fetch(BYOP_BALANCE_URL, { headers: { 'Authorization': `Bearer ${key}` } });
            if (res.status === 401) {
                clearByopSession();
                this.checkByopStatus();
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            const remaining = Number(data.balance);
            if (!Number.isFinite(remaining)) throw new Error('Unexpected balance response');

            // Αν το key δεν έχει budget, το balance είναι ολόκληρο το wallet (accountBalance.total).
            const walletTotal = Number(data.accountBalance?.total);
            const keyHasBudget = !(Number.isFinite(walletTotal) && Math.abs(walletTotal - remaining) < 1e-9);

            if (markAsInitial && keyHasBudget) setByopInitialBudget(remaining);

            this.renderByopBalance({
                remaining,
                initial: keyHasBudget ? getByopInitialBudget() : null,
                keyHasBudget
            });
        } catch (e) {
            console.warn('[BYOP] Could not read balance:', e.message);
            this.renderByopBalance(null); // κρύψε το badge αντί να δείχνεις λάθος νούμερο
        }
    }

    renderByopBalance(state) {
        const badge = document.getElementById('byop-balance-badge');
        if (!badge) return;

        if (!state) { badge.style.display = 'none'; return; }

        const fmt = (n) => {
            if (n > 0 && n < 0.01) return '<0.01';
            return n.toFixed(2).replace(/\.?0+$/, '') || '0';
        };
        const { remaining, initial, keyHasBudget } = state;

        let text = `${fmt(remaining)} Pollen left`;
        if (keyHasBudget && initial && initial >= remaining) text = `${fmt(remaining)} / ${fmt(initial)} Pollen left`;
        if (!keyHasBudget) text = `${fmt(remaining)} Pollen in your wallet`;

        const ratio = initial ? remaining / initial : null;
        let color = '#00B8D4', bg = 'rgba(0, 184, 212, 0.12)', border = 'rgba(0, 184, 212, 0.35)';
        if (remaining <= 0) { color = '#ff6b6b'; bg = 'rgba(255, 107, 107, 0.12)'; border = 'rgba(255, 107, 107, 0.4)'; }
        else if (ratio !== null && ratio < 0.2) { color = '#ffb74d'; bg = 'rgba(255, 183, 77, 0.12)'; border = 'rgba(255, 183, 77, 0.4)'; }

        const expiresAt = getByopExpiresAt();
        const expiryNote = expiresAt ? ` Key expires ${new Date(expiresAt).toLocaleDateString()}.` : '';
        badge.title = `Remaining budget of your Pollinations Pay authorization.${expiryNote} Top up at enter.pollinations.ai`;

        badge.textContent = text;
        badge.style.color = color;
        badge.style.background = bg;
        badge.style.borderColor = border;
        badge.style.display = 'inline-block';
    }

    // Keep AI actions unavailable until this tab has a valid BYOP session.
    updateByopAiControls() {
        const hasKey = !!getByopKey();
        const note = document.getElementById('byop-required-note');
        if (note) note.hidden = hasKey;
        document.querySelectorAll('[data-requires-byop]').forEach(button => {
            if (button.dataset.byopAppDisabled === undefined) button.dataset.byopAppDisabled = String(button.disabled);
            if (button.dataset.byopOriginalTitle === undefined) button.dataset.byopOriginalTitle = button.title || '';
            const appDisabled = button.dataset.byopAppDisabled === 'true';
            const editType = button.id === 'apply-track-edit'
                ? document.getElementById('edit-type')?.value
                : null;
            const isDeterministicEdit = button.id === 'apply-track-edit' &&
                ['transpose_up', 'transpose_down', 'quantize', 'velocity_up', 'velocity_down', 'velocity_normalize', 'note_length'].includes(editType);
            const requiresKey = !isDeterministicEdit;
            button.disabled = (requiresKey && !hasKey) || appDisabled;
            button.setAttribute('aria-disabled', String(button.disabled));
            button.classList.toggle('byop-ai-locked', requiresKey && !hasKey);
            button.title = requiresKey && !hasKey
                ? 'Connect Bring Your Own Pollen first to use this AI feature.'
                : (button.dataset.byopOriginalTitle || '');
        });
    }

    setByopAiButtonReady(buttonOrId, ready) {
        const button = typeof buttonOrId === 'string' ? document.getElementById(buttonOrId) : buttonOrId;
        if (!button) return;
        button.dataset.byopAppDisabled = String(!ready);
        this.updateByopAiControls();
    }

    checkByopStatus() {
        try {
            // Το getByopKey() καθαρίζει μόνο του ληγμένο token.
            const hasKey = !!getByopKey();

            this.updateByopHeaderButton();

            // Υπόλοιπο Pollen (ή απόκρυψη του badge όταν δεν υπάρχει σύνδεση)
            this.refreshByopBalance();
            const subtext = document.getElementById('byop-subtext');
            if (subtext) subtext.style.display = hasKey ? 'none' : 'block';
            this.updateByopAiControls();
        } catch (e) {
            console.warn('[BYOP] Error checking status:', e);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // BYOP – OAuth callback (code + PKCE exchange + userinfo)
    // ─────────────────────────────────────────────────────────────

    async handleByopCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const returnedState = urlParams.get('state');
        const errorParam = urlParams.get('error');

        // Δεν είναι callback – έξοδος
        if (!code && !errorParam) return;

        if (errorParam) {
            console.warn('[BYOP] Authorization returned error:', errorParam);
            this.clearByopOAuthState();
            this.cleanByopUrlParams();
            this.ui.showMessage(`Authorization cancelled: ${errorParam}`, 'warning');
            this.returnToApiPlayground('cancelled');
            return;
        }

        // ── 1. Επικύρωση state (CSRF) + ανάκτηση verifier από sessionStorage ──
        const { codeVerifier, state: storedState } = readOAuthState();

        if (!returnedState || !storedState || returnedState !== storedState) {
            console.warn('[BYOP] State mismatch – possible CSRF. Aborting token exchange.');
            this.ui.showMessage('Authorization failed: invalid state. Please try again.', 'error');
            this.clearByopOAuthState();
            this.cleanByopUrlParams();
            this.returnToApiPlayground('error');
            return;
        }

        if (!codeVerifier) {
            console.warn('[BYOP] Missing code_verifier');
            this.ui.showMessage('Authorization failed: missing PKCE verifier.', 'error');
            this.clearByopOAuthState();
            this.cleanByopUrlParams();
            this.returnToApiPlayground('error');
            return;
        }

        // ── 2. Exchange code → token ──
        try {
            this.ui.showLoading('Finalizing authorization...');

            const redirectUri = window.location.origin + '/';
            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: BYOP_CLIENT_ID,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier
            });

            const response = await fetch(BYOP_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString()
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Token exchange failed (${response.status}): ${errText}`);
            }

            const tokenData = await response.json();
            const accessToken = tokenData.access_token;

            if (!accessToken || !accessToken.startsWith('sk_')) {
                throw new Error('Invalid access token received');
            }

            // ── 3. Αποθήκευση ΜΟΝΟ σε sessionStorage (ζει όσο το tab) ──
            setByopSession(accessToken, tokenData.expires_in);

            // ── 4. Userinfo (μη κρίσιμο) ──
            try {
                const userinfoResp = await fetch(BYOP_USERINFO_URL, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });

                if (userinfoResp.ok) {
                    const userInfo = await userinfoResp.json();
                    console.info('[BYOP] User identified:', userInfo.preferred_username || userInfo.sub);
                    // Μόνο μη-ευαίσθητα πεδία (το email σκόπιμα παραλείπεται).
                    setByopUser({
                        sub: userInfo.sub || null,
                        preferred_username: userInfo.preferred_username || null,
                        name: userInfo.name || null,
                        picture: userInfo.picture || null
                    });
                } else {
                    console.warn('[BYOP] userinfo failed:', userinfoResp.status);
                }
            } catch (err) {
                console.warn('[BYOP] Could not fetch userinfo:', err.message);
            }

            // ── 5. Καθαρισμός PKCE + URL ──
            this.clearByopOAuthState();
            this.cleanByopUrlParams();

            // ── 6. UI ──
            // Το πρώτο υπόλοιπο μετά τη σύνδεση = το budget που ενέκρινε ο χρήστης.
            await this.refreshByopBalance({ markAsInitial: true });
            this.checkByopStatus();
            this.ui.showMessage('Pollinations connected — generations now use your own Pollen.', 'success');

            if (typeof gtag !== 'undefined') {
                gtag('event', 'byop_connected', {
                    event_category: 'monetization',
                    method: 'oauth_pkce'
                });
            }
            this.returnToApiPlayground('connected');

        } catch (err) {
            console.error('[BYOP] Token exchange error:', err);
            this.ui.showMessage(`Authorization failed: ${err.message}`, 'error');
            this.clearByopOAuthState();
            this.cleanByopUrlParams();
            this.returnToApiPlayground('error');
        } finally {
            this.ui.hideLoading();
        }
    }

    returnToApiPlayground(status) {
        try {
            if (sessionStorage.getItem('api_playground_oauth_pending') !== '1') return;
            sessionStorage.removeItem('api_playground_oauth_pending');
            sessionStorage.setItem('api_playground_oauth_result', status);
            window.location.replace('/test-api.html');
        } catch (err) {
            console.warn('[BYOP] Could not return to API playground:', err);
        }
    }

    clearByopOAuthState() {
        clearOAuthState();
    }

    cleanByopUrlParams() {
        try {
            const cleanUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
        } catch (e) {
            console.warn('[BYOP] Failed to clean URL:', e);
        }
    }

    disconnectByop() {
        try {
            clearByopSession();
            this.checkByopStatus();
            this.updateByopHeaderButton();
            this.ui.showMessage('Disconnected from Pollinations.', 'info');
        } catch (e) {
            console.warn('[BYOP] Disconnect failed:', e);
        }
    }

    /**
     * reason: 'connect' (δεν υπάρχει key) | 'balance' (τέλειωσε το Pollen/budget) | 'expired' (ληγμένο/άκυρο key)
     */
    showByopModal(reason = 'connect') {
        if (reason === 'connect' && getByopKey()) {
            this.ui.showMessage('Pollinations is already connected. Try generating again.', 'info');
            return;
        }

        document.getElementById('byop-modal')?.remove();

        const copy = {
            connect: {
                icon: '🌸',
                title: 'Connect Pollinations to generate',
                text: 'Generations run on <strong style="color:var(--accent)">your own Pollen</strong> via Pollinations Pay. You choose the budget and can revoke access at any time.',
                button: 'Connect with Pollinations',
                reconnect: false
            },
            balance: {
                icon: '🪫',
                title: 'Out of Pollen',
                text: 'Your Pollinations key has no Pollen or budget left. Top up at <a href="https://enter.pollinations.ai" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">enter.pollinations.ai</a>, or reconnect and approve a larger budget.',
                button: 'Reconnect with a new budget',
                reconnect: true
            },
            expired: {
                icon: '⏱️',
                title: 'Session expired',
                text: 'Your Pollinations session has expired or was revoked. Reconnect to continue.',
                button: 'Reconnect Pollinations',
                reconnect: true
            }
        }[reason] || null;
        if (!copy) return this.showByopModal('connect');

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
                <div style="font-size:2rem;margin-bottom:12px;">${copy.icon}</div>
                <h2 style="margin:0 0 10px;font-size:1.3rem;color:var(--accent);">${copy.title}</h2>
                <p style="margin:0 0 24px;font-size:.9rem;color:#94a3b8;line-height:1.6;">${copy.text}</p>

                <button id="byop-connect-btn" style="
                    display:block;width:100%;padding:13px 24px;border-radius:10px;
                    background:var(--accent);
                    color:var(--dark-bg);border:none;cursor:pointer;font-size:1rem;font-weight:700;
                    margin-bottom:12px;transition:opacity .2s;
                " onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
                    ${copy.button}
                </button>

                <p style="margin:0 0 20px;font-size:.8rem;color:var(--text-gray-400);line-height:1.5;">
                    You'll be redirected to Pollinations to authorize with GitHub.<br>
                    You'll return here automatically.
                </p>

                <button id="byop-cancel" style="
                    padding:8px 20px;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.1);
                    background:transparent;color:var(--text-gray-400);cursor:pointer;font-size:.82rem;
                ">Not now</button>

                <p style="margin:16px 0 0;font-size:.72rem;color:var(--text-gray-500);">
                    Your key lives only in this browser tab (sessionStorage) — never on our servers
                </p>
            </div>
        `;

        document.body.appendChild(modal);
        document.getElementById('byop-cancel').addEventListener('click', () => modal.remove());

        document.getElementById('byop-connect-btn').addEventListener('click', async () => {
            modal.remove();
            if (copy.reconnect) {
                clearByopSession();
                this.checkByopStatus();
            }
            await this.startByopAuthorization();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    getPreviewBpm() {
        const previewInput = safeGetElement('preview-bpm');
        const fallback = Number(this.visualizer?.compositionBpm) || Number(safeGetElement('bpm')?.value) || 120;
        const requested = Number(previewInput?.value) || fallback;
        return Math.max(40, Math.min(300, Math.round(requested)));
    }

    getExportMetadataSuffix(musicalContext, bpm) {
        const key = String(this.midiImportManager?.importedKey || musicalContext?.key || '').trim();
        const scale = String(this.midiImportManager?.importedScale || musicalContext?.scale || '').trim().toLowerCase();
        let keyLabel = '';

        if (key) {
            if (scale === 'minor') keyLabel = `${key}m`;
            else if (!scale || scale === 'major') keyLabel = key;
            else keyLabel = `${key}-${scale}`;
        }

        return [keyLabel, `${Math.round(Number(bpm) || this.getPreviewBpm())}BPM`]
            .filter(Boolean)
            .join('_');
    }

    handlePreviewBpmChange() {
        const input = safeGetElement('preview-bpm');
        if (!input || input.disabled) return;

        const bpm = this.getPreviewBpm();
        input.value = String(bpm);

        // Tone.Part events are scheduled in seconds. Stop an active preview so
        // the next Play rebuilds the schedule consistently at the new tempo.
        if (this.audioEngine?.isPlaying || this.visualizer?.isVisualizing) {
            this.handleStop();
        }

        this.ui.showMessage(`Preview tempo set to ${bpm} BPM. Press Play to hear the change.`, 'info');
    }

    handlePlaybackModeChange() {
        if (!this.audioEngine?.isPlaying && !this.visualizer?.isVisualizing) return;

        // Apply the newly selected mode to the current track immediately.
        // Restarting from the beginning avoids mixing old loop scheduling with
        // the new one-shot/loop timeline.
        const activeTrackType = this.visualizer?.playingTrackType
            || this.visualizer?.activeTrackType
            || 'all';
        void this.handlePlay(activeTrackType);
    }

    async handlePlay(trackType = null) {
        if (!this.generatedTracks || !(this.generatedTracks instanceof Map) || this.generatedTracks.size === 0) {
            this.ui.showMessage('No tracks available to play. Generate a composition first.', 'warning');
            return;
        }

        const requestedTrackType = trackType || this.visualizer.activeTrackType || 'all';
        if (this.visualizer.activeTrackType !== requestedTrackType) {
            this.visualizer.setActiveTrack(requestedTrackType);
        }

        this.handleStop();

        try {
            await this.ensureAudioEngine();
            this.audioEngine.onTransportStop = () => {
                this.visualizer.stopVisualization();
                this.visualizer.setTrackPlaying(null);
                this.audioDiagnostics?.snapshot('transport-stop');
                const playhead = document.querySelector('.playhead');
                if (playhead) playhead.style.left = '20px';
            };

            const bpm = this.getPreviewBpm();
            Tone.Transport.bpm.value = bpm;

            const activeTrackType = this.visualizer.activeTrackType;

            // Note times are stored in seconds at the arrangement's source tempo.
            // Keep that tempo separate from the user's current playback tempo.
            const compositionBpm = Number(this.visualizer?.compositionBpm) || bpm;
            // Use the Visualizer's arrangement length as the single source of truth.
            // maxTime is expressed in quarter-note beats, so playback duration follows
            // the selected transport BPM without an arbitrary tail or a second estimate.
            let loopDurationBeats = Number(this.visualizer?.maxTime) || 0;
            if (!loopDurationBeats) {
                let sourceDuration = 0;
                this.generatedTracks.forEach((trackData) => {
                    const notes = trackData?.midi?.tracks?.flatMap(track => track.notes || []) || [];
                    notes.forEach(note => {
                        const end = Number(note.time || 0) + Number(note.duration || 0);
                        if (end > sourceDuration) sourceDuration = end;
                    });
                });
                loopDurationBeats = sourceDuration * compositionBpm / 60;
            }
            const beatsPerMeasure = this.visualizer?.getBeatsPerMeasure?.() || 4;
            loopDurationBeats = Math.max(beatsPerMeasure, Math.ceil(loopDurationBeats / beatsPerMeasure) * beatsPerMeasure);
            const totalDuration = loopDurationBeats * 60 / bpm;

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

            this.audioDiagnostics?.beginPlayback({
                engine: this.audioEngine,
                trackTypes: [...tracksToPlay.keys()],
                noteEventsPerLoop: [...tracksToPlay].map(([trackType, trackData]) => ({
                    trackType,
                    count: trackData.midi.tracks[0].notes.length
                })),
                bpm,
                totalDuration,
                loop: shouldLoop
            });

            // Resume Web Audio first, but do not start Transport yet. Starting the
            // clock before Parts are registered can make their first events late.
            await this.audioEngine.start({ startTransport: false });

            tracksToPlay.forEach((trackData, trackType) => {
                this.audioEngine.playNotes(
                    trackData.midi.tracks[0].notes,
                    0,
                    trackType,
                    totalDuration,
                    shouldLoop,
                    compositionBpm,
                    bpm
                );
            });

            if (!shouldLoop && totalDuration > 0) {
                Tone.Transport.scheduleOnce((time) => {
                    this.handleStop(time);
                }, totalDuration + 0.1);
            }

            // All track events are now registered against the same Transport
            // timeline. Start them together with a small scheduling safety offset.
            this.audioEngine.startTransport("+0.05");
            this.visualizer.setTrackPlaying(activeTrackType);
            this.visualizer.startVisualization(shouldLoop ? loopDurationBeats : null);

            this.ui.showMessage(`Playing ${activeTrackType === 'all' ? 'all tracks' : activeTrackType} (${shouldLoop ? 'Loop' : 'Single'})...`, 'success');

        } catch (error) {
            console.error('Playback Error:', error);
            this.ui.showMessage('Playback failed: ' + error.message, 'error');
            this.handleStop();
        }
    }
    handleStop(scheduledTime) {
        try {
            if (this.audioEngine) {
                this.audioEngine.stop(scheduledTime);
                if (scheduledTime === undefined) {
                    this.audioDiagnostics?.snapshot('stop-requested');
                }
            }

            // A Transport callback runs ahead of its scheduled audio time.
            // Let the Transport's actual stop event end the visualization too.
            if (scheduledTime !== undefined) return;

            this.visualizer.setTrackPlaying(null);
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
            const bpm = this.getPreviewBpm();
            const sourceBpm = Number(this.visualizer?.compositionBpm) || bpm;
            const timeSignature = this.visualizer?.compositionTimeSignature || musicalContext?.timeSignature || '4/4';

            const exportSuffix = this.getExportMetadataSuffix(musicalContext, bpm);

            if (type === 'single') {
                const trackData = this.generatedTracks.get(activeTrackType);
                if (!trackData || !trackData.midi) {
                    this.ui.showMessage('Selected track data is not available.', 'error');
                    return;
                }
                midiToDownload = MidiBuilder.createCombinedMidi(new Map([[activeTrackType, trackData]]), bpm, timeSignature, sourceBpm);
                filename = sanitizeFilename(`${this.compositionTitle || 'composition'}_${activeTrackType}_${exportSuffix}`);
            } else {
                midiToDownload = MidiBuilder.createCombinedMidi(this.generatedTracks, bpm, timeSignature, sourceBpm);
                filename = sanitizeFilename(`${this.compositionTitle || 'composition'}_FULL_${exportSuffix}`);
            }

            this.downloadMidiFile(midiToDownload, filename, bpm);

        } catch (error) {
            console.error('Download Error:', error);
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            this.ui.showMessage(`Download failed: ${errorMessage || 'Unknown error occurred'}`, 'error');
        }
    }

    /** Multitrack MIDI as a Blob (used by the Suno Prompt Studio pack for Suno Pro users). */
    getMultitrackMidiBlob() {
        if (!this.generatedTracks?.size) return null;
        const ctx = this.musicalContextManager.getContext();
        const bpm = this.getPreviewBpm();
        const sourceBpm = Number(this.visualizer?.compositionBpm) || bpm;
        const timeSignature = this.visualizer?.compositionTimeSignature || ctx?.timeSignature || '4/4';
        const midi = MidiBuilder.createCombinedMidi(this.generatedTracks, bpm, timeSignature, sourceBpm);
        return midi ? new Blob([midi.toArray()], { type: 'audio/midi' }) : null;
    }

    async downloadMidiFile(midi, filename, exportBpm = null) {
        if (!midi || !midi.tracks || midi.tracks.length === 0 || !midi.tracks.some(t => t.notes.length > 0)) {
            this.ui.showMessage('Cannot download empty MIDI file.', 'warning');
            return;
        }

        try {
            const midiArray = midi.toArray();
            if (!midiArray || midiArray.length === 0) throw new Error('Generated MIDI array is empty');

            const blob = new Blob([midiArray], { type: 'audio/midi' });
            const bpm = Number(exportBpm) || this.getPreviewBpm();

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
                        gtag('event', 'export_midi', { event_category: 'engagement', format: 'single', method: 'save_dialog', bpm });
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
                gtag('event', 'export_midi', { event_category: 'engagement', format: 'single', method: 'fallback', bpm });
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
            const bpm = this.getPreviewBpm();
            const sourceBpm = Number(this.visualizer?.compositionBpm) || bpm;
            const timeSignature = document.getElementById('time-signature')?.value || musicalContext?.timeSignature || '4/4';

            const tracksToInclude = Array.from(this.generatedTracks.keys());

            if (tracksToInclude.length === 0) {
                this.ui.showMessage('No tracks are audible to include in the ZIP file.', 'warning');
                return;
            }

            let trackIndex = 1;
            for (const trackType of tracksToInclude) {
                const trackData = this.generatedTracks.get(trackType);
                if (trackData?.midi?.tracks?.[0]?.notes.length > 0) {
                    const singleTrackMidi = MidiBuilder.createCombinedMidi(new Map([[trackType, trackData]]), bpm, timeSignature, sourceBpm);
                    const prefix = String(trackIndex).padStart(2, '0');
                    const trackLabel = trackType.replace(/[-_]+/g, ' ').toUpperCase().replace(/\s+/g, '_');
                    const exportSuffix = this.getExportMetadataSuffix(musicalContext, bpm);
                    const filename = sanitizeFn(`${prefix}_${this.compositionTitle || 'composition'}_${trackLabel}_${exportSuffix}`);
                    zip.file(`${filename}.mid`, singleTrackMidi.toArray());
                    trackIndex++;
                }
            }

            const combinedMidi = MidiBuilder.createCombinedMidi(this.generatedTracks, bpm, timeSignature, sourceBpm);
            const exportSuffix = this.getExportMetadataSuffix(musicalContext, bpm);
            const combinedFilename = sanitizeFn(`${this.compositionTitle || 'composition'}_FULL_${exportSuffix}`);

            if (combinedMidi && combinedMidi.tracks.some(t => t.notes.length > 0)) {
                zip.file(`00_${combinedFilename}.mid`, combinedMidi.toArray());
            }

            const rawJsonContent = this.jsonVariations.sourceJson;
            if (rawJsonContent) {
                const rawJsonFilename = sanitizeFn(this.compositionTitle || 'composition') + '-raw-data.txt';
                zip.file(rawJsonFilename, rawJsonContent);
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const zipFilename = `${sanitizeFn(this.compositionTitle || 'composition')}_${exportSuffix}_TRACKS.zip`;

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
                        gtag('event', 'export_midi', { event_category: 'engagement', format: 'zip', method: 'save_dialog', bpm, track_count: tracksToInclude.length });
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
                gtag('event', 'export_midi', { event_category: 'engagement', format: 'zip', method: 'fallback', bpm, track_count: tracksToInclude.length });
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
            const previewBpmInput = safeGetElement('preview-bpm');
            if (previewBpmInput) previewBpmInput.value = '120';
            this.jsonVariations.reset();
            this.ui.updateButtonStates(false);

            const downloadBtn = safeGetElement('download');
            if (downloadBtn) {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Export MIDI';
            }

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
            if (textPrompt) {
                textPrompt.value = '';
                this.updateTextPromptCounter();
            }

            if (this.midiImportManager) {
                this.midiImportManager.reset();
            }

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
            this.syncPreviewSubgenreWithStyle();
            this.audioEngine?.updateGenreSettings();

            this.updateDurationTooltip();

            const playMode = safeGetElement('play-mode');
            if (playMode) playMode.value = 'loop';

            this.ui.showMessage('Application reset to initial state.', 'success');

        } catch (error) {
            console.error('Error during reset:', error);
            this.ui.showMessage('Reset failed: ' + error.message, 'error');
        }
    }

}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});
