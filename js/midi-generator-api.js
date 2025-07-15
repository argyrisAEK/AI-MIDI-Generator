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
    
    const availableTracks = ['bassline', 'melody', 'chord', 'arpeggio', 'strings', 'lead', 'plucks', 'drums', 'keys', 'brass', 'percussion', 'guitar', 'pad-textures', 'fx-riser'];
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
    -   For "trackTypes", create an array of strings, picking from this list: ${availableTracks.join(', ')}. Make a sensible guess based on the description if not explicit.
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
    "trackTypes": ["bassline", "keys", "drums", "chord"],
    "rhythmicComplexity": "simple"
  },
  "enhancedPrompt": "Create a chilled, atmospheric downtempo piece with a simple, melancholic Moby-like feel."
}

User request: "${userPrompt}"

Respond ONLY with the raw JSON object, without any surrounding text or markdown.`;

    const analysisUrl = `https://text.pollinations.ai/${encodeURIComponent(analysisPrompt)}?model=openai-large`;

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
        const beatDuration = 60 / bpm;
        const notes = [];

        // Define drum MIDI notes with better mapping
        const drumKit = {
            kick: 36,        // C2
            snare: 38,       // D2
            hihat: 42,       // F#2 (Closed)
            openHihat: 46,   // A#2 (Open)
            crash: 49,       // C#3
            ride: 51,        // D#3
            sidestick: 37,   // C#2
            clap: 39,        // D#2
            tomHigh: 50,     // D3
            tomMid: 47,      // B2
            tomLow: 43       // G2
        };

        const sixteenth = beatDuration / 4;
        const eighth = beatDuration / 2;
        const styleKey = style.toLowerCase().trim();

        const addNote = (midi, time, duration = 0.1, velocity = 0.8) => {
            notes.push({
                name: Tone.Frequency(midi, 'midi').toNote(),
                midi: midi,
                time: time,
                duration: Math.max(0.01, duration),
                velocity: Math.max(0.1, Math.min(1.0, velocity))
            });
        };

        for (let bar = 0; bar < bars; bar++) {
            const barStart = bar * beatsPerBar * beatDuration;
            const isLastBarOfPhrase = (bar + 1) % 4 === 0;
            const isFirstBarOfPhrase = bar % 4 === 0;

            if (isFirstBarOfPhrase) {
                addNote(drumKit.crash, barStart, 0.4, 0.7);
            }

            // Tom fill on the last bar of a 4-bar phrase for certain styles
            const createTomFill = () => {
                const fillStart = barStart + 2 * beatDuration;
                addNote(drumKit.tomMid, fillStart + 0 * eighth, 0.1, 0.8);
                addNote(drumKit.tomMid, fillStart + 1 * eighth, 0.1, 0.8);
                addNote(drumKit.tomLow, fillStart + 2 * eighth, 0.1, 0.85);
                addNote(drumKit.tomLow, fillStart + 3 * eighth, 0.1, 0.85);
            };

            switch (styleKey) {
                case 'drum-and-bass':
                    // Fast, syncopated breakbeat
                    const dnbPattern = [
                        { m: drumKit.kick, t: 0, v: 0.95 },
                        { m: drumKit.hihat, t: 0.5, v: 0.6 },
                        { m: drumKit.snare, t: 1, v: 0.9 },
                        { m: drumKit.hihat, t: 1.5, v: 0.7 },
                        { m: drumKit.kick, t: 1.75, v: 0.8 },
                        { m: drumKit.hihat, t: 2, v: 0.6 },
                        { m: drumKit.hihat, t: 2.5, v: 0.7 },
                        { m: drumKit.snare, t: 3, v: 0.95 },
                        { m: drumKit.hihat, t: 3.5, v: 0.6 },
                        { m: drumKit.kick, t: 3.75, v: 0.85 },
                    ];
                    dnbPattern.forEach(p => {
                        addNote(p.m, barStart + p.t * beatDuration, 0.05, p.v + Math.random() * 0.05);
                    });
                    break;
                case 'synthwave':
                    // Classic 80s drum machine
                    addNote(drumKit.kick, barStart, 0.1, 0.9);
                    addNote(drumKit.kick, barStart + 0.5 * beatDuration, 0.1, 0.7);
                    addNote(drumKit.snare, barStart + 1 * beatDuration, 0.15, 0.95);
                    addNote(drumKit.kick, barStart + 2 * beatDuration, 0.1, 0.9);
                    addNote(drumKit.snare, barStart + 3 * beatDuration, 0.15, 0.95);
                    for (let i = 0; i < beatsPerBar * 2; i++) {
                        addNote(drumKit.hihat, barStart + i * eighth, 0.05, 0.6);
                    }
                    if (isLastBarOfPhrase) {
                        createTomFill();
                    }
                    break;
                case 'downtempo':
                     // Slow, spacious trip-hop groove
                    addNote(drumKit.kick, barStart, 0.1, 0.85);
                    addNote(drumKit.sidestick, barStart + 1 * beatDuration, 0.05, 0.7);
                    if (bar % 2 === 0) {
                        addNote(drumKit.kick, barStart + 1.75 * beatDuration, 0.1, 0.7);
                    }
                    addNote(drumKit.kick, barStart + 2.5 * beatDuration, 0.1, 0.8);
                    addNote(drumKit.sidestick, barStart + 3 * beatDuration, 0.05, 0.75);
                    addNote(drumKit.hihat, barStart + 3.5 * beatDuration, 0.05, 0.6);
                    break;
                case 'progressive-rock':
                case 'rock':
                    // Versatile rock/pop pattern
                    if (!isLastBarOfPhrase) {
                        addNote(drumKit.kick, barStart, 0.1, 0.9);
                        if (bar % 4 !== 3) {
                             addNote(drumKit.kick, barStart + 2 * beatDuration, 0.1, 0.85);
                        } else {
                             addNote(drumKit.kick, barStart + 1.5 * beatDuration, 0.1, 0.8);
                             addNote(drumKit.kick, barStart + 2.5 * beatDuration, 0.1, 0.8);
                        }
                        addNote(drumKit.snare, barStart + 1 * beatDuration, 0.1, 0.9);
                        addNote(drumKit.snare, barStart + 3 * beatDuration, 0.1, 0.9);
                        // Hi-hats on 8th notes
                        for (let i = 0; i < beatsPerBar * 2; i++) {
                            const velocity = i % 2 === 1 ? 0.5 : 0.7;
                            addNote(drumKit.ride, barStart + i * eighth, 0.05, velocity);
                        }
                    } else {
                        // Create a fill on the last bar
                        addNote(drumKit.kick, barStart, 0.1, 0.95);
                        addNote(drumKit.snare, barStart + 1 * beatDuration, 0.1, 0.9);
                        createTomFill();
                    }
                    break;
                case 'house':
                case 'disco':
                    // Four-on-the-floor kick
                    for (let beat = 0; beat < beatsPerBar; beat++) {
                        addNote(drumKit.kick, barStart + beat * beatDuration, 0.1, 0.9 + Math.random() * 0.1);
                    }
                    // Snare on 2 and 4
                    addNote(drumKit.snare, barStart + 1 * beatDuration, 0.1, 0.85);
                    addNote(drumKit.snare, barStart + 3 * beatDuration, 0.1, 0.85);
                    // Hi-hats on 8th notes with subtle variation
                    for (let i = 0; i < beatsPerBar * 2; i++) {
                        const velocity = 0.6 + (i % 2 === 1 ? 0.1 : 0) + Math.random() * 0.1;
                        addNote(drumKit.hihat, barStart + i * eighth, 0.05, velocity);
                    }
                    break;

                case 'techno':
                    // Heavy four-on-the-floor
                    for (let beat = 0; beat < beatsPerBar; beat++) {
                        addNote(drumKit.kick, barStart + beat * beatDuration, 0.15, 0.95);
                    }
                    // Off-beat hi-hats
                    for (let i = 1; i < beatsPerBar * 2; i += 2) {
                        addNote(drumKit.hihat, barStart + i * eighth, 0.05, 0.7);
                    }
                    // Occasional snare
                    if (bar % 2 === 1) {
                        addNote(drumKit.snare, barStart + 1 * beatDuration, 0.1, 0.8);
                    }
                    break;

                case 'trance':
                    // Kick pattern with some variation
                    addNote(drumKit.kick, barStart, 0.1, 0.95);
                    addNote(drumKit.kick, barStart + 2 * beatDuration, 0.1, 0.9);
                    if (bar % 4 === 3) {
                        addNote(drumKit.kick, barStart + 3.5 * beatDuration, 0.1, 0.8);
                    }
                    // Clap instead of snare
                    addNote(drumKit.clap, barStart + 1 * beatDuration, 0.1, 0.75);
                    addNote(drumKit.clap, barStart + 3 * beatDuration, 0.1, 0.75);
                    // 16th note hi-hats
                    for (let i = 0; i < beatsPerBar * 4; i++) {
                        if (i % 4 !== 0) { // Skip downbeats
                            addNote(drumKit.hihat, barStart + i * sixteenth, 0.03, 0.5 + Math.random() * 0.2);
                        }
                    }
                    break;

                case 'hip-hop':
                case 'trap':
                    // Syncopated kick pattern
                    addNote(drumKit.kick, barStart, 0.1, 0.9);
                    addNote(drumKit.kick, barStart + 2.75 * beatDuration, 0.1, 0.85);
                    // Snare on 2 and 4
                    addNote(drumKit.snare, barStart + 1 * beatDuration, 0.1, 0.9);
                    addNote(drumKit.snare, barStart + 3 * beatDuration, 0.1, 0.9);
                    // Complex hi-hat pattern
                    const hihatPattern = [0, 0.25, 0.75, 1, 1.5, 1.75, 2.25, 2.5, 3, 3.25, 3.75];
                    hihatPattern.forEach(offset => {
                        addNote(drumKit.hihat, barStart + offset * beatDuration, 0.05, 0.4 + Math.random() * 0.3);
                    });
                    break;

                default:
                    // Default to a versatile pattern if style is unknown
                    addNote(drumKit.kick, barStart, 0.1, 0.9);
                    addNote(drumKit.kick, barStart + 2 * beatDuration, 0.1, 0.85);
                    addNote(drumKit.snare, barStart + 1 * beatDuration, 0.1, 0.9);
                    addNote(drumKit.snare, barStart + 3 * beatDuration, 0.1, 0.9);
                    // Hi-hats on 8th notes
                    for (let i = 0; i < beatsPerBar * 2; i++) {
                        const velocity = i % 2 === 1 ? 0.5 : 0.7;
                        addNote(drumKit.hihat, barStart + i * eighth, 0.05, velocity);
                    }
                    break;
            }
        }
        
        // Sort by time and add subtle timing humanization
        notes.sort((a, b) => a.time - b.time);
        notes.forEach(note => {
            // Add slight timing variation (max 5ms)
            note.time += (Math.random() - 0.5) * 0.01;
        });
        
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
                
                // Add a small delay before retrying
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt -1) )); // Exponential backoff starting smaller
            }
        }
    }

    parseApiResponse(text, expectedTracks) {
        console.log('Attempting to parse API response…');
        const tracks = new Map();
        let compositionTitle = '';
        let compositionDescription = '';
        let rawJsonResponse = null; // To store the extracted JSON string

        // First get key timing parameters
        const bars = parseInt(document.getElementById('duration')?.value, 10) || 4;
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const timeSignature = document.getElementById('time-signature')?.value || '4/4';
        const beatsPerBar = parseInt(timeSignature.split('/')[0], 10) || 4;
        const beatDuration = 60 / bpm;
        const totalDuration = bars * beatsPerBar * beatDuration;

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

        // Enhanced JSON validation and cleaning
        const cleanJsonText = (rawText) => {
            let cleaned = rawText.trim();
            
            // Remove any markdown code blocks
            cleaned = cleaned.replace(/```json\s*|\s*```/g, '');
            
            // Find the JSON object boundaries
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            
            if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
                return null;
            }
            
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
            
            // Fix common JSON issues in the notation field
            const notationRegex = /"notation"\s*:\s*"([^"]*(?:\\.[^"]*)*)"?/;
            const match = cleaned.match(notationRegex);
            
            if (match) {
                let notationContent = match[1];
                
                // If notation contains unescaped newlines, fix them
                if (notationContent.includes('\n') && !notationContent.includes('\\n')) {
                    notationContent = notationContent.replace(/\n/g, '\\n');
                    cleaned = cleaned.replace(notationRegex, `"notation": "${notationContent}"`);
                }
                
                // Ensure proper escaping of quotes within notation
                notationContent = notationContent.replace(/(?<!\\)"/g, '\\"');
                cleaned = cleaned.replace(notationRegex, `"notation": "${notationContent}"`);
            }
            
            return cleaned;
        };

        // --- Start Parsing ---
        try {
            const cleanedJson = cleanJsonText(text);
            if (!cleanedJson) {
                throw new Error('Could not extract valid JSON from response');
            }
            
            rawJsonResponse = cleanedJson; // Store the cleaned JSON string
            const jsonResponse = JSON.parse(cleanedJson);
            
            // Validate required structure
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
                    if (notes.length > 0) {
                        tracks.set(type, { 
                            notes,
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
                new RegExp(`"${key}"\s*:\s*"([^"]*)"`, 'i'),
                new RegExp(`${key}\s*:\s*"([^"]*)"`, 'i'),
                new RegExp(`${key}\s*:\s*([^,\n}]+)`, 'i')
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

        // Special handling for drums - generate our own pattern if API fails for them
        if (expectedTracks.includes('drums') && !tracks.has('drums')) {
            const style = document.getElementById('style')?.value || 'house';
            const drumNotes = this.generateDrumPattern(bars, bpm, timeSignature, style);
            const processedDrumNotes = drumNotes.map(note => fitToLoop(note, totalDuration));
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
            
            if (tracks.size > 0) {
                return { tracks, title: compositionTitle, description: compositionDescription, rawJson: rawJsonResponse || text };
            }
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
            'perc': 'percussion', 'auxperc': 'percussion',
            'guitars': 'guitar', 'acoustic': 'guitar', 'electric': 'guitar',
            'padtexture': 'pad-textures', 'textures': 'pad-textures',
            'riser': 'fx-riser', 'fx': 'fx-riser'
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
        let rawJsonResponse = '';

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

                const url = `https://text.pollinations.ai/${encodeURIComponent(enhancedPrompt)}?model=mistral&seed=${Math.floor(Math.random() * 100000)}`;
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
            const { tracks: parsedTracks, title, description, rawJson } = this.parseApiResponse(responseText, tracksForAPI);

            compositionTitle = title;
            compositionDescription = description;
            rawJsonResponse = rawJson;

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
            return { tracks: generatedMidis, compositionTitle, compositionDescription, rawJson: rawJsonResponse };

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
