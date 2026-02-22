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
        const generateBtn = document.getElementById('generate-variations');
        const downloadBtn = document.getElementById('download-all-zip');
        const rawInput = document.getElementById('raw-json-input');
        const editTypeSelect = document.getElementById('edit-type');
        const intensitySlider = document.getElementById('intensity-slider');
        const applyEditBtn = document.getElementById('apply-track-edit');

        if (generateBtn) generateBtn.addEventListener('click', () => this.generateVariation());
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
        
        // Sort tracks by priority
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
    // 🔥 COMPACT DIFFERENTIAL EDITING - Optimized for speed with retries
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

        // Build improved compact prompt
        const prompt = this.buildImprovedDifferentialPrompt({
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

        // Retry logic
        const MAX_RETRIES = 2;
        let lastError;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                this.app.ui.showLoading(`Editing ${targetTracks.join(', ')}${attempt > 1 ? ` (retry ${attempt-1})` : ''}...`);

                // Get BYOP key if available
                const userApiKey = localStorage.getItem('byop_pollinations_key') || undefined;

                const response = await fetchWithModelFallbacks('/api/variations', 
                    ['openai-large', 'claude-fast', 'openai'],
                    this.app.ui, 
                    { 
                        prompt, 
                        seed: Math.floor(Math.random() * 100000) + attempt,
                        timeout: 60000,
                        userApiKey // ← Pass BYOP key
                    }
                );

                const responseText = await response.text();
                
                // Validate response
                if (!responseText || responseText.length < 100) {
                    throw new Error('Empty or too short response from AI');
                }

                const editedTracks = this.parseDifferentialResponse(responseText, targetTracks);

                // Validate all target tracks are present
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

                const newVersion = {
                    apiResponse: mergedResult,
                    context: this.versions[0]?.context || {},
                    isOriginal: false,
                    structure: `Edit: ${targetTracks.join(', ')}`,
                    editDetails: editRequest
                };

                this.versions.push(newVersion);
                this.renderVersionsList();
                
                // Update source JSON for further edits
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
                return; // Success - exit retry loop

            } catch (error) {
                lastError = error;
                console.error(`Differential edit attempt ${attempt} failed:`, error);
                
                // Check for BYOP requirement
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

        // All retries failed
        this.app.ui.hideLoading();
        let userMessage = `Edit failed after ${MAX_RETRIES} attempts: ${lastError.message}`;
        if (lastError.message?.includes('timeout')) {
            userMessage = 'Edit timed out. Try a simpler edit or fewer tracks.';
        } else if (lastError.message?.includes('Missing tracks')) {
            userMessage = 'AI response incomplete. Please try again with different settings.';
        }
        
        this.app.ui.showMessage(userMessage, 'error');
    }

    /**
     * IMPROVED prompt - better structured for AI understanding
     */
    buildImprovedDifferentialPrompt(params) {
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

        // Get instructions
        const instructions = this.getCompactEditInstructions(editType, {
            intensityChange,
            customInstructions
        });

        // Build context lines
        const lines = [
            `=== MUSICAL COMPOSITION EDIT ===`,
            `Title: "${originalJson.title || 'Untitled'}"`,
            `Genre: ${genre} | Key: ${key} | BPM: ${bpm} | Duration: ${duration} bars`,
            ``,
            `=== EDIT INSTRUCTIONS ===`,
            `Target Tracks: ${targetTracks.join(', ')}`,
            `Edit Type: ${instructions}`,
            `Preserve Unchanged: ${unchangedTracks.join(', ') || 'none'}`,
            ``,
            `=== ORIGINAL TRACK DATA ===`
        ];

        // Add track summaries (not full data to save tokens)
        targetTracks.forEach(track => {
            const notation = originalJson.tracks[track] || '';
            const notes = notation.split('\n').filter(l => l.trim());
            const firstNotes = notes.slice(0, 3).join(' | ');
            const noteCount = notes.length;
            
            lines.push(`${track.toUpperCase()}: ${noteCount} notes | Example: ${firstNotes}${notes.length > 3 ? '...' : ''}`);
        });

        lines.push(``);
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

    getCompactEditInstructions(editType, params) {
        const { intensityChange, customInstructions } = params;
        const pct = Math.abs(Math.round(intensityChange * 100));

        const compact = {
            intensity_up: `INCREASE INTENSITY by ${pct}% - Add more notes, increase velocity (louder), shorter note durations, more rhythmic activity`,
            intensity_down: `DECREASE INTENSITY by ${pct}% - Remove some notes, decrease velocity (softer), longer note durations, simpler rhythm`,
            simplify: `SIMPLIFY - Remove 30-40% of notes, use longer durations, simpler rhythmic patterns, less syncopation`,
            complexify: `ADD COMPLEXITY - Add 30-40% more notes, shorter durations, more syncopation, rhythmic variations`,
            change_rhythm: `CHANGE RHYTHMIC FEEL - Keep same pitches but completely transform the rhythm pattern`,
            transpose_up: `TRANSPOSE UP ONE OCTAVE (+12 semitones) - Same rhythm and velocities, just higher pitch`,
            transpose_down: `TRANSPOSE DOWN ONE OCTAVE (-12 semitones) - Same rhythm and velocities, just lower pitch`,
            custom: `CUSTOM EDIT: ${customInstructions?.substring(0, 150) || 'Apply custom modifications as specified'}`
        };

        return compact[editType] || compact.custom;
    }

    generateEditDescription(editRequest) {
        const { targetTracks, editType, intensityChange } = editRequest;
        const trackList = targetTracks.join('+');
        const pct = Math.abs(Math.round(intensityChange * 100));
        
        const desc = {
            intensity_up: `${trackList} +${pct}% energy`,
            intensity_down: `${trackList} -${pct}% energy`,
            simplify: `${trackList} simplified`,
            complexify: `${trackList} complexified`,
            change_rhythm: `${trackList} new rhythm`,
            transpose_up: `${trackList} up 8va`,
            transpose_down: `${trackList} down 8va`,
            custom: `${trackList} custom edit`
        };

        return desc[editType] || `${trackList} edited`;
    }

    parseDifferentialResponse(responseText, expectedTracks) {
        try {
            // Find JSON in response
            let cleaned = responseText;
            
            // Remove markdown code blocks
            cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
            cleaned = cleaned.trim();

            // Find JSON object
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            
            if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
                throw new Error('No valid JSON object found in response');
            }

            const jsonText = cleaned.substring(firstBrace, lastBrace + 1);
            
            // Try to parse
            let parsed;
            try {
                parsed = JSON.parse(jsonText);
            } catch (parseError) {
                // Try to fix common JSON issues
                let fixed = jsonText;
                // Remove trailing commas
                fixed = fixed.replace(/,\s*([\}\]])/g, '$1');
                // Fix single quotes
                fixed = fixed.replace(/'/g, '"');
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
                // Try to get edited version
                const edited = editedTracks[abbrev] || editedTracks[trackName];
                if (edited && typeof edited === 'string' && edited.trim().length > 0) {
                    mergedTracks[trackName] = edited;
                } else {
                    // Fallback to original if edit is empty/invalid
                    console.warn(`No valid edit for ${trackName}, keeping original`);
                    mergedTracks[trackName] = originalTracks[trackName];
                }
            } else {
                // Keep unchanged
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
    // EXISTING METHODS (with improvements)
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

            this.app.ui.showMessage('JSON is valid. Ready to generate.', 'success');
            const generateBtn = document.getElementById('generate-variations');
            const applyEditBtn = document.getElementById('apply-track-edit');
            if (generateBtn) generateBtn.disabled = false;
            if (applyEditBtn) applyEditBtn.disabled = false;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            this.app.ui.showMessage('Invalid JSON format.', 'warning');
            const generateBtn = document.getElementById('generate-variations');
            const applyEditBtn = document.getElementById('apply-track-edit');
            if (generateBtn) generateBtn.disabled = true;
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
        const generateBtn = document.getElementById('generate-variations');
        const downloadBtn = document.getElementById('download-all-zip');
        const applyEditBtn = document.getElementById('apply-track-edit');

        if (rawJsonInput) rawJsonInput.value = '';
        if (versionsList) versionsList.innerHTML = '<p>Your generated versions will appear here.</p>';
        
        if (sourceTitle) sourceTitle.textContent = '';
        if (sourceExplanation) sourceExplanation.textContent = '';
        if (sourceDetails && sourceDetails.querySelector('p')) {
            sourceDetails.querySelector('p').style.display = 'block';
        }
        
        if (generateBtn) generateBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = true;
        if (applyEditBtn) applyEditBtn.disabled = true;

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

            const generateBtn = document.getElementById('generate-variations');
            const applyEditBtn = document.getElementById('apply-track-edit');
            if (generateBtn) generateBtn.disabled = false;
            if (applyEditBtn) applyEditBtn.disabled = false;
            
            this.app.ui.showMessage('Composition loaded. Generate variations or edit tracks!', 'info');

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
            const noteLine = notesStr.split('\n').filter(l => l.trim());
            for (const note of noteLine) {
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
            listEl.innerHTML = '<p>Your generated versions will appear here.</p>';
            const downloadBtn = document.getElementById('download-all-zip');
            if (downloadBtn) downloadBtn.disabled = true;
            return;
        }

        this.versions.forEach((version, index) => {
            const card = document.createElement('div');
            card.className = 'variation-card';
            
            const editBadge = version.editDetails ? 
                `<span style="display: inline-block; padding: 2px 8px; background: #7c3aed; color: white; border-radius: 12px; font-size: 0.7rem; margin-left: 8px;">EDIT</span>` : '';
            
            const structureBadge = version.structure ? 
                `<span style="display: inline-block; padding: 2px 8px; background: ${version.isOriginal ? '#10b981' : '#3b82f6'}; color: white; border-radius: 12px; font-size: 0.7rem; margin-left: 8px;">${version.structure}</span>` : '';
            
            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${version.apiResponse.title} ${version.isOriginal ? '(Original)' : ''}${editBadge}${structureBadge}</h4>
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
    
    loadVersion(index) {
        try {
            const version = this.versions[index];
            if (!version) {
                this.app.ui.showMessage('Version not found.', 'error');
                return;
            }

            const tracks = this.parseNotationToTracks(version.apiResponse.notation);
            
            if (tracks.size === 0) {
                this.app.ui.showMessage('Cannot load an empty version.', 'error');
                return;
            }

            this.app.generatedTracks = tracks;
            this.app.compositionTitle = version.apiResponse.title;
            this.app.compositionDescription = version.apiResponse.explanation;
            
            this.updateVisualizer(
                tracks,
                version.apiResponse.title,
                version.apiResponse.explanation
            );
            
            this.app.ui.updateButtonStates(true);
            this.app.ui.showMessage(`Loaded "${version.apiResponse.title}" into the main player.`, 'success');

        } catch (error) {
            console.error('Error loading version:', error);
            this.app.ui.showMessage(`Failed to load version: ${error.message}`, 'error');
        }
    }

    updateVisualizer(tracks, title, description) {
        try {
            this.app.visualizer.compositionTitle = title;
            this.app.visualizer.compositionDescription = description;
            this.app.visualizer.loadNotes(tracks, title, description);
            this.app.visualizer.updateTrackSelectors();
            this.app.visualizer.stopVisualization();
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();
        } catch (error) {
            console.error('Visualizer update failed:', error);
            throw error;
        }
    }

    extractTrackTypesFromNotation(notationString) {
        if (!notationString) return [];
        const lines = notationString.replace(/\\n/g, '\n').split('\n');
        const trackTypes = new Set();
        
        for (const line of lines) {
            if (line.includes('#')) {
                const parts = line.split('#');
                if (parts.length > 1) {
                    const trackType = parts[1].trim().split(/\s/)[0];
                    if (trackType && trackType.length > 0) {
                        trackTypes.add(trackType);
                    }
                }
            }
        }
        return Array.from(trackTypes);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COMPACT STRUCTURE VARIATIONS (with improvements)
    // ═══════════════════════════════════════════════════════════════════════════════

    getCompactStructureInstructions(structure, genre, mood, trackTypes) {
        const has = (t) => trackTypes.includes(t);
        
        const selectTracks = (min, max, priority) => {
            const selected = [];
            for (const track of priority) {
                if (has(track) && selected.length < max) selected.push(track);
            }
            if (selected.length < min) {
                for (const track of trackTypes) {
                    if (!selected.includes(track) && selected.length < min) selected.push(track);
                }
            }
            return selected.slice(0, max);
        };

        const instructions = {
            intro: () => {
                const t = selectTracks(1, 2, ['pad-textures', 'chord', 'strings']);
                return `INTRO: ${mood} atmosphere, sparse texture, ${t.join('+')}, velocity 0.25-0.45, build tension gradually`;
            },
            build: () => {
                const t = selectTracks(2, 4, ['arpeggio', 'bassline', 'chord', 'plucks']);
                return `BUILD-UP: 30%→85% energy, add ${t.slice(2).join('+') || 'layers'}, accelerating rhythms, velocity 0.35→0.75`;
            },
            verse: () => {
                const t = selectTracks(2, 4, ['melody', 'chord', 'bassline', 'keys']);
                return `VERSE: 60% energy, ${t.join('+')}, steady groove, velocity 0.5-0.7, leave space for development`;
            },
            chorus: () => {
                const t = selectTracks(3, 5, ['melody', 'lead', 'chord', 'bassline', 'plucks']);
                return `CHORUS: 90-100% energy, all ${t.join('+')}, maximum intensity, velocity 0.75-0.95, hook melody`;
            },
            bridge: () => {
                const t = selectTracks(1, 3, ['pad-textures', 'strings', 'melody']);
                return `BRIDGE: contrast section, ${t.join('+')}, 40-60% energy, velocity 0.4-0.6, reset for final chorus`;
            },
            breakdown: () => {
                const t = selectTracks(1, 2, ['melody', 'pad-textures']);
                return `BREAKDOWN: 20-40% energy, ${t.join('+')}, strip back to essentials, velocity 0.3-0.5, build to drop`;
            },
            outro: () => {
                const t = selectTracks(1, 3, ['pad-textures', 'chord', 'melody']);
                return `OUTRO: 60%→10% energy, ${t.join('+')}, fade out gradually, velocity 0.6→0.2, resolve tension`;
            }
        };

        return (instructions[structure] || instructions.verse)();
    }

    buildVariationPrompt(originalJson, structure, originalTrackTypes, duration) {
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const beatsPerBar = parseInt((document.getElementById('time-signature')?.value || '4/4').split('/')[0], 10) || 4;
        const totalBeats = parseInt(duration) * beatsPerBar;
        const genre = (document.getElementById('style')?.value || 'house').toLowerCase();
        const mood = (document.getElementById('mood')?.value || 'mysterious').toLowerCase();
        const key = (document.getElementById('key')?.value || 'C');

        const trackAbbrevs = originalTrackTypes.map(t => trackAbbreviations[t] || t);
        const structureInstructions = this.getCompactStructureInstructions(structure, genre, mood, originalTrackTypes);

        // Improved prompt with better structure
        const lines = [
            `=== MUSICAL VARIATION ===`,
            `Base Composition: "${originalJson.title}"`,
            `Variation Type: ${structure.toUpperCase()}`,
            `Genre: ${genre} | Mood: ${mood} | Key: ${key} | BPM: ${bpm}`,
            `Duration: ${duration} bars (${totalBeats} beats)`,
            ``,
            `=== STRUCTURE INSTRUCTIONS ===`,
            structureInstructions,
            ``,
            `=== AVAILABLE TRACKS ===`,
            `Full names: ${originalTrackTypes.join(', ')}`,
            `Abbreviations: ${trackAbbrevs.join(', ')}`,
            ``,
            `=== OUTPUT REQUIREMENTS ===`,
            `1. Generate ONLY the tracks listed above`,
            `2. Use track abbreviations as keys in the tracks object`,
            `3. Note format: "pitch,beat,duration,velocity" (one per line, or pipe-separated)`,
            `4. Velocity range: 0.1-1.0`,
            `5. Total duration must match: ${totalBeats} beats`,
            ``,
            `=== RESPONSE FORMAT ===`,
            `{"title":"${originalJson.title} - ${structure}","desc":"${structure} ${genre} ${mood}","tracks":{${trackAbbrevs.map(t => `"${t}":"..."`).join(',')}}}`
        ];

        return lines.join('\n');
    }

    async generateVariation() {
        if (!this.sourceJson) {
            this.app.ui.showMessage('Please provide a source JSON.', 'warning');
            return;
        }

        const selectedStructure = document.getElementById('structure-select')?.value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a version type.', 'warning');
            return;
        }

        const selectedDuration = parseInt(document.getElementById('variation-duration')?.value, 10) || 4;

        let sourceVersion;
        try {
            const currentJson = JSON.parse(this.sourceJson);
            sourceVersion = {
                apiResponse: currentJson,
                context: this.versions.find(v => v.isOriginal)?.context || {},
                isOriginal: true,
                structure: 'Original'
            };
        } catch (e) {
            this.app.ui.showMessage('Invalid JSON. Cannot generate variation.', 'error');
            return;
        }
        
        let trackTypes = this.extractTrackTypesFromNotation(sourceVersion.apiResponse.notation);
        if (trackTypes.length === 0 && sourceVersion.apiResponse.tracks) {
            trackTypes = Object.keys(sourceVersion.apiResponse.tracks);
        }

        if (trackTypes.length === 0) {
            this.app.ui.showMessage('No tracks found in composition.', 'error');
            return;
        }

        // Retry logic
        const MAX_RETRIES = 2;
        let lastError;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                this.app.ui.showLoading(`Generating "${selectedStructure}"${attempt > 1 ? ` (retry ${attempt-1})` : ''}...`);

                const variationPrompt = this.buildVariationPrompt(
                    sourceVersion.apiResponse, 
                    selectedStructure, 
                    trackTypes, 
                    selectedDuration
                );

                // Get BYOP key if available
                const userApiKey = localStorage.getItem('byop_pollinations_key') || undefined;

                const response = await fetchWithModelFallbacks('/api/variations', 
                    ['openai-large', 'claude-fast', 'openai'],
                    this.app.ui, 
                    { 
                        prompt: variationPrompt, 
                        seed: Math.floor(Math.random() * 100000) + attempt,
                        timeout: 60000,
                        userApiKey
                    }
                );

                const responseText = await response.text();
                
                if (!responseText || responseText.length < 100) {
                    throw new Error('Empty or too short response from AI');
                }

                const variationJson = this.parseVariationResponse(responseText, trackTypes);
                
                const newVersion = {
                    apiResponse: variationJson,
                    context: sourceVersion.context,
                    isOriginal: false,
                    structure: selectedStructure
                };

                this.versions.push(newVersion);
                this.renderVersionsList();
                this.app.ui.showMessage(`Generated "${selectedStructure}" version.`, 'success');
                return; // Success

            } catch (error) {
                lastError = error;
                console.error('Variation generation failed:', error);
                
                // Check for BYOP requirement
                if (error.requiresByop || error.message?.includes('daily_limit_reached')) {
                    this.app.ui.hideLoading();
                    this.app.showByopModal?.(error.resetAt);
                    return;
                }
                
                let msg = `Failed: ${error.message}`;
                if (error.message?.includes('timeout')) {
                    msg = 'Generation timed out. Try a shorter duration or simpler structure.';
                }
                
                if (attempt < MAX_RETRIES) {
                    this.app.ui.showMessage(`${msg} Retrying...`, 'warning');
                    await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
                } else {
                    this.app.ui.showMessage(msg, 'error');
                }
            }
        }

        this.app.ui.hideLoading();
    }

    parseVariationResponse(responseText, expectedTrackTypes) {
        try {
            // Clean markdown
            let cleanedJson = responseText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
            
            // Find JSON object
            const firstBrace = cleanedJson.indexOf('{');
            const lastBrace = cleanedJson.lastIndexOf('}');

            if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
                throw new Error('No JSON object found in response');
            }

            const jsonText = cleanedJson.substring(firstBrace, lastBrace + 1);
            
            // Try parse with fixes
            let parsed;
            try {
                parsed = JSON.parse(jsonText);
            } catch (parseError) {
                // Apply fixes
                let fixed = jsonText
                    .replace(/,\s*([\}\]])/g, '$1') // trailing commas
                    .replace(/'/g, '"'); // single quotes
                parsed = JSON.parse(fixed);
            }

            if (!parsed.title || !parsed.tracks) {
                throw new Error('Missing title or tracks in response');
            }

            // Validate tracks
            const reverseAbbrev = Object.fromEntries(
                Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
            );

            // Convert tracks to notation format
            let notation = parsed.notation || '';
            if (parsed.tracks && typeof parsed.tracks === 'object') {
                const lines = [];
                for (const [trackAbbr, notesStr] of Object.entries(parsed.tracks)) {
                    if (!notesStr || typeof notesStr !== 'string') continue;
                    
                    const trackFull = reverseAbbrev[trackAbbr] || trackAbbr;
                    const noteLines = notesStr.replace(/\\n/g, '\n').split('\n').filter(l => l.trim());
                    
                    for (const noteLine of noteLines) {
                        // Skip header lines
                        if (noteLine.match(/^(pitch|note|midi)/i)) continue;
                        if (noteLine.trim()) {
                            lines.push(`${noteLine.trim()} # ${trackFull}`);
                        }
                    }
                }
                notation = lines.join('\n');
            }

            return {
                title: parsed.title,
                explanation: parsed.description || parsed.explanation || parsed.desc || '',
                notation: notation
            };

        } catch (error) {
            console.error("Parse error:", error, "Response:", responseText.substring(0, 500));
            throw new Error(`Could not parse AI response: ${error.message}`);
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
            const zipFilename = `${sanitizedSourceTitle}-variations.zip`;

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
