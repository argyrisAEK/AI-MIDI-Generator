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

        availableTracks.forEach(track => {
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
    // 🔥 COMPACT DIFFERENTIAL EDITING - Optimized for speed
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

        // Build compact prompt (under 2000 tokens ideally)
        const prompt = this.buildCompactDifferentialPrompt({
            originalJson: original,
            targetTracks,
            unchangedTracks,
            editType,
            customInstructions,
            intensityChange,
            genre: document.getElementById('style')?.value || 'house',
            bpm: parseInt(document.getElementById('bpm')?.value, 10) || 120,
            key: document.getElementById('key')?.value || 'C'
        });

        try {
            this.app.ui.showLoading(`Editing ${targetTracks.join(', ')}...`);

            // Use faster models with shorter timeout
            const response = await fetchWithModelFallbacks('/api/variations', 
                ['openai', 'claude-fast'],  // Faster models first
                this.app.ui, 
                { 
                    prompt, 
                    seed: Math.floor(Math.random() * 100000),
                    timeout: 45000  // 45 seconds instead of 90
                }
            );

            const responseText = await response.text();
            
            // Check if response is empty or too short
            if (!responseText || responseText.length < 50) {
                throw new Error('Empty or invalid response from AI');
            }

            const editedTracks = this.parseDifferentialResponse(responseText, targetTracks);

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

        } catch (error) {
            console.error('Differential edit failed:', error);
            
            // User-friendly error messages
            let userMessage = `Edit failed: ${error.message}`;
            if (error.message.includes('504') || error.message.includes('timeout')) {
                userMessage = 'Edit timed out. The AI is taking too long. Try a simpler edit or fewer tracks.';
            } else if (error.message.includes('Empty')) {
                userMessage = 'AI returned empty response. Please try again.';
            }
            
            this.app.ui.showMessage(userMessage, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    /**
     * COMPACT prompt - under 1500 tokens for speed
     */
    buildCompactDifferentialPrompt(params) {
        const {
            originalJson,
            targetTracks,
            unchangedTracks,
            editType,
            customInstructions,
            intensityChange,
            genre,
            bpm,
            key
        } = params;

        // Get compact instructions
        const instructions = this.getCompactEditInstructions(editType, {
            intensityChange,
            customInstructions
        });

        // Show only first 2 notes of each target track as example
        const targetSamples = targetTracks.map(t => {
            const notation = originalJson.tracks[t] || '';
            const lines = notation.split('\\n').filter(l => l.trim());
            const sample = lines.slice(0, 2).join('\\n');
            return `${t}:${sample}${lines.length > 2 ? '...' : ''}`;
        }).join('|');

        return `EDIT ${targetTracks.join('+')} for ${genre} track "${originalJson.title}"
KEY:${key} BPM:${bpm}

EDIT:${instructions}

TARGETS:${targetSamples}
PRESERVE:${unchangedTracks.join(',') || 'none'}

RULES:
- Modify ONLY target tracks
- Return ONLY modified tracks as JSON
- Format: "track":"pitch,beat,dur,vel\\n..."
- Same duration as original
- Match key/tempo

RESPONSE:
{"title":"[edited]","desc":"${this.generateEditDescription({editType, targetTracks, intensityChange})}","tracks":{${targetTracks.map(t => `"${trackAbbreviations[t]||t}":"..."`).join(',')}}}`;
    }

    getCompactEditInstructions(editType, params) {
        const { intensityChange, customInstructions } = params;
        const pct = Math.abs(Math.round(intensityChange * 100));

        const compact = {
            intensity_up: `INTENSITY+${pct}%:higher vel,more notes,shorter dur`,
            intensity_down: `INTENSITY-${pct}%:lower vel,fewer notes,longer dur`,
            simplify: `SIMPLIFY:remove 40% notes,longer durations,simpler rhythm`,
            complexify: `COMPLEXIFY:add 40% notes,shorter durations,more syncopation`,
            change_rhythm: `NEW RHYTHM:same pitches,completely different rhythm pattern`,
            transpose_up: `UP 8VA:+12 semitones,same rhythm,adjust vel if needed`,
            transpose_down: `DOWN 8VA:-12 semitones,same rhythm,adjust vel if needed`,
            custom: `CUSTOM:${customInstructions?.substring(0, 100) || 'as requested'}`
        };

        return compact[editType] || compact.custom;
    }

    generateEditDescription(editRequest) {
        const { targetTracks, editType, intensityChange } = editRequest;
        const trackList = targetTracks.join('+');
        const pct = Math.abs(Math.round(intensityChange * 100));
        
        const desc = {
            intensity_up: `${trackList}+${pct}%`,
            intensity_down: `${trackList}-${pct}%`,
            simplify: `${trackList} simple`,
            complexify: `${trackList} complex`,
            change_rhythm: `${trackList} new rhythm`,
            transpose_up: `${trackList} up 8va`,
            transpose_down: `${trackList} down 8va`,
            custom: `${trackList} custom`
        };

        return desc[editType] || `${trackList} edited`;
    }

    parseDifferentialResponse(responseText, expectedTracks) {
        try {
            // Find JSON in response
            const cleaned = responseText.replace(/```json\s*|\s*```/g, '').trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            
            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error('No JSON found');
            }

            const jsonText = cleaned.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonText);

            if (!parsed.tracks || typeof parsed.tracks !== 'object') {
                throw new Error('Missing tracks');
            }

            return parsed.tracks;

        } catch (error) {
            console.error('Parse error:', error, 'Response:', responseText.substring(0, 200));
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
                mergedTracks[trackName] = edited || originalTracks[trackName];
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
    // COMPACT STRUCTURE VARIATIONS
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
                return `INTRO:${mood},sparse,${t.join('+')},vel 0.25-0.45,build tension`;
            },
            build: () => {
                const t = selectTracks(2, 4, ['arpeggio', 'bassline', 'chord', 'plucks']);
                return `BUILD:30%→85% energy,add ${t.slice(2).join('+')||'layers'},acc rhythms,vel 0.35→0.75`;
            },
            verse: () => {
                const t = selectTracks(2, 4, ['melody', 'chord', 'bassline', 'keys']);
                return `VERSE:60% energy,${t.join('+')},steady groove,vel 0.5-0.7,space for vocals`;
            },
            chorus: () => {
                const t = selectTracks(3, 5, ['melody', 'lead', 'chord', 'bassline', 'plucks']);
                return `CHORUS:90-100% energy,all ${t.join('+')},max power,vel 0.75-0.95,hook`;
            },
            bridge: () => {
                const t = selectTracks(1, 3, ['pad-textures', 'strings', 'melody']);
                return `BRIDGE:contrast,${t.join('+')},40-60% energy,vel 0.4-0.6,reset for chorus`;
            },
            breakdown: () => {
                const t = selectTracks(1, 2, ['melody', 'pad-textures']);
                return `BREAK:20-40% energy,${t.join('+')},strip drums,vel 0.3-0.5,build to drop`;
            },
            outro: () => {
                const t = selectTracks(1, 3, ['pad-textures', 'chord', 'melody']);
                return `OUTRO:60%→10% energy,${t.join('+')},fade out,vel 0.6→0.2,resolve`;
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

        // Compact prompt
        return `VARIATION:${structure.toUpperCase()} for ${genre}
TITLE:${originalJson.title}
KEY:${key} BPM:${bpm} DUR:${duration}b (${totalBeats}beats)
${structureInstructions}

TRACKS:${originalTrackTypes.join(',')}
ABBRS:${trackAbbrevs.join(',')}

FORMAT:pitch,beat,duration,velocity\\n...

RESPONSE:
{"title":"${originalJson.title} - ${structure}","desc":"${structure} ${genre} ${mood}","tracks":{${trackAbbrevs.map(t => `"${t}":"..."`).join(',')}}}`;
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

        try {
            this.app.ui.showLoading(`Generating "${selectedStructure}"...`);

            const variationPrompt = this.buildVariationPrompt(
                sourceVersion.apiResponse, 
                selectedStructure, 
                trackTypes, 
                selectedDuration
            );

            const response = await fetchWithModelFallbacks('/api/variations', 
                ['openai', 'claude-fast'],  // Faster models
                this.app.ui, 
                { 
                    prompt: variationPrompt, 
                    seed: Math.floor(Math.random() * 100000),
                    timeout: 60000  // 60 seconds
                }
            );

            const responseText = await response.text();
            
            if (!responseText || responseText.length < 50) {
                throw new Error('Empty response from AI');
            }

            const variationJson = this.parseVariationResponse(responseText);
            
            const newVersion = {
                apiResponse: variationJson,
                context: sourceVersion.context,
                isOriginal: false,
                structure: selectedStructure
            };

            this.versions.push(newVersion);
            this.renderVersionsList();
            this.app.ui.showMessage(`Generated "${selectedStructure}" version.`, 'success');

        } catch (error) {
            console.error('Variation generation failed:', error);
            let msg = `Failed: ${error.message}`;
            if (error.message.includes('504') || error.message.includes('timeout')) {
                msg = 'Generation timed out. Try a shorter duration or simpler structure.';
            }
            this.app.ui.showMessage(msg, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    parseVariationResponse(responseText) {
        try {
            const cleanedJson = responseText.replace(/```json\s*|\s*```/g, '').trim();
            const firstBrace = cleanedJson.indexOf('{');
            const lastBrace = cleanedJson.lastIndexOf('}');

            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error('No JSON found');
            }

            const jsonText = cleanedJson.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonText);

            if (!parsed.title || !parsed.tracks) {
                throw new Error('Missing title or tracks');
            }

            const reverseAbbrev = Object.fromEntries(
                Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
            );

            let notation = parsed.notation || '';
            if (parsed.tracks && typeof parsed.tracks === 'object') {
                const lines = [];
                for (const [trackAbbr, notesStr] of Object.entries(parsed.tracks)) {
                    if (!notesStr) continue;
                    const trackFull = reverseAbbrev[trackAbbr] || trackAbbr;
                    const noteLines = notesStr.replace(/\\n/g, '\n').split('\n').filter(l => l.trim());
                    for (const noteLine of noteLines) {
                        if (noteLine && !noteLine.startsWith('pitch')) {
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
            console.error("Parse error:", error);
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
