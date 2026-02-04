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
                if (sourceExplanation) sourceExplanation.textContent = parsedJson.explanation || parsedJson.description || '';
            }

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

    buildNotationFromTracks(tracks) {
        if (!tracks || typeof tracks !== 'object') return '';
        const lines = [];
        for (const [trackName, notesStr] of Object.entries(tracks)) {
            // ✅ SUPPORT BOTH FORMATS
            const noteLine = this.splitNoteString(notesStr);
            for (const note of noteLine) {
                if (note.trim()) {
                    lines.push(`${note.trim()} # ${trackName}`);
                }
            }
        }
        return lines.join('\n');
    }

    /**
     * ✅ NEW: Split notes from both formats
     * COMPACT: "60:0:.5:8|62:.25:.5:7|"
     * LEGACY: "60,0,0.5,0.8\n62,0.25,0.5,0.7\n"
     */
    splitNoteString(notesStr) {
        if (!notesStr || notesStr.trim().length === 0) {
            return [];
        }

        // Detect format
        const isCompact = notesStr.includes('|') || (notesStr.includes(':') && !notesStr.includes(','));

        if (isCompact) {
            // Split by pipe (compact format)
            return notesStr.split('|').filter(s => s.trim().length > 0);
        } else {
            // Split by newline (legacy format)
            return notesStr.split('\n').filter(s => s.trim().length > 0);
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

            // Update app state
            this.app.generatedTracks = tracks;
            this.app.currentApiResponse = version.apiResponse;
            this.app.currentContext = version.context;

            // Update UI
            const titles = document.querySelectorAll('.composition-title');
            titles.forEach(t => t.textContent = version.apiResponse.title);

            const descriptions = document.querySelectorAll('.composition-description');
            descriptions.forEach(d => d.textContent = version.apiResponse.explanation);

            // Trigger visualizer update
            if (this.app.visualizer) {
                this.app.visualizer.clear();
                this.app.visualizer.updateTracks(tracks);
            }

            this.app.ui.showMessage(`Loaded: "${version.apiResponse.title}"`, 'success');

        } catch (error) {
            console.error('Failed to load version:', error);
            this.app.ui.showMessage(`Error loading version: ${error.message}`, 'error');
        }
    }

    async generateVariation() {
        if (!this.sourceJson) {
            this.app.ui.showMessage('No source composition loaded. Please load one first.', 'warning');
            return;
        }

        const generateBtn = document.getElementById('generate-variations');
        if (generateBtn) generateBtn.disabled = true;

        this.app.ui.showLoading('Generating variation...');

        try {
            const sourceParsed = JSON.parse(this.sourceJson);
            const sourceNotation = sourceParsed.notation || this.buildNotationFromTracks(sourceParsed.tracks);

            const prompt = `
You are a musical variation generator. Based on the following musical notation, create an interesting variation while maintaining the core structure.

Original Notation:
\`\`\`
${sourceNotation}
\`\`\`

Generate a variation of this composition and return ONLY valid JSON, no markdown, no explanation.

Format: 
{
  "title": "Variation - [name]",
  "description": "Brief explanation of the variation",
  "notation": "pitch:beat:dur:vel|pitch:beat:dur:vel|... for each track"
}

Requirements:
- Change rhythmic patterns, note sequences, or dynamics
- Keep the same MIDI ranges and general structure
- Output ONLY valid JSON
`;

            const response = await fetchWithModelFallbacks(prompt);
            
            if (!response) {
                throw new Error('Failed to get response from AI');
            }

            const metadata = this.parseVariationResponse(response);
            
            this.versions.push({
                apiResponse: metadata,
                context: this.app.currentContext,
                isOriginal: false,
                structure: 'Generated'
            });

            this.renderVersionsList();
            this.app.ui.showMessage(`Variation generated: "${metadata.title}"`, 'success');

        } catch (error) {
            console.error('Error generating variation:', error);
            this.app.ui.showMessage(`Error generating variation: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
            const generateBtn = document.getElementById('generate-variations');
            if (generateBtn) generateBtn.disabled = false;
        }
    }

    parseVariationResponse(responseText) {
        try {
            let cleanJsonText = responseText.trim();
            
            // Remove markdown code blocks
            cleanJsonText = cleanJsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            cleanJsonText = cleanJsonText.trim();
            
            // Extract JSON object
            const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanJsonText = jsonMatch[0];
            }

            const parsed = JSON.parse(cleanJsonText);

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
                    
                    // ✅ SUPPORT BOTH FORMATS
                    const noteLines = this.splitNoteString(notesStr);

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
            throw new Error(`Could not parse the AI's response. It may have been malformed. Details: ${error.message}`);
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

    /**
     * ✅ UPDATED: Parse both COMPACT and LEGACY formats
     * COMPACT: "60:0:.5:8"
     * LEGACY: "60,0,0.5,0.8"
     */
    parseNoteLine(line) {
        try {
            const cleanLine = line.split('#')[0].trim();
            
            // Detect format
            const isCompact = cleanLine.includes(':') && !cleanLine.includes(',');

            let parts;
            if (isCompact) {
                // Compact format: split by colon
                parts = cleanLine.split(':').map(p => p.trim());
            } else {
                // Legacy format: split by comma
                parts = cleanLine.split(',').map(p => p.trim());
            }

            if (parts.length < 4) {
                console.warn(`[Parser] Skipped line (incomplete): ${line}`);
                return null;
            }

            const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
            const secondsPerBeat = 60 / bpm;

            const pitchOrName = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocityRaw = parseFloat(parts[3]);

            if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocityRaw)) {
                console.warn(`[Parser] Skipped line (NaN values): ${line}`);
                return null;
            }

            // ✅ Handle velocity conversion for compact format (1-9 to 0.1-0.9)
            let velocity;
            if (isCompact && velocityRaw >= 1 && velocityRaw <= 9) {
                // Compact format: 1-9 → 0.1-0.9
                velocity = Math.max(0.1, Math.min(0.9, velocityRaw / 10));
            } else {
                // Legacy format: 0.0-1.0
                velocity = Math.max(0.1, Math.min(1.0, velocityRaw));
            }

            let name, midi;
            if (isNaN(parseInt(pitchOrName))) {
                name = pitchOrName;
                midi = Tone.Frequency(name).toMidi();
            } else {
                midi = parseInt(pitchOrName);
                name = Tone.Frequency(midi, 'midi').toNote();
            }

            if (isNaN(midi)) {
                console.warn(`[Parser] Invalid pitch: ${pitchOrName}`);
                return null;
            }

            return {
                name, midi,
                time: Math.max(0, startBeat * secondsPerBeat),
                duration: Math.max(0.01, durationBeats * secondsPerBeat),
                velocity: velocity,
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
