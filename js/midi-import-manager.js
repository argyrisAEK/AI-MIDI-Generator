/**
 * midi-import-manager.js
 *
 * Adds "Import MIDI" tab to MIDIGeneratorApp.
 *
 * ARCHITECTURE — ταυτόσημη με το υπάρχον σύστημα:
 *   • MIDI parsing: client-side με @tonejs/midi (ήδη dependency)
 *   • Pipe notation: pitch:beat:dur:vel|...  (ίδια μορφή με generate.js)
 *   • Companion generation: καλεί generateMultiTrackMIDIFromAPI
 *     (ίδια συνάρτηση που χρησιμοποιεί το handleGenerate)
 *   • LLM output: ίδιο JSON format → ίδιο parseApiResponse path
 *   • Locked track: φορτώνεται στο generatedTracks με flag locked:true
 */

import { Midi } from '@tonejs/midi';
import { generateMultiTrackMIDIFromAPI } from './midi-generator-api.js';

// ── Constants (mirrors generate.js) ──────────────────────────────────────────

const AVAILABLE_TRACKS = [
    { value: 'bassline',     label: 'Bassline',  icon: '🎸' },
    { value: 'chord',        label: 'Chords',    icon: '🎹' },
    { value: 'melody',       label: 'Melody',    icon: '🎵' },
    { value: 'arpeggio',     label: 'Arpeggio',  icon: '✨' },
    { value: 'lead',         label: 'Lead',      icon: '🎙️' },
    { value: 'plucks',       label: 'Plucks',    icon: '🪕' },
    { value: 'strings',      label: 'Strings',   icon: '🎻' },
    { value: 'keys',         label: 'Keys',      icon: '🎼' },
    { value: 'pad-textures', label: 'Pad',       icon: '🌊' },
    { value: 'brass',        label: 'Brass',     icon: '🎺' },
    { value: 'percs',        label: 'Percs',     icon: '🥁' },
];

const VALID_STYLES = [
    'house','techno','trance','trap','hip-hop','rock','pop','funk',
    'reggae','jazz','disco','classical','ambient','drum-and-bass',
    'synthwave','downtempo','progressive-rock','cinematic'
];

// Track abbreviations — mirrors generate.js trackAbbreviations
const TRACK_ABBR = {
    bassline:'bass', chord:'chd', melody:'mel', arpeggio:'arp',
    lead:'lead', plucks:'plk', strings:'str', keys:'keys',
    guitar:'gtr', 'pad-textures':'pad', brass:'brss', percs:'perc'
};

// ── Key detection (Krumhansl-Schmuckler profiles) ─────────────────────────────

const KEY_PROFILES = {
    major: [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],
    minor: [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]
};
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function detectKey(notes) {
    const pitchClass = new Array(12).fill(0);
    // Use velocity (0–1 from @tonejs/midi) as weight
    notes.forEach(n => { pitchClass[n.midi % 12] += (n.velocity || 0.5); });
    const total = pitchClass.reduce((a, b) => a + b, 1);
    const norm  = pitchClass.map(v => v / total);

    let bestRoot = 0, bestScore = -Infinity, bestMode = 'major';
    for (const [mode, profile] of Object.entries(KEY_PROFILES)) {
        for (let root = 0; root < 12; root++) {
            let score = 0;
            for (let i = 0; i < 12; i++) score += norm[(i + root) % 12] * profile[i];
            if (score > bestScore) { bestScore = score; bestRoot = root; bestMode = mode; }
        }
    }
    // Build key string: "Am", "F#", "Dbm", etc.
    const keyName = NOTE_NAMES[bestRoot] + (bestMode === 'minor' ? 'm' : '');
    return { key: keyName, scale: bestMode };
}

