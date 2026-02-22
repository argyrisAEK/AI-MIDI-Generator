import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { trackAbbreviations } from './track-config.js';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.setupEventListeners();
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
            intensitySection.style.display = value === 'intensity_up' || value === 'intensity_down' ? 'block' : 'none';
        }
        if (customSection) {
            customSection.style.display = value === 'custom' ? 'block' : 'none';
        }
    }

    handleIntensityChange(e) {
        const value = parseInt(e.target.value);
        const display = document.getElementById('intensity-value');
        if (display) {
            const sign = value >= 0 ? '+' : '';
            display.textContent = `${sign}${value}%`;
            display.style.color = value > 0 ? '#10b981' : value < 0 ? '#ef4444' : '#a78bfa';
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
    // 🔥 QUICK TRACK EDIT - ΚΥΡΙΑ ΛΕΙΤΟΥΡΓΙΑ
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

        const editRequest = {
            targetTracks,
            editType,
            customInstructions: editType === 'custom' ? customInstructions : null,
            intensityChange: editType === 'intensity_up' ? Math.abs(intensityValue) : 
                            editType === 'intensity_down' ? -Math.abs(intensityValue) : 0,
            preserveOtherTracks: true
        };

        await this.editTrackSelectively(editRequest);
    }

    async editTrackSelectively(editRequest) {
        const {
            targetTracks,
            editType,
            customInstructions,
            intensityChange
        } = editRequest;

        let original;
        try {
            original = JSON.parse(this.sourceJson);
        } catch (e) {
            this.app.ui.showMessage('Invalid source JSON. Cannot perform edit.', 'error');
            return;
        }

        const originalTracks = original.tracks || {};
        const availableTracks = Object.keys(originalTracks);

        for (const track of targetTracks) {
            if (!availableTracks.includes(track)) {
                this.app.ui.showMessage(`Track "${track}" not found in composition.`, 'error');
                return;
            }
        }

        const unchangedTracks = availableTracks.filter(t => !targetTracks.includes(t));

        const prompt = this.buildEditPrompt({
            originalJson: original,
            targetTracks,
            unchangedTracks,
            editType,
            customInstructions,
            intensityChange,
            genre: document.getElementById('style')?.value || 'house',
            bpm: parseInt(document.getElementById('bpm')?.value, 10) || 120,
            key: document.getElementById('key')?.value || 'C',
            duration: parseInt(document.getElementById('duration')?.value, 10) || 4
        });

        const MAX_RETRIES = 2;
        let lastError;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                this.app.ui.showLoading(`Editing ${targetTracks.join(', ')}${attempt > 1 ? ` (retry ${attempt-1})` : ''}...`);

                const userApiKey = localStorage.getItem('byop_pollinations_key') || undefined;

                const response = await fetchWithModelFallbacks('/api/variations', 
                    ['openai-large', 'claude-fast', 'openai'],
                    this.app.ui, 
                    { 
                        prompt, 
                        seed: Math.floor(Math.random() * 100000) + attempt,
                        timeout: 60000,
                        userApiKey
                    }
                );

                const responseText = await response.text();
                
                if (!responseText || responseText.length < 100) {
                    throw new Error('Empty or too short response from AI');
                }

                const editedTracks = this.parseEditResponse(responseText, targetTracks);

                const missingTracks = targetTracks.filter(t => {
                    const abbrev = trackAbbreviations[t] || t;
                    return !editedTracks[abbrev] && !editedTracks[t];
                });
                
                if (missingTracks.length > 0) {
                    throw new Error(`Response missing tracks: ${missingTracks.join(', ')}`);
                }

                const mergedResult = this.mergeDifferentialChanges({
                    originalTracks,
                    editedTracks,
                    targetTracks,
                    originalMetadata: {
                        title: original.title,
                        explanation: original.explanation
                    },
                    editDescription: this.generateEditDescription(editRequest)
                });

                // 🔥🔥🔥 ΚΡΙΣΙΜΟ: Ενημέρωση main app σαν να είναι νέο generation
                await this.updateMainAppAfterEdit(mergedResult);

                // Προσθήκη στις versions
                const newVersion = {
                    apiResponse: mergedResult,
                    context: this.versions[0]?.context || {},
                    isOriginal: false,
                    structure: `Edit: ${targetTracks.join(', ')}`,
                    editDetails: editRequest
                };

                this.versions.push(newVersion);
                this.renderVersionsList();
                
                // Update source JSON για περαιτέρω edits
                this.sourceJson = JSON.stringify({
                    title: mergedResult.title,
                    explanation: mergedResult.explanation,
                    tracks: mergedResult.tracks
                });
                
                const rawInput = document.getElementById('raw-json-input');
                if (rawInput) {
                    rawInput.value = JSON.stringify({
                        title: mergedResult.title,
                        explanation: mergedResult.explanation,
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
     * 🔥 ΕΝΗΜΕΡΩΣΗ MAIN APP - ΑΚΡΙΒΩΣ ΟΠΩΣ ΤΟ ΚΑΝΟΝΙΚΟ GENERATION
     */
    async updateMainAppAfterEdit(mergedResult) {
        console.log('[UPDATE-MAIN] Updating main app after edit...');
        
        try {
            // 1. Μετατροπή notation σε tracks Map (ίδιο με generateMultiTrackMIDI)
            const tracks = this.parseNotationToTracks(mergedResult.notation);
            
            if (tracks.size === 0) {
                throw new Error('No tracks parsed from edit result');
            }

            console.log('[UPDATE-MAIN] Parsed tracks:', Array.from(tracks.keys()));

            // 2. Ενημέρωση app state (ΑΚΡΙΒΩΣ όπως στο main.js handleGenerate)
            this.app.generatedTracks = tracks;
            this.app.compositionTitle = mergedResult.title;
            this.app.compositionDescription = mergedResult.explanation;

            // 3. Ενημέρωση visualizer (ίδιο με updateVisualizer στο main.js)
            this.app.visualizer.compositionTitle = mergedResult.title;
            this.app.visualizer.compositionDescription = mergedResult.explanation;
            
            // Φόρτωση notes και ενημέρωση UI
            this.app.visualizer.loadNotes(
                tracks,
                mergedResult.title,
                mergedResult.explanation
            );
            
            // Ενημέρωση track selectors (τα κουμπιά επιλογής track)
            this.app.visualizer.updateTrackSelectors();
            
            // Σταμάτα τυχόν running visualization
            this.app.visualizer.stopVisualization();
            
            // Render αρχικό frame
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();

            // 4. Ενημέρωση UI buttons (Play, Stop, Download ενεργά)
            this.app.ui.updateButtonStates(true);

            // 5. Switch σε "All Tracks" για να φαίνονται όλα μαζί
            this.setVisualizerToAllTracks();

            console.log('[UPDATE-MAIN] Successfully updated main app');

        } catch (error) {
            console.error('[UPDATE-MAIN] Failed:', error);
            throw error;
        }
    }

    /**
     * Ορισμός visualizer σε "All Tracks" mode
     */
    setVisualizerToAllTracks() {
        try {
            // Καθαρισμός προηγούμενου active state
            document.querySelectorAll('.track-selector').forEach(btn => {
                btn.classList.remove('active');
            });

            // Εύρεση και ενεργοποίηση του "All Tracks" button
            const allTracksBtn = document.querySelector('.track-selector[data-track-type="all"]');
            if (allTracksBtn) {
                allTracksBtn.classList.add('active');
            }

            // Ενημέρωση visualizer state
            this.app.visualizer.activeTrackType = 'all';
            
            // Ενημέρωση metadata display
            if (this.app.visualizer.updateMetadataDisplay) {
                this.app.visualizer.updateMetadataDisplay('all');
            }

            // Re-render για να φανούν όλα τα tracks
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();

            console.log('[SET-ALL-TRACKS] Visualizer set to show all tracks');

        } catch (error) {
            console.error('[SET-ALL-TRACKS] Error:', error);
            // Fallback: απλά ορισμός της μεταβλητής
            this.app.visualizer.activeTrackType = 'all';
        }
    }

    buildEditPrompt(params) {
        const {
            originalJson,
            targetTracks,
            unchangedTracks,
            editType,
            customInstructions,
            intensityChange,
            genre,
            bpm,
            key,
            duration
        } = params;

        const instructions = this.getEditInstructions(editType, {
            intensityChange,
            customInstructions
        });

        const lines = [
            `=== MUSICAL TRACK EDIT ===`,
            `Composition: "${originalJson.title || 'Untitled'}"`,
            `Genre: ${genre} | Key: ${key} | BPM: ${bpm} | Duration: ${duration} bars`,
            ``,
            `=== EDIT INSTRUCTIONS ===`,
            `Target Tracks: ${targetTracks.join(', ')}`,
            `Edit Type: ${instructions}`,
            `Preserve Unchanged: ${unchangedTracks.join(', ') || 'none'}`,
            ``,
            `=== ORIGINAL TRACK DATA ===`
        ];

        targetTracks.forEach(track => {
            const notation = originalJson.tracks[track] || '';
            const notes = notation.split('\n').filter(l => l.trim());
            const firstNotes = notes.slice(0, 3).join(' | ');
            
            lines.push(`${track.toUpperCase()}: ${notes.length} notes`);
            lines.push(`Example: ${firstNotes}${notes.length > 3 ? '...' : ''}`);
            lines.push(``);
        });

        lines.push(`=== REQUIREMENTS ===`);
        lines.push(`1. Modify ONLY the target tracks listed above`);
        lines.push(`2. Keep the same total duration (${duration} bars)`);
        lines.push(`3. Maintain key (${key}) and tempo (${bpm})`);
        lines.push(`4. Return ONLY the modified tracks in JSON format`);
        lines.push(`5. Use track abbreviations: ${targetTracks.map(t => `${t}=${trackAbbreviations[t] || t}`).join(', ')}`);
        lines.push(``);
        lines.push(`=== OUTPUT FORMAT ===`);
        lines.push(`{"title":"${originalJson.title} [edited]","desc":"${this.generateEditDescription({editType, targetTracks, intensityChange})}","tracks":{${targetTracks.map(t => `"${trackAbbreviations[t] || t}":"pitch,beat,dur,vel\\n..."`).join(',')}}}`);

        return lines.join('\n');
    }

    getEditInstructions(editType, params) {
        const { intensityChange, customInstructions } = params;
        const pct = Math.abs(Math.round(intensityChange * 100));

        const instructions = {
            intensity_up: `INCREASE INTENSITY by ${pct}% - Add more notes, increase velocity (louder), shorter note durations, more rhythmic activity`,
            intensity_down: `DECREASE INTENSITY by ${pct}% - Remove some notes, decrease velocity (softer), longer note durations, simpler rhythm`,
            simplify: `SIMPLIFY - Remove 30-40% of notes, use longer durations, simpler rhythmic patterns, less syncopation`,
            complexify: `ADD COMPLEXITY - Add 30-40% more notes, shorter durations, more syncopation, rhythmic variations`,
            change_rhythm: `CHANGE RHYTHMIC FEEL - Keep same pitches but completely transform the rhythm pattern`,
            transpose_up: `TRANSPOSE UP ONE OCTAVE (+12 semitones) - Same rhythm and velocities, just higher pitch`,
            transpose_down: `TRANSPOSE DOWN ONE OCTAVE (-12 semitones) - Same rhythm and velocities, just lower pitch`,
            custom: `CUSTOM EDIT: ${customInstructions?.substring(0, 150) || 'Apply custom modifications as specified'}`
        };

        return instructions[editType] || instructions.custom;
    }

    generateEditDescription(editRequest) {
        const { targetTracks, editType, intensityChange } = editRequest;
        const trackList = targetTracks.join('+');
        const pct = Math.abs(Math.round(intensityChange * 100));
        
        const desc = {
            intensity_up: `${trackList} +${pct}%`,
            intensity_down: `${trackList} -${pct}%`,
            simplify: `${trackList} simplified`,
            complexify: `${trackList} complexified`,
            change_rhythm: `${trackList} new rhythm`,
            transpose_up: `${trackList} up 8va`,
            transpose_down: `${trackList} down 8va`,
            custom: `${trackList} custom edit`
        };

        return desc[editType] || `${trackList} edited`;
    }

    parseEditResponse(responseText, expectedTracks) {
        try {
            let cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            
            if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
                throw new Error('No valid JSON object found in response');
            }

            const jsonText = cleaned.substring(firstBrace, lastBrace + 1);
            
            let parsed;
            try {
                parsed = JSON.parse(jsonText);
            } catch (parseError) {
                let fixed = jsonText
                    .replace(/,\s*([\}\]])/g, '$1')
                    .replace(/'/g, '"');
                parsed = JSON.parse(fixed);
            }

            if (!parsed.tracks || typeof parsed.tracks !== 'object') {
                throw new Error('Missing or invalid tracks object in response');
            }

            return parsed.tracks;

        } catch (error) {
            console.error('Parse error:', error, 'Response:', responseText.substring(0, 500));
            throw new Error(`Could not parse edit response: ${error.message}`);
        }
    }

    mergeDifferentialChanges({ originalTracks, editedTracks, targetTracks, originalMetadata, editDescription }) {
        const reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
        );

        const mergedTracks = {};
        const allTrackNames = Object.keys(originalTracks);

        for (const trackName of allTrackNames) {
            const abbrev = trackAbbreviations[trackName] || trackName;
            
            if (targetTracks.includes(trackName)) {
                const edited = editedTracks[abbrev] || editedTracks[trackName];
                if (edited && typeof edited === 'string' && edited.trim().length > 0) {
                    mergedTracks[trackName] = edited;
                } else {
                    console.warn(`No valid edit for ${trackName}, keeping original`);
                    mergedTracks[trackName] = originalTracks[trackName];
                }
            } else {
                mergedTracks[trackName] = originalTracks[trackName];
            }
        }

        const notation = this.buildNotationFromTracks(mergedTracks);

        return {
            title: `${originalMetadata.title} [${targetTracks.join(', ')} edit]`,
            explanation: `${originalMetadata.explanation} | ${editDescription}`,
            tracks: mergedTracks,
            notation: notation,
            _editMetadata: {
                editedTracks: targetTracks,
                timestamp: new Date().toISOString(),
                description: editDescription
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // EXISTING METHODS
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
                if (sourceExplanation) sourceExplanation.textContent = parsedJson.explanation || parsedJson.description || '';
            }

            this.app.ui.showMessage('JSON is valid. Ready to edit.', 'success');
            const applyEditBtn = document.getElementById('apply-track-edit');
            if (applyEditBtn) applyEditBtn.disabled = false;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            this.app.ui.showMessage('Invalid JSON format.', 'warning');
            const applyEditBtn = document.getElementById('apply-track-edit');
            if (applyEditBtn) applyEditBtn.disabled = true;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--error)';
        }
    }

    reset() {
        this.sourceJson = null;
        this.versions = [];

        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');
        const versionsList = document.getElementById('versions-list');
        const rawJsonInput = document.getElementById('raw-json-input');
        const applyEditBtn = document.getElementById('apply-track-edit');
        const downloadBtn = document.getElementById('download-all-zip');

        if (rawJsonInput) rawJsonInput.value = '';
        if (versionsList) versionsList.innerHTML = '<p>Your edited versions will appear here.</p>';
        
        if (sourceTitle) sourceTitle.textContent = '';
        if (sourceExplanation) sourceExplanation.textContent = '';
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
                    explanation: metadata.explanation,
                    notation: parsedSource.notation || this.buildNotationFromTracks(parsedSource.tracks) || '',
                },
                context: context,
                isOriginal: true,
                structure: 'Original'
            };
            this.versions.push(originalVersion);
            this.renderVersionsList();

            if (sourceTitle) sourceTitle.textContent = metadata.title;
            if (sourceExplanation) sourceExplanation.textContent = metadata.explanation;
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

    buildNotationFromTracks(tracks) {
        if (!tracks || typeof tracks !== 'object') return '';
        const lines = [];
        for (const [trackName, notesStr] of Object.entries(tracks)) {
            if (!notesStr || typeof notesStr !== 'string') continue;
            const noteLines = notesStr.split('\n').filter(l => l.trim());
            for (const note of noteLines) {
                if (note.trim()) {
                    lines.push(`${note.trim()} # ${trackName}`);
                }
            }
        }
        return lines.join('\n');
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
            
            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${version.apiResponse.title} ${version.isOriginal ? '(Original)' : ''}${editBadge}</h4>
                    <p>${version.apiResponse.explanation}</p>
                </div>
                <div class="variation-card-actions">
                    <button class="btn btn-accent btn-load" data-index="${index}">Load</button>
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
    }
    
    /**
     * 🔥 LOAD VERSION - ΕΝΗΜΕΡΩΜΕΝΟ ΓΙΑ ΣΩΣΤΗ ΕΝΣΩΜΑΤΩΣΗ
     */
    loadVersion(index) {
        try {
            const version = this.versions[index];
            if (!version) {
                this.app.ui.showMessage('Version not found.', 'error');
                return;
            }

            // Χρήση της ίδιας λογικής με το edit
            this.updateMainAppAfterEdit(version.apiResponse);
            
            this.app.ui.showMessage(`Loaded "${version.apiResponse.title}" into the main player.`, 'success');

        } catch (error) {
            console.error('Error loading version:', error);
            this.app.ui.showMessage(`Failed to load version: ${error.message}`, 'error');
        }
    }

    parseNotationToTracks(notation) {
        const tracks = new Map();
        const lines = notation.replace(/\\n/g, '\n').split('\n');
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        const rawTrackNotes = new Map();
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.includes('#')) continue;
            
            const [content, comment] = trimmed.split('#', 2);
            const note = this.parseNoteLine(content.trim());
            const trackType = comment?.trim().split(/\s/)[0];
            
            if (note && trackType) {
                if (!rawTrackNotes.has(trackType)) {
                    rawTrackNotes.set(trackType, []);
                }
                rawTrackNotes.get(trackType).push(note);
            }
        }
        
        rawTrackNotes.forEach((notes, trackType) => {
            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                tracks.set(trackType, {
                    midi,
                    title: trackType.charAt(0).toUpperCase() + trackType.slice(1),
                    description: `Generated ${trackType}`
                });
            }
        });
        
        return tracks;
    }

    parseNoteLine(line) {
        try {
            const cleanLine = line.split('#')[0].trim();
            const parts = cleanLine.split(',').map(p => p.trim());
            if (parts.length < 4) return null;

            const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
            const secondsPerBeat = 60 / bpm;

            const pitchOrName = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocity = parseFloat(parts[3]);

            if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocity)) return null;

            let name, midi;
            if (isNaN(parseInt(pitchOrName))) {
                name = pitchOrName;
                midi = Tone.Frequency(name).toMidi();
            } else {
                midi = parseInt(pitchOrName);
                name = Tone.Frequency(midi, 'midi').toNote();
            }

            return {
                name, midi,
                time: Math.max(0, startBeat * secondsPerBeat),
                duration: Math.max(0.01, durationBeats * secondsPerBeat),
                velocity: Math.max(0.1, Math.min(1.0, velocity)),
            };
        } catch (error) {
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
                const tracks = this.parseNotationToTracks(version.apiResponse.notation);
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
