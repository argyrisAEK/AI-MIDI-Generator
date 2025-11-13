import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { ScaleValidator, ScaleStrictness } from './scale-validator.js';

// Chord progressions for coherence
const CHORD_PROGRESSIONS = {
    pop: ['C', 'Am', 'F', 'G'],
    jazz: ['Cmaj7', 'Am7', 'Dm7', 'G7'],
    classical: ['C', 'F', 'G', 'C']
};

async function fetchWithModelFallbacks(baseUrl, models, ui, options = {}) {
    const { timeout = 60000 } = options;
    let lastError = null;

    for (const model of models) {
        const url = `${baseUrl}&model=${model}`;
        const modelNameForUI = model.replace(/-\d+k$/, ''); // Clean up model names for display
        ui.showMessage(`Trying model: ${modelNameForUI}...`, 'loading');
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await fetch(url, { 
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const responseText = await response.text();
                // Some models return empty or near-empty responses on failure.
                if (responseText && responseText.trim().length > 10) {
                                        return new Response(responseText, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }
                throw new Error(`Model '${model}' returned an empty or invalid response.`);
            }
            
            lastError = new Error(`Model '${model}' failed with status ${response.status}: ${response.statusText}`);
            console.warn(lastError.message);

        } catch (error) {
            lastError = error;
            console.warn(`Request with model '${model}' failed:`, error.message);
        }
    }
    // If we're here, all models failed.
    throw lastError || new Error(`All fallback models failed: ${models.join(', ')}`);
}

// Replaces the old getTrackTypesFromPrompt, providing a more comprehensive analysis in a single API call.
export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui.showMessage('Analyzing and enhancing your prompt...', 'loading');
    
    const availableTracks = ['bassline', 'melody', 'chord', 'arpeggio', 'strings', 'lead', 'plucks', 'keys', 'brass', 'guitar', 'pad-textures'];
    const validKeys = ["C", "Cm", "D", "Dm", "E", "Em", "F", "Fm", "G", "Gm", "A", "Am", "B", "Bm"];
    const validDurations = ["4", "8", "16", "32"];
    const validStyles = Array.from(document.querySelectorAll('#style option')).map(opt => opt.value);
    const validMoods = Array.from(document.querySelectorAll('#mood option')).map(opt => opt.value);
    const validComplexities = Array.from(document.querySelectorAll('#rhythmic-complexity option')).map(opt => opt.value);

    const analysisPrompt = `Analyze the user's musical request to extract parameters for a MIDI generation tool. Respond ONLY with a single raw JSON object.

The JSON object must have two top-level keys: "extractedParams" and "enhancedPrompt".

1.  "extractedParams": An object containing musical parameters. This object must have these keys: "key", "bpm", "duration_bars", "style", "mood", "trackTypes", "rhythmicComplexity".
    -   Extract parameters strictly based on the user's text.
    -   For "key", translate the user's input (e.g., "f minor", "C major") into one of these exact values: ${validKeys.join(', ')}.
    -   For "bpm", extract the number as a string.
    -   For "duration_bars", extract the number of bars. It must be one of these exact string values: ${validDurations.join(', ')}. Find the closest valid option if the user provides a different number.
    -   For "style", extract the genre. The value MUST be one of these: ${validStyles.join(', ')}. If an artist is mentioned, determine their most representative genre from this list. If the user specifies a genre directly, prioritize that over the artist's style. For example, in "Moby style downtempo", the style is "downtempo".
    -   For "mood", extract the described mood. The value MUST be one of these: ${validMoods.join(', ')}.
    -   For "rhythmicComplexity", extract the rhythmic complexity. The value MUST be one of these: ${validComplexities.join(', ')}.
    -   For "trackTypes", create an array of strings, picking from this list: ${availableTracks.join(', ')}. Make a sensible guess based on the description if not explicit.No more than 5 trackTypes.
    -   If any parameter is not found in the user's text, its value in the JSON response MUST be null. Do not guess or add default values.

2.  "enhancedPrompt": A string containing a short, evocative, one-sentence creative direction based on the user's request, focusing on the artistic feeling.

EXAMPLE:
User request: "a Moby style downtempo composition in 8 bars"
Your JSON response:
{
  "extractedParams": {
    "key": null,
    "bpm": null,
    "duration_bars": "8",
    "style": "downtempo",
    "mood": "relaxed",
    "trackTypes": ["bassline", "keys", "plucks", "chord"],
    "rhythmicComplexity": "simple"
  },
  "enhancedPrompt": "Create a chilled, atmospheric downtempo piece with a simple, melancholic Moby-like feel."
}

User request: "${userPrompt}"

Respond ONLY with the raw JSON object, without any surrounding text or markdown.`;

    const analysisBaseUrl = `https://text.pollinations.ai/${encodeURIComponent(analysisPrompt)}?token=bMdm4yB_MTujU2E9`;
    const analysisModels = ['openai-large', 'midijourney', 'openai'];

    try {
        const response = await fetchWithModelFallbacks(analysisBaseUrl, analysisModels, ui, { timeout: 20000 }); // Shorter timeout for analysis

        const text = await response.text();
        // Clean up potential markdown formatting around the JSON
        const jsonText = text.replace(/```json\n?([\s\S]+?)\n?```/, '$1').trim();
        const result = JSON.parse(jsonText);

        if (!result.extractedParams || !result.enhancedPrompt) {
            throw new Error("API response is missing required 'extractedParams' or 'enhancedPrompt' keys.");
        }

        return { 
            extractedParams: result.extractedParams, 
            enhancedPrompt: result.enhancedPrompt 
        };
    } catch (e) {
        console.error("Failed to analyze or parse prompt analysis from API.", e);
   
        throw new Error(`Could not process your creative prompt. The AI might be busy or the request was unclear. Details: ${e.message}`);
    }
}

