import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { trackAbbreviations } from './track-config.js';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';
import { MIDIGenerator } from './midi-generator-api.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.setupEventListeners();

        // Reverse map για normalization
        this.reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
        );
    }

    setupEventListeners() {
        const downloadBtn = document.getElementById('download-all-zip');
        const rawInput = document.getElementById('raw-json-input');
        const editTypeSelect = document.getElementById('edit-type');
        const intensitySlider = document.getElementById('intensity-slider');
        const applyEditBtn = document.getElementById('apply-track-edit');

        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadAllAsZip());
        if (rawInput) rawInput.addEventListener('input', (e) => this.handleJsonInputChange(e));

        if (editTypeSelect) {
            editTypeSelect.addEventListener('change', (e) => this.handleEditTypeChange(e));
        }
        if (intensitySlider) {
            intensitySlider.addEventListener('input', (e) => this.handleIntensityChange(e));
        }
        if (applyEditBtn) {
            applyEditBtn.addEventListener('click', () => this.applyTrackEdit());
        }
    }

    handleEditTypeChange(e) {
        const value = e.target.value;
        const intensitySection = document.getElementById('intensity-slider-section');
        const customSection = document.getElementById('custom-edit-section');

        if (intensitySection) {
            const isIntensity = value === 'intensity_up' || value === 'intensity_down';
            intensitySection.style.display = isIntensity ? 'block' : 'none';
            if (isIntensity) this.configureSliderForDirection(value);
        }
        if (customSection) {
            customSection.style.display = value === 'custom' ? 'block' : 'none';
        }
    }

    configureSliderForDirection(direction) {
        const slider = document.getElementById('intensity-slider');
        const minLabel = document.getElementById('intensity-min-label');
        const maxLabel = document.getElementById('intensity-max-label');
        if (!slider) return;

        if (direction === 'intensity_up') {
            slider.min = 10; slider.max = 100; slider.value = 30;
            if (minLabel) minLabel.textContent = 'Subtle';
            if (maxLabel) maxLabel.textContent = 'Max 🔥';
        } else {
            slider.min = 10; slider.max = 80; slider.value = 30;
            if (minLabel) minLabel.textContent = 'Subtle';
            if (maxLabel) maxLabel.textContent = 'Minimal ❄️';
        }
        this.updateIntensityDisplay(direction, parseInt(slider.value));
    }

    handleIntensityChange(e) {
        const value = parseInt(e.target.value);
        const direction = document.getElementById('edit-type')?.value;
        this.updateIntensityDisplay(direction, value);
    }

    updateIntensityDisplay(direction, value) {
        const display = document.getElementById('intensity-value');
        const preview = document.getElementById('intensity-preview');
        if (!display) return;

        if (direction === 'intensity_up') {
            let label, previewText, color;
            if (value <= 20)      { label = 'Subtle';   color = '#a78bfa'; previewText = '🎵 Light fills · 🔊 Vel 6 · ⏱️ Slightly shorter notes'; }
            else if (value <= 40) { label = 'Moderate'; color = '#60a5fa'; previewText = '🎵 More fills · 🔊 Vel 6-7 · ⏱️ Shorter notes'; }
            else if (value <= 60) { label = 'Strong';   color = '#34d399'; previewText = '🎵 Dense notes · 🔊 Vel 7-8 · ⏱️ Fast bursts'; }
            else if (value <= 80) { label = 'Dramatic'; color = '#f59e0b'; previewText = '🎵 Very dense · 🔊 Vel 8 · ⏱️ 16th notes dominant'; }
            else                  { label = 'Max 🔥';   color = '#ef4444'; previewText = '🎵 Maximum notes · 🔊 Vel 8-9 · ⏱️ Fastest possible'; }
            display.textContent = `↑ ${label}: +${value}%`;
            display.style.color = color;
            if (preview) { preview.textContent = previewText; preview.style.display = 'block'; }

        } else if (direction === 'intensity_down') {
            let label, previewText, color;
            if (value <= 20)      { label = 'Subtle';     color = '#a78bfa'; previewText = '🎵 Few fewer notes · 🔊 Vel 5 · ⏱️ Slightly longer notes'; }
            else if (value <= 40) { label = 'Moderate';   color = '#60a5fa'; previewText = '🎵 Remove fills · 🔊 Vel 4-5 · ⏱️ Longer notes'; }
            else if (value <= 60) { label = 'Strong';     color = '#f59e0b'; previewText = '🎵 Sparse texture · 🔊 Vel 3-4 · ⏱️ Half notes'; }
            else                  { label = 'Minimal ❄️'; color = '#94a3b8'; previewText = '🎵 Skeleton only · 🔊 Vel 3 · ⏱️ Long sustained notes'; }
            display.textContent = `↓ ${label}: -${value}%`;
            display.style.color = color;
            if (preview) { preview.textContent = previewText; preview.style.display = 'block'; }
        }
    }

    updateEditTrackCheckboxes(availableTracks) {
        const container = document.getElementById('edit-track-checkboxes');
        if (!container) return;

        if (!availableTracks || availableTracks.length === 0) {
            container.innerHTML = '<span class="sub-text" style="font-size: 0.75rem;">Load a composition to see available tracks...</span>';
            return;
        }

        container.innerHTML = '';

        const priorityOrder = ['bassline', 'chord', 'melody', 'lead', 'arpeggio', 'plucks', 'keys', 'strings', 'pad-textures', 'guitar', 'brass', 'percs'];
        const sortedTracks = [...availableTracks].sort((a, b) => {
            const idxA = priorityOrder.indexOf(a);
            const idxB = priorityOrder.indexOf(b);
            if (idxA === -1 && idxB === -1) return a.localeCompare(b);
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });

        const colors = {
            'bassline': '#E74C3C',
            'chord': '#E67E22',
            'keys': '#F1C40F',
            'plucks': '#F39C12',
            'arpeggio': '#2ECC71',
            'melody': '#1ABC9C',
            'strings': '#3498DB',
            'pad-textures': '#9B59B6',
            'lead': '#E91E63',
            'guitar': '#8E44AD',
            'brass': '#F1C40F',
            'percs': '#BDC3C7'
        };

        sortedTracks.forEach(track => {
            const label = document.createElement('label');
            label.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 10px;
                background: #0f0f1a;
                border: 2px solid ${colors[track] || '#4c4c6d'};
                border-radius: 16px;
                cursor: pointer;
                font-size: 0.75rem;
                color: #e2e8f0;
                transition: all 0.2s;
            `;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = track;
            checkbox.className = 'edit-track-checkbox';
            checkbox.style.cssText = 'accent-color: #7c3aed; cursor: pointer;';

            const icon = document.createElement('span');
            icon.textContent = this.getTrackIcon(track);
            icon.style.fontSize = '0.9rem';

            const text = document.createElement('span');
            text.textContent = track.charAt(0).toUpperCase() + track.slice(1);

            label.appendChild(checkbox);
            label.appendChild(icon);
            label.appendChild(text);
            container.appendChild(label);

            label.addEventListener('mouseenter', () => {
                label.style.background = colors[track] ? `${colors[track]}20` : '#1a1a2e';
            });
            label.addEventListener('mouseleave', () => {
                label.style.background = '#0f0f1a';
            });
        });
    }

    getTrackIcon(track) {
        const icons = {
            'bassline': '🎸',
            'chord': '🎹',
            'keys': '🎹',
            'plucks': '🎸',
            'arpeggio': '🎵',
            'melody': '🎤',
            'strings': '🎻',
            'pad-textures': '🌊',
            'lead': '⭐',
            'guitar': '🎸',
            'brass': '🎺',
            'percs': '🥁'
        };
        return icons[track] || '🎵';
    }

    getSelectedEditTracks() {
        const checkboxes = document.querySelectorAll('.edit-track-checkbox:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // QUICK TRACK EDIT - Ενημερωμένο για νέο API format
    // ═══════════════════════════════════════════════════════════════════════════════

    async applyTrackEdit() {
        const targetTracks = this.getSelectedEditTracks();
        const editType = document.getElementById('edit-type')?.value;
        const customInstructions = document.getElementById('custom-edit-instructions')?.value;
        const intensityValue = parseInt(document.getElementById('intensity-slider')?.value || 0) / 100;

        if (targetTracks.length === 0) {
            this.app.ui.showMessage('Please select at least one track to edit.', 'warning');
            return;
        }
        if (!editType) {
            this.app.ui.showMessage('Please select an edit type.', 'warning');
            return;
        }
        if (!this.sourceJson) {
            this.app.ui.showMessage('No composition loaded. Please generate or paste JSON first.', 'warning');
            return;
        }

        // ΝΕΟ: Build editParams αντί για prompt
        const originalJson = JSON.parse(this.sourceJson);
        const availableTracks = Object.keys(originalJson.tracks || {});

        const editParams = {
            originalJson,
            targetTracks,
            unchangedTracks: availableTracks.filter(t => !targetTracks.includes(t)),
            editType,
            customInstructions: editType === 'custom' ? customInstructions : null,
            intensityChange: Math.abs(intensityValue),  // always positive; direction is in editType
            genre: document.getElementById('style')?.value || 'house',
            bpm: parseInt(document.getElementById('bpm')?.value, 10) || 120,
            key: document.getElementById('key')?.value || 'C',
            duration: parseInt(document.getElementById('duration')?.value, 10) || 4,
            timeSignature: document.getElementById('time-signature')?.value || '4/4'
        };

        await this.editTrackSelectively(editParams);
    }

    async editTrackSelectively(editParams) {
        const { targetTracks } = editParams;
        const MAX_RETRIES = 2;
        let lastError;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                this.app.ui.showLoading(`Editing ${targetTracks.join(', ')}${attempt > 1 ? ` (retry ${attempt-1})` : ''}...`);

                const userApiKey = localStorage.getItem('byop_pollinations_key') || undefined;

                // ΝΕΟ: Κλήση με editParams (όπως το main generation)
                const response = await fetchWithModelFallbacks('/api/variations', 
                    ['midijourney', 'claude-fast', 'openai'],
                    this.app.ui, 
                    { 
                        editParams,  // Αντί για prompt
                        seed: Math.floor(Math.random() * 100000) + attempt,
                        userApiKey
                    }
                );

                // ΝΕΟ: Χρήση του ίδιου parser με το main generation
                const responseText = await response.text();

                // 🔥 Χρήση MIDIGenerator parser (τώρα με κανονικό import)
                const generator = new MIDIGenerator();
                const bpm = editParams.bpm;

                // Parse με expected tracks (full names)
                const { tracks: editedTracksMap, title, description } = 
                    generator.parseApiResponse(responseText, targetTracks, bpm);

                // Έλεγχος ότι όλα τα target tracks υπάρχουν
                if (editedTracksMap.size === 0) {
                    throw new Error('No tracks returned from AI');
                }

                const missingTracks = targetTracks.filter(t => !editedTracksMap.has(t));
                if (missingTracks.length > 0) {
                    throw new Error(`Missing tracks: ${missingTracks.join(', ')}`);
                }

                // Merge με unchanged tracks
                const mergedResult = this.mergeWithUnchanged({
                    originalJson: editParams.originalJson,
                    editedTracks: editedTracksMap,
                    targetTracks,
                    title,
                    description
                });

                // Ενημέρωση main app
                await this.updateMainAppAfterEdit(mergedResult);

                // Προσθήκη στις versions
                const newVersion = {
                    apiResponse: mergedResult,
                    context: this.versions[0]?.context || {},
                    isOriginal: false,
                    structure: `Edit: ${targetTracks.join(', ')}`,
                    editDetails: editParams
                };

                this.versions.push(newVersion);
                this.renderVersionsList();

                // Update source JSON
                this.sourceJson = JSON.stringify({
                    title: mergedResult.title,
                    desc: mergedResult.desc,
                    tracks: mergedResult.tracks
                });

                const rawInput = document.getElementById('raw-json-input');
                if (rawInput) {
                    rawInput.value = JSON.stringify({
                        title: mergedResult.title,
                        desc: mergedResult.desc,
                        tracks: mergedResult.tracks
                    }, null, 2);
                }

                this.app.ui.showMessage(`Successfully edited ${targetTracks.join(', ')}.`, 'success');
                return;

            } catch (error) {
                lastError = error;
                console.error(`Edit attempt ${attempt} failed:`, error);

                if (error.requiresByop || error.message?.includes('daily_limit_reached')) {
                    this.app.ui.hideLoading();
                    this.app.showByopModal?.(error.resetAt);
                    return;
                }

                if (error.requiresByopReauth) {
                    this.app.ui.hideLoading();
                    this.app.checkByopStatus?.();
                    this.app.showByopModal?.(null, true);
                    return;
                }

                if (attempt < MAX_RETRIES) {
                    this.app.ui.showMessage(`${error.message}. Retrying...`, 'warning');
                    await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
                }
            }
        }

        this.app.ui.hideLoading();
        let userMessage = `Edit failed after ${MAX_RETRIES} attempts: ${lastError.message}`;
        if (lastError.message?.includes('timeout')) {
            userMessage = 'Edit timed out. Try a simpler edit or fewer tracks.';
        }
        this.app.ui.showMessage(userMessage, 'error');
    }

    /**
     * ΝΕΟ: Απλοποιημένο merge με χρήση MIDIGenerator notes
     */
    mergeWithUnchanged({ originalJson, editedTracks, targetTracks, title, description }) {
        console.log('[MERGE] Starting merge...');
        console.log('[MERGE] Edited tracks:', Array.from(editedTracks.keys()));
        console.log('[MERGE] Target tracks:', targetTracks);

        const mergedTracks = { ...originalJson.tracks };

        // Replace edited tracks
        for (const [trackName, trackData] of editedTracks.entries()) {
            // Μετατροπή notes πίσω σε compact string format
            mergedTracks[trackName] = this.notesToCompactFormat(trackData.notes);
            console.log(`[MERGE] ✓ Replaced ${trackName} with ${trackData.notes.length} notes`);
        }

        // Log unchanged
        const unchangedTracks = Object.keys(originalJson.tracks).filter(t => !targetTracks.includes(t));
        unchangedTracks.forEach(t => console.log(`[MERGE] → Kept unchanged: ${t}`));

        return {
            title: title || `${originalJson.title || 'Untitled'} [${targetTracks.join(', ')} edit]`,
            desc: description || `Edited ${targetTracks.join(', ')}`,
            tracks: mergedTracks
        };
    }

    /**
     * ΝΕΟ: Helper για μετατροπή notes → compact string
     */
    notesToCompactFormat(notes) {
        if (!notes || notes.length === 0) return '';

        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const secondsPerBeat = 60 / bpm;

        return notes.map(n => {
            const vel = Math.max(1, Math.min(9, Math.round(n.velocity * 10)));  // 0.7 → 7
            const beat = (n.time / secondsPerBeat).toFixed(2);  // seconds → beats
            const dur = (n.duration / secondsPerBeat).toFixed(2);
            return `${n.midi}:${beat}:${dur}:${vel}`;
        }).join('|');
    }

    async updateMainAppAfterEdit(mergedResult) {
        try {
            console.log('[UPDATE-MAIN] Starting update...');

            // Χρήση MIDIGenerator για δημιουργία MIDI objects
            const tracks = this.mergedTracksToTrackMap(mergedResult.tracks);

            // Ενημέρωση app state
            this.app.generatedTracks = tracks;
            this.app.compositionTitle = mergedResult.title;
            this.app.compositionDescription = mergedResult.desc;

            // Ενημέρωση visualizer
            this.app.visualizer.compositionTitle = mergedResult.title;
            this.app.visualizer.compositionDescription = mergedResult.desc;

            this.app.visualizer.loadNotes(
                tracks,
                mergedResult.title,
                mergedResult.desc
            );

            this.app.visualizer.updateTrackSelectors();
            this.app.visualizer.stopVisualization();
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();

            // Ενεργοποίηση κουμπιών
            this.app.ui.updateButtonStates(true);
            this.setVisualizerToAllTracks();

            console.log('[UPDATE-MAIN] Successfully updated');

        } catch (error) {
            console.error('[UPDATE-MAIN] Failed:', error);
            throw error;
        }
    }

    mergedTracksToTrackMap(mergedTracks) {
        const tracks = new Map();
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        console.log('[MERGED-TO-MAP] Converting tracks:', Object.keys(mergedTracks));

        for (const [trackName, notesStr] of Object.entries(mergedTracks)) {
            if (!notesStr || typeof notesStr !== 'string') continue;

            const notes = [];
            const separator = notesStr.includes('|') ? '|' : '\n';
            const lines = notesStr.split(separator).map(l => l.trim()).filter(l => l);

            for (const line of lines) {
                if (line.match(/^(pitch|note|midi|#)/i)) continue;

                const note = this.parseCompactNoteLine(line, bpm);
                if (note) notes.push(note);
            }

            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                tracks.set(trackName, {
                    midi,
                    title: trackName.charAt(0).toUpperCase() + trackName.slice(1),
                    description: `Generated ${trackName}`
                });
                console.log(`[MERGED-TO-MAP] Created track "${trackName}" with ${notes.length} notes`);
            }
        }

        return tracks;
    }

    parseCompactNoteLine(line, bpm) {
        try {
            const parts = line.split(':').map(p => p.trim());
            if (parts.length < 4) return null;

            const secondsPerBeat = 60 / bpm;
            const pitchStr = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocityRaw = parseInt(parts[3]);

            if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocityRaw)) return null;

            const normalizedVelocity = Math.max(0.1, Math.min(0.9, velocityRaw / 10));

            let midiNote;
            if (!isNaN(parseInt(pitchStr))) {
                midiNote = parseInt(pitchStr);
            } else {
                midiNote = Tone.Frequency(pitchStr).toMidi();
            }

            if (isNaN(midiNote)) return null;

            return {
                midi: midiNote,
                name: Tone.Frequency(midiNote, "midi").toNote(),
                time: startBeat * secondsPerBeat,
                duration: durationBeats * secondsPerBeat,
                velocity: normalizedVelocity
            };
        } catch (e) {
            return null;
        }
    }

    createMidiFromNotes(notes, bpm) {
        const midi = new Midi();
        const track = midi.addTrack();
        midi.header.setTempo(bpm);

        notes.sort((a, b) => a.time - b.time).forEach(note => {
            track.addNote({
                name: note.name,
                midi: note.midi,
                time: note.time,
                duration: note.duration,
                velocity: note.velocity
            });
        });

        return midi;
    }

    setVisualizerToAllTracks() {
        try {
            document.querySelectorAll('.track-selector').forEach(btn => {
                btn.classList.remove('active');
            });

            const allTracksBtn = document.querySelector('.track-selector[data-track-type="all"]');
            if (allTracksBtn) {
                allTracksBtn.classList.add('active');
            }

            this.app.visualizer.activeTrackType = 'all';
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();

        } catch (error) {
            console.error('[SET-ALL-TRACKS] Error:', error);
            this.app.visualizer.activeTrackType = 'all';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // EXISTING METHODS (unchanged)
    // ═══════════════════════════════════════════════════════════════════════════════

    handleJsonInputChange(e) {
        const newJsonString = e.target.value;
        const rawJsonInput = document.getElementById('raw-json-input');

        try {
            const parsedJson = JSON.parse(newJsonString);
            this.sourceJson = JSON.stringify(parsedJson);

            if (parsedJson.tracks) {
                this.updateEditTrackCheckboxes(Object.keys(parsedJson.tracks));
            }

            const originalVersion = this.versions.find(v => v.isOriginal);
            if (originalVersion) {
                originalVersion.apiResponse = parsedJson;
                const sourceTitle = document.getElementById('source-composition-title');
                const sourceExplanation = document.getElementById('source-composition-explanation');
                if (sourceTitle) sourceTitle.textContent = parsedJson.title || 'Custom Composition';
                if (sourceExplanation) sourceExplanation.textContent = parsedJson.explanation || parsedJson.desc || '';
            }

            this.app.ui.showMessage('JSON is valid. Ready to edit.', 'success');
            const applyEditBtn = document.getElementById('apply-track-edit');
            if (applyEditBtn) applyEditBtn.disabled = false;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            console.error('Invalid JSON input:', error);
            this.app.ui.showMessage('Invalid JSON format.', 'error');
            const applyEditBtn = document.getElementById('apply-track-edit');
            if (applyEditBtn) applyEditBtn.disabled = true;
            if (rawJsonInput) rawJsonInput.style.borderColor = '#ef4444';
        }
    }

    reset() {
        this.sourceJson = null;
        this.versions = [];

        const rawJsonInput = document.getElementById('raw-json-input');
        const sourceDetails = document.getElementById('source-composition-details');
        const downloadBtn = document.getElementById('download-all-zip');
        const applyEditBtn = document.getElementById('apply-track-edit');

        if (rawJsonInput) rawJsonInput.value = '';
        if (sourceDetails && sourceDetails.querySelector('p')) {
            sourceDetails.querySelector('p').style.display = 'block';
        }

        if (applyEditBtn) applyEditBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = true;

        this.updateEditTrackCheckboxes([]);
    }

    setSourceComposition(rawJson, metadata, context) {
        this.reset();
        this.sourceJson = rawJson;
        this.versions = [];

        const rawJsonInput = document.getElementById('raw-json-input');
        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');

        try {
            const parsedSource = JSON.parse(rawJson);
            if (rawJsonInput) rawJsonInput.value = JSON.stringify(parsedSource, null, 2);

            if (parsedSource.tracks) {
                this.updateEditTrackCheckboxes(Object.keys(parsedSource.tracks));
            }

            const originalVersion = {
                apiResponse: {
                    title: metadata.title,
                    desc: metadata.explanation || metadata.desc,
                    tracks: parsedSource.tracks || {},
                },
                context: context,
                isOriginal: true,
                structure: 'Original'
            };
            this.versions.push(originalVersion);
            this.renderVersionsList();

            if (sourceTitle) sourceTitle.textContent = metadata.title;
            if (sourceExplanation) sourceExplanation.textContent = metadata.explanation || metadata.desc;
            if (sourceDetails && sourceDetails.querySelector('p')) {
                sourceDetails.querySelector('p').style.display = 'none';
            }

            const applyEditBtn = document.getElementById('apply-track-edit');
            if (applyEditBtn) applyEditBtn.disabled = false;

            this.app.ui.showMessage('Composition loaded. Select tracks to edit!', 'info');

        } catch (error) {
            console.error('Failed to parse source composition:', error);
            this.app.ui.showMessage('Error loading source composition.', 'error');
            this.reset();
        }
    }

    renderVersionsList() {
        const listEl = document.getElementById('versions-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        if (this.versions.length === 0) {
            listEl.innerHTML = '<p>Your edited versions will appear here.</p>';
            const downloadBtn = document.getElementById('download-all-zip');
            if (downloadBtn) downloadBtn.disabled = true;
            return;
        }

        this.versions.forEach((version, index) => {
            const card = document.createElement('div');
            card.className = 'variation-card';

            const editBadge = version.editDetails ?
                `<span style="display: inline-block; padding: 2px 8px; background: #7c3aed; color: white; border-radius: 12px; font-size: 0.7rem; margin-left: 8px;">EDIT</span>` : '';

            const compareBtn = !version.isOriginal ? `<button class="btn btn-secondary btn-compare" data-index="${index}" style="font-size: 0.75rem; padding: 4px 8px;">Compare</button>` : '';

            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${version.apiResponse.title} ${version.isOriginal ? '(Original)' : ''}${editBadge}</h4>
                    <p>${version.apiResponse.desc || version.apiResponse.explanation}</p>
                </div>
                <div class="variation-card-actions">
                    <button class="btn btn-accent btn-load" data-index="${index}">Load</button>
                    ${compareBtn}
                </div>
            `;
            listEl.appendChild(card);
        });

        const downloadBtn = document.getElementById('download-all-zip');
        if (downloadBtn) downloadBtn.disabled = this.versions.length < 1;

        listEl.querySelectorAll('.btn-load').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = e.target.dataset.index;
                this.loadVersion(index);
            });
        });

        listEl.querySelectorAll('.btn-compare').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = e.target.dataset.index;
                this.showComparison(index);
            });
        });
    }

    showComparison(editedVersionIndex) {
        const originalVersion = this.versions[0];
        const editedVersion = this.versions[editedVersionIndex];

        if (!originalVersion || !editedVersion) return;

        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); display: flex; align-items: center;
            justify-content: center; z-index: 2000; padding: 20px;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: #1a1a2e; border: 1px solid #4c4c6d;
            border-radius: 12px; max-width: 800px; max-height: 80vh;
            overflow-y: auto; padding: 20px; width: 100%;
        `;

        const origTracks = originalVersion.apiResponse.tracks || {};
        const editTracks = editedVersion.apiResponse.tracks || {};

        const getTrackStats = (tracks) => Object.entries(tracks).reduce((acc, [name, data]) => {
            acc[name] = (typeof data === 'string' ? data.split('|').length : 0);
            return acc;
        }, {});

        const origStats = getTrackStats(origTracks);
        const editStats = getTrackStats(editTracks);

        const comparison = Object.keys({ ...origTracks, ...editTracks }).map(track => {
            const orig = origStats[track] || 0;
            const edit = editStats[track] || 0;
            const change = edit - orig;
            const changeColor = change > 0 ? '#10b981' : change < 0 ? '#ef4444' : '#a78bfa';
            const changeSign = change > 0 ? '+' : '';

            return `
                <div style="display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid #312e81; font-size: 0.85rem;">
                    <span style="color: #e2e8f0;">${track}</span>
                    <span style="color: #94a3b8;">↓ ${orig} notes</span>
                    <span style="color: #94a3b8;">↓ ${edit} notes</span>
                    <span style="color: ${changeColor}; font-weight: 600;">${changeSign}${change}</span>
                </div>
            `;
        }).join('');

        content.innerHTML = `
            <div style="margin-bottom: 20px;">
                <h3 style="color: #e2e8f0; margin-bottom: 16px;">Comparison: Original vs "${editedVersion.apiResponse.title}"</h3>
                <div style="background: #0f0f1a; border-radius: 8px; overflow: hidden;">
                    <div style="display: flex; justify-content: space-between; padding: 12px; background: #312e81; font-weight: 600; color: #a78bfa;">
                        <span>Track</span>
                        <span>Original</span>
                        <span>Edited</span>
                        <span>Change</span>
                    </div>
                    ${comparison}
                </div>
            </div>
            <button id="close-comparison" class="btn btn-secondary" style="width: 100%;">Close</button>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        document.getElementById('close-comparison').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    loadVersion(index) {
        try {
            const version = this.versions[index];
            if (!version) {
                this.app.ui.showMessage('Version not found.', 'error');
                return;
            }

            const versionJson = JSON.stringify({
                title: version.apiResponse.title,
                desc: version.apiResponse.desc || version.apiResponse.explanation || '',
                tracks: version.apiResponse.tracks || {}
            }, null, 2);

            this.sourceJson = JSON.stringify({
                title: version.apiResponse.title,
                desc: version.apiResponse.desc || version.apiResponse.explanation || '',
                tracks: version.apiResponse.tracks || {}
            });

            const rawJsonInput = document.getElementById('raw-json-input');
            if (rawJsonInput) rawJsonInput.value = versionJson;

            if (version.apiResponse.tracks) {
                this.updateEditTrackCheckboxes(Object.keys(version.apiResponse.tracks));
            }

            this.updateMainAppAfterEdit(version.apiResponse);

            this.app.ui.showMessage(`Loaded "${version.apiResponse.title}" into the main player.`, 'success');

        } catch (error) {
            console.error('Error loading version:', error);
            this.app.ui.showMessage(`Failed to load version: ${error.message}`, 'error');
        }
    }

    async downloadAllAsZip() {
        if (this.versions.length === 0) {
            this.app.ui.showMessage('No versions to download.', 'warning');
            return;
        }

        this.app.ui.showLoading('Preparing ZIP...');
        try {
            const zip = new JSZip();
            const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
            const sourceTitle = this.versions[0]?.apiResponse?.title.replace(/ \(.+\)/, '') || 'composition';

            for (const version of this.versions) {
                const tracks = this.mergedTracksToTrackMap(version.apiResponse.tracks);
                if (tracks.size > 0) {
                    const combinedMidi = MidiBuilder.createCombinedMidi(tracks, bpm);
                    if (combinedMidi) {
                        const midiBytes = combinedMidi.toArray();
                        const sanitizedTitle = version.apiResponse.title.replace(/[\/\\?%*:|"<>]/g, '-').trim();
                        zip.file(`${sanitizedTitle}.mid`, midiBytes);
                    }
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const sanitizedSourceTitle = sourceTitle.replace(/[\/\\?%*:|"<>]/g, '-').trim();
            const zipFilename = `${sanitizedSourceTitle}-edits.zip`;

            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = zipFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            this.app.ui.showMessage('All versions downloaded as ZIP.', 'success');

        } catch (error) {
            console.error('ZIP failed:', error);
            this.app.ui.showMessage(`Error creating ZIP: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }
}
