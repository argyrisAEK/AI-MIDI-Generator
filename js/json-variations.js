import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { ScaleValidator, ScaleStrictness } from './scale-validator.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.validator = new ScaleValidator();
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('generate-variations').addEventListener('click', () => this.generateVariation());
        document.getElementById('download-all-zip').addEventListener('click', () => this.downloadAllAsZip());
        document.getElementById('raw-json-input').addEventListener('input', (e) => this.handleJsonInputChange(e));
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
                sourceTitle.textContent = parsedJson.title || 'Custom Composition';
                sourceExplanation.textContent = parsedJson.explanation || parsedJson.description || '';
            }

            this.app.ui.showMessage('JSON is valid. Ready to generate.', 'success');
            document.getElementById('generate-variations').disabled = false;
            rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            this.app.ui.showMessage('Invalid JSON format. Please correct it to generate variations.', 'warning');
            document.getElementById('generate-variations').disabled = true;
            rawJsonInput.style.borderColor = 'var(--error)';
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

        rawJsonInput.value = '';
        versionsList.innerHTML = '<p>Your generated versions will appear here.</p>';
        
        sourceTitle.textContent = '';
        sourceExplanation.textContent = '';
        sourceDetails.querySelector('p').style.display = 'block';
        
        document.getElementById('generate-variations').disabled = true;
        document.getElementById('download-all-zip').disabled = true;
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
            rawJsonInput.value = JSON.stringify(parsedSource, null, 2);

            const originalVersion = {
                apiResponse: {
                    title: metadata.title,
                    explanation: metadata.explanation,
                    notation: parsedSource.notation,
                },
                context: context,
                isOriginal: true,
                structure: 'Original'
            };
            this.versions.push(originalVersion);
            this.renderVersionsList();

            sourceTitle.textContent = metadata.title;
            sourceExplanation.textContent = metadata.explanation;
            sourceDetails.querySelector('p').style.display = 'none';
            
            document.getElementById('generate-variations').disabled = false;
            this.app.ui.showMessage('Composition loaded. You can now generate versions!', 'info');

        } catch (error) {
            console.error('Failed to parse and set source composition:', error);
            this.app.ui.showMessage('Error loading source composition for variations.', 'error');
            this.reset();
        }
    }

    async generateVariation() {
        if (!this.sourceJson) {
            this.app.ui.showMessage('Please provide a source JSON in the text area.', 'warning');
            return;
        }

        const selectedStructure = document.getElementById('structure-select').value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a version type (e.g., Intro, Chorus).', 'warning');
            return;
        }
        
        const selectedDuration = document.getElementById('variation-duration').value;

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
        
        const trackTypes = this.extractTrackTypesFromNotation(sourceVersion.apiResponse.notation);
        if (trackTypes.length === 0) {
            this.app.ui.showMessage('Could not find any tracks in the notation. Make sure notes are commented with a track name (e.g., # melody).', 'error');
            return;
        }

        try {
            this.app.ui.showLoading(`Generating "${selectedStructure}" version...`);
            
            const variationPrompt = this.buildVariationPrompt(sourceVersion.apiResponse, selectedStructure, trackTypes, selectedDuration);
            const url = `https://enter.pollinations.ai/api/generate/text/${encodeURIComponent(variationPrompt)}?model=openai-large&seed=${Math.floor(Math.random() * 100000)}&key=plln_sk_JmbRcolKjEzatmVsRROri34kyDAmSoUj`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error(`API Error: ${response.statusText || response.status}`);

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
    
    renderVersionsList() {
        const listEl = document.getElementById('versions-list');
        listEl.innerHTML = '';

        if (this.versions.length === 0) {
            listEl.innerHTML = '<p>Your generated versions will appear here.</p>';
            document.getElementById('download-all-zip').disabled = true;
            return;
        }

        this.versions.forEach((version, index) => {
            const card = document.createElement('div');
            card.className = 'variation-card';
            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${version.apiResponse.title} ${version.isOriginal ? '(Original)' : ''}</h4>
                    <p>${version.apiResponse.explanation}</p>
                </div>
                <div class="variation-card-actions">
                    <button class="btn btn-accent btn-load" data-index="${index}">Load</button>
                </div>
            `;
            listEl.appendChild(card);
        });
        
        document.getElementById('download-all-zip').disabled = this.versions.length < 1;
        
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
            const tracks = this.parseNotationToTracks(version.apiResponse.notation);
            
            if (tracks.size === 0) {
                this.app.ui.showMessage('Cannot load an empty version.', 'error');
                return;
            }

            // ✅ Ενημέρωση κατάστασης εφαρμογής
            this.app.generatedTracks = tracks;
            this.app.compositionTitle = version.apiResponse.title;
            this.app.compositionDescription = version.apiResponse.explanation;
            
            // ✅ Ενημέρωση visualizer με σωστή σειρά
            this.updateVisualizer(
                tracks,
                version.apiResponse.title,
                version.apiResponse.explanation
            );
            
            // ✅ Ενημέρωση UI
            this.app.ui.updateButtonStates(true);
            this.app.ui.showMessage(`Loaded "${version.apiResponse.title}" into the main player.`, 'success');

        } catch (error) {
            console.error('Error loading version:', error);
            this.app.ui.showMessage(`Failed to load version: ${error.message}`, 'error');
        }
    }

    /**
     * ✅ ΒΕΛΤΙΣΤΟΠΟΙΗΜΕΝΗ ΜΕΘΟΔΟΣ: Ενημέρωση Visualizer
     * Σωστή σύνδεση με όλα τα απαραίτητα δεδομένα και σειρά
     */
    updateVisualizer(tracks, title, description) {
        try {
            // 1. Ενημέρωση Properties Visualizer
            this.app.visualizer.compositionTitle = title;
            this.app.visualizer.compositionDescription = description;
            
            // 2. Φόρτωση Σημειώσεων - Αυτή είναι η κύρια μέθοδος ανανέωσης
            this.app.visualizer.loadNotes(tracks, title, description);
            
            // 3. Ανανέωση Selectors Track (για αλλαγή δομής)
            this.app.visualizer.updateTrackSelectors();
            
            // 4. Reset Visualization State
            this.app.visualizer.stopVisualization();
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();
            
            console.log(`✅ Visualizer updated with ${tracks.size} tracks`);
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
                    if (trackType) {
                        trackTypes.add(trackType);
                    }
                }
            }
        }
        return Array.from(trackTypes);
    }

    buildVariationPrompt(originalJson, structure, originalTrackTypes, duration) {
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const beatsPerBar = parseInt((document.getElementById('time-signature')?.value || '4/4').split('/')[0], 10) || 4;
        const totalSeconds = (duration * beatsPerBar) * (60 / bpm);
        
        // ✅ OPTIMIZED: Compact instructions to reduce header size
        const structureGuides = {
            intro: {
                chars: "Sparse, atmospheric, minimal. Use 1-2 tracks. Velocities 0.25-0.45. 40%+ silence. Open 2 bars sparse, bars 3+ add layers. End with anticipation.",
                density: "30% start → 50% end",
                velocity: "0.25-0.45",
                tracks: "1-2"
            },
            build: {
                chars: "Progressive energy. Add tracks/density gradually. Velocities 0.40→0.85. Bars 1-4: 30%, 5-8: 50%, 9-12: 70%, 13+: 85%. Peak at end.",
                density: "30% → 50% → 70% → 85%+",
                velocity: "0.40→0.55→0.70→0.85",
                tracks: "2 → 3 → 4 → all"
            },
            verse: {
                chars: "Groove-locked, space for vocals. Use 3-4 tracks. 50% density. Velocities 0.55-0.65. Repetitive 4-bar pattern with subtle variation. Smooth energy.",
                density: "50%",
                velocity: "0.55-0.65",
                tracks: "3-4"
            },
            chorus: {
                chars: "Maximum impact, all tracks, dense. Velocities 0.75-1.0. 85%+ density. Hit hard bar 1, no silence >1/4 bar. 4-bar hook repeats. Full arrangement.",
                density: "85%+",
                velocity: "0.75-1.0",
                tracks: "All"
            },
            bridge: {
                chars: "Contrast & surprise. Change 2+ elements (groove/register/harmony). Opposite energy from chorus. Velocities 0.40-0.70. Different instrumentation. End with transition.",
                density: "Varies (opposite chorus)",
                velocity: "0.40-0.70",
                tracks: "2-4 (avoid main ones)"
            }
        };

        const guide = structureGuides[structure];

        return `You are an expert music producer. Create a ${structure.toUpperCase()} in valid JSON only - no markdown.
CONTEXT: ${originalJson.title} | ${bpm}BPM ${beatsPerBar}/4 | ${duration}bars (~${totalSeconds.toFixed(1)}s) | Tracks: ${originalTrackTypes.join(',')}
CHARACTER: ${guide.chars}
DENSITY: ${guide.density} | VELOCITY: ${guide.velocity} | TRACKS: ${guide.tracks}
REQUIREMENTS:
• Keep original key, tempo, time sig
• Use track names: ${originalTrackTypes.join(', ')}
• Pitch format: MIDI 36-96
• All notes: pitch,time,duration,velocity # track
• Times max 2 decimals (X.XX)
• Newlines: \\n only
• NO silence >40% any bar (except intro)
REFERENCE (adapt, don't copy):
${originalJson.notation.substring(0, 500)}...
RESPOND ONLY JSON:
{
  "title": "${originalJson.title} - ${structure.charAt(0).toUpperCase() + structure.slice(1)}",
  "explanation": "A ${structure} version: [max 15 words]",
  "notation": "[notes]"
}`;
    }

    parseVariationResponse(responseText) {
        try {
            const cleanedJson = responseText.replace(/```json\s*|\s*```/g, '').trim();
            const firstBrace = cleanedJson.indexOf('{');
            const lastBrace = cleanedJson.lastIndexOf('}');
            
            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error('No valid JSON object found in the API response.');
            }
            
            const jsonText = cleanedJson.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonText);

            if (!parsed.title || !parsed.explanation || !parsed.notation) {
                throw new Error("Parsed JSON is missing one or more required keys: title, explanation, notation.");
            }
            return parsed;

        } catch (error) {
            console.error("Failed to parse variation response:", error, "Raw response:", responseText);
            throw Error(`Could not parse the AI's response. It may have been malformed. Details: ${error.message}`);
        }
    }

    parseNotationToTracks(notation) {
        const tracks = new Map();
        const lines = notation.replace(/\\n/g, '\n').split('\n');
        
        const key = document.getElementById('key')?.value || 'C';
        const scaleType = document.getElementById('scale-type')?.value || 'major';
        const validationStrictness = document.getElementById('scale-validation-strictness')?.value || ScaleStrictness.MEDIUM;
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        this.validator.setScale(key, scaleType);

        const rawTrackNotes = new Map();
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.includes('pitch,time') || !trimmed.includes('#')) continue;
            
            const [content, comment] = trimmed.split('#', 2);
            const note = this.parseNoteLine(content.trim());
            const trackType = comment.trim().split(/\s/)[0];
            
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
                const { notes: validatedNotes, stats } = this.validator.validateNotes(notes, validationStrictness);
                
                if (stats.message) {
                    console.log(`[Variation ${trackType}] Scale validation: ${stats.message}`);
                }

                const midi = this.createMidiFromNotes(validatedNotes, bpm);
                
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
            const parts = line.split(',').map(p => p.trim());
            if (parts.length < 4) return null;

            const pitchOrName = parts[0];
            const time = parseFloat(parts[1]);
            const duration = parseFloat(parts[2]);
            const velocity = parseFloat(parts[3]);
            
            if (isNaN(time) || isNaN(duration) || isNaN(velocity)) return null;
            
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
                time: Math.max(0, time),
                duration: Math.max(0.01, duration),
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
                    const midiBytes = combinedMidi.toArray();
                    const sanitizedTitle = version.apiResponse.title.replace(/[\/\\?%*:|"<>]/g, '-').trim();
                    const filename = `${sanitizedTitle}.mid`;
                    zip.file(filename, midiBytes);
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