class MIDIGenerator {
    constructor() {
        this.generatedTracks = new Map();
        this.globalKey = 'C';
        this.globalScale = 'major';
        this.timeSignature = [4, 4];
        this.scaleValidator = new ScaleValidator();
    }

    parseApiResponse(text, expectedTracks) {
        console.log('Attempting to parse API response…');
        const tracks = new Map();
        let compositionTitle = '';
        let compositionDescription = '';
        let rawJsonResponse = null;

        // First get key timing parameters
        const bars = parseInt(document.getElementById('duration')?.value, 10) || 4;
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const timeSignature = document.getElementById('time-signature')?.value || '4/4';
        const beatsPerBar = parseInt(timeSignature.split('/')[0], 10) || 4;
        const beatDuration = 60 / bpm;
        const totalDuration = bars * beatsPerBar * beatDuration;

        // Get scale validation strictness from UI
        const validationStrictness = document.getElementById('scale-validation-strictness')?.value || ScaleStrictness.MEDIUM;
        const key = document.getElementById('key')?.value || 'C';
        const scaleType = document.getElementById('scale-type')?.value || 'major';

        // Set up scale validator
        this.scaleValidator.setScale(key, scaleType);

        // Function to quantize note timing to grid
        const quantizeToGrid = (time, gridSize = beatDuration / 8) => {
            return Math.round(time / gridSize) * gridSize;
        };

        // Function to ensure note fits within loop boundaries
        const fitToLoop = (note, loopDur) => {
            const quantizedTime = quantizeToGrid(note.time);
            const quantizedDuration = Math.max(0.01, quantizeToGrid(note.duration));
            let adjustedTime = quantizedTime % loopDur;
            let adjustedDuration = quantizedDuration;
            if (adjustedTime + adjustedDuration > loopDur) {
                adjustedDuration = loopDur - adjustedTime;
            }
            return {
                ...note,
                time: adjustedTime,
                duration: Math.max(0.01, adjustedDuration)
            };
        };

        // Enhanced JSON validation and cleaning with better regex patterns
        const cleanJsonText = (rawText) => {
            let cleaned = rawText.trim();
            
            // Remove markdown code blocks
            cleaned = cleaned.replace(/```(?:json)?\s*\n?|```\n?/g, '');
            
            // Extract JSON object boundaries more reliably
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return null;
            }
            
            let jsonStr = jsonMatch[0];
            
            // Fix common escaping issues within notation field
            // Handle escaped newlines properly
            jsonStr = jsonStr.replace(/"notation"\s*:\s*"/, (match) => {
                return match; // Keep the opening
            });
            
