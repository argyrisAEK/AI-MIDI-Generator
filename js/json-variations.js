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
        
        // NEW: Track edit panel listeners
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

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🎛️ TRACK EDIT PANEL UI MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

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
            
            // Hover effect
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
    // 🔥 DIFFERENTIAL EDITING - CORE METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    async applyTrackEdit() {
        const targetTracks = this.getSelectedEditTracks();
        const editType = document.getElementById('edit-type')?.value;
        const customInstructions = document.getElementById('custom-edit-instructions')?.value;
        const intensityValue = parseInt(document.getElementById('intensity-slider')?.value || 0) / 100;

        // Validation
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

        // Prepare edit request
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
            intensityChange,
            preserveOtherTracks = true
        } = editRequest;

        // Parse original
        let original;
        try {
            original = JSON.parse(this.sourceJson);
        } catch (e) {
            this.app.ui.showMessage('Invalid source JSON. Cannot perform edit.', 'error');
            return;
        }

        const originalTracks = original.tracks || {};
        const availableTracks = Object.keys(originalTracks);

        // Validate target tracks exist
        for (const track of targetTracks) {
            if (!availableTracks.includes(track)) {
                this.app.ui.showMessage(`Track "${track}" not found in composition.`, 'error');
                return;
            }
        }

        // Tracks that won't change
        const unchangedTracks = availableTracks.filter(t => !targetTracks.includes(t));

        // Build differential prompt
        const prompt = this.buildDifferentialPrompt({
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

            const response = await fetchWithModelFallbacks('/api/variations', 
                ['openai-large', 'openai'], 
                this.app.ui, 
                { prompt, seed: Math.floor(Math.random() * 100000) }
            );

            const responseText = await response.text();
            const editedTracks = this.parseDifferentialResponse(responseText, targetTracks);

            // Merge with original
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

            // Create new version
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
            
            // Update raw input
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
            this.app.ui.showMessage(`Edit failed: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    buildDifferentialPrompt(params) {
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

        const editInstructions = this.getEditTypeInstructions(editType, {
            intensityChange,
            customInstructions,
            genre
        });

        // Show sample of original notation for context
        const targetSamples = targetTracks.map(t => {
            const notation = originalJson.tracks[t] || '';
            const sample = notation.split('\\n').slice(0, 3).join('\\n');
            return `• ${t.toUpperCase()}:\n  ${sample}${notation.split('\\n').length > 3 ? '\\n  ...' : ''}`;
        }).join('\n\n');

        return `You are an expert music editor specializing in surgical, precise edits. Modify ONLY the specified tracks while preserving all others exactly.

═══════════════════════════════════════════════════════════════════
COMPOSITION CONTEXT
═══════════════════════════════════════════════════════════════════
Title: ${originalJson.title}
Genre: ${genre.toUpperCase()} | BPM: ${bpm} | Key: ${key}

═══════════════════════════════════════════════════════════════════
TRACKS TO EDIT (MODIFY THESE EXACTLY)
═══════════════════════════════════════════════════════════════════
${targetSamples}

═══════════════════════════════════════════════════════════════════
EDIT INSTRUCTIONS
═══════════════════════════════════════════════════════════════════
${editInstructions}

═══════════════════════════════════════════════════════════════════
TRACKS TO PRESERVE (DO NOT MODIFY - KEEP IDENTICAL)
═══════════════════════════════════════════════════════════════════
${unchangedTracks.length > 0 ? unchangedTracks.join(', ') : 'None (all tracks being edited)'}

CRITICAL RULES:
1. Return ONLY the modified tracks: ${targetTracks.join(', ')}
2. DO NOT include unchanged tracks in your response
3. Maintain exact same format: pitch,beat,duration,velocity\\n...
4. Stay within same total duration as original
5. Preserve harmonic compatibility with unchanged tracks
6. Use ONLY escaped newlines (\\\\n) in JSON strings

═══════════════════════════════════════════════════════════════════
RESPONSE FORMAT - Return ONLY modified tracks:
═══════════════════════════════════════════════════════════════════

{
  "title": "${originalJson.title} [${targetTracks.join(', ')} edited]",
  "description": "${this.generateEditDescription({editType, targetTracks, intensityChange, customInstructions})}",
  "tracks": {
${targetTracks.map(t => {
    const abbrev = trackAbbreviations[t] || t;
    return `    "${abbrev}": "pitch,beat,duration,velocity\\\\npitch2,beat2,dur2,vel2\\\\n..."`;
}).join(',\n')}
  }
}

Perform the edit now. Output ONLY the JSON with modified tracks.`;
    }

    getEditTypeInstructions(editType, params) {
        const { intensityChange, customInstructions, genre } = params;

        const instructions = {
            intensity_up: `INCREASE INTENSITY by ${Math.abs(Math.round(intensityChange * 100))}%:
• Raise velocities by ~${Math.abs(Math.round(intensityChange * 100))}% (max 0.95)
• Add ${Math.abs(Math.round(intensityChange * 50))}% more note density
• Shorten note durations for more attack and punch
• Increase rhythmic activity and syncopation
• Make pattern more driving and energetic`,

            intensity_down: `DECREASE INTENSITY by ${Math.abs(Math.round(intensityChange * 100))}%:
• Lower velocities by ~${Math.abs(Math.round(intensityChange * 100))}% (min 0.2)
• Reduce note density by ${Math.abs(Math.round(intensityChange * 50))}%
• Lengthen note durations for smoother, sustained feel
• Simplify rhythmic patterns
• Create more space and breathing room`,

            simplify: `SIMPLIFY - Reduce musical complexity:
• Remove 30-50% of notes (keep only the essential ones)
• Convert fast passages to longer sustained notes
• Reduce rhythmic subdivision (16ths → 8ths → quarters)
• Narrow octave range to middle register
• Make pattern more repetitive and predictable
• Remove ornamental notes, keep core melody/harmony`,

            complexify: `ADD COMPLEXITY - Enhance musical interest:
• Add 30-50% more notes (fill rhythmic gaps)
• Introduce shorter durations (add 16ths, 32nds where appropriate)
• Add rhythmic variations and syncopation
• Extend range with occasional high/low accents
• Vibrate repeated patterns with subtle changes
• Add passing tones, neighbor tones, embellishments`,

            change_rhythm: `CHANGE RHYTHMIC FEEL - Transform groove:
• Keep exact same pitches and harmonic structure
• Completely reinvent the rhythmic pattern
• If ${genre} typically has swing, make it straight (or vice versa)
• Shift accent patterns (on-beats ↔ off-beats)
• Change articulation: staccato ↔ legato ↔ mixed
• Alter metric emphasis (syncopation, hemiola effects)`,

            transpose_up: `TRANSPOSE UP ONE OCTAVE:
• Shift every note up 12 semitones (+12 MIDI numbers)
• Keep all rhythmic relationships identical
• Adjust velocities if needed for new register (often slightly softer)
• Preserve all note durations and timing exactly
• Result should be recognizable as same part, just higher`,

            transpose_down: `TRANSPOSE DOWN ONE OCTAVE:
• Shift every note down 12 semitones (-12 MIDI numbers)
• Keep all rhythmic relationships identical
• May need velocity boost for lower register audibility
• Preserve all note durations and timing exactly
• Watch for notes going below MIDI 36 (adjust if needed)`,

            custom: `CUSTOM EDIT - Follow these specific instructions:
${customInstructions}

Apply these changes while maintaining musical coherence with the rest of the composition.`
        };

        return instructions[editType] || instructions.custom;
    }

    generateEditDescription(editRequest) {
        const { targetTracks, editType, intensityChange, customInstructions } = editRequest;
        const trackList = targetTracks.join(', ');
        
        const descriptions = {
            intensity_up: `${trackList}: intensity +${Math.abs(Math.round(intensityChange * 100))}%`,
            intensity_down: `${trackList}: intensity ${Math.round(intensityChange * 100)}%`,
            simplify: `${trackList}: simplified`,
            complexify: `${trackList}: added complexity`,
            change_rhythm: `${trackList}: new rhythmic feel`,
            transpose_up: `${trackList}: transposed up octave`,
            transpose_down: `${trackList}: transposed down octave`,
            custom: `${trackList}: custom edit`
        };

        return descriptions[editType] || `${trackList}: edited`;
    }

    parseDifferentialResponse(responseText, expectedTracks) {
        try {
            const cleaned = responseText.replace(/```json\s*|\s*```/g, '').trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            
            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error('No JSON object found in response');
            }

            const jsonText = cleaned.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonText);

            if (!parsed.tracks || typeof parsed.tracks !== 'object') {
                throw new Error('Response missing tracks object');
            }

            // Validate we got what we expected
            const receivedTracks = Object.keys(parsed.tracks);
            const reverseAbbrev = Object.fromEntries(
                Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
            );

            const normalizedReceived = receivedTracks.map(t => reverseAbbrev[t] || t);
            const missing = expectedTracks.filter(t => !normalizedReceived.includes(t));

            if (missing.length > 0) {
                console.warn('Missing expected tracks:', missing);
            }

            return parsed.tracks;

        } catch (error) {
            console.error('Failed to parse differential response:', error);
            throw new Error(`Could not parse edit response: ${error.message}`);
        }
    }

    mergeDifferentialChanges({ originalTracks, editedTracks, targetTracks, originalMetadata, editDescription }) {
        const reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
        );

        // Build merged tracks
        const mergedTracks = {};
        const allTrackNames = Object.keys(originalTracks);

        for (const trackName of allTrackNames) {
            const abbrev = trackAbbreviations[trackName] || trackName;
            
            if (targetTracks.includes(trackName)) {
                // Use edited version
                const edited = editedTracks[abbrev] || editedTracks[trackName];
                if (!edited) {
                    console.warn(`Missing edit for ${trackName}, keeping original`);
                    mergedTracks[trackName] = originalTracks[trackName];
                } else {
                    mergedTracks[trackName] = edited;
                }
            } else {
                // Preserve original exactly
                mergedTracks[trackName] = originalTracks[trackName];
            }
        }

        // Convert to notation format
        const notation = this.buildNotationFromTracks(mergedTracks);

        return {
            title: `${originalMetadata.title} [${targetTracks.join(', ')} edited]`,
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
    // EXISTING METHODS (with enhancements)
    // ═══════════════════════════════════════════════════════════════════════════════

    handleJsonInputChange(e) {
        const newJsonString = e.target.value;
        const rawJsonInput = document.getElementById('raw-json-input');

        try {
            const parsedJson = JSON.parse(newJsonString);
            this.sourceJson = JSON.stringify(parsedJson);

            // NEW: Update track edit checkboxes
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
            this.app.ui.showMessage('Invalid JSON format. Please correct it to generate variations.', 'warning');
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

        // Reset track edit checkboxes
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

            // NEW: Populate track edit checkboxes
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
            
            this.app.ui.showMessage('Composition loaded. You can now generate variations or edit tracks!', 'info');

        } catch (error) {
            console.error('Failed to parse and set source composition:', error);
            this.app.ui.showMessage('Error loading source composition for variations.', 'error');
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
            
            // Add edit badge if applicable
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
    // STRUCTURE VARIATIONS (enhanced with genre awareness)
    // ═══════════════════════════════════════════════════════════════════════════════

    getStructureInstructions(structure, genre, mood, trackTypes) {
        const has = (t) => trackTypes.includes(t);
        
        const genreTraits = {
            'house': { fourOnFloor: true, groove: 'steady', energy: 'medium', swing: 0, characteristics: 'four-on-floor kick, steady groove' },
            'techno': { fourOnFloor: true, groove: 'driving', energy: 'high', swing: 0, characteristics: 'industrial, repetitive, hypnotic' },
            'trance': { fourOnFloor: true, groove: 'uplifting', energy: 'very-high', arpeggios: true, characteristics: 'euphoric builds, rolling bass' },
            'trap': { fourOnFloor: false, groove: 'bouncy', energy: 'high', swing: 0.6, characteristics: '808 slides, hi-hat rolls, half-time feel' },
            'hip-hop': { fourOnFloor: false, groove: 'laid-back', energy: 'medium', swing: 0.5, characteristics: 'boom-bap, sample-based, head-nodding' },
            'rock': { fourOnFloor: false, groove: 'aggressive', energy: 'high', swing: 0, characteristics: 'live drums, guitar-driven, energetic' },
            'pop': { fourOnFloor: false, groove: 'catchy', energy: 'medium-high', swing: 0, characteristics: 'hook-focused, polished, accessible' },
            'funk': { fourOnFloor: false, groove: 'syncopated', energy: 'high', swing: 0.4, characteristics: '16th-note grooves, slap bass, tight' },
            'jazz': { fourOnFloor: false, groove: 'swing', energy: 'medium', swing: 0.7, characteristics: 'swing feel, improvisation, complex harmony' },
            'disco': { fourOnFloor: true, groove: 'four-on-floor', energy: 'high', swing: 0, characteristics: 'orchestral hits, string sections, dance' },
            'ambient': { fourOnFloor: false, groove: 'floating', energy: 'low', swing: 0, characteristics: 'textural, atmospheric, no clear pulse' },
            'cinematic': { fourOnFloor: false, groove: 'epic', energy: 'dynamic', swing: 0, characteristics: 'dynamic range, emotional arcs, orchestral' },
            'synthwave': { fourOnFloor: true, groove: 'retro', energy: 'medium-high', swing: 0, characteristics: '80s nostalgia, analog synths, driving' },
            'progressive-rock': { fourOnFloor: false, groove: 'complex', energy: 'dynamic', swing: 0.3, characteristics: 'odd meters, virtuosic, epic lengths' },
            'drum-and-bass': { fourOnFloor: false, groove: 'breakbeat', energy: 'very-high', swing: 0.2, characteristics: 'fast breakbeats, heavy bass, amen breaks' },
            'downtempo': { fourOnFloor: false, groove: 'relaxed', energy: 'low', swing: 0.3, characteristics: 'slow, trippy, head-nodding, atmospheric' }
        };

        const traits = genreTraits[genre] || genreTraits['house'];
        
        const selectTracks = (min, max, priority) => {
            const selected = [];
            for (const track of priority) {
                if (has(track) && selected.length < max) {
                    selected.push(track);
                }
                if (selected.length >= max) break;
            }
            if (selected.length < min) {
                for (const track of trackTypes) {
                    if (!selected.includes(track) && selected.length < min) {
                        selected.push(track);
                    }
                }
            }
            return selected.slice(0, max);
        };

        const instructions = {
            intro: () => {
                const tracks = selectTracks(1, 2, ['pad-textures', 'chord', 'strings', 'arpeggio', 'bassline']);
                const intensity = traits.energy === 'low' ? 'minimal' : 'sparse';
                
                return `INTRO - Establish atmosphere for ${genre} (${traits.characteristics})
                
MOOD: Mysterious, anticipatory, ${mood}-toned. INTENSITY: ${intensity.toUpperCase()}

USE ONLY ${tracks.length} TRACKS: ${tracks.join(', ')}

• Start with near-silence or ambient wash (1-2 bars)
• Gradually introduce elements every 2-4 beats
• Sustained pads/chords with long attacks (8th-16th fades)
• Bassline: Subtle, enter at bar 2-3 if present
• Melody: Absent or hinted only (2-3 preview notes)
• Velocities: 0.25-0.45 | Density: 15-25%

${traits.fourOnFloor ? '• Implied four-on-floor, not emphasized yet' : '• No strong rhythmic anchor - focus on texture'}

AVOID: Full melody, busy percussion, loud transients`;
            },

            build: () => {
                const tracks = selectTracks(2, 4, ['arpeggio', 'bassline', 'chord', 'plucks', 'pad-textures']);
                
                return `BUILD-UP - Create tension toward climax for ${genre}

ENERGY CURVE: 30% → 85% (exponential increase)

LAYERING STRATEGY:
• Start: Minimal (${tracks.slice(0, 2).join(', ')})
• Middle: Add ${tracks[2] || 'harmonic element'}, increase activity
• End: Nearly full, peak tension

${genre === 'trance' ? '• Rolling bassline enters, filter opens\n• Arpeggio accelerates 1/8 → 1/16 → 1/32' : 
  genre === 'trap' ? '• Hi-hat rolls intensify (1/8 → 1/16 → 1/32 triplets)\n• 808 slides become more prominent' :
  genre === 'techno' ? '• Industrial noise elements increase\n• Hat density builds relentlessly' :
  '• Accelerating rhythmic density\n• Rising pitch patterns'}

• Filter sweep (simulate with velocity/brightness)
• Velocities: 0.35 → 0.75 progressive
• Density: 25% → 65%

${has('arpeggio') ? '• Arpeggio: 1/4 → 1/16 note speed' : ''}
${has('bassline') ? '• Bass: 25% point enter, 75% full energy' : ''}

CRITICAL: End at peak tension, unresolved, ready for drop/chorus`;
            },

            verse: () => {
                const tracks = selectTracks(2, 4, ['melody', 'chord', 'bassline', 'keys', 'plucks']);
                
                return `VERSE - Storytelling section for ${genre}

ENERGY: 60-70% - Established but restrained

MUSICAL DIRECTIVES:
• Complete groove, controlled energy
• Melody: Clear, memorable, slightly subdued (v. 0.55-0.7)
• Harmonic rhythm: Consistent, supportive
• Bass: Locked with groove (v. 0.6-0.75)
• Space for potential vocals/lead

TRACKS: ${tracks.join(', ')}

${genre === 'hip-hop' ? '• Boom-bap drum pattern, sample chops\n• Bass: Sub-heavy, melodic walks' :
  genre === 'pop' ? '• Hook-friendly but not peak energy\n• Clean, polished production values' :
  genre === 'jazz' ? '• Swing feel, walking bass\n• Comping chords, space for solo' :
  '• Genre-appropriate groove: ' + traits.groove}

RHYTHMIC FEEL: ${traits.groove}, swing ${Math.round(traits.swing * 100)}%

Velocities: 0.5-0.7 | Density: 45-60%`;
            },

            chorus: () => {
                const tracks = selectTracks(3, 5, ['melody', 'lead', 'chord', 'bassline', 'plucks', 'strings', 'brass']);
                
                return `CHORUS/DROP - Peak energy for ${genre}

ENERGY: 90-100% - The payoff moment

ALL ESSENTIAL TRACKS: ${tracks.join(', ')}

• Melody/Lead: Full embellishment, highest register (v. 0.75-0.95)
• Harmony: Rich voicings (${genre === 'jazz' || genre === 'funk' ? '7ths, 9ths, extensions' : 'full, wide'})
• Bass: Maximum power and presence
• Transients: Sharp attacks, full energy

${genre === 'trance' ? '• Supersaw chords, sidechain pumping\n• Anthemic lead melody, euphoric' :
  genre === 'trap' ? '• 808 hits hardest, rapid hi-hats\n• Ad-libs space, call-and-response' :
  genre === 'rock' ? '• Power chords, driving drums\n• Guitar harmonies, energetic' :
  '• ' + traits.characteristics + ' at maximum'}

${has('lead') ? '• Lead: Highest register, active rhythm, memorable hook' : ''}
${has('strings') ? '• Strings: Full chords, dramatic swells' : ''}
${has('brass') ? '• Brass: Stabs on downbeats, accents' : ''}

Velocities: 0.75-0.95 | Density: 75-90%

HOOK: First 2 bars establish, middle varies, last 2 set up transition`;
            },

            bridge: () => {
                const tracks = selectTracks(1, 3, ['pad-textures', 'strings', 'melody', 'keys']);
                const contrastTracks = trackTypes.filter(t => !tracks.includes(t)).slice(0, 2);
                
                return `BRIDGE - Contrast and reset for ${genre}

MOOD: ${mood === 'happy' ? 'contemplative' : mood === 'dark' ? 'ethereal hope' : 'contrasting texture'}
ENERGY: 40-60% - Deliberately different

PURPOSE: Contrast before final chorus

CONTRAST TACTICS:
• Different instruments: ${contrastTracks.join(' or ') || 'unused tracks'}
• Register shift: Up (lighter) or down (heavier)
• Harmonic: Relative key, modal interchange, pedal point
• Rhythmic: ${traits.fourOnFloor ? 'Break the four-on-floor, half-time feel' : 'Shift to straight from swing or vice versa'}

TRACKS: ${tracks.join(', ')} (intimate, exposed)

${has('pad-textures') ? '• Ambient wash with melodic fragments' : ''}
${has('strings') ? '• Legato lines, emotional arc' : ''}
${has('keys') ? '• Sparse piano, single hits or simple chords' : ''}

Velocities: 0.4-0.6 | Density: 30-45%

END: Longing to return to familiar material → build or cut to chorus`;
            },

            breakdown: () => {
                const tracks = selectTracks(1, 2, ['melody', 'pad-textures', 'strings', 'keys']);
                
                return `BREAKDOWN - Dramatic reduction for ${genre}

ENERGY: 20-40% - Sudden drop from peak

REMOVAL STRATEGY:
• Strip 60-70% of elements suddenly
• Keep only: ${tracks.join(', ')}

RHYTHMIC:
${genre === 'drum-and-bass' ? '• Strip to half-time, amen break drops out\n• Sub-bass drone only' :
  genre === 'techno' ? '• Kick drops out, hats continue sparse\n• Tension through reduction' :
  '• Remove or simplify drums significantly'}

${has('bassline') ? '• Bass: Absent OR sustained sub-bass drone only' : ''}

BUILD WITHIN:
• Start: Minimal (1 element)
• Middle: Add second element
• End: Prepare for re-entry (pulse returns)

Velocities: 0.3-0.5 | Density: 20-35%

DURATION: Often 2-4 bars (shorter than main sections)`;
            },

            outro: () => {
                const tracks = selectTracks(1, 3, ['pad-textures', 'chord', 'melody', 'strings']);
                
                return `OUTRO - Graceful exit for ${genre}

ENERGY: 60% → 10% (decrescendo to silence)

EXIT STRATEGY:
• Mirror intro with known material
• Gradual removal (reverse of build)
• Satisfying, complete resolution

REMOVAL SEQUENCE:
1. Drums/percussion first
2. Bass (energy drops significantly)
3. Harmonic support thins
4. Final: Single note or ambient tail

${has('melody') ? '• Final melody statement, then fade' : ''}
${has('chord') || has('pad-textures') ? '• Sustained tonic chord, long reverb tail' : ''}
${has('arpeggio') ? '• Slowing arpeggio to individual notes' : ''}

Velocities: 0.6 → 0.2 gradual fade
Density: 50% → 5%

AVOID: Abrupt cuts, new material, unresolved tension`;
            }
        };

        const instructionFn = instructions[structure] || instructions.verse;
        return instructionFn();
    }

    buildVariationPrompt(originalJson, structure, originalTrackTypes, duration) {
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const beatsPerBar = parseInt((document.getElementById('time-signature')?.value || '4/4').split('/')[0], 10) || 4;
        const totalBeats = parseInt(duration) * beatsPerBar;
        const genre = (document.getElementById('style')?.value || 'house').toLowerCase();
        const mood = (document.getElementById('mood')?.value || 'mysterious').toLowerCase();
        const key = (document.getElementById('key')?.value || 'C');

        const trackAbbrevs = originalTrackTypes.map(t => trackAbbreviations[t] || t);
        const trackAbbrList = trackAbbrevs.map(t => `"${t}"`).join(', ');

        const structureInstructions = this.getStructureInstructions(structure, genre, mood, originalTrackTypes);

        return `You are an expert music producer AI specializing in ${genre.toUpperCase()} production. Create a professional "${structure.toUpperCase()}" section.

═══════════════════════════════════════════════════════════════════
COMPOSITION CONTEXT
═══════════════════════════════════════════════════════════════════
Title: ${originalJson.title}
Genre: ${genre.toUpperCase()} | Mood: ${mood} | Key: ${key} | BPM: ${bpm}
Time: ${beatsPerBar}/4 | Duration: ${duration} bars (${totalBeats} beats)

═══════════════════════════════════════════════════════════════════
${structureInstructions}
═══════════════════════════════════════════════════════════════════

TECHNICAL SPECIFICATIONS:
• pitch: MIDI number (36-96) OR note name (C2, F#4, etc.)
• beat: Decimal position (0, 0.5, 1, 1.25, 2, etc.)
• duration: Beats (0.25=16th, 0.5=8th, 1=quarter, 2=half)
• velocity: 0.1-1.0 (follow structure guidelines)
• Use ONLY escaped newlines (\\\\n) in JSON
• Stay within ${totalBeats} beats total
• Match KEY (${key}) and TEMPO (${bpm} BPM) exactly

AVAILABLE TRACKS: ${originalTrackTypes.join(', ')}
TRACK ABBREVIATIONS: ${trackAbbrList}

═══════════════════════════════════════════════════════════════════
ORIGINAL REFERENCE
═══════════════════════════════════════════════════════════════════
${originalJson.notation || JSON.stringify(originalJson.tracks || {})}

═══════════════════════════════════════════════════════════════════
RESPONSE FORMAT - Return ONLY this JSON:
═══════════════════════════════════════════════════════════════════

{
  "title": "${originalJson.title} - ${structure.charAt(0).toUpperCase() + structure.slice(1)}",
  "description": "A ${structure} ${genre} variation: ${mood}, ${duration} bars",
  "tracks": {
${trackAbbrList.split(', ').map(t => `    ${t}: "pitch,beat,duration,velocity\\\\npitch2,beat2,dur2,vel2\\\\n..."`).join(',\n')}
  }
}

Generate the ${structure.toUpperCase()} variation now. Output ONLY JSON.`;
    }

    async generateVariation() {
        if (!this.sourceJson) {
            this.app.ui.showMessage('Please provide a source JSON in the text area.', 'warning');
            return;
        }

        const selectedStructure = document.getElementById('structure-select')?.value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a version type (e.g., Intro, Chorus).', 'warning');
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
            this.app.ui.showMessage('The JSON is currently invalid. Cannot generate variation.', 'error');
            return;
        }
        
        let trackTypes = this.extractTrackTypesFromNotation(sourceVersion.apiResponse.notation);

        if (trackTypes.length === 0 && sourceVersion.apiResponse.tracks) {
            trackTypes = Object.keys(sourceVersion.apiResponse.tracks);
        }

        if (trackTypes.length === 0) {
            this.app.ui.showMessage('Could not find any tracks in the composition.', 'error');
            return;
        }

        try {
            this.app.ui.showLoading(`Generating "${selectedStructure}" version...`);

            const variationPrompt = this.buildVariationPrompt(sourceVersion.apiResponse, selectedStructure, trackTypes, selectedDuration);
            
            console.log('[VARIATION] Structure:', selectedStructure, '| Genre:', document.getElementById('style')?.value);

            const response = await fetchWithModelFallbacks('/api/variations', 
                ['openai-large', 'openai'], 
                this.app.ui, 
                { prompt: variationPrompt, seed: Math.floor(Math.random() * 100000) }
            );

            const responseText = await response.text();
            const variationJson = this.parseVariationResponse(responseText);
            
            const newVersion = {
                apiResponse: variationJson,
                context: sourceVersion.context,
                isOriginal: false,
                structure: selectedStructure
            };

            this.versions.push(newVersion);
            this.renderVersionsList();
            
            this.app.ui.showMessage(`Successfully generated "${selectedStructure}" version.`, 'success');

        } catch (error) {
            console.error('Variation generation failed:', error);
            this.app.ui.showMessage(`Failed to generate version: ${error.message}`, 'error');
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
                throw new Error('No JSON object found in the API response.');
            }

            const jsonText = cleanedJson.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonText);

            if (!parsed.title) {
                throw new Error("Parsed JSON is missing 'title'.");
            }

            if (!parsed.tracks && !parsed.notation) {
                throw new Error("Parsed JSON is missing 'tracks' or 'notation'.");
            }

            const reverseAbbrev = Object.fromEntries(
                Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
            );

            let notation = parsed.notation || '';

            if (parsed.tracks && typeof parsed.tracks === 'object') {
                const lines = [];
                for (const [trackAbbr, notesStr] of Object.entries(parsed.tracks)) {
                    if (!notesStr || notesStr.trim() === '') continue;

                    const trackFull = reverseAbbrev[trackAbbr] || trackAbbr;
                    const noteLines = notesStr.replace(/\\n/g, '\n').split('\n').filter(l => l.trim());

                    for (const noteLine of noteLines) {
                        const trimmed = noteLine.trim();
                        if (trimmed && !trimmed.startsWith('pitch')) {
                            lines.push(`${trimmed} # ${trackFull}`);
                        }
                    }
                }
                notation = lines.join('\n');
            }

            return {
                title: parsed.title,
                explanation: parsed.description || parsed.explanation || '',
                notation: notation
            };

        } catch (error) {
            console.error("Failed to parse variation response:", error, "Raw response:", responseText);
            throw new Error(`Could not parse the AI's response. Details: ${error.message}`);
        }
    }

    parseNotationToTracks(notation) {
        const tracks = new Map();
        const lines = notation.replace(/\\n/g, '\n').split('\n');
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        const rawTrackNotes = new Map();
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.includes('pitch,time') || !trimmed.includes('#')) continue;
            
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
        
        const finalTracks = new Map();
        
        rawTrackNotes.forEach((notes, trackType) => {
            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                finalTracks.set(trackType, {
                    midi,
                    title: trackType.charAt(0).toUpperCase() + trackType.slice(1),
                    description: `Generated ${trackType} version.`
                });
            }
        });
        
        return finalTracks;
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
            console.warn("Failed to parse note line:", line, error);
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

        this.app.ui.showLoading('Preparing ZIP file...');
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
                        const filename = `${sanitizedTitle}.mid`;
                        zip.file(filename, midiBytes);
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

            this.app.ui.showMessage('All versions downloaded successfully as a ZIP file.', 'success');

        } catch (error) {
            console.error('Failed to create ZIP file:', error);
            this.app.ui.showMessage(`Error creating ZIP file: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }
}
