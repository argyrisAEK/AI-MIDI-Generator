import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';

// Musical scales for better harmony
const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    blues: [0, 3, 5, 6, 7, 10]
};

// Chord progressions for coherence
const CHORD_PROGRESSIONS = {
    pop: ['C', 'Am', 'F', 'G'],
    jazz: ['Cmaj7', 'Am7', 'Dm7', 'G7'],
    classical: ['C', 'F', 'G', 'C']
};

// Replaces the old getTrackTypesFromPrompt, providing a more comprehensive analysis in a single API call.
export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui.showMessage('Analyzing and enhancing your prompt...', 'loading');
    
    const availableTracks = ['bassline', 'melody', 'chord', 'arpeggio', 'strings', 'lead', 'plucks', 'drums', 'keys', 'brass', 'percussion', 'guitar'];
    const validKeys = ["C", "Cm", "D", "Dm", "E", "Em", "F", "Fm", "G", "Gm", "A", "Am", "B", "Bm"];
    const validDurations = ["4", "8", "16", "32"];

    const analysisPrompt = `Analyze the user's musical request. Respond ONLY with a single raw JSON object.
The JSON object must have two top-level keys: "extractedParams" and "enhancedPrompt".

1.  "extractedParams": An object containing musical parameters. This object must have these keys: "key", "bpm", "duration_bars", "style", "mood", "trackTypes".
    -   For "key", translate the user's input (e.g., "f minor", "C major") into one of these exact values: ${validKeys.join(', ')}.
    -   For "bpm", extract the number as a string.
    -   For "duration_bars", extract the number of bars and return it as one of these exact string values: ${validDurations.join(', ')}. Find the closest valid option if the user provides a different number.
    -   For "style", extract the genre or artist style mentioned.
    -   For "mood", extract the described mood.
    -   For "trackTypes", create an array of strings, picking from this list: ${availableTracks.join(', ')}. Make a sensible guess based on the description if not explicit.
    -   If any parameter is not found in the user's text, its value in the JSON should be null.

2.  "enhancedPrompt": A string containing a short, evocative, one-sentence creative direction based on the user's request. Focus on the artistic feeling, not the technical details.

User request: "${userPrompt}"

Respond ONLY with the raw JSON object, without any surrounding text or markdown.`;

    const analysisUrl = `https://text.pollinations.ai/${encodeURIComponent(analysisPrompt)}?model=openai`;

    try {
        const response = await fetch(analysisUrl);
        if (!response.ok) {
            throw new Error(`API for prompt analysis failed with status: ${response.status}`);
        }
        
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
        // Instead of falling back to more API calls, we throw and let the caller handle it.
        // This fulfills the user request of a single API call for this step.
        throw new Error(`Could not process your creative prompt. The AI might be busy or the request was unclear. Details: ${e.message}`);
    }
}

class MIDIGenerator {
    constructor() {
        this.generatedTracks = new Map();
        this.globalKey = 'C';
        this.globalScale = 'major';
        this.timeSignature = [4, 4];
    }

