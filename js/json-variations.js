import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { ScaleValidator, ScaleStrictness } from './scale-validator.js';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';
import { trackAbbreviations } from './prompt-builder.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.validator = new ScaleValidator();
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
                if (sourceExplanation) sourceExplanation.textContent = parsedJson.desc || parsedJson.description || '';
            }

            this.app.ui.showMessage('✓ JSON is valid. Ready to generate variations.', 'success');
            const generateBtn = document.getElementById('generate-variations');
            if (generateBtn) generateBtn.disabled = false;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            this.app.ui.showMessage('✗ Invalid JSON format.', 'warning');
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

            const originalVersion = {
                apiResponse: {
                    title: metadata.title,
                    description: metadata.explanation,
                    tracks: parsedSource.tracks || {},
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
            this.app.ui.showMessage('✓ Composition loaded. You can now generate variations!', 'info');

        } catch (error) {
            console.error('Failed to parse source composition:', error);
            this.app.ui.showMessage('Error loading source composition for variations.', 'error');
            this.reset();
        }
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
                    <p>${version.apiResponse.description || 'Generated variation'}</p>
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

            const tracks = this.convertTracksToMidi(version.apiResponse.tracks);
            
            if (tracks.size === 0) {
                this.app.ui.showMessage('Cannot load an empty version.', 'error');
                return;
            }

            // Update app state
            this.app.generatedTracks = tracks;
            this.app.compositionTitle = version.apiResponse.title;
            this.app.compositionDescription = version.apiResponse.description;
            
            // Update visualizer
            this.updateVisualizer(tracks, version.apiResponse.title, version.apiResponse.description);
            
            // Update UI
            this.app.ui.updateButtonStates(true);
            this.app.ui.showMessage(`✓ Loaded "${version.apiResponse.title}"`, 'success');

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
            this.app.visualizer.stopVisualization();
            
            console.log(`✓ Visualizer updated with ${tracks.size} tracks`);
        } catch (error) {
            console.error('Visualizer update failed:', error);
            throw error;
        }
    }

    // ✅ Analyze composition characteristics
    analyzeComposition(compositionJson) {
        const tracks = compositionJson.tracks || {};
        const trackNames = Object.keys(tracks);
        
        let totalNotes = 0;
        let minPitch = 127, maxPitch = 0;
        let minVelocity = 1, maxVelocity = 0;
        const trackDensities = {};

        for (const [trackName, notesStr] of Object.entries(tracks)) {
            const lines = notesStr.split('\n').filter(l => l.trim());
            trackDensities[trackName] = lines.length;
            totalNotes += lines.length;

            for (const line of lines) {
                const parts = line.split(',');
                const pitch = parseInt(parts[0]);
                const velocity = parseFloat(parts[3]);

                if (!isNaN(pitch)) {
                    minPitch = Math.min(minPitch, pitch);
                    maxPitch = Math.max(maxPitch, pitch);
                }
                if (!isNaN(velocity)) {
                    minVelocity = Math.min(minVelocity, velocity);
                    maxVelocity = Math.max(maxVelocity, velocity);
                }
            }
        }

        return {
            trackCount: trackNames.length,
            trackNames,
            trackDensities,
            totalNotes,
            minPitch: minPitch === 127 ? 36 : minPitch,
            maxPitch: maxPitch === 0 ? 96 : maxPitch,
            minVelocity: minVelocity === 1 ? 0.3 : minVelocity,
            maxVelocity: maxVelocity === 0 ? 1.0 : maxVelocity,
            density: totalNotes > 100 ? 'high' : totalNotes > 50 ? 'medium' : 'low'
        };
    }

    // ✅ Build intelligent variation prompt
    buildVariationPrompt(originalJson, variationType, analysis) {
        const { trackNames, trackDensities, minPitch, maxPitch, minVelocity, maxVelocity } = analysis;
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const timeSignature = document.getElementById('time-signature')?.value || '4/4';
        const duration = parseInt(document.getElementById('variation-duration')?.value, 10) || 4;
        const key = document.getElementById('key')?.value || 'C';
        const beatsPerBar = parseInt(timeSignature.split('/')[0]);
        const totalBeats = duration * beatsPerBar;

        // Build original notation reference
        const originalNotation = Object.entries(originalJson.tracks || {})
            .map(([name, notes]) => `${name}: ${notes.split('\n').length} notes`)
            .join('\n');

        const structureGuides = {
            intro: {
                trackCount: `1-2 (use ${trackNames[trackNames.length - 1] || 'pad'} + sparse element)`,
                density: '5-8 notes total',
                velocity: '0.3-0.5 (very soft)',
                duration: `${totalBeats} beats`,
                pattern: 'Long sustained notes (2-4 beats each) with silence',
                energy: 'Build anticipation slowly, establish mood and key',
                register: `${minPitch} - ${minPitch + 12} (low register)`
            },
            build: {
                trackCount: '3-4 (gradually add layers)',
                density: '15-30 notes total, increasing towards end',
                velocity: '0.5-0.8 (gradually increase)',
                duration: `${totalBeats} beats`,
                pattern: 'Start simple, accelerate rhythm, add rising melodies',
                energy: 'Rising tension, build climax',
                register: `${minPitch} to ${maxPitch} (full range)`
            },
            verse: {
                trackCount: '3 (rhythm foundation + melody + support)',
                density: '15-25 notes per track',
                velocity: '0.5-0.7 (solid, medium)',
                duration: `${totalBeats} beats`,
                pattern: 'Consistent 2-4 bar loops, repetitive groove',
                energy: 'Steady, established groove - support without overwhelming',
                register: `${minPitch} to ${maxPitch - 12} (mid-high range)`
            },
            chorus: {
                trackCount: `4-5 (use all: ${trackNames.slice(0, 5).join(', ')})`,
                density: '25-40 notes per track',
                velocity: '0.7-1.0 (bright, punchy)',
                duration: `${totalBeats} beats`,
                pattern: 'Memorable hooks, catchy riffs, dense arrangement',
                energy: 'Peak energy, emotional climax',
                register: `${minPitch} to ${maxPitch} (full range, bright)`
            },
            bridge: {
                trackCount: '2-3 (contrasting tracks)',
                density: '10-20 notes per track',
                velocity: '0.5-0.8 (moderate)',
                duration: `${totalBeats} beats`,
                pattern: 'Shifted register or different rhythm than verse/chorus',
                energy: 'Musical contrast, reset energy before return',
                register: `${minPitch + 12} to ${maxPitch - 12} (shifted)`
            },
            breakdown: {
                trackCount: '1-2 (minimal)',
                density: '5-10 notes total',
                velocity: '0.3-0.6 (soft)',
                duration: `${totalBeats} beats`,
                pattern: 'Sparse, stripped-down - rhythm or harmony only',
                energy: 'Minimal, build anticipation for re-entry',
                register: `${minPitch} - ${minPitch + 24}`
            }
        };

        const guide = structureGuides[variationType] || structureGuides.verse;

        return `You are a professional music producer creating a "${variationType.toUpperCase()}" variation.

ORIGINAL COMPOSITION:
Title: "${originalJson.title}"
Description: "${originalJson.desc || originalJson.description || ''}"
Key: ${key}, BPM: ${bpm}, Time: ${timeSignature}
Available tracks: ${trackNames.join(', ')}
Original note density per track:
${originalNotation}

"${variationType.toUpperCase()}" SECTION REQUIREMENTS:
- Tracks to use: ${guide.trackCount}
- Total note density: ${guide.density}
- Velocity range: ${guide.velocity}
- Duration: ${guide.duration}
- Rhythmic pattern: ${guide.pattern}
- Energy level: ${guide.energy}
- Register (pitch range): ${guide.register}

CRITICAL RULES:
1. Return ONLY valid JSON (no markdown, explanations, or code blocks)
2. Format each track as: "pitch,beat,duration,velocity\\npitch,beat,duration,velocity\\n..."
3. Use \\n (escaped newline) between notes, NOT actual newlines
4. Pitch: MIDI numbers (${minPitch}-${maxPitch}) or note names (C4, D4, etc)
5. Beat: position in bars (0.0-${totalBeats})
6. Duration: in beats (0.25-4.0)
7. Velocity: float 0.1-1.0
8. Match original key: ${key}
9. Match BPM: ${bpm}
10. Use track names from original: ${trackNames.join(', ')}

RESPONSE - Return ONLY this JSON:
{
  "title": "${originalJson.title} - ${variationType.charAt(0).toUpperCase() + variationType.slice(1)}",
  "desc": "A ${variationType} variation (4-8 words)",
  "tracks": {
    "track_name": "pitch,beat,duration,velocity\\npitch,beat,duration,velocity\\n...",
    "another_track": "pitch,beat,duration,velocity\\n..."
  }
}`;
    }

    async generateVariation() {
        if (!this.sourceJson) {
            this.app.ui.showMessage('Please provide a source JSON.', 'warning');
            return;
        }

        const selectedStructure = document.getElementById('structure-select')?.value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a variation type.', 'warning');
            return;
        }

        try {
            const currentJson = JSON.parse(this.sourceJson);
            const analysis = this.analyzeComposition(currentJson);

            this.app.ui.showLoading(`Generating "${selectedStructure}"...`);

            const variationPrompt = this.buildVariationPrompt(currentJson, selectedStructure, analysis);
            
            // ✅ Call /api/variations endpoint
            const response = await fetch('/api/variations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: variationPrompt })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const responseText = await this.readSSEStream(response.body);
            const variationJson = this.parseVariationResponse(responseText);
            
            const newVersion = {
                apiResponse: variationJson,
                context: this.versions.find(v => v.isOriginal)?.context || {},
                isOriginal: false,
                structure: selectedStructure
            };

            this.versions.push(newVersion);
            this.renderVersionsList();
            
            this.app.ui.showMessage(`✓ Generated "${selectedStructure}" version`, 'success');

        } catch (error) {
            console.error('Variation generation failed:', error);
            this.app.ui.showMessage(`Error: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    async readSSEStream(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullText = "";
        let done = false;
        let buffer = '';

        while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            
            if (value) {
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                
                const eventBoundary = buffer.lastIndexOf('\n\n');
                if (eventBoundary !== -1) {
                    const completeBuffer = buffer.substring(0, eventBoundary);
                    const events = completeBuffer.split('\n\n');
                    
                    for (const event of events) {
                        const lines = event.split('\n').filter(l => l.trim());
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || trimmed === '[DONE]') continue;
                            
                            if (trimmed.startsWith('data: ')) {
                                const dataStr = trimmed.slice(6);
                                try {
                                    const data = JSON.parse(dataStr);
                                    if (data.content) {
                                        const unescaped = data.content
                                            .replace(/\\n/g, '\n')
                                            .replace(/\\r/g, '\r')
                                            .replace(/\\t/g, '\t')
                                            .replace(/\\"/g, '"')
                                            .replace(/\\\\/g, '\\');
                                        fullText += unescaped;
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                    buffer = buffer.substring(eventBoundary + 2);
                }
            }
        }

        if (buffer.trim()) {
            const lines = buffer.split('\n').filter(l => l.trim());
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6);
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.content) {
                            const unescaped = data.content
                                .replace(/\\n/g, '\n')
                                .replace(/\\r/g, '\r')
                                .replace(/\\t/g, '\t')
                                .replace(/\\"/g, '"')
                                .replace(/\\\\/g, '\\');
                            fullText += unescaped;
                        }
                    } catch (e) {}
                }
            }
        }

        return fullText;
    }

    parseVariationResponse(responseText) {
        try {
            // Remove markdown and extract JSON
            let cleanedJson = responseText.replace(/```json\s*|\s*```/g, '').trim();
            
            const firstBrace = cleanedJson.indexOf('{');
            const lastBrace = cleanedJson.lastIndexOf('}');

            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error('No JSON object found');
            }

            let jsonText = cleanedJson.substring(firstBrace, lastBrace + 1);

            // Fix incomplete JSON
            const openBraces = (jsonText.match(/\{/g) || []).length;
            const closeBraces = (jsonText.match(/\}/g) || []).length;
            for (let i = 0; i < openBraces - closeBraces; i++) {
                jsonText += '}';
            }

            const parsed = JSON.parse(jsonText);

            return {
                title: parsed.title || 'Untitled',
                description: parsed.desc || parsed.description || 'Generated variation',
                tracks: parsed.tracks || {}
            };

        } catch (error) {
            console.error("Parse error:", error, "Raw:", responseText.substring(0, 500));
            throw new Error(`Could not parse response: ${error.message}`);
        }
    }

    convertTracksToMidi(tracks) {
        const result = new Map();
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        for (const [trackName, notesStr] of Object.entries(tracks)) {
            const notes = [];
            const lines = notesStr.split('\n').filter(l => l.trim());

            for (const line of lines) {
                const note = this.parseNoteLine(line, bpm);
                if (note) notes.push(note);
            }

            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                result.set(trackName, {
                    midi,
                    title: trackName.charAt(0).toUpperCase() + trackName.slice(1),
                    description: `Generated ${trackName}`
                });
            }
        }

        return result;
    }

    parseNoteLine(line, bpm) {
        try {
            const cleanLine = line.split('#')[0].trim();
            const parts = cleanLine.split(',').map(p => p.trim());
            if (parts.length < 4) return null;

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

        this.app.ui.showLoading('Creating ZIP...');
        try {
            const zip = new JSZip();
            const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
            const sourceTitle = this.versions[0]?.apiResponse?.title.replace(/ \(.+\)/, '') || 'composition';

            for (const version of this.versions) {
                const tracks = this.convertTracksToMidi(version.apiResponse.tracks);
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
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `${sanitizedSourceTitle}-variations.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            this.app.ui.showMessage('✓ Downloaded variations as ZIP', 'success');

        } catch (error) {
            console.error('ZIP creation failed:', error);
            this.app.ui.showMessage(`Error: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }
}
