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

        const rawJsonInput = document.getElementById('raw-json-input');
        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');

        try {
            const parsedSource = JSON.parse(rawJson);
            this.sourceJson = JSON.stringify(parsedSource);
            
            if (rawJsonInput) rawJsonInput.value = JSON.stringify(parsedSource, null, 2);

            this.parseSourceNotes(parsedSource);

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
                    ${version.directives ? `<small class="directive-tag">${version.directives}</small>` : ''}
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
            
            if (version.directives && this.sourceNotes.size > 0) {
                tracks = this.applyStructureDirectives(version.directives, version.structure);
            } else {
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
     * SMART STRUCTURE-SPECIFIC DIRECTIVES
     * ============================================
     * 
     * Each structure has its own creative transformation strategy
     * that goes beyond simple parameter adjustment
     */

    buildSmartDirectivePrompt(structure, trackTypes, duration) {
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const beatsPerBar = parseInt((document.getElementById('time-signature')?.value || '4/4').split('/')[0], 10) || 4;
        const totalBeats = duration * beatsPerBar;

        // Get pitch ranges from source for intelligent suggestions
        const pitchRanges = {};
        this.sourceNotes.forEach((notes, trackType) => {
            if (notes.length > 0) {
                const pitches = notes.map(n => n.midi);
                pitchRanges[trackType] = {
                    min: Math.min(...pitches),
                    max: Math.max(...pitches),
                    avg: Math.round(pitches.reduce((a,b) => a+b, 0) / pitches.length)
                };
            }
        });

        const structureDirectives = {
            intro: `You are creating an INTRO - the mysterious entry point.

MUSICAL GOAL: Sparse, atmospheric, building anticipation from silence
AVAILABLE TRACKS: ${trackTypes.join(', ')}

TRANSFORMATION STRATEGY:
1. DENSITY: Use only 20-30% of original notes (extreme sparsity)
2. VELOCITY: Reduce to 30-50% (intimate, whispered)
3. TRACK SELECTION: Pick 1-2 tracks max (chord/pad + subtle bass OR melody)
4. RHYTHM: Double note durations (sustained, floating)
5. PITCH: Drop bass notes one octave lower for depth
6. HARMONIC RHYTHM: One chord change every 2-4 bars (static, meditative)
7. SPACE: Add 50% more silence between phrases

EXAMPLE DIRECTIVES FOR INTRO:
"density:0.25,velocity:0.4,tracks:2,stretch:2,octave:-1,sparse:1,gate:0.6"

Return ONLY the directive string (no explanation):`,

            build: `You are creating a BUILD-UP - rising tension toward climax.

MUSICAL GOAL: Energy accumulation, anticipation, "lift-off" feeling
AVAILABLE TRACKS: ${trackTypes.join(', ')}

TRANSFORMATION STRATEGY:
1. DENSITY: Gradual increase 50% → 150% (start sparse, end dense)
2. VELOCITY: Crescendo 40% → 90% (getting louder)
3. PITCH: Gradual upward shift +3 to +7 semitones (rising tension)
4. RHYTHM: Accelerate - compress time to 70% (faster feel)
5. TRACKS: Progressive layering - start with 2, end with all ${trackTypes.length}
6. FILTER SIMULATION: Reduce gate to 0.3 then open to 0.9 (opening up)
7. EXCITEMENT: Add fill notes in gaps (ghost notes)

EXAMPLE DIRECTIVES FOR BUILD:
"density:1.2,velocity:0.7,transpose:5,stretch:0.7,fill:1,gate:0.4,octave:1"

Return ONLY the directive string (no explanation):`,

            verse: `You are creating a VERSE - the storytelling section.

MUSICAL GOAL: Steady groove, grounded, consistent energy, "breathing" space
AVAILABLE TRACKS: ${trackTypes.join(', ')}

TRANSFORMATION STRATEGY:
1. DENSITY: 70-80% (fuller than intro, sparser than chorus)
2. VELOCITY: Moderate 60-70% (conversational, not shouting)
3. GROOVE: Add subtle swing (30-40%) for human feel
4. CONSISTENCY: Humanize timing slightly (20-30% variance)
5. BASS: Keep solid and grounded, maybe staccato for punch
6. MELODY: Clear but not overwhelming, leave space for vocals/lead
7. CHORDS: Regular harmonic rhythm, supportive role

EXAMPLE DIRECTIVES FOR VERSE:
"density:0.75,velocity:0.65,swing:35,humanize:25,staccato:1,gate:0.8"

Return ONLY the directive string (no explanation):`,

            chorus: `You are creating a CHORUS - the peak emotional moment.

MUSICAL GOAL: Maximum impact, memorable, anthemic, all-in energy
AVAILABLE TRACKS: ${trackTypes.join(', ')}

TRANSFORMATION STRATEGY:
1. DENSITY: 120-150% (more notes than original - fill the space!)
2. VELOCITY: 90-110% (bright, bold, confident)
3. ALL TRACKS: Use every available track (${trackTypes.join(', ')})
4. PITCH: Raise melody +12 semitones (octave up for brightness)
5. HARMONY: Add parallel harmonies (fill chords with extra notes)
6. RHYTHM: Straight, driving, no swing (focused energy)
7. LEGATO: Connect notes for smooth, soaring lines
8. DOUBLING: Double important melodic notes at octave

EXAMPLE DIRECTIVES FOR CHORUS:
"density:1.4,velocity:1.0,transpose:12,legato:1,fill:1,octave:1,gate:0.95"

Return ONLY the directive string (no explanation):`,

            bridge: `You are creating a BRIDGE - the contrast and departure.

MUSICAL GOAL: Surprise, contrast, reset expectations, prepare for return
AVAILABLE TRACKS: ${trackTypes.join(', ')}

TRANSFORMATION STRATEGY:
1. MODULATION: Transpose +4 or +7 semitones (new key center)
2. TRACK SWAP: Remove 1-2 main tracks, emphasize different ones
3. DENSITY: Drop to 50% then build back (contrast in dynamics)
4. RHYTHM: Reverse pattern or use different subdivision
5. TEXTURE: Staccato if original was legato, or vice versa
6. SPACE: Create "hole" in middle then fill (contrast in time)
7. VELOCITY: Variable - soft-loud-soft (dramatic arc)

EXAMPLE DIRECTIVES FOR BRIDGE:
"density:0.6,velocity:0.8,transpose:7,staccato:1,reverse:1,sparse:1,fill:1"

Return ONLY the directive string (no explanation):`
        };

        return structureDirectives[structure] || structureDirectives.verse;
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
            this.app.ui.showLoading(`Creating "${selectedStructure}" variation...`);

            // ✅ ALL structures use smart directive-based generation
            const prompt = this.buildSmartDirectivePrompt(selectedStructure, trackTypes, selectedDuration);
            const directiveString = await this.fetchDirectives(prompt, ['openai-large', 'openai']);

            console.log('[generateVariation] Received directives:', directiveString);

            const newVersion = {
                apiResponse: {
                    title: `${this.versions[0]?.apiResponse?.title?.replace(/ \(Original\)/, '') || 'Composition'} - ${selectedStructure.charAt(0).toUpperCase() + selectedStructure.slice(1)}`,
                    explanation: `${selectedStructure} variation: ${directiveString}`,
                    notation: null
                },
                directives: directiveString,
                structure: selectedStructure,
                isOriginal: false
            };

            this.versions.push(newVersion);
            this.renderVersionsList();
            
            this.app.ui.showMessage(`Created "${selectedStructure}" with smart directives: ${directiveString}`, 'success');

        } catch (error) {
            console.error('Variation generation failed:', error);
            this.app.ui.showMessage(`Failed to generate variation: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    async fetchDirectives(prompt, models) {
        const timeout = 25000;
        let lastError = null;

        for (const model of models) {
            this.app.ui.showMessage(`Designing ${model} directives...`, 'loading');
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch('/api/variations', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        prompt: prompt, 
                        model: model,
                        max_tokens: 200, // Short response for directives
                        temperature: 0.8, // Slightly creative
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

                const trimmed = text.trim();
                
                // Extract directive string (look for pattern like "density:0.5,velocity:0.7")
                const directiveMatch = trimmed.match(/([a-z]+:[\d.]+(?:,[a-z]+:[\d.]+)*)/i);
                
                if (directiveMatch) {
                    return directiveMatch[1];
                }
                
                // Fallback: if it contains colons and commas, it's probably directives
                if (trimmed.includes(':') && trimmed.includes(',')) {
                    return trimmed.replace(/["']/g, '').replace(/.*?(density|transpose|velocity)/i, '$1');
                }

                throw new Error('Response does not contain valid directives');

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

    /**
     * Apply structure-specific creative transformations
     */
    applyStructureDirectives(directiveString, structure) {
        const directives = this.parseDirectives(directiveString);
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const finalTracks = new Map();

        console.log(`[Structure: ${structure}] Applying directives:`, directives);

        // Structure-specific preprocessing
        const trackTypes = Array.from(this.sourceNotes.keys());
        let activeTracks = [...trackTypes];
        
        // INTRO: Use only 1-2 tracks
        if (structure === 'intro' && directives.tracks) {
            const numTracks = Math.min(2, trackTypes.length);
            activeTracks = trackTypes.slice(0, numTracks);
        }
        
        // BUILD: Progressive track addition
        if (structure === 'build') {
            // All tracks active, but we'll process them differently
        }

        this.sourceNotes.forEach((originalNotes, trackType) => {
            // Skip tracks not active for this structure
            if (!activeTracks.includes(trackType)) return;
            if (originalNotes.length === 0) return;

            let notes = originalNotes.map(n => ({...n}));

            // ===== DENSITY TRANSFORMATION =====
            if (directives.density !== undefined) {
                const density = Math.max(0.1, Math.min(2.0, directives.density));
                
                if (density < 1.0) {
                    // Remove notes strategically (keep structural ones)
                    notes = notes.filter((note, i) => {
                        const beatPos = (note.time * bpm / 60) % 4;
                        const isDownbeat = Math.abs(beatPos) < 0.1;
                        const isStrongBeat = Math.abs(beatPos - 2) < 0.1;
                        
                        // Always keep downbeats, probabilistically keep others
                        if (isDownbeat || isStrongBeat) return true;
                        return Math.random() < density;
                    });
                } else if (density > 1.0) {
                    // Duplicate/add notes for density
                    const newNotes = [];
                    notes.forEach(note => {
                        newNotes.push(note);
                        // Add ghost notes in gaps
                        if (Math.random() < (density - 1)) {
                            newNotes.push({
                                ...note,
                                time: note.time + (60/bpm) * 0.5, // 8th note later
                                velocity: note.velocity * 0.6,
                                midi: note.midi + ([-2, 0, 2, 4][Math.floor(Math.random() * 4)])
                            });
                        }
                    });
                    notes = newNotes;
                }
            }

            // ===== VELOCITY/DYNAMICS =====
            if (directives.velocity !== undefined) {
                const scale = Math.max(0.1, Math.min(1.5, directives.velocity));
                notes.forEach(n => {
                    n.velocity = Math.max(0.05, Math.min(1.0, n.velocity * scale));
                });
            }

            // ===== PITCH/TRANSPOSITION =====
            if (directives.transpose !== undefined) {
                const semitones = Math.max(-24, Math.min(24, parseInt(directives.transpose)));
                notes.forEach(n => {
                    n.midi += semitones;
                    n.name = Tone.Frequency(n.midi, 'midi').toNote();
                });
            }

            // ===== OCTAVE SHIFT =====
            if (directives.octave !== undefined) {
                const octaves = parseInt(directives.octave) * 12;
                notes.forEach(n => {
                    n.midi += octaves;
                    n.name = Tone.Frequency(n.midi, 'midi').toNote();
                });
            }

            // ===== TIME STRETCH/COMPRESS =====
            if (directives.stretch !== undefined) {
                const factor = Math.max(0.25, Math.min(4.0, directives.stretch));
                notes.forEach(n => {
                    n.time *= factor;
                    n.duration *= factor;
                });
            }

            // ===== REVERSE (for bridge contrast) =====
            if (directives.reverse === 1) {
                const totalDuration = Math.max(...notes.map(n => n.time + n.duration));
                notes.forEach(n => {
                    const endTime = n.time + n.duration;
                    const newEnd = totalDuration - n.time;
                    n.time = Math.max(0, newEnd - n.duration);
                });
                notes.sort((a, b) => a.time - b.time);
            }

            // ===== SPARSE (keep only structural notes) =====
            if (directives.sparse === 1) {
                notes = notes.filter(n => {
                    const beatPos = (n.time * bpm / 60) % 4;
                    // Keep only downbeats and backbeats
                    return beatPos < 0.3 || Math.abs(beatPos - 2) < 0.3;
                });
            }

            // ===== FILL (add ghost notes) =====
            if (directives.fill === 1) {
                const newNotes = [];
                for (let i = 0; i < notes.length - 1; i++) {
                    newNotes.push(notes[i]);
                    const gap = notes[i + 1].time - (notes[i].time + notes[i].duration);
                    if (gap > 0.15) { // Significant gap
                        newNotes.push({
                            ...notes[i],
                            time: notes[i].time + notes[i].duration + gap / 2,
                            duration: Math.min(gap / 2, 0.1),
                            velocity: notes[i].velocity * 0.5,
                            midi: notes[i].midi + (Math.random() > 0.5 ? 7 : -5) // Perfect 5th or 4th
                        });
                    }
                }
                if (notes.length > 0) newNotes.push(notes[notes.length - 1]);
                notes = newNotes;
            }

            // ===== STACCATO (shorten) =====
            if (directives.staccato === 1) {
                notes.forEach(n => n.duration *= 0.4);
            }

            // ===== LEGATO (extend to next) =====
            if (directives.legato === 1) {
                for (let i = 0; i < notes.length - 1; i++) {
                    const gap = notes[i + 1].time - (notes[i].time + notes[i].duration);
                    if (gap > 0 && gap < 0.5) {
                        notes[i].duration += gap - 0.02; // Almost touch
                    }
                }
            }

            // ===== GATE (note length adjustment) =====
            if (directives.gate !== undefined) {
                const gate = Math.max(0.1, Math.min(1.0, directives.gate));
                notes.forEach(n => n.duration *= gate);
            }

            // ===== HUMANIZE (timing/velocity variance) =====
            if (directives.humanize !== undefined) {
                const amount = Math.max(0, Math.min(100, directives.humanize));
                const timeVar = (amount / 100) * 0.03; // Max 30ms
                const velVar = amount / 100 * 0.15;
                
                notes.forEach(n => {
                    n.time += (Math.random() - 0.5) * 2 * timeVar;
                    n.velocity *= 1 + (Math.random() - 0.5) * 2 * velVar;
                    n.velocity = Math.max(0.05, Math.min(1.0, n.velocity));
                });
            }

            // ===== SWING (groove) =====
            if (directives.swing !== undefined) {
                const swingAmount = Math.max(0, Math.min(100, directives.swing));
                const beatDur = 60 / bpm;
                
                notes.forEach(n => {
                    const beatPos = n.time / beatDur;
                    const isEighth = Math.abs((beatPos % 1) - 0.5) < 0.15;
                    if (isEighth) {
                        // Delay off-beats
                        n.time += (swingAmount / 100) * (beatDur / 3);
                    }
                });
            }

            // Sort by time after all transformations
            notes.sort((a, b) => a.time - b.time);

            // Create MIDI if we have notes
            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                finalTracks.set(trackType, {
                    midi,
                    title: `${trackType} (${structure})`,
                    description: `Smart ${structure} variation`
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
                // Try to parse as number, fallback to string
                const numVal = parseFloat(val.trim());
                directives[cmd.trim()] = isNaN(numVal) ? val.trim() : numVal;
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
                console.log(`[recoverSourceNotesFromApp] Recovered ${convertedNotes.length} notes for ${trackType}`);
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
        
        rawTrackNotes.forEach((notes, trackType) => {
            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                tracks.set(trackType, {
                    midi,
                    title: trackType.charAt(0).toUpperCase() + trackType.slice(1),
                    description: `Generated ${trackType} version.`
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
                
                if (version.directives && this.sourceNotes.size > 0) {
                    tracks = this.applyStructureDirectives(version.directives, version.structure);
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
                `${v.apiResponse.title}: ${v.directives || 'original'}`
            ).join('\n');
            zip.file('_directives_summary.txt', directivesSummary);

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
