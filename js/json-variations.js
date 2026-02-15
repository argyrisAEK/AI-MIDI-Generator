import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';

import { fetchWithModelFallbacks } from './prompt-analyzer.js';
import { trackAbbreviations } from './prompt-builder.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.sourceNotes = new Map(); // Store original parsed notes per track
     
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

            // Parse and store source notes for directive-based variations
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
        this.sourceNotes.clear();

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
        this.reset();
        this.versions = [];

        const rawJsonInput = document.getElementById('raw-json-input');
        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');

        try {
            // ✅ PARSE FIRST - JSON.parse automatically takes only the first valid JSON object
            const parsedSource = JSON.parse(rawJson);
            
            // ✅ Store the CLEAN stringified version, not the raw dirty one
            this.sourceJson = JSON.stringify(parsedSource);
            
            if (rawJsonInput) rawJsonInput.value = JSON.stringify(parsedSource, null, 2);

            // Parse and store source notes
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
            this.reset();
        }
    }

    /**
     * Parse source composition and store notes per track for directive-based manipulation
     */
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
            
            // If version has directives, apply them to source notes
            if (version.directives && this.sourceNotes.size > 0) {
                tracks = this.applyDirectives(version.directives, version.structure);
            } else {
                // Fallback to old notation parsing
                tracks = this.parseNotationToTracks(version.apiResponse.notation);
            }
            
            if (tracks.size === 0) {
                this.app.ui.showMessage('Cannot load an empty version.', 'error');
                return;
            }

            // Update app state
            this.app.generatedTracks = tracks;
            this.app.compositionTitle = version.apiResponse.title;
            this.app.compositionDescription = version.apiResponse.explanation;
            
            // Update visualizer
            this.updateVisualizer(
                tracks,
                version.apiResponse.title,
                version.apiResponse.explanation
            );
            
            // Update UI
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
     * NOTATION DIRECTIVES SYSTEM
     * ============================================
     * 
     * Format: "command:param,command:param,..."
     * 
     * COMMANDS:
     * - density:0.3-2.0     → Note density multiplier
     * - velocity:0.3-1.5    → Velocity scale factor
     * - transpose:-12-12    → Semitone transpose
     * - stretch:0.5-2.0       → Time stretch factor
     * - reverse:1             → Reverse note order
     * - sparse:1              → Keep only important notes
     * - fill:1                → Add ghost notes
     * - octave:1-2            → Octave shift up/down
     * - staccato:1            → Shorten notes 50%
     * - legato:1              → Extend notes to touch next
     * - humanize:0-100        → Random variance
     * - swing:0-100           → Apply swing groove
     * - gate:0.1-0.9          → Note gate percentage
     */

    buildDirectivePrompt(structure, trackTypes, duration) {
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        
        const structureDirectives = {
            intro: `Create INTRO directives for sparse, atmospheric start.
Available: density, velocity, transpose, stretch, sparse, gate
Target: density:0.3-0.5, velocity:0.4-0.6, transpose:0, sparse:1, gate:0.5
Return ONLY the directive string, e.g.: "density:0.4,velocity:0.5,sparse:1"`,

            build: `Create BUILD directives for rising tension.
Available: density, velocity, stretch, fill, octave, swing
Target: density:0.8→1.5, velocity:0.6→1.0, stretch:0.9→0.7, fill:1
Return ONLY the directive string, e.g.: "density:1.2,velocity:0.8,fill:1,stretch:0.8"`,

            verse: `Create VERSE directives for steady groove.
Available: density, velocity, humanize, swing, gate
Target: density:0.8, velocity:0.7, humanize:20, swing:30, gate:0.8
Return ONLY the directive string, e.g.: "density:0.8,velocity:0.7,swing:30"`,

            chorus: `Create CHORUS directives for peak energy.
Available: density, velocity, transpose, fill, octave, swing
Target: density:1.2, velocity:1.0-1.2, transpose:0 or 12, fill:1, swing:20
Return ONLY the directive string, e.g.: "density:1.2,velocity:1.1,fill:1,octave:1"`,

            bridge: `Create BRIDGE directives for contrast.
Available: density, velocity, transpose, reverse, octave, staccato
Target: density:0.6, velocity:0.7, transpose:-5 or +7, staccato:1 or legato:1
Return ONLY the directive string, e.g.: "density:0.6,transpose:7,staccato:1"`
        };

        return `You are a music production AI. Generate NOTATION DIRECTIVES for a "${structure.toUpperCase()}" section.

SOURCE TRACKS: ${trackTypes.join(', ')}
BPM: ${bpm}, DURATION: ${duration} bars

${structureDirectives[structure] || structureDirectives.verse}

RULES:
1. Return ONLY the directive string (50-150 chars max)
2. Use ONLY these commands: density, velocity, transpose, stretch, reverse, sparse, fill, octave, staccato, legato, humanize, swing, gate
3. NO explanation, NO markdown, NO JSON
4. Values must be realistic for ${structure}
5. Multiple directives separated by commas

Generate directives now:`;
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

    /**
     * Apply directives to source notes deterministically
     */
    applyDirectives(directiveString, structure) {
        const directives = this.parseDirectives(directiveString);
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const finalTracks = new Map();

        console.log(`[Directives] Applying: ${directiveString}`);
        console.log(`[Directives] Parsed:`, directives);

        this.sourceNotes.forEach((originalNotes, trackType) => {
            if (originalNotes.length === 0) return;

            let notes = originalNotes.map(n => ({...n})); // Deep copy

            // 1. DENSITY
            if (directives.density !== undefined) {
                const density = Math.max(0.1, Math.min(2.0, directives.density));
                if (density < 1.0) {
                    notes = notes.filter((_, i) => {
                        const beatPos = (notes[i].time * bpm / 60) % 4;
                        const isOnBeat = Math.abs(beatPos - Math.round(beatPos)) < 0.1;
                        return isOnBeat || Math.random() < density;
                    });
                } else if (density > 1.0) {
                    const newNotes = [];
                    notes.forEach(note => {
                        newNotes.push(note);
                        if (Math.random() < (density - 1)) {
                            newNotes.push({
                                ...note,
                                time: note.time + 0.05,
                                velocity: note.velocity * 0.7
                            });
                        }
                    });
                    notes = newNotes;
                }
            }

            // 2. VELOCITY
            if (directives.velocity !== undefined) {
                const scale = Math.max(0.1, Math.min(2.0, directives.velocity));
                notes.forEach(n => {
                    n.velocity = Math.max(0.1, Math.min(1.0, n.velocity * scale));
                });
            }

            // 3. TRANSPOSE
            if (directives.transpose !== undefined) {
                const semitones = Math.max(-24, Math.min(24, parseInt(directives.transpose)));
                notes.forEach(n => {
                    n.midi += semitones;
                    n.name = Tone.Frequency(n.midi, 'midi').toNote();
                });
            }

            // 4. OCTAVE
            if (directives.octave !== undefined) {
                const octaves = parseInt(directives.octave) * 12;
                notes.forEach(n => {
                    n.midi += octaves;
                    n.name = Tone.Frequency(n.midi, 'midi').toNote();
                });
            }

            // 5. STRETCH
            if (directives.stretch !== undefined) {
                const factor = Math.max(0.25, Math.min(4.0, directives.stretch));
                notes.forEach(n => {
                    n.time *= factor;
                    n.duration *= factor;
                });
            }

            // 6. REVERSE
            if (directives.reverse === 1) {
                const totalDuration = Math.max(...notes.map(n => n.time + n.duration));
                notes.forEach(n => {
                    const newEndTime = totalDuration - n.time;
                    n.time = Math.max(0, newEndTime - n.duration);
                });
                notes.sort((a, b) => a.time - b.time);
            }

            // 7. SPARSE
            if (directives.sparse === 1) {
                notes = notes.filter(n => {
                    const beatPos = (n.time * bpm / 60) % 4;
                    return beatPos < 0.5 || Math.abs(beatPos - 2) < 0.5;
                });
            }

            // 8. FILL
            if (directives.fill === 1) {
                const newNotes = [];
                for (let i = 0; i < notes.length - 1; i++) {
                    newNotes.push(notes[i]);
                    const gap = notes[i + 1].time - (notes[i].time + notes[i].duration);
                    if (gap > 0.2) {
                        newNotes.push({
                            ...notes[i],
                            time: notes[i].time + notes[i].duration + gap / 2,
                            duration: gap / 3,
                            velocity: notes[i].velocity * 0.4,
                            midi: notes[i].midi + ([-2, -1, 0, 1, 2][Math.floor(Math.random() * 5)])
                        });
                    }
                }
                if (notes.length > 0) newNotes.push(notes[notes.length - 1]);
                notes = newNotes;
            }

            // 9. STACCATO
            if (directives.staccato === 1) {
                notes.forEach(n => n.duration *= 0.5);
            }

            // 10. LEGATO
            if (directives.legato === 1) {
                for (let i = 0; i < notes.length - 1; i++) {
                    const gap = notes[i + 1].time - (notes[i].time + notes[i].duration);
                    if (gap > 0) notes[i].duration += gap - 0.01;
                }
            }

            // 11. GATE
            if (directives.gate !== undefined) {
                const gate = Math.max(0.1, Math.min(1.0, directives.gate));
                notes.forEach(n => n.duration *= gate);
            }

            // 12. HUMANIZE
            if (directives.humanize !== undefined) {
                const amount = Math.max(0, Math.min(100, directives.humanize));
                const timeVariance = (amount / 100) * 0.05;
                const velVariance = amount / 100 * 0.2;
                notes.forEach(n => {
                    n.time += (Math.random() - 0.5) * 2 * timeVariance;
                    n.velocity *= 1 + (Math.random() - 0.5) * 2 * velVariance;
                    n.velocity = Math.max(0.1, Math.min(1.0, n.velocity));
                });
            }

            // 13. SWING
            if (directives.swing !== undefined) {
                const swingAmount = Math.max(0, Math.min(100, directives.swing));
                const beatDuration = 60 / bpm;
                notes.forEach(n => {
                    const beatPos = n.time / beatDuration;
                    const isEighth = Math.abs((beatPos % 1) - 0.5) < 0.1;
                    if (isEighth) {
                        n.time += (swingAmount / 100) * (beatDuration / 3);
                    }
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

    async generateVariation() {
        if (this.sourceNotes.size === 0) {
            this.app.ui.showMessage('No source notes loaded. Please generate a composition first.', 'warning');
            return;
        }

        const selectedStructure = document.getElementById('structure-select')?.value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a version type (e.g., Intro, Chorus).', 'warning');
            return;
        }

        const selectedDuration = parseInt(document.getElementById('variation-duration')?.value, 10) || 4;
        const trackTypes = Array.from(this.sourceNotes.keys());

        try {
            this.app.ui.showLoading(`Generating "${selectedStructure}" directives...`);

            const prompt = this.buildDirectivePrompt(selectedStructure, trackTypes, selectedDuration);
            
            const response = await fetchWithModelFallbacks('/api/variations', ['οpenai-large', 'openai'], this.app.ui, {
                prompt: prompt,
                max_tokens: 150,
                seed: Math.floor(Math.random() * 100000)
            });

            const directiveString = (await response.text()).trim();
            
            if (!directiveString.includes(':') || directiveString.length > 200) {
                throw new Error('Invalid directive format received from AI');
            }

            const newVersion = {
                apiResponse: {
                    title: `${this.versions[0]?.apiResponse?.title?.replace(/ \(Original\)/, '') || 'Composition'} - ${selectedStructure.charAt(0).toUpperCase() + selectedStructure.slice(1)}`,
                    explanation: `Variation using directives: ${directiveString}`,
                    notation: null
                },
                directives: directiveString,
                structure: selectedStructure,
                isOriginal: false
            };

            this.versions.push(newVersion);
            this.renderVersionsList();
            
            this.app.ui.showMessage(`Generated "${selectedStructure}" with directives: ${directiveString}`, 'success');

        } catch (error) {
            console.error('Variation generation failed:', error);
            this.app.ui.showMessage(`Failed to generate variation: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
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
                let tracks;
                
                if (version.directives && this.sourceNotes.size > 0) {
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