function detectTrackType(notes) {
    if (!notes.length) return 'melody';
    const midis = notes.map(n => n.midi);
    const avg   = midis.reduce((a, b) => a + b, 0) / midis.length;
    const span  = Math.max(...midis) - Math.min(...midis);

    // Polyphony: count notes that start within 0.05 s of each other
    const sorted = [...notes].sort((a, b) => a.time - b.time);
    let simultaneous = 0;
    for (let i = 1; i < sorted.length; i++) {
        if (Math.abs(sorted[i].time - sorted[i - 1].time) < 0.05) simultaneous++;
    }
    const chordRatio = simultaneous / Math.max(notes.length, 1);

    if (avg < 52)                         return 'bassline';
    if (chordRatio > 0.3 && avg < 70)    return 'chord';
    if (avg >= 62 && span > 24)          return 'lead';
    if (notes.length > 30 && span < 20)  return 'arpeggio';
    if (avg >= 48 && avg < 64 && span < 18) return 'pad-textures';
    return 'melody';
}

function estimateBars(notes, bpm) {
    if (!notes.length) return 4;
    const maxTime = Math.max(...notes.map(n => n.time + (n.duration || 0)));
    const beats   = maxTime / (60 / bpm);
    const bars    = Math.ceil(beats / 4);
    if (bars <= 4)  return 4;
    if (bars <= 8)  return 8;
    return 16;
}

// ── Pipe notation conversion ──────────────────────────────────────────────────
// @tonejs/midi note: { midi, time (sec), duration (sec), velocity (0–1) }
// Output format:    "pitch:beat:dur:vel|..."
//   pitch = MIDI integer
//   beat  = start beat (multiples of 0.25)
//   dur   = duration in beats (multiples of 0.25, min 0.25)
//   vel   = 1–9

function notesToPipeNotation(notes, bpm) {
    const spb = 60 / bpm; // seconds per beat
    // Shift so the phrase starts at beat 0
    const firstTime = notes.length ? Math.min(...notes.map(n => n.time)) : 0;
    return notes
        .slice()
        .sort((a, b) => a.time - b.time)
        .map(n => {
            const beat = Math.round(((n.time - firstTime) / spb) * 4) / 4;
            const dur  = Math.max(0.25, Math.round((n.duration / spb) * 4) / 4);
            const vel  = Math.max(1, Math.min(9, Math.round((n.velocity || 0.5) * 9)));
            return `${n.midi}:${beat}:${dur}:${vel}`;
        })
        .join('|');
}

// ── MidiImportManager ─────────────────────────────────────────────────────────

export class MidiImportManager {
    constructor(app) {
        this.app = app;

        // State — populated after a successful import
        this.importedNotation  = null;
        this.importedTrackType = null;
        this.importedKey       = null;
        this.importedScale     = null;
        this.importedBpm       = null;
        this.importedBars      = null;
        this.importedNoteCount = 0;

        this.selectedCompanions = [];
    }

    // ── Public API ────────────────────────────────────────────────────────────

    mount() {
        this._injectStyles();
        this._injectTab();
        this._injectPanel();
        this._bindGlobalDrop();
    }

    reset() {
        this.importedNotation  = null;
        this.importedTrackType = null;
        this.importedKey       = null;
        this.importedScale     = null;
        this.importedBpm       = null;
        this.importedBars      = null;
        this.importedNoteCount = 0;
        this.selectedCompanions = [];

        document.querySelectorAll('.companion-btn').forEach(btn => {
            btn.classList.remove('selected', 'disabled-imported');
            btn.disabled = false;
        });
        ['imp-info', 'imp-overrides', 'imp-companions', 'imp-gen-wrap', 'imp-status']
            .forEach(id => this._show(id, false));
    }

    // ── DOM injection ─────────────────────────────────────────────────────────

    _injectTab() {
        const tabBar = document.querySelector('.tab-bar');
        if (!tabBar || document.getElementById('import-tab')) return;

        const btn = document.createElement('button');
        btn.id          = 'import-tab';
        btn.className   = 'tab-btn';
        btn.dataset.tab = 'import';
        btn.textContent = '⬆ Import MIDI';
        btn.addEventListener('click', () => this.app.switchMode('import'));
        tabBar.appendChild(btn);
    }

