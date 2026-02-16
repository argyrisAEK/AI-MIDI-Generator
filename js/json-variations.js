import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.sourceAnalysis = null;
     
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
            this.sourceJson = parsedJson;

            const originalVersion = this.versions.find(v => v.isOriginal);
            if (originalVersion) {
                originalVersion.data = parsedJson;
                const sourceTitle = document.getElementById('source-composition-title');
                const sourceExplanation = document.getElementById('source-composition-explanation');
                if (sourceTitle) sourceTitle.textContent = parsedJson.title || 'Custom Composition';
                if (sourceExplanation) sourceExplanation.textContent = parsedJson.desc || '';
            }

            this.analyzeSourceMusic(parsedJson);

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
        this.resetUI();
    }

    fullReset() {
        this.reset();
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
            const parsedSource = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
            this.sourceJson = parsedSource;
            
            if (rawJsonInput) rawJsonInput.value = JSON.stringify(parsedSource, null, 2);

            this.analyzeSourceMusic(parsedSource);

            const originalVersion = {
                data: parsedSource,
                context: context,
                isOriginal: true,
                structure: 'Original'
            };
            this.versions.push(originalVersion);
            this.renderVersionsList();

            if (sourceTitle) sourceTitle.textContent = parsedSource.title || metadata.title || 'Composition';
            if (sourceExplanation) sourceExplanation.textContent = parsedSource.desc || metadata.explanation || '';
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
     * Parse compact notation string to note objects
     * Format: "pitch:beat:dur:vel|pitch:beat:dur:vel"
     * Velocity is 1-9 (10% increments)
     */
    parseCompactNotation(notationString) {
        if (!notationString || typeof notationString !== 'string') return [];
        
        return notationString.split('|')
            .map(entry => entry.trim())
            .filter(entry => entry.length > 0)
            .map(entry => {
                const parts = entry.split(':').map(p => p.trim());
                if (parts.length < 4) return null;
                
                const pitch = parseInt(parts[0]);
                const time = parseFloat(parts[1]);
                const duration = parseFloat(parts[2]);
                const velocity = parseInt(parts[3]); // 1-9 scale
                
                if (isNaN(pitch) || isNaN(time) || isNaN(duration) || isNaN(velocity)) {
                    return null;
                }
                
                return {
                    pitch,
                    time,
                    duration,
                    velocity, // Keep as 1-9 for compactness, normalize later for MIDI
                    velocityNorm: Math.max(0.1, Math.min(0.9, velocity / 10))
                };
            })
            .filter(n => n !== null);
    }

    /**
     * Convert note objects back to compact notation string
     */
    notationToString(notes) {
        return notes.map(n => {
            const pitch = Math.round(n.pitch);
            const time = Number(n.time).toFixed(2).replace(/^0+/, '').replace(/^\.+/, '0.');
            const duration = Number(n.duration).toFixed(2).replace(/^0+/, '').replace(/^\.+/, '0.');
            const velocity = Math.max(1, Math.min(9, Math.round(n.velocity)));
            return `${pitch}:${time}:${duration}:${velocity}`;
        }).join('|');
    }

    /**
     * Analyze source music for intelligent variation generation
     */
    analyzeSourceMusic(parsedJson) {
        if (!parsedJson || !parsedJson.tracks) return;

        const analysis = {
            bpm: parsedJson.bpm || 120,
            timeSignature: parsedJson.timeSignature || '4/4',
            totalBeats: 0,
            tracks: {},
            key: this.detectKey(parsedJson),
            style: parsedJson.style || 'house',
            mood: parsedJson.mood || 'neutral'
        };

        Object.entries(parsedJson.tracks).forEach(([trackName, notation]) => {
            const notes = this.parseCompactNotation(notation);
            if (notes.length === 0) return;

            const pitches = notes.map(n => n.pitch);
            const times = notes.map(n => n.time);
            const totalDuration = Math.max(...times.map((t, i) => t + notes[i].duration));
            
            if (totalDuration > analysis.totalBeats) {
                analysis.totalBeats = totalDuration;
            }

            // Classify track type by name and pitch range
            const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
            const lowerName = trackName.toLowerCase();
            
            let type = 'other';
            if (lowerName.includes('bass')) type = 'bass';
            else if (lowerName.includes('drum') || lowerName.includes('kick') || lowerName.includes('snare') || lowerName.includes('perc')) type = 'drums';
            else if (lowerName.includes('lead') || lowerName.includes('melody') || lowerName.includes('arp')) type = 'melody';
            else if (lowerName.includes('chord') || lowerName.includes('pad') || lowerName.includes('key')) type = 'harmony';
            else if (avgPitch < 40) type = 'drums';
            else if (avgPitch < 55) type = 'bass';
            else if (avgPitch > 70) type = 'melody';
            else type = 'harmony';

            analysis.tracks[trackName] = {
                noteCount: notes.length,
                pitchRange: Math.max(...pitches) - Math.min(...pitches),
                lowestPitch: Math.min(...pitches),
                highestPitch: Math.max(...pitches),
                density: notes.length / totalDuration,
                totalDuration: totalDuration,
                avgVelocity: notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length,
                avgPitch: avgPitch,
                type: type,
                rhythmPattern: this.detectRhythmPattern(notes)
            };
        });

        this.sourceAnalysis = analysis;
        console.log('[Source Analysis]', analysis);
    }

    detectKey(parsedJson) {
        const allPitches = [];
        Object.values(parsedJson.tracks || {}).forEach(notation => {
            const notes = this.parseCompactNotation(notation);
            notes.forEach(n => allPitches.push(n.pitch % 12));
        });
        
        if (allPitches.length === 0) return 'C';
        
        const pitchCounts = {};
        allPitches.forEach(p => {
            pitchCounts[p] = (pitchCounts[p] || 0) + 1;
        });
        
        const hasEb = (pitchCounts[3] || 0) > allPitches.length * 0.1;
        const hasAb = (pitchCounts[8] || 0) > allPitches.length * 0.1;
        return (hasEb || hasAb) ? 'C minor' : 'C major';
    }

    detectRhythmPattern(notes) {
        if (notes.length < 4) return 'simple';
        const intervals = [];
        for (let i = 1; i < notes.length; i++) {
            intervals.push(Math.round((notes[i].time - notes[i-1].time) * 100) / 100);
        }
        const unique = [...new Set(intervals)];
        if (unique.length <= 2) return 'repetitive';
        if (unique.length <= 4) return 'patterned';
        return 'complex';
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
            const title = version.data?.title || 'Untitled';
            const desc = version.data?.desc || '';
            
            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${title} ${version.isOriginal ? '(Original)' : ''}</h4>
                    <p>${desc}</p>
                    ${version.directives ? `<small class="directive-tag">${version.directives}</small>` : ''}
                    ${version.structure ? `<small class="structure-tag">${version.structure}</small>` : ''}
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
            if (!version || !version.data) {
                this.app.ui.showMessage('Version not found.', 'error');
                return;
            }

            // Convert JSON tracks to MIDI for the player using existing parser
            const tracks = this.jsonToMidiTracks(version.data);
            
            if (tracks.size === 0) {
                this.app.ui.showMessage('Cannot load an empty version.', 'error');
                return;
            }

            this.app.generatedTracks = tracks;
            this.app.compositionTitle = version.data.title;
            this.app.compositionDescription = version.data.desc;
            
            this.updateVisualizer(
                tracks,
                version.data.title,
                version.data.desc
            );
            
            this.app.ui.updateButtonStates(true);
            this.app.ui.showMessage(`Loaded "${version.data.title}" into the main player.`, 'success');

        } catch (error) {
            console.error('Error loading version:', error);
            this.app.ui.showMessage(`Failed to load version: ${error.message}`, 'error');
        }
    }

    /**
     * Convert JSON format to MIDI tracks for the player
     * Uses the same logic as midi-generator-api
     */
    jsonToMidiTracks(jsonData) {
        const tracks = new Map();
        const bpm = jsonData.bpm || parseInt(document.getElementById('bpm')?.value) || 120;
        const secondsPerBeat = 60 / bpm;
        
        Object.entries(jsonData.tracks || {}).forEach(([trackName, notation]) => {
            const notes = this.parseCompactNotation(notation);
            if (notes.length === 0) return;

            const midi = new Midi();
            const track = midi.addTrack();
            midi.header.setTempo(bpm);
            
            notes.forEach(note => {
                track.addNote({
                    midi: note.pitch,
                    time: note.time * secondsPerBeat,
                    duration: note.duration * secondsPerBeat,
                    velocity: note.velocityNorm
                });
            });
            
            tracks.set(trackName, {
                midi,
                title: trackName,
                description: `${trackName} track`
            });
        });
        
        return tracks;
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

    /**
     * ============================================
     * LLM DIRECTIVE GENERATION
     * ============================================
     */

    buildDirectivePrompt(structure, analysis) {
        const trackInfo = Object.entries(analysis.tracks).map(([name, data]) => {
            return `${name}(${data.type}, ${data.noteCount}n, ${data.lowestPitch}-${data.highestPitch})`;
        }).join(', ');

        const structureContexts = {
            intro: `Create INTRO directives for: ${analysis.style}, ${analysis.mood}, ${analysis.key}
            
Tracks: ${trackInfo}
Duration: ${analysis.totalBeats} beats

GOAL: Sparse, atmospheric entry. Draw listener in with minimal material.

DIRECTIVES (pick 3-5):
- density:0.15-0.35 (essential - very sparse)
- velocity:0.4-0.6 (quiet)
- stretch:1.3-2.0 (slower, floating)
- transpose:0 or 12 (octave up for airiness)
- only:bass,pad (limit tracks)
- sparse:1 (structural notes only)
- sustain:2-4 (long notes)
- pedal:1 (drone tone)
- fadein:1 (gradual build)

Example: "density:0.2,velocity:0.5,stretch:1.5,only:bass,pad,sparse:1"

Return ONLY the directive string:`,

            build: `Create BUILD-UP directives for: ${analysis.style}, ${analysis.mood}
            
Tracks: ${trackInfo}

GOAL: Rising tension, increasing energy exponentially.

DIRECTIVES (pick 4-6):
- density:0.6→1.4 (progressive increase)
- velocity:0.6→1.0 (crescendo)
- stretch:0.8→1.0 (accelerating)
- transpose:3-7 (rising pitch)
- octave:1 (higher register)
- fill:1 (ghost notes)
- rise:1 (ascending lines)
- accent:1 (emphasize beats)
- double:1 (octave doubling)
- tremolo:1 (intensity)

Example: "density:1.2,velocity:0.9,transpose:5,rise:1,accent:1,fill:1"

Return ONLY the directive string:`,

            verse: `Create VERSE directives for: ${analysis.style}, ${analysis.mood}
            
Tracks: ${trackInfo}

GOAL: Grounded, consistent groove. Support narrative.

DIRECTIVES (pick 3-5):
- density:0.7-0.9 (solid, not crowded)
- velocity:0.65-0.8 (conversational)
- swing:20-40 (human feel)
- humanize:10-25 (natural timing)
- staccato:1 (punchy)
- ghost:1 (subtle ghosts)
- syncopate:0.3-0.6 (off-beat)
- groove:1 (lock in pocket)

Example: "density:0.8,velocity:0.7,swing:30,humanize:15,groove:1"

Return ONLY the directive string:`,

            chorus: `Create CHORUS directives for: ${analysis.style}, ${analysis.mood}
            
Tracks: ${trackInfo}

GOAL: Maximum emotional impact. Anthemic, unforgettable.

DIRECTIVES (pick 5-7):
- density:1.2-1.6 (fill space)
- velocity:0.9-1.2 (bold)
- transpose:12 (octave up)
- double:1 (octave doubling)
- harmonize:3,5 (parallel intervals)
- legato:1 (smooth)
- fill:1 (ornamentation)
- spread:1 (wide register)
- sustain:1.5 (long notes)
- accent:1 (strong beats)
- all:1 (all tracks)

Example: "density:1.4,velocity:1.1,transpose:12,double:1,harmonize:3,legato:1,accent:1"

Return ONLY the directive string:`,

            bridge: `Create BRIDGE directives for: ${analysis.style}, ${analysis.mood}
            
Tracks: ${trackInfo}

GOAL: Contrast, surprise, modulation. Refresh the ear.

DIRECTIVES (pick 4-6):
- transpose:4-7 (modulation)
- invert:1 (flip contour)
- retrograde:1 (reverse melody)
- density:0.5-0.8 (contrast)
- staccato:1 (opposite of legato)
- cluster:1 (dissonant)
- spread:1 (extreme register)
- break:1 (rhythmic holes)
- fall:1 (descending lines)
- only:lead,keys (different focus)

Example: "transpose:5,invert:1,density:0.6,staccato:1,cluster:1,fall:1"

Return ONLY the directive string:`,

            breakdown: `Create BREAKDOWN directives for: ${analysis.style}
            
Tracks: ${trackInfo}

GOAL: Stripped-back tension, minimal material.

DIRECTIVES (pick 3-5):
- density:0.1-0.25 (almost nothing)
- velocity:0.3-0.5 (quiet)
- sparse:1 (skeleton only)
- break:1 (rhythmic silence)
- pedal:1 (single drone)
- filter:low (muffled)
- only:pad (minimal tracks)
- space:1 (emphasize silence)

Example: "density:0.15,velocity:0.4,sparse:1,break:1,only:pad"

Return ONLY the directive string:`,

            drop: `Create DROP directives for: ${analysis.style}
            
Tracks: ${trackInfo}

GOAL: Maximum impact, sudden fullness.

DIRECTIVES (pick 4-6):
- density:1.6-2.0 (wall of sound)
- velocity:1.1-1.3 (hit hard)
- accent:1 (every beat)
- double:1 (octave reinforce)
- quantize:1 (tight)
- staccato:0.5 (punchy)
- syncopate:0.5 (off-beat hits)
- rolls:1 (drum rolls)
- all:1 (everything)
- truncate:0.7 (short, tight)

Example: "density:1.8,velocity:1.2,accent:1,double:1,quantize:1,rolls:1"

Return ONLY the directive string:`,

            outro: `Create OUTRO directives for: ${analysis.style}, ${analysis.mood}
            
Tracks: ${trackInfo}

GOAL: Resolution, release, or fade to infinity.

DIRECTIVES (pick 3-5):
- density:0.3→0.05 (dissolve)
- velocity:0.6→0.2 (fading)
- stretch:1.5-2.5 (expanding time)
- sustain:2-3 (final long notes)
- pedal:1 (last drone)
- sparse:1 (essential only)
- fadeout:1 (diminuendo)
- fall:1 (descending)
- only:pad,bass (strip down)

Example: "density:0.2,velocity:0.4,stretch:2,sustain:3,sparse:1,fadeout:1"

Return ONLY the directive string:`
        };

        return structureContexts[structure] || structureContexts.verse;
    }

    async generateVariation() {
        if (!this.sourceJson || !this.sourceJson.tracks) {
            this.app.ui.showMessage('No source composition loaded. Please generate a composition first.', 'warning');
            return;
        }

        const selectedStructure = document.getElementById('structure-select')?.value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a version type (e.g., Intro, Chorus).', 'warning');
            return;
        }

        try {
            this.app.ui.showLoading(`Designing "${selectedStructure}" variation with AI...`);

            // Get AI-generated directives based on structure and source analysis
            const prompt = this.buildDirectivePrompt(selectedStructure, this.sourceAnalysis);
            const directiveString = await this.fetchDirectives(prompt, ['claude-fast', 'openai']);

            console.log('[generateVariation] AI directives:', directiveString);

            // Apply directives to source JSON to create variation
            const variationJson = this.applyDirectivesToJson(
                JSON.parse(JSON.stringify(this.sourceJson)), // Deep copy
                directiveString,
                selectedStructure
            );

            // Update metadata
            variationJson.title = `${this.sourceJson.title} - ${selectedStructure.charAt(0).toUpperCase() + selectedStructure.slice(1)}`;
            variationJson.desc = `${selectedStructure} variation using directives: ${directiveString}`;
            variationJson.bpm = this.sourceJson.bpm;
            variationJson.style = this.sourceJson.style;
            variationJson.mood = this.sourceJson.mood;

            const newVersion = {
                data: variationJson,
                directives: directiveString,
                structure: selectedStructure,
                isOriginal: false
            };

            this.versions.push(newVersion);
            this.renderVersionsList();
            
            this.app.ui.showMessage(`Created "${selectedStructure}" with AI directives: ${directiveString}`, 'success');

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
            this.app.ui.showMessage(`Asking ${model} for musical directions...`, 'loading');
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch('/api/variations', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        prompt: prompt, 
                        model: model,
                        max_tokens: 150,
                        temperature: 0.8,
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
                
                // Extract directive string (format: "key:value,key:value")
                const directiveMatch = trimmed.match(/([a-z]+:[\d.]+(?:,[a-z]+:[\d.]+)*)/i);
                
                if (directiveMatch) {
                    return directiveMatch[1];
                }
                
                // Fallback: if contains colons and commas, clean it up
                if (trimmed.includes(':') && trimmed.includes(',')) {
                    return trimmed.replace(/["']/g, '').split('\n')[0].trim();
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
     * ============================================
     * DIRECTIVE APPLICATION ENGINE
     * ============================================
     */

    applyDirectivesToJson(json, directiveString, structure) {
        const directives = this.parseDirectives(directiveString);
        
        console.log(`[Apply Directives] Structure: ${structure}`, directives);

        // Handle track filtering
        let activeTracks = Object.keys(json.tracks);
        if (directives.only) {
            const allowed = directives.only.split(',').map(t => t.trim().toLowerCase());
            activeTracks = activeTracks.filter(t => 
                allowed.some(a => t.toLowerCase().includes(a))
            );
        } else if (directives.all === 1) {
            activeTracks = Object.keys(json.tracks);
        }

        Object.entries(json.tracks).forEach(([trackName, notation]) => {
            // Skip tracks not in active list
            if (!activeTracks.includes(trackName)) {
                // Keep minimal presence or empty
                const notes = this.parseCompactNotation(notation);
                if (notes.length > 0 && Math.random() > 0.7) {
                    json.tracks[trackName] = this.notationToString(notes.filter((n, i) => i % 4 === 0));
                } else {
                    json.tracks[trackName] = '';
                }
                return;
            }

            let notes = this.parseCompactNotation(notation);
            if (notes.length === 0) return;

            // Apply transformations
            notes = this.applyTransformations(notes, directives, trackName);

            // Sort by time
            notes.sort((a, b) => a.time - b.time);
            
            json.tracks[trackName] = this.notationToString(notes);
        });

        return json;
    }

    parseDirectives(directiveString) {
        const directives = {};
        if (!directiveString) return directives;
        
        const parts = directiveString.split(',');
        for (const part of parts) {
            const [cmd, val] = part.trim().split(':');
            if (cmd && val !== undefined) {
                // Handle ranges like "0.6→1.0" by taking the end value
                const cleanVal = val.replace(/.*→/, '');
                const numVal = parseFloat(cleanVal);
                directives[cmd.trim()] = isNaN(numVal) ? val.trim() : numVal;
            }
        }
        return directives;
    }

    applyTransformations(notes, directives, trackName) {
        let result = [...notes];
        const trackType = this.sourceAnalysis?.tracks[trackName]?.type || 'other';

        // ===== DENSITY =====
        if (directives.density !== undefined) {
            const density = parseFloat(directives.density);
            if (density < 1.0) {
                result = result.filter((n, i) => {
                    const beat = Math.floor(n.time) % 4;
                    const isStructural = beat === 0 || beat === 2;
                    return isStructural || Math.random() < density;
                });
            } else if (density > 1.0) {
                const newNotes = [];
                const extraRatio = density - 1;
                result.forEach((n, i) => {
                    newNotes.push(n);
                    if (Math.random() < extraRatio && i < result.length - 1) {
                        newNotes.push({
                            pitch: n.pitch + ([-5, -2, 0, 2, 4, 7][Math.floor(Math.random() * 6)]),
                            time: n.time + n.duration * 0.5,
                            duration: n.duration * 0.5,
                            velocity: Math.max(1, Math.min(9, Math.round(n.velocity * 0.6)))
                        });
                    }
                });
                result = newNotes;
            }
        }

        // Progressive density (for build-ups)
        if (directives.density && directives.density.toString().includes('→')) {
            const [start, end] = directives.density.toString().split('→').map(parseFloat);
            const maxTime = Math.max(...result.map(n => n.time));
            result = result.filter(n => {
                const progress = n.time / maxTime;
                const threshold = start + (end - start) * progress;
                return Math.random() < threshold;
            });
        }

        // ===== PITCH TRANSFORMATIONS =====
        if (directives.transpose !== undefined) {
            const semitones = parseInt(directives.transpose);
            result = result.map(n => ({ ...n, pitch: n.pitch + semitones }));
        }

        if (directives.octave === 1) {
            result = result.map(n => ({ ...n, pitch: n.pitch + 12 }));
        }

        if (directives.invert === 1 && result.length > 0) {
            const center = result.reduce((sum, n) => sum + n.pitch, 0) / result.length;
            result = result.map(n => ({ ...n, pitch: Math.round(center * 2 - n.pitch) }));
        }

        if (directives.retrograde === 1) {
            const pitches = result.map(n => n.pitch);
            pitches.reverse();
            result = result.map((n, i) => ({ ...n, pitch: pitches[i] || n.pitch }));
        }

        if (directives.rise === 1) {
            const maxAdd = 12;
            result = result.map((n, i) => ({
                ...n,
                pitch: n.pitch + Math.round((i / Math.max(1, result.length - 1)) * maxAdd)
            }));
        }

        if (directives.fall === 1) {
            const maxSub = Math.min(12, Math.min(...result.map(n => n.pitch)) - 24);
            result = result.map((n, i) => ({
                ...n,
                pitch: n.pitch - Math.round((i / Math.max(1, result.length - 1)) * maxSub)
            }));
        }

        if (directives.double === 1) {
            const doubled = result.map(n => ({
                ...n,
                pitch: n.pitch + 12,
                velocity: Math.max(1, Math.min(9, Math.round(n.velocity * 0.7)))
            })).filter(n => n.pitch <= 127);
            result = [...result, ...doubled];
        }

        if (directives.harmonize !== undefined) {
            const interval = parseInt(directives.harmonize);
            const harmonies = result.map(n => ({
                ...n,
                pitch: n.pitch + interval,
                velocity: Math.max(1, Math.min(9, Math.round(n.velocity * 0.8)))
            })).filter(n => n.pitch <= 127);
            result = [...result, ...harmonies];
        }

        if (directives.spread === 1) {
            const center = result.reduce((sum, n) => sum + n.pitch, 0) / result.length;
            result = result.map(n => {
                const diff = n.pitch - center;
                return {
                    ...n,
                    pitch: Math.max(24, Math.min(108, Math.round(center + diff * 1.5)))
                };
            });
        }

        if (directives.cluster === 1) {
            const clustered = [];
            result.forEach(n => {
                clustered.push(n);
                [-1, 1].forEach(offset => {
                    if (n.pitch + offset >= 0 && n.pitch + offset <= 127) {
                        clustered.push({
                            ...n,
                            pitch: n.pitch + offset,
                            velocity: Math.max(1, Math.min(9, Math.round(n.velocity * 0.5))),
                            duration: n.duration * 0.5
                        });
                    }
                });
            });
            result = clustered;
        }

        if (directives.randomize !== undefined) {
            const amount = parseFloat(directives.randomize);
            result = result.map(n => ({
                ...n,
                pitch: Math.max(0, Math.min(127, n.pitch + Math.round((Math.random() - 0.5) * 24 * amount)))
            }));
        }

        // ===== RHYTHMIC TRANSFORMATIONS =====
        if (directives.stretch !== undefined) {
            const factor = parseFloat(directives.stretch);
            result = result.map(n => ({
                ...n,
                time: n.time * factor,
                duration: n.duration * factor
            }));
        }

        if (directives.staccato === 1) {
            result = result.map(n => ({ ...n, duration: n.duration * 0.4 }));
        }

        if (directives.legato === 1) {
            for (let i = 0; i < result.length - 1; i++) {
                const gap = result[i + 1].time - (result[i].time + result[i].duration);
                if (gap > 0 && gap < 0.5) {
                    result[i].duration += gap - 0.02;
                }
            }
        }

        if (directives.sustain !== undefined) {
            const factor = parseFloat(directives.sustain);
            result = result.map(n => ({ ...n, duration: n.duration * factor }));
        }

        if (directives.truncate !== undefined) {
            const factor = parseFloat(directives.truncate);
            result = result.map(n => ({ ...n, duration: n.duration * factor }));
        }

        if (directives.gate !== undefined) {
            const factor = Math.max(0.1, Math.min(1.0, parseFloat(directives.gate)));
            result = result.map(n => ({ ...n, duration: n.duration * factor }));
        }

        if (directives.swing !== undefined) {
            const amount = parseFloat(directives.swing) / 100;
            result = result.map(n => {
                const beatPos = n.time % 1;
                if (beatPos > 0.4 && beatPos < 0.6) {
                    return { ...n, time: n.time + amount * 0.33 };
                }
                return n;
            });
        }

        if (directives.humanize !== undefined) {
            const amount = parseFloat(directives.humanize) / 100;
            const timeVar = amount * 0.05;
            const velVar = amount * 2;
            result = result.map(n => ({
                ...n,
                time: Math.max(0, n.time + (Math.random() - 0.5) * 2 * timeVar),
                velocity: Math.max(1, Math.min(9, Math.round(n.velocity + (Math.random() - 0.5) * 2 * velVar)))
            }));
        }

        if (directives.quantize === 1) {
            const grid = 0.25; // 16th notes
            result = result.map(n => ({
                ...n,
                time: Math.round(n.time / grid) * grid
            }));
        }

        if (directives.syncopate !== undefined) {
            const amount = parseFloat(directives.syncopate);
            result = result.map(n => {
                const beatPos = n.time % 1;
                if (Math.abs(beatPos) < 0.2 || Math.abs(beatPos - 0.5) < 0.2) {
                    return { ...n, time: n.time + 0.25 * amount };
                }
                return n;
            });
        }

        if (directives.break === 1) {
            result = result.filter(n => {
                const beat = Math.floor(n.time);
                return beat % 8 !== 6;
            });
        }

        // ===== ORNAMENTATION =====
        if (directives.fill === 1) {
            const newNotes = [];
            for (let i = 0; i < result.length - 1; i++) {
                newNotes.push(result[i]);
                const gap = result[i + 1].time - (result[i].time + result[i].duration);
                if (gap > 0.1) {
                    newNotes.push({
                        pitch: result[i].pitch + (Math.random() > 0.5 ? 7 : -5),
                        time: result[i].time + result[i].duration + gap / 2,
                        duration: gap / 3,
                        velocity: Math.max(1, Math.min(9, Math.round(result[i].velocity * 0.5)))
                    });
                }
            }
            if (result.length > 0) newNotes.push(result[result.length - 1]);
            result = newNotes;
        }

        if (directives.ghost === 1) {
            const ghosts = [];
            result.forEach(n => {
                if (Math.random() < 0.3) {
                    ghosts.push({
                        pitch: n.pitch,
                        time: n.time + 0.5,
                        duration: n.duration * 0.5,
                        velocity: Math.max(1, Math.min(9, Math.round(n.velocity * 0.25)))
                    });
                }
            });
            result = [...result, ...ghosts];
        }

        if (directives.arpeggiate === 1) {
            const timeGroups = {};
            result.forEach(n => {
                const key = Math.round(n.time * 100) / 100;
                if (!timeGroups[key]) timeGroups[key] = [];
                timeGroups[key].push(n);
            });

            const arpeggiated = [];
            Object.entries(timeGroups).forEach(([time, group]) => {
                if (group.length > 1) {
                    group.sort((a, b) => a.pitch - b.pitch);
                    group.forEach((n, i) => {
                        arpeggiated.push({
                            ...n,
                            time: n.time + i * 0.05,
                            duration: n.duration * 0.7
                        });
                    });
                } else {
                    arpeggiated.push(...group);
                }
            });
            result = arpeggiated;
        }

        if (directives.tremolo === 1) {
            const tremolo = [];
            result.forEach(n => {
                const divisions = 4;
                const subDur = n.duration / divisions;
                for (let i = 0; i < divisions; i++) {
                    tremolo.push({
                        ...n,
                        time: n.time + i * subDur,
                        duration: subDur * 0.8,
                        velocity: Math.max(1, Math.min(9, Math.round(n.velocity * (0.8 + i * 0.05))))
                    });
                }
            });
            result = tremolo;
        }

        if (directives.rolls === 1 && trackType === 'drums') {
            const rolls = [];
            result.forEach(n => {
                if (n.velocity > 7) {
                    rolls.push({
                        ...n,
                        time: n.time - 0.03,
                        velocity: Math.max(1, Math.min(9, Math.round(n.velocity * 0.4))),
                        duration: 0.05
                    });
                }
                rolls.push(n);
            });
            result = rolls;
        }

        if (directives.pedal === 1 && (trackType === 'bass' || trackType === 'harmony')) {
            const root = result.length > 0 ? result[0].pitch : 36;
            const totalDur = Math.max(...result.map(n => n.time + n.duration));
            result.unshift({
                pitch: root,
                time: 0,
                duration: totalDur,
                velocity: 4
            });
        }

        if (directives.callresponse === 1) {
            const splitTime = Math.max(...result.map(n => n.time)) / 2;
            result = result.map(n => {
                if (n.time < splitTime && n.pitch < 60) {
                    return { ...n, pitch: n.pitch + 12 };
                } else if (n.time >= splitTime && n.pitch > 60) {
                    return { ...n, pitch: n.pitch - 12 };
                }
                return n;
            });
        }

        // ===== DYNAMICS =====
        if (directives.velocity !== undefined) {
            const scale = parseFloat(directives.velocity);
            result = result.map(n => ({
                ...n,
                velocity: Math.max(1, Math.min(9, Math.round(n.velocity * scale)))
            }));
        }

        if (directives.fadein === 1) {
            const maxTime = Math.max(...result.map(n => n.time));
            result = result.map(n => ({
                ...n,
                velocity: Math.max(1, Math.min(9, Math.round(n.velocity * (n.time / maxTime))))
            }));
        }

        if (directives.fadeout === 1) {
            const maxTime = Math.max(...result.map(n => n.time));
            result = result.map(n => ({
                ...n,
                velocity: Math.max(1, Math.min(9, Math.round(n.velocity * (1 - (n.time / maxTime)))))
            }));
        }

        if (directives.accent === 1) {
            result = result.map(n => {
                const beat = Math.floor(n.time) % 4;
                if (beat === 0) {
                    return { ...n, velocity: Math.min(9, Math.round(n.velocity * 1.3)) };
                }
                return n;
            });
        }

        // ===== FILTER (simulated via velocity) =====
        if (directives.filter === 'low') {
            result = result.map(n => ({
                ...n,
                velocity: Math.max(1, Math.min(9, Math.round(n.velocity * 0.6))),
                duration: n.duration * 1.2
            }));
        }

        return result;
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
            const sourceTitle = this.versions[0]?.data?.title?.replace(/ \(.+\)/, '') || 'composition';

            const jsonFolder = zip.folder('json-variations');
            const midiFolder = zip.folder('midi-files');

            for (const version of this.versions) {
                const sanitizedTitle = (version.data.title || 'untitled').replace(/[\/\\?%*:|"<>]/g, '-');
                
                // Save JSON variation
                jsonFolder.file(`${sanitizedTitle}.json`, JSON.stringify(version.data, null, 2));
                
                // Convert to MIDI and save
                const tracks = this.jsonToMidiTracks(version.data);
                if (tracks.size > 0) {
                    const combinedMidi = MidiBuilder.createCombinedMidi(tracks, bpm);
                    if (combinedMidi) {
                        const midiBytes = combinedMidi.toArray();
                        midiFolder.file(`${sanitizedTitle}.mid`, midiBytes);
                    }
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${sourceTitle}-variations.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.app.ui.showMessage(`Downloaded ${this.versions.length} versions as ZIP`, 'success');
        } catch (error) {
            console.error('ZIP download failed:', error);
            this.app.ui.showMessage('Failed to create ZIP file', 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }
}