    generateDrumPattern(bars, bpm, timeSignature, style = 'house') {
        const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
        const totalBeats = bars * beatsPerBar;
        const beatDuration = 60 / bpm;
        const notes = [];

        // Define drum MIDI notes (standard GM mapping)
        const kickMidi = 36;    // C2
        const snareMidi = 38;   // D2
        const hihatMidi = 42;   // F#2 (Closed)
        const openHihatMidi = 46; // A#2 (Open)

        const sixteenth = beatDuration / 4;
        const styleKey = style.toLowerCase().trim();
        const omitDefaultHats = styleKey === 'trap' || styleKey === 'hip-hop';

        const addNote = (midi, time, duration = 0.1, velocity = 0.8) => {
            notes.push({
                name: Tone.Frequency(midi, 'midi').toNote(),
                midi: midi,
                time: time,
                duration: duration,
                velocity: velocity
            });
        };

        for (let bar = 0; bar < bars; bar++) {
            const barStart = bar * beatsPerBar * beatDuration;

            switch (styleKey) {
                case 'house':
                case 'techno':
                case 'disco':
                    // Build the pattern from scratch for these genres to ensure four-on-the-floor.
                    notes.length = 0;
                    for (let currentBar = 0; currentBar < bars; currentBar++) {
                        const currentBarStart = currentBar * beatsPerBar * beatDuration;
                        
                        // 1. Four-on-the-floor kick
                        for (let beat = 0; beat < beatsPerBar; beat++) {
                            addNote(kickMidi, currentBarStart + beat * beatDuration, 0.1, 0.95);
                        }

                        // 2. Snare on beats 2 and 4
                        addNote(snareMidi, currentBarStart + 1 * beatDuration, 0.1, 0.85);
                        addNote(snareMidi, currentBarStart + 3 * beatDuration, 0.1, 0.85);

                        // 3. Closed hi-hats on every 8th note
                        for (let i = 0; i < beatsPerBar * 2; i++) {
                            addNote(hihatMidi, currentBarStart + i * (beatDuration / 2), 0.05, i % 2 === 1 ? 0.6 : 0.8);
                        }
                    }
                    // Since we've built the full pattern for all bars, we can break out of the main loop.
                    bar = bars; 
                    break;

                case 'hip-hop':
                case 'trap':
                    // Custom drum pattern: kicks, snares, and 16th-note hi-hats
                     // Kick on 1 and a syncopated beat
                    addNote(kickMidi, barStart, 0.1, 0.9);
                    addNote(kickMidi, barStart + 2 * beatDuration + 2 * sixteenth, 0.1, 0.85);
                    // Snare on 2 and 4
                    addNote(snareMidi, barStart + 1 * beatDuration, 0.1, 0.9);
                    addNote(snareMidi, barStart + 3 * beatDuration, 0.1, 0.9);
                    // 16th note hi-hats with some variation
                    for (let i = 0; i < beatsPerBar * 4; i++) {
                        if (Math.random() > 0.2) {
                            addNote(hihatMidi, barStart + i * sixteenth, 0.05, Math.random() * 0.4 + 0.3);
                        }
                    }
                    break;
                
                case 'rock':
                case 'pop':
                    // Default hi-hat pattern (8th notes)
                    for (let i = 0; i < beatsPerBar * 2; i++) {
                        const time = barStart + i * (beatDuration / 2);
                        const isOffBeat = i % 2 === 1;
                        addNote(hihatMidi, time, 0.05, isOffBeat ? 0.5 : 0.7);
                    }
                    // Kick on 1 and 3
                    addNote(kickMidi, barStart, 0.1, 0.95);
                    addNote(kickMidi, barStart + 2 * beatDuration, 0.1, 0.9);
                    break;

                case 'funk':
                    notes.length = 0; // Clear default hats for syncopation
                    // Syncopated kick pattern
                    addNote(kickMidi, barStart, 0.1, 0.95);
                    addNote(kickMidi, barStart + 3 * sixteenth, 0.1, 0.7);
                    addNote(kickMidi, barStart + 2 * beatDuration, 0.1, 0.9);
                    // Snare on 2 and 4
                    addNote(snareMidi, barStart + 1 * beatDuration, 0.1, 0.9);
                    addNote(snareMidi, barStart + 3 * beatDuration, 0.1, 0.9);
                    // 16th note hi-hats with open hats
                     for (let i = 0; i < beatsPerBar * 4; i++) {
                        const time = barStart + i * sixteenth;
                        if (i % 4 === 2) { // open hat on the 'e' of 1 and 3
                            addNote(openHihatMidi, time, 0.1, 0.6);
                        } else {
                            addNote(hihatMidi, time, 0.05, 0.7);
                        }
                    }
                    break;

                case 'reggae':
                     notes.length = 0; // Clear default hats for "one drop"
                    // "One drop" rhythm: Kick and snare on beat 3
                    if (beatsPerBar >= 3) {
                         addNote(kickMidi, barStart + 2 * beatDuration, 0.1, 0.9);
                         addNote(snareMidi, barStart + 2 * beatDuration, 0.1, 0.8, true); // Rimshot style
                    }
                     // Hi-hats on the off-beats (the '&'s)
                    for (let i = 0; i < beatsPerBar * 2; i++) {
                        if (i % 2 === 1) {
                            addNote(hihatMidi, barStart + i * (beatDuration/2), 0.05, 0.7);
                        }
                    }
                    break;

                default: // A versatile default pattern
                     // Default hi-hat pattern (8th notes)
                    for (let i = 0; i < beatsPerBar * 2; i++) {
                        const time = barStart + i * (beatDuration / 2);
                        const isOffBeat = i % 2 === 1;
                        addNote(hihatMidi, time, 0.05, isOffBeat ? 0.5 : 0.7);
                    }
                    addNote(kickMidi, barStart, 0.1, 0.9);
                    addNote(kickMidi, barStart + 2 * beatDuration, 0.1, 0.85);
                    addNote(snareMidi, barStart + 1 * beatDuration, 0.1, 0.9);
                    addNote(snareMidi, barStart + 3 * beatDuration, 0.1, 0.9);
                    break;
            }
        }
        
        // Sort by time to ensure proper ordering
        notes.sort((a, b) => a.time - b.time);
        console.log('Notes generated by generateDrumPattern:', notes); // DEBUG LOG
        return notes;
    }