            // Ensure proper JSON string escaping
            try {
                // Try to parse to validate structure
                JSON.parse(jsonStr);
                return jsonStr;
            } catch (e) {
                // If parsing fails, try additional cleaning
                // Remove any control characters except \n
                jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
                
                // Fix improperly escaped newlines in notation field
                jsonStr = jsonStr.replace(/"notation"\s*:\s*"([^"]*?)"/g, (match, notation) => {
                    const fixed = notation.replace(/\n(?!\\n)/g, '\\n').replace(/\\\\n/g, '\\n');
                    return `"notation": "${fixed}"`;
                });
                
                return jsonStr;
            }
        };

        // --- Start Parsing ---
        try {
            const cleanedJson = cleanJsonText(text);
            if (!cleanedJson) {
                throw new Error('Could not extract valid JSON from response');
            }
            
            rawJsonResponse = cleanedJson;
            const jsonResponse = JSON.parse(cleanedJson);
            
            if (typeof jsonResponse !== "object" || !jsonResponse.notation) {
                throw new Error('Invalid JSON structure - missing notation field');
            }
            
            compositionTitle = jsonResponse.title || 'Generated Composition';
            compositionDescription = jsonResponse.explanation || jsonResponse.description || '';
            
            if (typeof jsonResponse.notation === 'string') {
                const rawNotation = jsonResponse.notation.replace(/\\n/g, '\n');
                const lines = rawNotation.replace(/^\|-\s*/, '').split(/\r?\n/);
                const loopBars = parseInt(jsonResponse.duration, 10) || bars;
                const loopDuration = loopBars * beatsPerBar * beatDuration;
                const trackNoteMap = new Map();
                expectedTracks.forEach(type => trackNoteMap.set(type, []));

                // Parse all notes first
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('|-') || trimmed.toLowerCase().startsWith('pitch,time')) continue;
                    
                    let content = trimmed, comment = '';
                    if (trimmed.includes('#')) {
                        [content, comment] = trimmed.split('#', 2);
                        content = content.trim();
                        comment = comment.trim();
                    }
                    
                    const note = this.parseNoteLine(content);
                    if (!note) continue;

                    let type = '';
                    if (comment) type = this.normalizeTrackType(comment.split(/\s/)[0]);
                    if (!type && expectedTracks.length === 1) type = expectedTracks[0];
                    
                    if (type && trackNoteMap.has(type)) {
                        trackNoteMap.get(type).push(fitToLoop(note, loopDuration));
                    }
                }

                // Validate and apply scale corrections
                trackNoteMap.forEach((notes, type) => {
                    if (notes.length > 0) {
                        // Apply scale validation
                        const { notes: validatedNotes, stats } = this.scaleValidator.validateNotes(notes, validationStrictness);
                        
                        // Log validation stats
                        if (stats.message) {
                            console.log(`[${type}] ${stats.message}`);
                        }

                        tracks.set(type, { 
                            notes: validatedNotes,
                            title: type.charAt(0).toUpperCase() + type.slice(1),
                            description: `${type} track for ${compositionTitle}`
                        });
                    }
                });
                
                if (tracks.size > 0) {
                    return { tracks, title: compositionTitle, description: compositionDescription, rawJson: rawJsonResponse };
                }
            }
        } catch (e) {
            console.warn("JSON parsing failed, attempting fallback parsing:", e.message);
        }

        // --- Enhanced Fallback Parsing ---
        function extractByRegex(key, txt) {
            const patterns = [
                new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i'),
                new RegExp(`${key}\\s*:\\s*"([^"]*)"`, 'i'),
                new RegExp(`${key}\\s*:\\s*([^,\\n}]+)`, 'i')
            ];
            
            for (const pattern of patterns) {
                const match = txt.match(pattern);
                if (match) {
                    return match[1].trim().replace(/^["']|["']$/g, '');
                }
            }
            return '';
        }

        compositionTitle = extractByRegex("title", text) || 'Generated Composition';
        compositionDescription = extractByRegex("explanation", text) || extractByRegex("description", text) || '';

        // Legacy multi-track format with improved parsing
        const trackBlockPattern = /notation:\s*\|-\s*([\s\S]*?)(?=(\[TRACK:|$|notation:))/gi;
        const notationMatches = text.matchAll(trackBlockPattern);
        
        let hasFoundNotation = false;
        for (const match of notationMatches) {
            hasFoundNotation = true;
            const notationContent = match[1];
            const trackNoteMap = new Map();
            expectedTracks.forEach(type => trackNoteMap.set(type, []));
            const loopDuration = totalDuration;

            for (const line of notationContent.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.toLowerCase().startsWith('pitch,time')) continue;
                
                let content = trimmed, comment = '';
                if (trimmed.includes('#')) {
                    [content, comment] = trimmed.split('#', 2);
                    content = content.trim();
                    comment = comment.trim();
                }

                const note = this.parseNoteLine(content);
                if (!note) continue;

                let type = '';
                if (comment) type = this.normalizeTrackType(comment.split(/\s/)[0]);
                if (!type && expectedTracks.length === 1) type = expectedTracks[0];
                
                if (type && trackNoteMap.has(type)) {
                    trackNoteMap.get(type).push(fitToLoop(note, loopDuration));
                }
            }

            trackNoteMap.forEach((notes, type) => {
                if (notes.length > 0) {
                    tracks.set(type, { 
                        notes,
                        title: type.charAt(0).toUpperCase() + type.slice(1),
                        description: `${type} track for ${compositionTitle}`
                    });
                }
            });
            
            if (tracks.size > 0) break;
        }
        
        return { tracks, title: compositionTitle, description: compositionDescription, rawJson: rawJsonResponse || text };
    }

    normalizeTrackType(trackType) {
        const lower = trackType.toLowerCase().replace(/_/, '');
        const normalizations = {
            'bass': 'bassline',
            'lead': 'lead', 'leadsynth': 'lead',
            'pad': 'chord', 'pads': 'chord', 'chords': 'chord',
            'arps': 'arpeggio',
            'string': 'strings',
            'pluck': 'plucks', 'plucky': 'plucks',
            'key': 'keys', 'piano': 'keys', 'organ': 'keys',
            'horns': 'brass',
            
            'guitars': 'guitar', 'acoustic': 'guitar', 'electric': 'guitar',
            'padtexture': 'pad-textures', 'textures': 'pad-textures',
            
        };
        return normalizations[lower] || lower;
    }

    parseNoteLine(line) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 4) return null;

        try {
            const pitchOrName = parts[0];
            const time = parseFloat(parts[1]);
            const duration = parseFloat(parts[2]);
            const rawVelocity = parseFloat(parts[3]);
            if ([time, duration].some(isNaN) || isNaN(rawVelocity)) return null;
            // Normalize velocity from percent if needed
            const scaled = rawVelocity > 1 ? rawVelocity / 100 : rawVelocity;
            const velocity = Math.max(0.01, Math.min(1.0, scaled));

            let name, midi;
            if (isNaN(parseInt(pitchOrName, 10))) {
                name = pitchOrName;
                midi = Tone.Frequency(name).toMidi();
            } else {
                midi = parseInt(pitchOrName, 10);
                name = Tone.Frequency(midi, 'midi').toNote();
            }

            return {
                name,
                time: Math.max(0, time),
                duration: Math.max(0.01, duration),
                velocity,
                midi
            };
        } catch (error) {
            console.warn('Could not parse note line:', line, error);
            return null;
        }
    }
    
    createMidiObject(notes, bpm) {
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

    async generateMultiTrackMIDI(prompt, ui, expectedTracks) {
        const generatedMidis = new Map();
        let compositionTitle = '';
        let compositionDescription = '';
        let rawJsonResponse = '';

        try {
            const tracksForAPI = expectedTracks;

            let responseText = '';

            // Only call API if there are tracks to generate
            if (tracksForAPI.length > 0) {
                const enhancedPrompt = prompt;
                ui.showMessage(`Generating ${tracksForAPI.length > 1 ? `${tracksForAPI.length} cohesive tracks...` : `a ${tracksForAPI[0]} track...`}`, 'loading');

                const baseUrl = `https://enter.pollinations.ai/generate/text/${encodeURIComponent(enhancedPrompt)}?key=plln_pk_CFgWGVj2GWzm60pHMs0Yl4lPRFcOB9R6hPxKZggnKzzumK8XOTv85OUITxB8cDJm`;
                const generationModels = ['gemini', 'openai-large', 'midijourney'];

                const response = await fetchWithModelFallbacks(baseUrl, generationModels, ui, {
                    timeout: 60000, 
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'User-Agent': 'MIDI-Generator-App/1.1'
                    }
                });
                
                responseText = await response.text();
                console.log(`Raw API Response:`, responseText.substring(0, 800) + '...');
            } else {
                // If expectedTracks is empty (e.g., user selected 0 tracks after analysis), fail gracefully
                throw new Error('No tracks selected for generation.');
            }

            // The new parser will return composition metadata alongside tracks
            const { tracks: parsedTracks, title, description, rawJson } = this.parseApiResponse(responseText, tracksForAPI);

            compositionTitle = title;
            compositionDescription = description;
            rawJsonResponse = rawJson;

            if (tracksForAPI.length > 0 && parsedTracks.size === 0) {
                throw new Error('No valid tracks could be parsed from the response. Please try a different prompt.');
            }

            const bpm = parseInt(document.getElementById('bpm')?.value) || 120;

            for (const [trackType, trackInfo] of parsedTracks.entries()) {
                const notes = trackInfo.notes || [];
                if (notes.length > 0) {
                    const midiObj = this.createMidiObject(notes, bpm);
                    generatedMidis.set(trackType, {
                        midi: midiObj,
                        // Pass through title/description from parser
                        title: trackInfo.title,
                        description: trackInfo.description
                    });
                }
            }

            if (generatedMidis.size === 0) {
                throw new Error('MIDI generation resulted in empty tracks.');
            }

            // Success! Return both track map and the overall composition metadata
            return { tracks: generatedMidis, compositionTitle, compositionDescription, rawJson: rawJsonResponse };

        } catch (error) {
            console.error(`Generation failed:`, error);
            let message;
            if (error.name === 'AbortError') {
                message = 'Generation timed out. The AI service is taking too long to respond. Please try again with a simpler request.';
            } else {
                message = `Generation failed: ${error.message}`;
            }
            ui.showMessage(message, 'error');
            throw error; // Propagate error to be handled by the caller
        }
    }
}

// Export the enhanced generator
export async function generateMultiTrackMIDIFromAPI(prompt, ui, expectedTracks) {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(prompt, ui, expectedTracks);
}
