import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { trackAbbreviations } from './prompt-builder.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.sourceNotes = new Map();
        this.sourceAnalysis = null; // Store musical analysis of source
     
        this.setupEventListeners();
    }

    setupEventListeners() {
        const generateBtn = document.getElementById('generate-variations');
        const downloadBtn = document.getElementById('download-all-zip');
        const rawInput = document.getElementById('raw-json-input');

        if (generateBtn) generateBtn.addEventListener('click', () => this.generateVariation());
        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadAllAsZip());
        if (rawInput) rawInput.addEventListener('input', (e) => this.handleJsonInputChange(e));
    }

    handleJsonInputChange(e) {
        const newJsonString = e.target.value;
        const rawJsonInput = document.getElementById('raw-json-input');

        try {
            const parsedJson = JSON.parse(newJsonString);
            this.sourceJson = JSON.stringify(parsedJson);

            const originalVersion = this.versions.find(v => v.isOriginal);
            if (originalVersion) {
                originalVersion.apiResponse = parsedJson;
                const sourceTitle = document.getElementById('source-composition-title');
                const sourceExplanation = document.getElementById('source-composition-explanation');
                if (sourceTitle) sourceTitle.textContent = parsedJson.title || 'Custom Composition';
                if (sourceExplanation) sourceExplanation.textContent = parsedJson.explanation || parsedJson.description || '';
            }

            this.parseSourceNotes(parsedJson);
            this.analyzeSourceMusic(); // Analyze the musical content

            this.app.ui.showMessage('JSON is valid. Ready to generate.', 'success');
            const generateBtn = document.getElementById('generate-variations');
            if (generateBtn) generateBtn.disabled = false;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            this.app.ui.showMessage('Invalid JSON format. Please correct it to generate variations.', 'warning');
            const generateBtn = document.getElementById('generate-variations');
            if (generateBtn) generateBtn.disabled = true;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--error)';
        }
    }

    reset() {
        this.sourceJson = null;
        this.versions = [];
        this.sourceAnalysis = null;

        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');
        const versionsList = document.getElementById('versions-list');
        const rawJsonInput = document.getElementById('raw-json-input');
        const generateBtn = document.getElementById('generate-variations');
        const downloadBtn = document.getElementById('download-all-zip');

        if (rawJsonInput) rawJsonInput.value = '';
        if (versionsList) versionsList.innerHTML = '<p>Your generated versions will appear here.</p>';
        
        if (sourceTitle) sourceTitle.textContent = '';
        if (sourceExplanation) sourceExplanation.textContent = '';
        if (sourceDetails && sourceDetails.querySelector('p')) {
            sourceDetails.querySelector('p').style.display = 'block';
        }
        
        if (generateBtn) generateBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = true;
    }

    fullReset() {
        this.sourceJson = null;
        this.versions = [];
        this.sourceNotes.clear();
        this.sourceAnalysis = null;
        this.resetUI();
    }

    resetUI() {
        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');
        const versionsList = document.getElementById('versions-list');
        const rawJsonInput = document.getElementById('raw-json-input');
        const generateBtn = document.getElementById('generate-variations');
        const downloadBtn = document.getElementById('download-all-zip');

        if (rawJsonInput) rawJsonInput.value = '';
        if (versionsList) versionsList.innerHTML = '<p>Your generated versions will appear here.</p>';
        
        if (sourceTitle) sourceTitle.textContent = '';
        if (sourceExplanation) sourceExplanation.textContent = '';
        if (sourceDetails && sourceDetails.querySelector('p')) {
            sourceDetails.querySelector('p').style.display = 'block';
        }
        
        if (generateBtn) generateBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = true;
    }

    setSourceComposition(rawJson, metadata, context) {
        this.versions = [];
        this.sourceJson = null;
        this.sourceAnalysis = null;

        const rawJsonInput = document.getElementById('raw-json-input');
        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');

        try {
            const parsedSource = JSON.parse(rawJson);
            this.sourceJson = JSON.stringify(parsedSource);
            
            if (rawJsonInput) rawJsonInput.value = JSON.stringify(parsedSource, null, 2);

            this.parseSourceNotes(parsedSource);
            this.analyzeSourceMusic(); // Analyze musical patterns

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
            if (generateBtn) generateBtn.disabled = false;
            this.app.ui.showMessage('Composition loaded. You can now generate variations!', 'info');

        } catch (error) {
            console.error('Failed to parse and set source composition:', error);
            this.app.ui.showMessage('Error loading source composition for variations.', 'error');
            this.fullReset();
        }
    }

    /**
     * Analyze source music to extract patterns for intelligent variation generation
     */
    analyzeSourceMusic() {
        if (this.sourceNotes.size === 0) return;

        const analysis = {
            key: 'C', // Could be detected from pitches
            scale: 'minor', // Could be detected
            bpm: parseInt(document.getElementById('bpm')?.value) || 120,
            timeSignature: document.getElementById('time-signature')?.value || '4/4',
            totalBeats: 0,
            tracks: {}
        };

        this.sourceNotes.forEach((notes, trackType) => {
            if (notes.length === 0) return;

            const pitches = notes.map(n => n.midi);
            const uniquePitches = [...new Set(pitches)].sort((a, b) => a - b);
            const pitchRange = Math.max(...pitches) - Math.min(...pitches);
            
            const rhythms = notes.map(n => {
                const beat = (n.time * analysis.bpm / 60) % 4;
                return Math.round(beat * 4) / 4; // Quantize to 16ths
            });
            const uniqueRhythms = [...new Set(rhythms)].sort((a, b) => a - b);

            const velocities = notes.map(n => n.velocity);
            const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;

            const totalDuration = Math.max(...notes.map(n => n.time + n.duration));
            if (totalDuration > analysis.totalBeats) {
                analysis.totalBeats = totalDuration;
            }

            analysis.tracks[trackType] = {
                noteCount: notes.length,
                pitchRange: pitchRange,
                lowestPitch: Math.min(...pitches),
                highestPitch: Math.max(...pitches),
                uniquePitches: uniquePitches,
                uniqueRhythms: uniqueRhythms,
                avgVelocity: avgVelocity,
                density: notes.length / totalDuration, // notes per beat
                patternLength: this.detectPatternLength(notes, analysis.bpm)
            };
        });

        this.sourceAnalysis = analysis;
        console.log('[Source Analysis]', analysis);
    }

    /**
     * Detect repeating pattern length in beats
     */
    detectPatternLength(notes, bpm) {
        if (notes.length < 4) return 4;
        
        // Simple pattern detection: find where pitch/rhythm repeats
        const pitchSequence = notes.map(n => n.midi);
        
        for (let len = 1; len <= 8; len++) {
            let matches = 0;
            for (let i = 0; i < pitchSequence.length - len; i++) {
                if (pitchSequence[i] === pitchSequence[i + len]) matches++;
            }
            if (matches > pitchSequence.length * 0.3) return len;
        }
        return 4; // Default to 4 beats
    }

    parseSourceNotes(parsedJson) {
        this.sourceNotes.clear();
        
        const notation = parsedJson.notation || '';
        const lines = notation.replace(/\\n/g, '\n').split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.includes('#')) continue;
            
            const [content, comment] = trimmed.split('#', 2);
            const note = this.parseNoteLine(content.trim());
            const trackType = comment?.trim().split(/\s/)[0];
            
            if (note && trackType) {
                if (!this.sourceNotes.has(trackType)) {
                    this.sourceNotes.set(trackType, []);
                }
                this.sourceNotes.get(trackType).push(note);
            }
        }

        console.log(`[JSONVariations] Parsed source notes:`, 
            Array.from(this.sourceNotes.entries()).map(([k, v]) => `${k}: ${v.length} notes`).join(', '));
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
            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${version.apiResponse.title} ${version.isOriginal ? '(Original)' : ''}</h4>
                    <p>${version.apiResponse.explanation}</p>
                    ${version.generationType === 'ai' ? '<span class="badge-ai">AI Generated</span>' : ''}
                    ${version.generationType === 'directive' ? `<small class="directive-tag">${version.directives}</small>` : ''}
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

            let tracks;
            
            if (version.generationType === 'ai' && version.generatedNotation) {
                // AI generated content
                tracks = this.parseNotationToTracks(version.generatedNotation);
            } else if (version.generationType === 'directive' && this.sourceNotes.size > 0) {
                // Directive-based transformation
                tracks = this.applyDirectives(version.directives, version.structure);
            } else {
                // Original or fallback
                tracks = this.parseNotationToTracks(version.apiResponse.notation);
            }
            
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
            
            console.log(`✓ Visualizer updated with ${tracks.size} tracks`);
        } catch (error) {
            console.error('Visualizer update failed:', error);
            throw error;
        }
    }

    /**
     * ============================================
     * SMART STRUCTURE-AWARE VARIATION GENERATION
     * ============================================
     * 
     * Instead of simple directives, we generate NEW musical content
     * based on the source analysis and structure requirements.
     */

    buildSmartVariationPrompt(structure, trackTypes, duration) {
        const bpm = this.sourceAnalysis?.bpm || parseInt(document.getElementById('bpm')?.value) || 120;
        const analysis = this.sourceAnalysis;
        
        // Build track-specific instructions based on analysis
        const trackInstructions = trackTypes.map(trackType => {
            const trackAnalysis = analysis?.tracks[trackType];
            if (!trackAnalysis) return `${trackType}: Follow structure guidelines`;
            
            return `${trackType} (was ${trackAnalysis.noteCount} notes, range ${trackAnalysis.lowestPitch}-${trackAnalysis.highestPitch}):
  - Density: ${(trackAnalysis.density * 100).toFixed(0)}% of original
  - Velocity: ${(trackAnalysis.avgVelocity * 100).toFixed(0)}% average
  - Use pitches: ${trackAnalysis.uniquePitches.slice(0, 5).join(',')}${trackAnalysis.uniquePitches.length > 5 ? '...' : ''}`;
        }).join('\n\n');

        const structureTemplates = {
            intro: `Create an INTRO variation that builds anticipation.

MUSICAL GOAL: Establish mood and key with sparse, atmospheric material.
ARRANGEMENT:
- Start with 1-2 tracks only (prefer pad/chord + subtle bass or melody)
- Add layers gradually over ${duration} bars
- Use sustained notes, long reverb tails, ambient textures
- Lower velocities (40-60% of original)
- Simpler rhythms, more space between notes

TRACK GUIDELINES:
${trackInstructions}

OUTPUT FORMAT:
Return compact format: pitch:beat:dur:vel|pitch:beat:dur:vel...
Use ONLY these tracks: ${trackTypes.join(', ')}
Total duration: ${duration} bars (${duration * 4} beats)`,

            build: `Create a BUILD-UP variation with rising tension.

MUSICAL GOAL: Increase energy and anticipation toward a climax.
ARRANGEMENT:
- Start sparse, end dense
- Add tracks one by one (2 → 3 → 4 tracks)
- Rising pitch registers (start low, end high)
- Accelerating rhythms (long notes → short notes)
- Velocity crescendo (50% → 100%)
- Optional: filter sweep simulation via note density

TRACK GUIDELINES:
${trackInstructions}

OUTPUT FORMAT:
Return compact format: pitch:beat:dur:vel|pitch:beat:dur:vel...
Use ONLY these tracks: ${trackTypes.join(', ')}
Total duration: ${duration} bars (${duration * 4} beats)`,

            verse: `Create a VERSE variation with steady groove.

MUSICAL GOAL: Establish the main theme with consistent energy.
ARRANGEMENT:
- 3 core tracks for rhythmic foundation
- Consistent pattern every 4 beats
- Medium density (70-80% of chorus)
- Slightly lower velocity than chorus
- Space for "storytelling" - not too busy

TRACK GUIDELINES:
${trackInstructions}

OUTPUT FORMAT:
Return compact format: pitch:beat:dur:vel|pitch:beat:dur:vel...
Use ONLY these tracks: ${trackTypes.join(', ')}
Total duration: ${duration} bars (${duration * 4} beats)`,

            chorus: `Create a CHORUS variation - the peak moment.

MUSICAL GOAL: Maximum energy, memorable, emotionally impactful.
ARRANGEMENT:
- All tracks active (4-5 layers)
- Highest note density
- Brightest velocities (80-100%)
- Memorable melodic hooks on top
- Full bass and drums
- Rich harmonies

TRACK GUIDELINES:
${trackInstructions}

OUTPUT FORMAT:
Return compact format: pitch:beat:dur:vel|pitch:beat:dur:vel...
Use ONLY these tracks: ${trackTypes.join(', ')}
Total duration: ${duration} bars (${duration * 4} beats)`,

            bridge: `Create a BRIDGE variation for contrast.

MUSICAL GOAL: Provide musical contrast and reset energy.
ARRANGEMENT:
- Different track combination (e.g., remove drums, add new element)
- Modulation or key change (transpose +4 or +7 semitones)
- Different rhythmic feel (straight → swing or vice versa)
- Stripped down then build back up
- Prepare return to chorus

TRACK GUIDELINES:
${trackInstructions}

OUTPUT FORMAT:
Return compact format: pitch:beat:dur:vel|pitch:beat:dur:vel...
Use ONLY these tracks: ${trackTypes.join(', ')}
Total duration: ${duration} bars (${duration * 4} beats)`
        };

        return `You are an expert music arranger creating a ${structure.toUpperCase()} for "${this.versions[0]?.apiResponse?.title || 'Composition'}".

SOURCE ANALYSIS:
- Key: C minor
- BPM: ${bpm}
- Time: 4/4
- Original tracks: ${trackTypes.join(', ')}

${structureTemplates[structure] || structureTemplates.verse}

RULES:
1. Use pitch as MIDI numbers (36-96)
2. Format: pitch:beat:dur:vel (decimals OK, e.g., 1.5, 0.5)
3. Velocity: 1-9 (1=soft, 9=loud)
4. Separator: | between notes
5. NO explanation, ONLY the note data
6. Match the structure's musical purpose exactly

Generate the ${structure} variation now.`;
    }

    /**
     * Parse AI-generated compact notation
     */
    parseCompactNotation(notationString, trackType, bpm) {
        const notes = [];
        const entries = notationString.split('|').filter(e => e.trim());
        
        entries.forEach(entry => {
            const parts = entry.trim().split(':');
            if (parts.length < 4) return;

            const pitch = parseInt(parts[0]);
            const beat = parseFloat(parts[1]);
            const duration = parseFloat(parts[2]);
            const velocity = parseInt(parts[3]);

            if (isNaN(pitch) || isNaN(beat) || isNaN(duration) || isNaN(velocity)) return;

            const secondsPerBeat = 60 / bpm;

            notes.push({
                name: Tone.Frequency(pitch, 'midi').toNote(),
                midi: pitch,
                time: beat * secondsPerBeat,
                duration: duration * secondsPerBeat,
                velocity: Math.max(0.1, Math.min(1.0, velocity / 9)) // Convert 1-9 to 0.1-1.0
            });
        });

        return notes;
    }

    async fetchVariationContent(prompt, models) {
        const timeout = 30000;
        let lastError = null;

        for (const model of models) {
            this.app.ui.showMessage(`Composing ${model} variation...`, 'loading');
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch('/api/variations', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        prompt: prompt, 
                        model: model,
                        max_tokens: 2000, // More tokens for full composition
                        temperature: 0.7,
                        seed: Math.floor(Math.random() * 100000)
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                const text = await response.text();
                
                if (!text || text.trim().length === 0) {
                    throw new Error('Empty response');
                }

                // Extract notation from response (look for compact format)
                const lines = text.trim().split('\n');
                const notationLines = [];
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    // Look for compact format lines (contain | and :)
                    if (trimmed.includes('|') && trimmed.includes(':') && !trimmed.includes('{')) {
                        notationLines.push(trimmed);
                    }
                }

                if (notationLines.length === 0) {
                    // Try to parse as plain compact format
                    if (text.includes('|') && text.includes(':')) {
                        return text.trim();
                    }
                    throw new Error('No valid notation found in response');
                }

                return notationLines.join('\n');

            } catch (error) {
                lastError = error;
                console.warn(`Attempt with ${model} failed:`, error.message);
                if (model !== models[models.length - 1]) {
                    this.app.ui.showMessage(`${model} failed, trying next...`, 'info');
                }
            }
        }

        throw lastError || new Error('All models failed');
    }

    async generateVariation() {
        console.log('[generateVariation] Checking sourceNotes:', {
            size: this.sourceNotes.size,
            keys: Array.from(this.sourceNotes.keys())
        });

        if (this.sourceNotes.size === 0) {
            if (this.app.generatedTracks && this.app.generatedTracks.size > 0) {
                console.log('[generateVariation] Attempting to recover from app.generatedTracks');
                this.recoverSourceNotesFromApp();
                this.analyzeSourceMusic();
            }
            
            if (this.sourceNotes.size === 0) {
                this.app.ui.showMessage('No source notes loaded. Please generate a composition first.', 'warning');
                return;
            }
        }

        const selectedStructure = document.getElementById('structure-select')?.value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a version type (e.g., Intro, Chorus).', 'warning');
            return;
        }

        const selectedDuration = parseInt(document.getElementById('variation-duration')?.value, 10) || 4;
        const trackTypes = Array.from(this.sourceNotes.keys());

        try {
            this.app.ui.showLoading(`Composing "${selectedStructure}" variation...`);

            // Use SMART generation for intro/chorus/bridge, directive for others
            const useSmartGeneration = ['intro', 'chorus', 'bridge', 'build'].includes(selectedStructure);
            
            if (useSmartGeneration) {
                // AI generates new musical content
                const prompt = this.buildSmartVariationPrompt(selectedStructure, trackTypes, selectedDuration);
                const generatedNotation = await this.fetchVariationContent(prompt, ['claude', 'openai-large']);
                
                console.log('[generateVariation] AI generated notation:', generatedNotation.substring(0, 200));

                const newVersion = {
                    apiResponse: {
                        title: `${this.versions[0]?.apiResponse?.title?.replace(/ \(Original\)/, '') || 'Composition'} - ${selectedStructure.charAt(0).toUpperCase() + selectedStructure.slice(1)}`,
                        explanation: `AI-generated ${selectedStructure} with new musical material`,
                        notation: null
                    },
                    generatedNotation: generatedNotation,
                    generationType: 'ai',
                    structure: selectedStructure,
                    isOriginal: false
                };

                this.versions.push(newVersion);
                
            } else {
                // Use directive-based for verse (simpler transformation)
                const prompt = this.buildSimpleDirectivePrompt(selectedStructure, trackTypes, selectedDuration);
                const directiveString = await this.fetchDirectives(prompt, ['claude-fast', 'openai']);

                const newVersion = {
                    apiResponse: {
                        title: `${this.versions[0]?.apiResponse?.title?.replace(/ \(Original\)/, '') || 'Composition'} - ${selectedStructure.charAt(0).toUpperCase() + selectedStructure.slice(1)}`,
                        explanation: `Variation using directives: ${directiveString}`,
                        notation: null
                    },
                    directives: directiveString,
                    generationType: 'directive',
                    structure: selectedStructure,
                    isOriginal: false
                };

                this.versions.push(newVersion);
            }
            
            this.renderVersionsList();
            this.app.ui.showMessage(`Generated "${selectedStructure}" variation successfully!`, 'success');

        } catch (error) {
            console.error('Variation generation failed:', error);
            this.app.ui.showMessage(`Failed to generate variation: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    // Legacy directive methods for simpler variations
    buildSimpleDirectivePrompt(structure, trackTypes, duration) {
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        
        const structureDirectives = {
            verse: `Create VERSE directives for steady groove.
Target: density:0.8, velocity:0.7, humanize:20, swing:30
Return ONLY: "density:0.8,velocity:0.7,swing:30"`
        };

        return `Generate directives for ${structure} section.
${structureDirectives[structure] || structureDirectives.verse}

Return ONLY the directive string.`;
    }

    async fetchDirectives(prompt, models) {
        const timeout = 15000;
        let lastError = null;

        for (const model of models) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch('/api/variations', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        prompt: prompt, 
                        model: model,
                        max_tokens: 100,
                        seed: Math.floor(Math.random() * 100000)
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                if (!response.ok) throw new Error(`Server error: ${response.status}`);

                const text = await response.text();
                const trimmed = text.trim();
                if (!trimmed.includes(':')) throw new Error('Invalid directive format');
                return trimmed;

            } catch (error) {
                lastError = error;
                if (model !== models[models.length - 1]) {
                    this.app.ui.showMessage(`${model} failed, trying next...`, 'info');
                }
            }
        }

        throw lastError || new Error('All models failed');
    }

    // ... (keep existing applyDirectives, parseDirectives, etc. from previous version)

    applyDirectives(directiveString, structure) {
        const directives = this.parseDirectives(directiveString);
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const finalTracks = new Map();

        this.sourceNotes.forEach((originalNotes, trackType) => {
            if (originalNotes.length === 0) return;
            let notes = originalNotes.map(n => ({...n}));

            // Apply transformations...
            if (directives.density !== undefined) {
                const density = Math.max(0.1, Math.min(2.0, directives.density));
                if (density < 1.0) {
                    notes = notes.filter((_, i) => {
                        const beatPos = (notes[i].time * bpm / 60) % 4;
                        const isOnBeat = Math.abs(beatPos - Math.round(beatPos)) < 0.1;
                        return isOnBeat || Math.random() < density;
                    });
                }
            }

            if (directives.velocity !== undefined) {
                const scale = Math.max(0.1, Math.min(2.0, directives.velocity));
                notes.forEach(n => n.velocity = Math.max(0.1, Math.min(1.0, n.velocity * scale)));
            }

            if (directives.transpose !== undefined) {
                const semitones = parseInt(directives.transpose);
                notes.forEach(n => {
                    n.midi += semitones;
                    n.name = Tone.Frequency(n.midi, 'midi').toNote();
                });
            }

            notes.sort((a, b) => a.time - b.time);

            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                finalTracks.set(trackType, {
                    midi,
                    title: `${trackType} (${structure})`,
                    description: `Generated with directives: ${directiveString}`
                });
            }
        });

        return finalTracks;
    }

    parseDirectives(directiveString) {
        const directives = {};
        if (!directiveString) return directives;
        
        const parts = directiveString.split(',');
        for (const part of parts) {
            const [cmd, val] = part.trim().split(':');
            if (cmd && val !== undefined) {
                directives[cmd.trim()] = parseFloat(val.trim()) || val.trim();
            }
        }
        return directives;
    }

    recoverSourceNotesFromApp() {
        if (!this.app.generatedTracks) return;
        
        this.sourceNotes.clear();
        
        this.app.generatedTracks.forEach((trackData, trackType) => {
            const notes = trackData?.midi?.tracks?.[0]?.notes;
            if (notes && notes.length > 0) {
                const convertedNotes = notes.map(n => ({
                    name: Tone.Frequency(n.midi, 'midi').toNote(),
                    midi: n.midi,
                    time: n.time,
                    duration: n.duration,
                    velocity: n.velocity
                }));
                this.sourceNotes.set(trackType, convertedNotes);
            }
        });
    }

    parseNotationToTracks(notation) {
        const tracks = new Map();
        if (!notation) return tracks;
        
        const lines = notation.replace(/\\n/g, '\n').split('\n');
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        const rawTrackNotes = new Map();
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.includes(':')) continue;
            
            // Try to detect track type from context or use generic
            const trackType = this.inferTrackType(trimmed) || 'melody';
            
            const notes = this.parseCompactNotation(trimmed, trackType, bpm);
            if (notes.length > 0) {
                if (!rawTrackNotes.has(trackType)) {
                    rawTrackNotes.set(trackType, []);
                }
                rawTrackNotes.get(trackType).push(...notes);
            }
        }
        
        rawTrackNotes.forEach((notes, trackType) => {
            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                finalTracks.set(trackType, {
                    midi,
                    title: `${trackType} (generated)`,
                    description: `AI-generated ${trackType} track`
                });
            }
        });
        
        return finalTracks;
    }

    inferTrackType(notationLine) {
        // Infer track type from pitch ranges
        const firstNote = notationLine.split('|')[0];
        if (!firstNote) return 'melody';
        
        const pitch = parseInt(firstNote.split(':')[0]);
        if (isNaN(pitch)) return 'melody';
        
        if (pitch < 40) return 'bass';
        if (pitch > 70) return 'melody';
        return 'chord';
    }

    parseCompactNotation(notationString, trackType, bpm) {
        const notes = [];
        const entries = notationString.split('|').filter(e => e.trim());
        
        entries.forEach(entry => {
            const parts = entry.trim().split(':');
            if (parts.length < 4) return;

            const pitch = parseInt(parts[0]);
            const beat = parseFloat(parts[1]);
            const duration = parseFloat(parts[2]);
            const velocity = parseInt(parts[3]);

            if (isNaN(pitch) || isNaN(beat) || isNaN(duration) || isNaN(velocity)) return;

            const secondsPerBeat = 60 / bpm;

            notes.push({
                name: Tone.Frequency(pitch, 'midi').toNote(),
                midi: pitch,
                time: beat * secondsPerBeat,
                duration: duration * secondsPerBeat,
                velocity: Math.max(0.1, Math.min(1.0, velocity / 9))
            });
        });

        return notes;
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
                let tracks;
                
                if (version.generationType === 'ai' && version.generatedNotation) {
                    tracks = this.parseNotationToTracks(version.generatedNotation);
                } else if (version.generationType === 'directive' && this.sourceNotes.size > 0) {
                    tracks = this.applyDirectives(version.directives, version.structure);
                } else {
                    tracks = this.parseNotationToTracks(version.apiResponse.notation);
                }
                
                if (tracks.size > 0) {
                    const combinedMidi = MidiBuilder.createCombinedMidi(tracks, bpm);
                    if (combinedMidi) {
                        const midiBytes = combinedMidi.toArray();
                        const sanitizedTitle = version.apiResponse.title.replace(/[\/\\?%*:|"<>]/g, '-').trim();
                        zip.file(`${sanitizedTitle}.mid`, midiBytes);
                    }
                }
            }

            const directivesSummary = this.versions.map(v => 
                `${v.apiResponse.title}: ${v.generationType === 'ai' ? 'AI-generated' : v.directives || 'original'}`
            ).join('\n');
            zip.file('_generation_summary.txt', directivesSummary);

            const content = await zip.generateAsync({ type: 'blob' });
            const zipFilename = `${sourceTitle.replace(/[\/\\?%*:|"<>]/g, '-').trim()}-variations.zip`;

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