    async enhancePromptWithContext(prompt, ui, trackTypes) {
        ui.showMessage('Enhancing prompt with musical context...', 'loading');
        // This is a simplified version. The main prompt construction in main.js is now the primary source.
        // This function confirms the structure is ready for the main API call.
        return prompt; // Pass through the already constructed detailed prompt.
    }

    async fetchWithRetry(url, options = {}) {
        const { timeout = 90000, retries = 3 } = options;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                
                const response = await fetch(url, { 
                    signal: controller.signal,
                    headers: {
                        'Accept': 'application/json, text/plain, */*', // Prefer JSON
                        'User-Agent': 'MIDI-Generator-App/1.1'
                    }
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
                }
                
                return response;
            } catch (error) {
                console.warn(`Fetch attempt ${attempt}/${retries} failed:`, error.message);
                
                if (attempt === retries || error.name === 'AbortError') {
                    throw error;
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt))); // Exponential backoff
            }
        }
    }

    parseApiResponse(text, expectedTracks) {
        console.log('Attempting to parse API response…');
        const tracks = new Map();
        let compositionTitle = '';
        let compositionDescription = '';

        // First get key timing parameters
        const bars = parseInt(document.getElementById('duration')?.value, 10) || 4;
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const timeSignature = document.getElementById('time-signature')?.value || '4/4';
        const beatsPerBar = parseInt(timeSignature.split('/')[0], 10) || 4;
        const beatDuration = 60 / bpm;
        const totalDuration = bars * beatsPerBar * beatDuration;

        // Function to quantize note timing to grid
        const quantizeToGrid = (time, gridSize = beatDuration / 4) => {
            return Math.round(time / gridSize) * gridSize;
        };

        // Function to ensure note fits within loop boundaries
        const fitToLoop = (note, loopDur) => {
            const quantizedTime = quantizeToGrid(note.time);
            const quantizedDuration = quantizeToGrid(note.duration);
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

        // --- Start Parsing ---
        try {
            let jsonText = text;
            // Be more lenient in finding the JSON block
            const jsonMatch = text.match(/{\s*("title"[\s\S]+)}/);
            if (jsonMatch) {
                jsonText = jsonMatch[0];
            } else {
                 // Fallback if the regex fails but it's probably JSON anyway
                const firstBrace = text.indexOf('{');
                const lastBrace = text.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace > firstBrace) {
                    jsonText = text.substring(firstBrace, lastBrace + 1);
                }
            }
            
            // Attempt to parse the cleaned text directly
            const jsonResponse = JSON.parse(jsonText);
            
            // Check for the expected structure
            if (typeof jsonResponse === "object" && jsonResponse.notation) {
                compositionTitle = jsonResponse.title || '';
                compositionDescription = jsonResponse.explanation || jsonResponse.description || '';
                
                if (typeof jsonResponse.notation === 'string') {
                    // This is the ideal case: notation is a valid JSON string with escaped newlines
                    const rawNotation = jsonResponse.notation.replace(/\\n/g, '\n'); // unescape for processing
                    const lines = rawNotation.replace(/^\|-\s*/, '').split(/\r?\n/);
                    const loopBars = parseInt(jsonResponse.duration, 10) || bars;
                    const loopDuration = loopBars * beatsPerBar * beatDuration;
                    const trackNoteMap = new Map();
                    expectedTracks.forEach(type => trackNoteMap.set(type, []));

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

                    trackNoteMap.forEach((notes, type) => {
                        if (notes.length > 0) tracks.set(type, { notes });
                    });
                    
                    // If we successfully parsed tracks, return them immediately.
                    if (tracks.size > 0) {
                        return { tracks, title: compositionTitle, description: compositionDescription };
                    }
                }
            }
        } catch (e) {
            console.warn("Could not parse as valid JSON. Attempting to fix and re-parse.", e);
            // This is where we handle the "bad JSON" from the API (e.g., unescaped newlines).
            const notationBlockMatch = text.match(/"notation"\s*:\s*"(?:\|-)?([\s\S]+?)"?\s*[,\}]/);
            
            if (notationBlockMatch) {
                const notationContent = notationBlockMatch[1];
                // Escape backslashes, then double quotes, then replace newlines with \n
                const escapedNotation = notationContent
                    .replace(/\\/g, '\\\\')
                    .replace(/"/g, '\\"')
                    .replace(/\r/g, '')
                    .replace(/\n/g, '\\n')
                    .trim()
                    .replace(/\\n$/, ''); // remove trailing newline

                // Reconstruct the broken part of the text into a valid JSON string value
                 const fixedText = text.substring(0, notationBlockMatch.index) +
                                `"notation": "${escapedNotation}"` +
                                text.substring(notationBlockMatch.index + notationBlockMatch[0].length-1);
                
                // Now, call parseApiResponse recursively with the fixed text.
                // Add a guard to prevent infinite recursion if the fix fails.
                if (text !== fixedText) {
                    return this.parseApiResponse(fixedText, expectedTracks);
                }
            }
            console.warn("Could not fix the JSON response. Proceeding with legacy fallback parsing.");
        }

        // --- Fallback for old formats or unrecoverable JSON ---
        
        function extractByRegex(key, txt) {
            const re = new RegExp(`"${key}"\s*:\s*"(.*?)"`, 'i');
            const m = txt.match(re);
            if (m) return m[1] || '';
            const yamlRE = new RegExp(`${key}\s*:\s*(.+)`, 'i');
            const ym = txt.match(yamlRE);
            if (ym) {
                let val = ym[1].trim();
                val = val.replace(/^("|')/, '').replace(/("|')$/, '');
                return val;
            }
            return '';
        }

        compositionTitle = extractByRegex("title", text);
        compositionDescription = extractByRegex("explanation", text) || extractByRegex("description", text);

        // Special handling for drums - generate our own pattern if API fails for them
        if (expectedTracks.includes('drums') && !tracks.has('drums')) {
            const style = document.getElementById('style')?.value || 'house';
            const drumNotes = this.generateDrumPattern(bars, bpm, timeSignature, style);
            const processedDrumNotes = drumNotes.map(note => fitToLoop(note, totalDuration));
            console.log('Notes being set for drums in fallback parser:', processedDrumNotes);
            tracks.set('drums', {
                notes: processedDrumNotes,
                title: 'Drums',
                description: `Auto-generated ${style} drum pattern.`
            });
        }

        // Legacy multi-track format
        const trackBlockPattern = /notation:\s*\|-\s*([\s\S]*?)(?=(\[TRACK:|$|notation:))/gi;
        const notationMatch = text.match(trackBlockPattern);
        
        if (notationMatch) {
            const notationContent = notationMatch[0].replace(/notation:\s*\|-/, '');
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
                    // Avoid duplicating tracks already parsed
                    if (!tracks.has(type)) {
                       if (!trackNoteMap.has(type)) trackNoteMap.set(type, []);
                       trackNoteMap.get(type).push(fitToLoop(note, loopDuration));
                    }
                }
            }
            trackNoteMap.forEach((notes, type) => {
                if (notes.length > 0) tracks.set(type, { notes });
            });
        }
        
        return { tracks, title: compositionTitle, description: compositionDescription };
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
            'perc': 'percussion', 'auxperc': 'percussion',
            'guitars': 'guitar', 'acoustic': 'guitar', 'electric': 'guitar'
        };
        return normalizations[lower] || lower;
    }

    parseNotationContent(content) {
        const lines = content.split('\n');
        const notes = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.includes('pitch,time')) {
                continue;
            }
            const note = this.parseNoteLine(trimmed);
            if (note) {
                notes.push(note);
            }
        }
        return notes;
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

        try {
            // Check for local drum generation override
            const style = document.getElementById('style')?.value?.toLowerCase() || 'house';
            const generateDrumsLocally = expectedTracks.includes('drums') && ['house', 'techno'].includes(style);

            const tracksForAPI = generateDrumsLocally
                ? expectedTracks.filter(t => t !== 'drums')
                : expectedTracks;

            let responseText = '';

            // Only call API if there are other tracks to generate
            if (tracksForAPI.length > 0) {
                const enhancedPrompt = await this.enhancePromptWithContext(prompt, ui, tracksForAPI);
                ui.showMessage(`Generating ${tracksForAPI.length > 1 ? `${tracksForAPI.length} cohesive tracks...` : `a ${tracksForAPI[0]} track...`}`, 'loading');

                const url = `https://text.pollinations.ai/${encodeURIComponent(enhancedPrompt)}?model=midijourney&seed=${Math.floor(Math.random() * 100000)}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 90000); // 90-second timeout

                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'User-Agent': 'MIDI-Generator-App/1.1'
                    }
                });
                
                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
                }
                
                responseText = await response.text();
                console.log(`Raw API Response:`, responseText.substring(0, 800) + '...');
            } else {
                ui.showMessage(`Generating drums locally...`, 'loading');
            }

            // The new parser will return composition metadata alongside tracks
            const { tracks: parsedTracks, title, description } = this.parseApiResponse(responseText, tracksForAPI);

            compositionTitle = title;
            compositionDescription = description;

            if (tracksForAPI.length > 0 && parsedTracks.size === 0) {
                throw new Error('No valid tracks could be parsed from the response. Please try a different prompt.');
            }

            const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
            const bars = parseInt(document.getElementById('duration')?.value, 10) || 4;
            const timeSignatureValue = document.getElementById('time-signature')?.value || '4/4';

            // Now, add the locally generated drums if needed
            if (generateDrumsLocally) {
                ui.showMessage('Adding locally generated drums...', 'loading');
                const drumNotes = this.generateDrumPattern(bars, bpm, timeSignatureValue, style);
                if (drumNotes.length > 0) {
                    parsedTracks.set('drums', {
                        notes: drumNotes,
                        title: 'Drums',
                        description: `Locally generated ${style} drum pattern.`
                    });
                }
            }


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
            return { tracks: generatedMidis, compositionTitle, compositionDescription };

        } catch (error) {
            console.error(`Generation failed:`, error.message);
            const message = error.name === 'AbortError'
                ? `Generation timed out. The server might be busy.`
                : `Generation failed: ${error.message}`;
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