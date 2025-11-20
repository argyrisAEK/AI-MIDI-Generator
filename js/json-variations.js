import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { ScaleValidator, ScaleStrictness } from './scale-validator.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null; // Holds the original composition JSON string
        this.versions = []; // Holds generated versions, including original
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
            // It's valid JSON.
            // Update the sourceJson.
            this.sourceJson = JSON.stringify(parsedJson); // Store it stringified but clean.

            // I also need to update the `originalVersion` in `this.versions`.
            const originalVersion = this.versions.find(v => v.isOriginal);
            if (originalVersion) {
                originalVersion.apiResponse = parsedJson;
                // Maybe I should update the title and explanation display too.
                const sourceTitle = document.getElementById('source-composition-title');
                const sourceExplanation = document.getElementById('source-composition-explanation');
                sourceTitle.textContent = parsedJson.title || 'Custom Composition';
                sourceExplanation.textContent = parsedJson.explanation || parsedJson.description || '';
            }

            this.app.ui.showMessage('JSON is valid. Ready to generate.', 'success');
            document.getElementById('generate-variations').disabled = false;
            rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            // Invalid JSON
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
        this.versions = []; // Ensure list is empty before adding to it

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

        // Use the current state of the JSON from the textarea, not just the original.
        let sourceVersion;
        try {
            const currentJson = JSON.parse(this.sourceJson);
            sourceVersion = {
                apiResponse: currentJson,
                context: this.versions.find(v => v.isOriginal)?.context || {}, // Use original context or empty
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
            const url = `https://text.pollinations.ai/${encodeURIComponent(variationPrompt)}?model=openai-large&seed=${Math.floor(Math.random() * 100000)}&token=bMdm4yB_MTujU2E9`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error(`API Error: ${response.statusText || response.status}`);

            const responseText = await response.text();
            const variationJson = this.parseVariationResponse(responseText);
            
            const newVersion = {
                apiResponse: variationJson,
                context: sourceVersion.context, // Inherit context from original
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
        listEl.innerHTML = ''; // Clear existing list

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
        
        // Enable download button if there's more than one version.
        document.getElementById('download-all-zip').disabled = this.versions.length < 1;
        
        // Add event listeners
        listEl.querySelectorAll('.btn-load').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = e.target.dataset.index;
                this.loadVersion(index);
            });
        });
    }
    
    loadVersion(index) {
        const version = this.versions[index];
        const tracks = this.parseNotationToTracks(version.apiResponse.notation);
        
        if (tracks.size === 0) {
            this.app.ui.showMessage('Cannot load an empty version.', 'error');
            return;
        }

        // Update main app state
        this.app.generatedTracks = tracks;
        this.app.compositionTitle = version.apiResponse.title;
        this.app.compositionDescription = version.apiResponse.explanation;
        
        // Update visualizer
        this.app.visualizer.compositionTitle = version.apiResponse.title;
        this.app.visualizer.compositionDescription = version.apiResponse.explanation;
        this.app.visualizer.setTracks(tracks);
        
        // Update form controls based on the version's context and actual tracks
        const trackTypesInVersion = Array.from(tracks.keys());
        this.app.updateUIFromContext(version.context, trackTypesInVersion);
        
        this.app.ui.updateButtonStates(true);
        this.app.ui.showMessage(`Loaded "${version.apiResponse.title}" into the main player.`, 'success');
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
        
        const structureInstructions = {
            intro: `Create an intro version with a sparse, atmospheric arrangement that builds anticipation. 
TRACK SELECTION: Use only 1-2 tracks from: ${originalTrackTypes.join(', ')} (prefer chord/pad + subtle bassline or melody)
MUSICAL APPROACH: Simple, sustained patterns with plenty of space. Lower velocities (0.3-0.6). Minimal rhythmic activity. Establish the mood and key.
ENERGY LEVEL: Low to moderate, creating anticipation for what's to come.`,

            build: `Create a build-up version with rising energy and tension that leads to a climax.
TRACK SELECTION: Use 3 tracks from: ${originalTrackTypes.join(', ')} (gradually add tracks, building layers)
MUSICAL APPROACH: Gradually increasing note density per bar. Use rising melodic patterns, accelerating rhythms, and growing intensity.
ENERGY LEVEL: Moderate to high, with clear upward momentum and mounting tension.`,

            verse: `Create a verse version with a steady, established groove that supports content and maintains interest.
TRACK SELECTION: Use 3 core tracks from: ${originalTrackTypes.join(', ')} (rhythmic foundation + melodic element)
MUSICAL APPROACH: Consistent rhythmic foundation, clear but not overwhelming. Leave space for focus. Maintain groove and pocket.
ENERGY LEVEL: Moderate and steady, providing solid foundation without competing for attention.`,

            chorus: `Create a chorus version representing the peak energy and emotional climax.
TRACK SELECTION: Use 4-5 tracks from: ${originalTrackTypes.join(', ')} (full arrangement with all layers)
MUSICAL APPROACH: Maximum note density, bright velocities (0.7-1.0), full harmonic content, memorable riffs and hooks.
ENERGY LEVEL: High energy, full and rich arrangement that feels like the emotional peak and hook.`,

            bridge: `Create a bridge version that provides musical contrast and resets energy before returning to familiar material.
TRACK SELECTION: Use 3 different tracks from: ${originalTrackTypes.join(', ')} (different combination or arrangement)
MUSICAL APPROACH: Contrasting rhythm patterns, shifted register, modified harmony, or syncopation. Create surprise and interest.
ENERGY LEVEL: Varied - can drop in energy for contrast or build differently than verse/chorus.`
        };

        const technicalRequirements = {
            intro: "Sustained notes with wide spacing. Velocities 0.3-0.6. Focus on atmosphere. Establish key and tempo clearly.",
            build: "Gradually increase note density and velocities. Add syncopation. Use ascending melodic lines. Increase rhythmic complexity.",
            verse: "Maintain consistent groove. Use moderate velocities (0.6-0.8). Keep space for other elements. Clear pulse.",
            chorus: "Dense arrangements. Velocities 0.7-1.0. Strong dynamics and accents. Memorable hook lines. Full harmonic palette.",
            bridge: "Different register or rhythmic feel. Moderate to high velocities. Contrasting but complementary to verse/chorus."
        };

        return `You are an expert music producer AI creating a professional "${structure.toUpperCase()}" section that is musically excellent. Your response must be ONLY a valid JSON object with no markdown formatting, explanations, or additional text.

ORIGINAL COMPOSITION ANALYSIS:
Title: ${originalJson.title}
Explanation: ${originalJson.explanation}
Available Tracks: ${originalTrackTypes.join(', ')}
Target Duration: ${duration} bars (~${totalSeconds.toFixed(3)} seconds)

STRUCTURAL TRANSFORMATION FOR "${structure.toUpperCase()}":
${structureInstructions[structure]}

TECHNICAL REQUIREMENTS:
${technicalRequirements[structure]}

CRITICAL MUSICAL RULES:
1. MAINTAIN: Original key, tempo (${bpm} BPM), and time signature (${beatsPerBar}/4) - these MUST NOT change
2. TRACK SELECTION: Choose appropriate tracks for a ${structure} section - NOT all tracks are needed
3. DURATION: Adapt all timing to exactly ${duration} bars; all note start times must be within [0, ${totalSeconds.toFixed(3)}] seconds
4. NOTATION FORMAT: Each note must be: pitch,time,duration,velocity # track_name
5. TRACK NAMES: Use ONLY these exact names: ${originalTrackTypes.join(', ')}
6. VELOCITY DYNAMICS: Use appropriate velocity ranges for ${structure} energy level
7. MUSICAL COHERENCE: Ensure all notes work together harmonically and rhythmically
8. NO REPETITION: Avoid exact repetition of the original section - create a new arrangement
9. **CRITICAL TOKEN SAVING**: Use MIDI note numbers (36-96) for pitch and maximum two decimal places (X.XX) for time, duration, and velocity. Use ONLY escaped newlines (\\n) for note separation.

RESPONSE FORMAT - Return ONLY this JSON structure:
{
  "title": "${originalJson.title} - ${structure.charAt(0).toUpperCase() + structure.slice(1)}",
  "explanation": "A ${structure} version of the original composition with [describe 15 words max]",
  "notation": "pitch,time,duration,velocity # track_name\\npitch,time,duration,velocity # track_name\\n[continue for all notes]"
}

ORIGINAL NOTATION TO TRANSFORM:
${originalJson.notation}

Generate the ${structure} variation now with excellent musical quality, following all requirements exactly.`;
    }

    parseVariationResponse(responseText) {
        try {
            // Be more aggressive in cleaning the response
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
        
        // 1. Get current scale parameters from UI
        const key = document.getElementById('key')?.value || 'C';
        const scaleType = document.getElementById('scale-type')?.value || 'major';
        const validationStrictness = document.getElementById('scale-validation-strictness')?.value || ScaleStrictness.MEDIUM;
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        // 2. Set validator
        this.validator.setScale(key, scaleType);

        // Phase 1: Parse all raw notes
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
        
        // Phase 2: Validate and build MIDI objects
        const finalTracks = new Map();
        
        rawTrackNotes.forEach((notes, trackType) => {
            if (notes.length > 0) {
                // Apply scale validation
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
                    const combinedMidi = MidiBuilder.createCombinedMidi(tracks, bpm); // No mixer settings for variations
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
