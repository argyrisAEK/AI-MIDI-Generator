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
        
        // 🎯 NEW: Event listeners για νέα controls
        const humanizeSlider = document.getElementById('humanize-slider');
        const swingSlider = document.getElementById('swing-slider');
        
        if (humanizeSlider) {
            humanizeSlider.addEventListener('input', (e) => this.handleHumanizeChange(e));
        }
        if (swingSlider) {
            swingSlider.addEventListener('input', (e) => this.handleSwingChange(e));
        }
    }

    handleEditTypeChange(e) {
        const value = e.target.value;
        const intensitySection = document.getElementById('intensity-slider-section');
        const customSection = document.getElementById('custom-edit-section');
        const harmonySection = document.getElementById('harmony-interval-section');
        const humanizeSection = document.getElementById('humanize-amount-section');
        const swingSection = document.getElementById('swing-amount-section');
        
        // Hide all conditional sections
        if (intensitySection) intensitySection.style.display = 'none';
        if (customSection) customSection.style.display = 'none';
        if (harmonySection) harmonySection.style.display = 'none';
        if (humanizeSection) humanizeSection.style.display = 'none';
        if (swingSection) swingSection.style.display = 'none';
        
        // Show relevant sections
        if (value === 'intensity_up' || value === 'intensity_down') {
            if (intensitySection) intensitySection.style.display = 'block';
        }
        if (value === 'custom') {
            if (customSection) customSection.style.display = 'block';
        }
        if (value === 'harmonize_thirds' || value === 'harmonize_fifths') {
            if (harmonySection) harmonySection.style.display = 'block';
        }
        if (value === 'humanize') {
            if (humanizeSection) humanizeSection.style.display = 'block';
        }
        if (value === 'swing_feel') {
            if (swingSection) swingSection.style.display = 'block';
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

    // 🎯 NEW: Humanize slider handler
    handleHumanizeChange(e) {
        const value = parseInt(e.target.value);
        const labels = ['Subtle', 'Medium', 'Heavy'];
        const display = document.getElementById('humanize-value');
        if (display) {
            display.textContent = labels[value - 1] || 'Medium';
        }
    }

    // 🎯 NEW: Swing slider handler
    handleSwingChange(e) {
        const value = parseInt(e.target.value);
        const display = document.getElementById('swing-value');
        if (display) {
            display.textContent = `${value}%`;
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
    // 🔥 QUICK TRACK EDIT
    // ═══════════════════════════════════════════════════════════════════════════════

    async applyTrackEdit() {
        const targetTracks = this.getSelectedEditTracks();
        const editType = document.getElementById('edit-type')?.value;
        const customInstructions = document.getElementById('custom-edit-instructions')?.value;
        const intensityValue = parseInt(document.getElementById('intensity-slider')?.value || 0) / 100;
        
        // 🎯 NEW: Get additional parameters
        const harmonyInterval = parseInt(document.getElementById('harmony-interval')?.value || 3);
        const humanizeAmount = parseInt(document.getElementById('humanize-slider')?.value || 2);
        const swingAmount = parseInt(document.getElementById('swing-slider')?.value || 60);

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
            preserveOtherTracks: true,
            // 🎯 NEW: Additional parameters
            harmonyInterval,
            humanizeAmount,
            swingAmount
        };

        await this.editTrackSelectively(editRequest);
    }

    async editTrackSelectively(editRequest) {
        const {
            targetTracks,
            editType,
            customInstructions,
            intensityChange,
            harmonyInterval,
            humanizeAmount,
            swingAmount
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
            harmonyInterval,
            humanizeAmount,
            swingAmount,
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
                        explanation: original.explanation || original.desc
                    },
                    editDescription: this.generateEditDescription(editRequest)
                });

                await this.updateMainAppAfterEdit(mergedResult);

                const newVersion = {
                    apiResponse: mergedResult,
                    context: this.versions[0]?.context || {},
                    isOriginal: false,
                    structure: `Edit: ${targetTracks.join(', ')}`,
                    editDetails: editRequest
                };

                this.versions.push(newVersion);
                this.renderVersionsList();
                
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

    mergeDifferentialChanges({ originalTracks, editedTracks, targetTracks, originalMetadata, editDescription }) {
        console.log('[MERGE] Starting merge...');
        console.log('[MERGE] Original tracks:', Object.keys(originalTracks));
        console.log('[MERGE] Edited tracks from AI:', Object.keys(editedTracks));
        console.log('[MERGE] Target tracks (to edit):', targetTracks);

        const reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
        );

        const mergedTracks = {};
        
        for (const trackName of Object.keys(originalTracks)) {
            const abbrev = trackAbbreviations[trackName] || trackName;
            
            if (targetTracks.includes(trackName)) {
                const edited = editedTracks[abbrev] || editedTracks[trackName];
                
                if (edited && typeof edited === 'string' && edited.trim().length > 0) {
                    mergedTracks[trackName] = this.normalizeToCompactFormat(edited);
                    console.log(`[MERGE] ✓ Replaced ${trackName} with edited version`);
                } else {
                    mergedTracks[trackName] = originalTracks[trackName];
                    console.warn(`[MERGE] ✗ No valid edit for ${trackName}, keeping original`);
                }
            } else {
                mergedTracks[trackName] = originalTracks[trackName];
                console.log(`[MERGE] → Kept unchanged: ${trackName}`);
            }
        }

        console.log('[MERGE] Final merged tracks:', Object.keys(mergedTracks));

        return {
            title: `${originalMetadata.title} [${targetTracks.join(', ')} edit]`,
            desc: `${originalMetadata.explanation || ''} | ${editDescription}`.trim(),
            tracks: mergedTracks
        };
    }

    normalizeToCompactFormat(notesStr) {
        if (!notesStr || typeof notesStr !== 'string') return '';
        
        if (notesStr.includes(':') && !notesStr.includes('pitch,beat')) {
            return notesStr.trim();
        }
        
        return notesStr.trim();
    }

    async updateMainAppAfterEdit(mergedResult) {
        try {
            console.log('[UPDATE-MAIN] Starting update with merged result...');
            console.log('[UPDATE-MAIN] Merged tracks:', Object.keys(mergedResult.tracks || {}));

            const tracks = this.mergedTracksToTrackMap(mergedResult.tracks);
            console.log('[UPDATE-MAIN] Parsed tracks:', Array.from(tracks.keys()));

            this.app.generatedTracks = tracks;
            this.app.compositionTitle = mergedResult.title;
            this.app.compositionDescription = mergedResult.desc;

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

            this.app.ui.updateButtonStates(true);

            this.setVisualizerToAllTracks();

            console.log('[UPDATE-MAIN] Successfully updated main app');

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
            if (!notesStr || typeof notesStr !== 'string') {
                console.warn(`[MERGED-TO-MAP] Skipping ${trackName}: invalid data`);
                continue;
            }
            
            const notes = [];
            
            const separator = notesStr.includes('|') ? '|' : '\n';
            const lines = notesStr.split(separator).map(l => l.trim()).filter(l => l);
            
            for (const line of lines) {
                if (line.match(/^(pitch|note|midi|#)/i)) continue;
                
                const note = this.parseCompactNoteLine(line);
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
            } else {
                console.warn(`[MERGED-TO-MAP] No valid notes for ${trackName}`);
            }
        }
        
        console.log('[MERGED-TO-MAP] Final tracks:', Array.from(tracks.keys()));
        return tracks;
    }

    parseCompactNoteLine(line) {
        try {
            const parts = line.split(':').map(p => p.trim());
            if (parts.length < 4) return null;

            const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
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

    setVisualizerToAllTracks() {
        console.log('[SET-ALL-TRACKS] Setting visualizer to show all tracks...');
        
        try {
            document.querySelectorAll('.track-selector').forEach(btn => {
                btn.classList.remove('active');
            });

            const allTracksBtn = document.querySelector('.track-selector[data-track-type="all"]');
            if (allTracksBtn) {
                allTracksBtn.classList.add('active');
            }

            this.app.visualizer.activeTrackType = 'all';
            
            if (this.app.visualizer.updateMetadataDisplay) {
                this.app.visualizer.updateMetadataDisplay('all');
            }

            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();

        } catch (error) {
            console.error('[SET-ALL-TRACKS] Error:', error);
            this.app.visualizer.activeTrackType = 'all';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🎯 ΒΕΛΤΙΩΜΕΝΟ PROMPT BUILDING - Με μουσική συνοχή και αρμονία
    // ═══════════════════════════════════════════════════════════════════════════════

    buildEditPrompt(params) {
        const {
            originalJson,
            targetTracks,
            unchangedTracks,
            editType,
            customInstructions,
            intensityChange,
            harmonyInterval,
            humanizeAmount,
            swingAmount,
            genre,
            bpm,
            key,
            duration
        } = params;

        const instructions = this.getEditInstructions(editType, {
            intensityChange,
            customInstructions,
            harmonyInterval,
            humanizeAmount,
            swingAmount,
            key,
            genre,
            duration
        });

        const unchangedContext = this.analyzeUnchangedTracks(originalJson.tracks, unchangedTracks, key);

        const lines = [
            `=== MUSICAL TRACK EDIT - HARMONICALLY AWARE ===`,
            `Composition: "${originalJson.title || 'Untitled'}"`,
            `Genre: ${genre} | Key: ${key} | BPM: ${bpm} | Duration: ${duration} bars`,
            ``,
            `=== MUSICAL CONTEXT (Unchanged Tracks) ===`,
            unchangedContext,
            ``,
            `=== EDIT INSTRUCTIONS ===`,
            `Target Tracks to Modify: ${targetTracks.join(', ')}`,
            `Edit Type: ${instructions}`,
            ``,
            `🎼 CRITICAL MUSICAL RULES:`,
            `1. MAINTAIN HARMONIC COHERENCE - Edited tracks MUST fit with unchanged tracks`,
            `2. RESPECT THE KEY (${key}) - Use notes from the ${key} scale`,
            `3. COMPLEMENT, DON'T CLASH - Avoid note collisions with unchanged tracks`,
            `4. MAINTAIN RHYTHMIC GROOVE - Keep the established rhythmic feel`,
            `5. BALANCE FREQUENCY RANGES - Don't overlap frequency spaces of other instruments`,
            ``,
            `=== ORIGINAL TRACK DATA (Target Tracks Only) ===`
        ];

        targetTracks.forEach(track => {
            const notation = originalJson.tracks[track] || '';
            const noteCount = notation.split('|').length;
            const sampleNotes = notation.split('|').slice(0, 3).join('|');
            lines.push(`${track.toUpperCase()}:`);
            lines.push(`  Notes: ${noteCount}`);
            lines.push(`  Sample: ${sampleNotes}...`);
            lines.push(`  Role: ${this.getTrackRole(track)}`);
            lines.push(``);
        });

        lines.push(`=== 🎯 HARMONIC INTEGRATION GUIDELINES ===`);
        lines.push(this.getHarmonicGuidelines(targetTracks, unchangedTracks, key, genre));
        lines.push(``);

        lines.push(`=== CRITICAL OUTPUT REQUIREMENTS ===`);
        lines.push(`1. Format: pitch:beat:dur:vel (e.g., "60:0:1:7")`);
        lines.push(`2. Separator: Use | (pipe) between notes`);
        lines.push(`3. Duration: Maintain ${duration} bars total`);
        lines.push(`4. Key: Stay in ${key} (use appropriate scale degrees)`);
        lines.push(`5. Tempo: Keep BPM=${bpm} in mind for rhythmic spacing`);
        lines.push(`6. Return ONLY modified tracks in JSON format`);
        lines.push(``);
        
        lines.push(`=== EXAMPLE OUTPUT FORMAT ===`);
        const exampleTracks = targetTracks.map(t => {
            const abbr = trackAbbreviations[t] || t;
            return `"${abbr}":"60:0:1:7|62:1:0.5:6|64:2:1:5|..."`;
        }).join(',');
        lines.push(`{"title":"${originalJson.title} [edited]","desc":"${this.generateEditDescription({editType, targetTracks, intensityChange})}","tracks":{${exampleTracks}}}`);

        return lines.join('\n');
    }

    analyzeUnchangedTracks(allTracks, unchangedTrackNames, key) {
        if (unchangedTrackNames.length === 0) {
            return 'No unchanged tracks - full creative freedom.';
        }

        const lines = [`These tracks will remain UNCHANGED and must be complemented:`];
        
        unchangedTrackNames.forEach(trackName => {
            const notation = allTracks[trackName] || '';
            const notes = notation.split('|').filter(n => n.trim());
            const noteCount = notes.length;
            
            const pitches = notes.map(n => {
                const parts = n.split(':');
                return parseInt(parts[0]) || 0;
            }).filter(p => p > 0);
            
            const minPitch = pitches.length > 0 ? Math.min(...pitches) : 0;
            const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 0;
            const avgPitch = pitches.length > 0 ? Math.round(pitches.reduce((a,b) => a+b, 0) / pitches.length) : 0;
            
            const role = this.getTrackRole(trackName);
            const freqRange = this.getFrequencyRange(avgPitch);
            
            lines.push(`  • ${trackName.toUpperCase()}: ${noteCount} notes, ${role}`);
            lines.push(`    Range: MIDI ${minPitch}-${maxPitch} (${freqRange})`);
        });
        
        lines.push(``);
        lines.push(`⚠️ Your edits must HARMONIZE with these unchanged elements.`);
        
        return lines.join('\n');
    }

    getTrackRole(trackName) {
        const roles = {
            'bassline': 'Foundation - Low frequencies, rhythmic anchor',
            'chord': 'Harmony - Mid frequencies, chord progressions',
            'keys': 'Harmony - Mid-high frequencies, supporting chords',
            'melody': 'Lead - High frequencies, main melodic line',
            'lead': 'Lead - High frequencies, prominent melodic voice',
            'arpeggio': 'Movement - Mid frequencies, rhythmic patterns',
            'plucks': 'Texture - Mid-high frequencies, percussive melody',
            'strings': 'Texture - Mid-high frequencies, sustained pads',
            'pad-textures': 'Atmosphere - Wide frequency, ambient support',
            'guitar': 'Rhythm/Melody - Mid frequencies, strumming or picking',
            'brass': 'Accent - Mid-high frequencies, powerful stabs',
            'percs': 'Rhythm - All frequencies, percussive elements'
        };
        return roles[trackName] || 'Supporting element';
    }

    getFrequencyRange(midiNote) {
        if (midiNote < 36) return 'Sub-bass';
        if (midiNote < 48) return 'Bass';
        if (midiNote < 60) return 'Low-mid';
        if (midiNote < 72) return 'Mid';
        if (midiNote < 84) return 'High-mid';
        return 'High';
    }

    getHarmonicGuidelines(targetTracks, unchangedTracks, key, genre) {
        const guidelines = [];
        
        if (targetTracks.includes('bassline')) {
            guidelines.push(`🎸 BASSLINE: Lock into the root notes of chord progressions. Stay in low register (MIDI 24-48).`);
            if (unchangedTracks.includes('chord')) {
                guidelines.push(`   → Complement existing chords by emphasizing root/5th notes.`);
            }
        }
        
        if (targetTracks.includes('chord') || targetTracks.includes('keys')) {
            guidelines.push(`🎹 CHORDS: Use proper chord voicings in ${key}. Mid register (MIDI 48-72).`);
            if (unchangedTracks.includes('bassline')) {
                guidelines.push(`   → Avoid doubling bass notes. Stay above MIDI 48.`);
            }
            if (unchangedTracks.includes('melody')) {
                guidelines.push(`   → Support the melody harmonically. Don't clash with lead notes.`);
            }
        }
        
        if (targetTracks.includes('melody') || targetTracks.includes('lead')) {
            guidelines.push(`🎤 MELODY: Strong, clear melodic line in ${key} scale. High register (MIDI 60-84).`);
            if (unchangedTracks.includes('chord')) {
                guidelines.push(`   → Align with chord tones on strong beats. Use passing tones carefully.`);
            }
            if (unchangedTracks.includes('arpeggio') || unchangedTracks.includes('plucks')) {
                guidelines.push(`   → Leave rhythmic space for existing movement patterns.`);
            }
        }
        
        if (targetTracks.includes('arpeggio') || targetTracks.includes('plucks')) {
            guidelines.push(`🎵 ARPEGGIOS: Broken chord patterns following the harmony. Mid register (MIDI 52-76).`);
            if (unchangedTracks.includes('chord')) {
                guidelines.push(`   → Use notes from existing chord progressions.`);
            }
        }
        
        if (genre.includes('house') || genre.includes('techno')) {
            guidelines.push(`🎛️ ${genre.toUpperCase()}: Maintain four-on-the-floor feel. Strong on-beat emphasis.`);
        } else if (genre.includes('dnb') || genre.includes('drum')) {
            guidelines.push(`🥁 ${genre.toUpperCase()}: Syncopated rhythms. Avoid straight patterns.`);
        }
        
        guidelines.push(``);
        guidelines.push(`⚡ GENERAL:`);
        guidelines.push(`  • Avoid direct note collisions at same time + same pitch`);
        guidelines.push(`  • Respect frequency separation (bass ≠ melody range)`);
        guidelines.push(`  • Maintain rhythmic coherence with existing patterns`);
        guidelines.push(`  • Use scale degrees from ${key} (consult music theory if needed)`);
        
        return guidelines.join('\n');
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🎯 IMPROVED EDIT INSTRUCTIONS - Με όλες τις νέες επιλογές
    // ═══════════════════════════════════════════════════════════════════════════════

    getEditInstructions(editType, params) {
        const { intensityChange, customInstructions, harmonyInterval, humanizeAmount, swingAmount, key, genre, duration } = params;
        const pct = Math.abs(Math.round(intensityChange * 100));

        const instructions = {
            // ═══ DYNAMICS & ENERGY ═══
            intensity_up: `INCREASE INTENSITY by ${pct}%:
• Add ${pct}% more notes (fill gaps, add passing tones)
• Increase velocity by ${Math.round(pct/2)}% (make notes hit harder)
• Reduce note durations by 10-20% (shorter, punchier)
• Maintain harmonic coherence with unchanged tracks`,

            intensity_down: `DECREASE INTENSITY by ${pct}%:
• Remove ${pct}% of notes (keep only essential notes)
• Decrease velocity by ${Math.round(pct/2)}% (softer dynamics)
• Increase note durations by 10-20% (longer, sustained)
• Preserve melodic/harmonic identity`,

            velocity_crescendo: `APPLY CRESCENDO (gradual increase):
• Start notes at current velocity
• Gradually increase velocity from start to end
• Final notes should be +30-40% louder than start
• Smooth velocity curve (not stepped)
• Same notes, timing - only velocity changes`,

            velocity_diminuendo: `APPLY DIMINUENDO (gradual decrease):
• Start notes at current velocity
• Gradually decrease velocity from start to end
• Final notes should be -30-40% softer than start
• Smooth velocity curve (not stepped)
• Same notes, timing - only velocity changes`,

            accent_beats: `ACCENT STRONG BEATS:
• Increase velocity on beats 1 and 3 by +20-30%
• Keep beats 2 and 4 at normal velocity (or slightly reduce)
• Off-beat notes (8th notes) at -10% velocity (ghost notes)
• Creates strong/weak beat pattern
• Emphasizes rhythmic pulse`,

            // ═══ COMPLEXITY & RHYTHM ═══
            simplify: `SIMPLIFY TO ESSENTIALS:
• Remove 30-40% of notes (keep core harmonic/melodic content)
• Focus on strong beats (1, 2, 3, 4)
• Longer note durations (minimum 0.5 beat)
• Simple, clear rhythm
• Maintain musical sense`,

            add_syncopation: `ADD SYNCOPATION (off-beat emphasis):
• Move some on-beat notes to off-beat positions
• Accent 8th notes on "and" (+20% velocity)
• Create rhythmic tension and groove
• Keep harmonic content similar
• Add 10-20% more notes on off-beats`,

            swing_feel: `APPLY SWING FEEL (shuffle, ${swingAmount || 60}%):
• Off-beat 8th notes delayed to ${swingAmount || 60}% of beat
• On-beat notes (1, 2, 3, 4) stay on grid
• Creates "long-short" rhythm (da-DUM da-DUM)
• Classic jazz/blues/hip-hop feel
• Same pitches, adjusted timing only`,

            straighten_feel: `REMOVE SWING (straighten to grid):
• Move all off-beat notes to exact 50% of beat
• Create even 8th note spacing
• Remove shuffle/swing feel
• Tight, metronomic rhythm
• Same pitches, corrected timing`,

            double_time: `DOUBLE-TIME FEEL (2x energy):
• Increase rhythmic activity (feels 2x faster)
• Reduce note durations to 60% of original
• Add subdivision notes between existing notes
• Maintain harmonic content
• Total duration stays ${duration || 4} bars
• Create urgency and energy`,

            half_time: `HALF-TIME FEEL (0.5x relaxed):
• Decrease rhythmic activity (feels 2x slower)
• Increase note durations to 150-200% of original
• Remove some notes (30-40% fewer)
• Create space and breathing room
• Total duration stays ${duration || 4} bars
• Laid-back, spacious feel`,

            // ═══ PITCH & HARMONY ═══
            transpose_up: `TRANSPOSE UP ONE OCTAVE:
• Add +12 semitones to ALL pitches
• Keep exact timing and rhythm
• Maintain velocity and durations
• Check new range doesn't clash with other tracks`,

            transpose_down: `TRANSPOSE DOWN ONE OCTAVE:
• Subtract -12 semitones from ALL pitches
• Keep exact timing and rhythm
• Maintain velocity and durations
• Ensure new range fits arrangement`,

            harmonize_thirds: `ADD HARMONY IN THIRDS:
• For each note, add harmony note 3-4 semitones higher
• Use diatonic intervals (follow ${key || 'C'} scale)
• Harmony notes at -10% velocity (slightly softer)
• Same timing and duration as original
• KEEP original notes + add harmonies (double the notes)
• Create rich, thick sound`,

            harmonize_fifths: `ADD HARMONY IN FIFTHS:
• For each note, add harmony note 7 semitones higher (perfect 5th)
• Creates "power chord" effect
• Harmony notes at -5% velocity
• Same timing and duration as original
• KEEP original notes + add harmonies
• Strong, bold sound`,

            // ═══ TIMING & FEEL ═══
            humanize: `HUMANIZE (natural timing variations, ${humanizeAmount === 3 ? 'heavy' : humanizeAmount === 2 ? 'medium' : 'subtle'} amount):
• Timing: Shift notes ±${humanizeAmount === 3 ? '15' : humanizeAmount === 2 ? '10' : '5'}ms randomly
• Velocity: Vary ±${humanizeAmount === 3 ? '20' : humanizeAmount === 2 ? '15' : '10'}% randomly
• Duration: Slight variations ±${humanizeAmount === 3 ? '10' : humanizeAmount === 2 ? '7' : '5'}%
• Make it sound played by human (not robotic)
• Keep overall groove center intact
• Avoid mechanical perfection`,

            quantize: `QUANTIZE TO GRID (perfect timing):
• Snap all note starts to nearest 16th note
• Perfect timing (no micro-variations)
• Uniform velocities (±3% variation max)
• Clean, exact durations
• Locked-in, tight feel
• Electronic/EDM precision`,

            // ═══ PATTERN TRANSFORMATION ═══
            arpeggiate_up: `ARPEGGIATE UPWARD (chords → rising pattern):
• Break simultaneous notes (chords) into sequence
• Pattern: lowest pitch → highest pitch
• Spread across original chord duration
• Example: C-E-G chord → C (0.0), E (0.25), G (0.5)
• Keep same pitches, sequential timing
• Create upward movement`,

            arpeggiate_down: `ARPEGGIATE DOWNWARD (chords → falling pattern):
• Break simultaneous notes (chords) into sequence
• Pattern: highest pitch → lowest pitch
• Spread across original chord duration
• Example: C-E-G chord → G (0.0), E (0.25), C (0.5)
• Keep same pitches, sequential timing
• Create downward movement`,

            reverse_time: `REVERSE TIME (play backwards):
• Reverse the order of all notes in time
• Last note becomes first, first becomes last
• Keep pitches and velocities the same
• Experimental/creative effect
• Total duration stays ${duration || 4} bars`,

            // ═══ CUSTOM ═══
            custom: `CUSTOM EDIT: ${customInstructions?.substring(0, 200) || 'Apply the requested modifications'}
• Follow the custom instructions above
• ALWAYS maintain harmonic coherence with unchanged tracks
• Stay in ${key || 'C'} key unless explicitly asked otherwise
• Respect the genre (${genre || 'house'}) conventions
• Keep composition duration (${duration || 4} bars)`
        };

        return instructions[editType] || instructions.custom;
    }

    generateEditDescription(editRequest) {
        const { targetTracks, editType, intensityChange, humanizeAmount, swingAmount } = editRequest;
        const trackList = targetTracks.join('+');
        const pct = Math.abs(Math.round(intensityChange * 100));
        
        const humanizeLabels = { 1: 'subtle', 2: 'medium', 3: 'heavy' };
        
        const desc = {
            intensity_up: `${trackList} +${pct}% intensity`,
            intensity_down: `${trackList} -${pct}% intensity`,
            velocity_crescendo: `${trackList} crescendo`,
            velocity_diminuendo: `${trackList} diminuendo`,
            accent_beats: `${trackList} accented beats`,
            
            simplify: `${trackList} simplified`,
            add_syncopation: `${trackList} syncopated`,
            swing_feel: `${trackList} swing ${swingAmount || 60}%`,
            straighten_feel: `${trackList} straightened`,
            double_time: `${trackList} double-time`,
            half_time: `${trackList} half-time`,
            
            transpose_up: `${trackList} +8va`,
            transpose_down: `${trackList} -8va`,
            harmonize_thirds: `${trackList} harmonized 3rds`,
            harmonize_fifths: `${trackList} harmonized 5ths`,
            
            humanize: `${trackList} humanized (${humanizeLabels[humanizeAmount] || 'medium'})`,
            quantize: `${trackList} quantized`,
            
            arpeggiate_up: `${trackList} arp↑`,
            arpeggiate_down: `${trackList} arp↓`,
            reverse_time: `${trackList} reversed`,
            
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
            
            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${version.apiResponse.title} ${version.isOriginal ? '(Original)' : ''}${editBadge}</h4>
                    <p>${version.apiResponse.desc || version.apiResponse.explanation}</p>
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