    _injectPanel() {
        if (document.getElementById('import-panel')) return;

        const styleOpts = VALID_STYLES
            .map(s => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')}</option>`)
            .join('');

        const companionBtns = AVAILABLE_TRACKS
            .map(t => `
                <button class="companion-btn" data-value="${t.value}" title="${t.label}">
                    <span class="companion-btn-icon">${t.icon}</span>
                    <span class="companion-btn-label">${t.label}</span>
                </button>`).join('');

        const panel = document.createElement('div');
        panel.id        = 'import-panel';
        panel.className = 'tab-panel';
        panel.innerHTML = `
<div class="imp-wrap">

    <!-- Drop zone -->
    <div id="imp-drop" class="imp-drop" tabindex="0" role="button"
         aria-label="Drop a MIDI file here or click to browse">
        <div class="imp-drop-icon">🎹</div>
        <p class="imp-drop-title">Drop a <strong>.mid</strong> file here</p>
        <p class="imp-drop-sub">or <span class="imp-browse">click to browse</span></p>
        <input type="file" id="imp-file" accept=".mid,.midi" hidden>
    </div>

    <!-- Status bar -->
    <div id="imp-status" class="imp-status" hidden></div>

    <!-- Detected track info -->
    <div id="imp-info" class="imp-info" hidden>
        <div class="imp-badge">
            <span id="imp-icon">🎵</span>
            <span id="imp-name">Track</span>
            <span class="imp-locked-badge">🔒 locked</span>
        </div>
        <p id="imp-meta" class="imp-meta"></p>
    </div>

    <!-- Style / BPM / Bars overrides -->
    <div id="imp-overrides" class="imp-overrides" hidden>
        <label class="imp-override-label">Style
            <select id="imp-style">${styleOpts}</select>
        </label>
        <label class="imp-override-label">BPM
            <input id="imp-bpm" type="number" min="40" max="220" step="1" value="120">
        </label>
        <label class="imp-override-label">Bars
            <select id="imp-bars">
                <option value="4">4 bars</option>
                <option value="8">8 bars</option>
                <option value="16">16 bars</option>
            </select>
        </label>
    </div>

    <!-- Companion instrument selector -->
    <div id="imp-companions" class="imp-companions" hidden>
        <p class="imp-companions-title">
            Add companion tracks
            <span class="imp-companions-hint">(select 1–4)</span>
        </p>
        <div class="imp-grid">${companionBtns}</div>
    </div>

    <!-- Generate -->
    <div id="imp-gen-wrap" class="imp-gen-wrap" hidden>
        <button id="imp-gen-btn" class="imp-gen-btn" disabled>
            ✦ Generate Companion Tracks
        </button>
        <p class="imp-gen-hint">
            The imported track stays <strong>untouched</strong>.<br>
            New AI tracks will be generated to fit it.
        </p>
    </div>

</div>`;

        // Insert after the last existing .tab-panel
        const panels = document.querySelectorAll('.tab-panel');
        if (panels.length) {
            panels[panels.length - 1].insertAdjacentElement('afterend', panel);
        } else {
            document.body.appendChild(panel);
        }

        this._bindPanelEvents(panel);
    }

    _bindPanelEvents(panel) {
        const drop   = panel.querySelector('#imp-drop');
        const input  = panel.querySelector('#imp-file');
        const browse = panel.querySelector('.imp-browse');

        drop.addEventListener('click',   () => input.click());
        drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
        browse.addEventListener('click', e => { e.stopPropagation(); input.click(); });

        input.addEventListener('change', e => {
            const f = e.target.files?.[0];
            if (f) this._handleFile(f);
            input.value = '';
        });

        drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag-over'); });
        drop.addEventListener('dragleave', ()  => drop.classList.remove('drag-over'));
        drop.addEventListener('drop', e => {
            e.preventDefault();
            drop.classList.remove('drag-over');
            const f = e.dataTransfer?.files?.[0];
            if (f) this._handleFile(f);
        });

        // Companion button toggle (event delegation)
        panel.querySelector('.imp-grid').addEventListener('click', e => {
            const btn = e.target.closest('.companion-btn');
            if (!btn || btn.disabled) return;
            btn.classList.toggle('selected');
            this._syncCompanions();
        });

        panel.querySelector('#imp-gen-btn').addEventListener('click', () => this._generate());
    }

    _bindGlobalDrop() {
        // Allow dropping anywhere on the page while Import tab is active
        document.addEventListener('dragover', e => { if (this._isActive()) e.preventDefault(); });
        document.addEventListener('drop', e => {
            if (!this._isActive()) return;
            const f = e.dataTransfer?.files?.[0];
            if (f?.name.match(/\.(mid|midi)$/i)) {
                e.preventDefault();
                this._handleFile(f);
            }
        });
    }

    // ── File handling ─────────────────────────────────────────────────────────

    async _handleFile(file) {
        if (!file.name.match(/\.(mid|midi)$/i)) {
            this._status('error', '⚠️ Please select a valid .mid / .midi file.');
            return;
        }

        this._status('loading', `⏳ Parsing <strong>${file.name}</strong>…`);

        try {
            // Parse with @tonejs/midi — same library used throughout the app
            const buffer = await file.arrayBuffer();
            const midi   = new Midi(buffer);

            if (!midi.tracks?.length) throw new Error('No tracks found in MIDI file.');

            // Merge all tracks' notes for analysis; pick the richest track for notation
            const allNotes = midi.tracks.flatMap(t => t.notes);
            if (!allNotes.length) throw new Error('No notes found in MIDI file.');

            // BPM from MIDI header; fall back to 120
            const detectedBpm = Math.round(midi.header?.tempos?.[0]?.bpm || 120);

            // Use the track with the most notes as the primary track
            const primaryTrack = midi.tracks.reduce(
                (best, t) => t.notes.length > best.notes.length ? t : best,
                midi.tracks[0]
            );
            const primaryNotes = primaryTrack.notes;

            // Musical analysis
            const { key, scale } = detectKey(allNotes);
            const trackType      = detectTrackType(primaryNotes);
            const bars           = estimateBars(primaryNotes, detectedBpm);

            // Convert to pipe notation — exact format that generate.js uses
            const notation = notesToPipeNotation(primaryNotes, detectedBpm);

            // Persist state
            this.importedNotation  = notation;
            this.importedTrackType = trackType;
            this.importedKey       = key;
            this.importedScale     = scale;
            this.importedBpm       = detectedBpm;
            this.importedBars      = bars;
            this.importedNoteCount = primaryNotes.length;

            // Pre-fill overrides from detected values
            const bpmEl  = document.getElementById('imp-bpm');
            const barsEl = document.getElementById('imp-bars');
            if (bpmEl)  bpmEl.value  = detectedBpm;
            if (barsEl) barsEl.value = bars;

            // Show info badge
            const trackMeta = AVAILABLE_TRACKS.find(t => t.value === trackType) || { label: trackType, icon: '🎵' };
            document.getElementById('imp-icon').textContent = trackMeta.icon;
            document.getElementById('imp-name').textContent = `${trackMeta.label} (imported)`;
            document.getElementById('imp-meta').textContent =
                `Key: ${key}  ·  BPM: ${detectedBpm}  ·  Bars: ${bars}  ·  Notes: ${primaryNotes.length}`;

            // Load locked track into app visualizer immediately
            this._loadLockedTrack(trackType, midi, detectedBpm);

            // Disable the imported track type in companion selector
            document.querySelectorAll('.companion-btn').forEach(btn => {
                const isImported = btn.dataset.value === trackType;
                btn.disabled = isImported;
                btn.classList.toggle('disabled-imported', isImported);
                if (isImported) btn.classList.remove('selected');
            });

            this._show('imp-info',       true);
            this._show('imp-overrides',  true);
            this._show('imp-companions', true);
            this._show('imp-gen-wrap',   true);
            this._status('success', `✅ <strong>${file.name}</strong> loaded — ${primaryNotes.length} notes, key ${key}`);
            this._syncCompanions();

        } catch (err) {
            console.error('[MidiImport]', err);
            this._status('error', `❌ ${err.message}`);
        }
    }

    // ── Load the imported track as a locked entry in app.generatedTracks ──────

    _loadLockedTrack(trackType, midiObj, bpm) {
        try {
            // Same shape as what midi-generator-api.js → createMidiObject produces
            this.app.generatedTracks.set(trackType, {
                midi:        midiObj,
                title:       AVAILABLE_TRACKS.find(t => t.value === trackType)?.label || trackType,
                description: 'Imported from MIDI file',
                locked:      true   // respected in _generate() — never overwritten
            });

            // Sync BPM input so playback uses the imported tempo
            const bpmInput = document.getElementById('bpm');
            if (bpmInput) bpmInput.value = bpm;

            // Refresh the visualizer — same call path as handleGenerate
            this.app.visualizer.loadNotes(
                this.app.generatedTracks,
                'Imported Track',
                'Loaded from MIDI file'
            );
            this.app.visualizer.updateTrackSelectors();
            this.app.ui.updateButtonStates(true);

        } catch (err) {
            console.error('[MidiImport] loadLockedTrack error:', err);
        }
    }

    // ── Companion generation ──────────────────────────────────────────────────
    // Follows exactly the same flow as handleGenerate in main.js:
    //   buildPromptParams → generateMultiTrackMIDIFromAPI → merge tracks →
    //   visualizer.loadNotes → jsonVariations.setSourceComposition

    async _generate() {
        if (!this.importedNotation || this.selectedCompanions.length === 0) return;

        const style = document.getElementById('imp-style')?.value  || 'house';
        const bpm   = parseInt(document.getElementById('imp-bpm')?.value)  || this.importedBpm || 120;
        const bars  = parseInt(document.getElementById('imp-bars')?.value) || this.importedBars || 4;

        // Companion types to generate (exclude the locked imported type, just in case)
        const companionTypes = this.selectedCompanions.filter(t => t !== this.importedTrackType);
        if (!companionTypes.length) {
            this.app.ui.showMessage('Select at least one companion instrument different from the imported track.', 'warning');
            return;
        }

        // ── enhancedPrompt — injected as INTENT (highest priority) in PromptBuilder
        // Tells the LLM exactly what the imported track is so it writes harmonically
        // and rhythmically compatible companion tracks.
        // Format: plain text, max ~800 chars to stay within the 800-char truncation
        // in analyze.js / generate.js prompt construction.
        const importedAbbr   = TRACK_ABBR[this.importedTrackType] || this.importedTrackType;
        const notationSample = this.importedNotation.length > 500
            ? this.importedNotation.substring(0, 500) + '…'
            : this.importedNotation;

        const enhancedPrompt =
            `LOCKED TRACK — DO NOT output "${importedAbbr}" key in JSON (it is already composed and locked). ` +
            `Reference notation of the imported ${this.importedTrackType} (read-only): ${notationSample}. ` +
            `Generate ONLY the companion tracks: ${companionTypes.map(t => TRACK_ABBR[t] || t).join(', ')}. ` +
            `All companions MUST be harmonically compatible with the locked track: ` +
            `same key (${this.importedKey}), same implied chord progression, ` +
            `complementary register and rhythmic density. Style: ${style}.`;

        // ── promptParams — same shape as musicalContext in handleGenerate
        const promptParams = {
            key:               this.importedKey,
            scale:             this.importedScale,
            scaleType:         this.importedScale,
            bpm,
            duration_bars:     bars,
            duration:          bars,
            style,
            mood:              'groovy',
            trackTypes:        companionTypes,
            rhythmicComplexity:'moderate',
            timeSignature:     '4/4',
            structure:         'verse',
            enhancedPrompt
        };

        try {
            this.app.ui.showLoading('Generating companion tracks…');

            // ── Same call as handleGenerate ──────────────────────────────────
            const { tracks: generatedMap, compositionTitle, compositionDescription, rawJson }
                = await generateMultiTrackMIDIFromAPI(promptParams, this.app.ui, companionTypes);

            // ── Merge: never overwrite locked imported track ──────────────────
            for (const [type, data] of generatedMap.entries()) {
                if (!this.app.generatedTracks.get(type)?.locked) {
                    this.app.generatedTracks.set(type, data);
                }
            }

            this.app.compositionTitle       = compositionTitle || 'Import + Generated';
            this.app.compositionDescription = compositionDescription || '';

            // ── setSourceComposition: same as handleGenerate ─────────────────
            // Inject the locked track notation into the rawJson so Edit Tracks
            // tab can see the full picture including the imported track.
            if (rawJson) {
                let jsonWithLocked = rawJson;
                try {
                    const parsed = JSON.parse(rawJson);
                    parsed.tracks = parsed.tracks || {};
                    parsed.tracks[importedAbbr] = this.importedNotation;
                    parsed.title = compositionTitle || 'Import + Generated';
                    jsonWithLocked = JSON.stringify(parsed, null, 2);
                } catch { /* keep rawJson as-is */ }

                this.app.jsonVariations.setSourceComposition(
                    jsonWithLocked,
                    { title: compositionTitle, explanation: compositionDescription },
                    promptParams
                );
            }

            // ── Visualizer refresh — same as handleGenerate ──────────────────
            this.app.visualizer.loadNotes(
                this.app.generatedTracks,
                this.app.compositionTitle,
                this.app.compositionDescription
            );
            this.app.visualizer.updateTrackSelectors();
            this.app.ui.updateButtonStates(true);
            this.app.ui.hideLoading();
            this.app.ui.showToast(
                `${generatedMap.size} companion track(s) generated! Imported ${this.importedTrackType} preserved. 🔒`,
                'success'
            );
            this.app.ui.showEditHint();

            // ── Optimistic free-gen decrement — same as handleGenerate ────────
            const newRemaining = StorageManager.decrementRemainingGenerations();
            if (newRemaining !== null) this.app.updateFreeGenerationsDisplay(newRemaining);

        } catch (error) {
            console.error('[MidiImport] generation error:', error);
            this.app.ui.hideLoading();
            this.app.ui.updateButtonStates(false);

            if (error.requiresByop || error.requiresByopReauth) {
                if (error.requiresByopReauth) {
                    localStorage.removeItem('byop_pollinations_key');
                    this.app.checkByopStatus();
                }
                this.app.showByopModal(error.resetAt);
            } else {
                this.app.ui.showMessage(`Generation failed: ${error.message}`, 'error');
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _syncCompanions() {
        this.selectedCompanions = Array.from(
            document.querySelectorAll('.companion-btn.selected:not(:disabled)')
        ).map(btn => btn.dataset.value);

        const btn = document.getElementById('imp-gen-btn');
        if (btn) btn.disabled = this.selectedCompanions.length === 0;
    }

    _isActive() {
        return document.getElementById('import-tab')?.classList.contains('active') ?? false;
    }

    _show(id, visible) {
        const el = document.getElementById(id);
        if (el) el.hidden = !visible;
    }

    _status(type, html) {
        const el = document.getElementById('imp-status');
        if (!el) return;
        el.hidden    = false;
        el.className = `imp-status imp-status--${type}`;
        el.innerHTML = html;
    }

    // ── Styles ────────────────────────────────────────────────────────────────

    _injectStyles() {
        if (document.getElementById('imp-styles')) return;
        const s = document.createElement('style');
        s.id = 'imp-styles';
        s.textContent = `
/* ── Import MIDI panel ── */
.imp-wrap {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.25rem 0;
    max-width: 620px;
    margin: 0 auto;
}

/* Drop zone */
.imp-drop {
    border: 2px dashed var(--border-color, #444);
    border-radius: 12px;
    padding: 2.5rem 1.5rem;
    text-align: center;
    cursor: pointer;
    transition: background .2s, border-color .2s;
    user-select: none;
}
.imp-drop:hover,
.imp-drop.drag-over {
    background: var(--surface-hover, rgba(255,255,255,.05));
    border-color: var(--accent, #7c6af0);
}
.imp-drop-icon  { font-size: 2.25rem; pointer-events: none; }
.imp-drop-title { margin: .4rem 0 0; font-size: 1rem; pointer-events: none; }
.imp-drop-sub   {
    margin: .25rem 0 0;
    font-size: .82rem;
    color: var(--text-muted, #888);
    pointer-events: none;
}
.imp-browse {
    color: var(--accent, #7c6af0);
    text-decoration: underline;
    cursor: pointer;
    pointer-events: all;
}

/* Status */
.imp-status { padding: .55rem .9rem; border-radius: 8px; font-size: .88rem; }
.imp-status--loading { background: var(--surface-2, #2a2a3a); color: var(--text-muted, #aaa); }
.imp-status--success { background: rgba(80,200,120,.12); color: #5fc87a; }
.imp-status--error   { background: rgba(220,60,60,.12);  color: #e06060; }

/* Info badge */
.imp-info  { display: flex; flex-direction: column; gap: .3rem; }
.imp-badge { display: flex; align-items: center; gap: .45rem; font-size: .95rem; font-weight: 600; }
.imp-locked-badge {
    margin-left: auto;
    font-size: .7rem;
    font-weight: 400;
    background: rgba(255,210,50,.12);
    color: #f5c842;
    border-radius: 20px;
    padding: .1rem .5rem;
}
.imp-meta { margin: 0; font-size: .78rem; color: var(--text-muted, #888); letter-spacing: .01em; }

/* Overrides */
.imp-overrides {
    display: flex;
    gap: .75rem;
    flex-wrap: wrap;
    background: var(--surface-2, #1e1e2e);
    border-radius: 10px;
    padding: .8rem 1rem;
}
.imp-override-label {
    display: flex;
    flex-direction: column;
    gap: .3rem;
    font-size: .78rem;
    font-weight: 600;
    color: var(--text-muted, #999);
}
.imp-overrides select,
.imp-overrides input {
    padding: .32rem .55rem;
    border-radius: 6px;
    font-size: .88rem;
    border: 1px solid var(--border-color, #444);
    background: var(--surface-3, #252535);
    color: var(--text-primary, #fff);
    min-width: 90px;
}

/* Companion selector */
.imp-companions { display: flex; flex-direction: column; gap: .55rem; }
.imp-companions-title {
    margin: 0;
    font-size: .9rem;
    font-weight: 600;
}
.imp-companions-hint {
    font-weight: 400;
    font-size: .78rem;
    color: var(--text-muted, #888);
}
.imp-grid { display: flex; flex-wrap: wrap; gap: .35rem; }

.companion-btn {
    display: flex;
    align-items: center;
    gap: .3rem;
    padding: .38rem .7rem;
    border-radius: 20px;
    cursor: pointer;
    border: 1px solid var(--border-color, #444);
    background: var(--surface-2, #1e1e2e);
    color: var(--text-primary, #eee);
    font-size: .8rem;
    white-space: nowrap;
    transition: background .15s, border-color .15s;
}
.companion-btn:hover:not(:disabled) {
    border-color: var(--accent, #7c6af0);
    background: var(--surface-hover, #252540);
}
.companion-btn.selected {
    background: var(--accent, #7c6af0);
    border-color: var(--accent, #7c6af0);
    color: #fff;
    font-weight: 600;
}
.companion-btn.disabled-imported,
.companion-btn:disabled {
    opacity: .35;
    cursor: not-allowed;
}
.companion-btn-icon  { font-size: 1rem; }
.companion-btn-label { font-size: .8rem; }

/* Generate */
.imp-gen-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .45rem;
}
.imp-gen-btn {
    width: 100%;
    max-width: 360px;
    padding: .72rem 0;
    border-radius: 30px;
    border: none;
    cursor: pointer;
    font-size: .97rem;
    font-weight: 700;
    background: var(--accent, #7c6af0);
    color: #fff;
    transition: opacity .15s, transform .1s;
}
.imp-gen-btn:hover:not(:disabled) { opacity: .88; transform: translateY(-1px); }
.imp-gen-btn:disabled { opacity: .38; cursor: not-allowed; }
.imp-gen-hint {
    margin: 0;
    font-size: .76rem;
    color: var(--text-muted, #888);
    text-align: center;
    line-height: 1.5;
}
        `;
        document.head.appendChild(s);
    }
}

// ── StorageManager shim ───────────────────────────────────────────────────────
// Mirrors the StorageManager defined in main.js so _generate() can call
// decrementRemainingGenerations() without importing main.js.

const StorageManager = {
    decrementRemainingGenerations() {
        try {
            const raw = localStorage.getItem('free_generations_data');
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (data.remaining > 0) {
                data.remaining--;
                data.timestamp = Date.now();
                localStorage.setItem('free_generations_data', JSON.stringify(data));
                return data.remaining;
            }
        } catch { /* ignore */ }
        return null;
    }
};
