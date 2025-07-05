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

// Helper to analyze user's text prompt, determine track types, and return an enhanced prompt
export async function getTrackTypesFromPrompt(userPrompt, ui) {
    ui.showMessage('Analyzing your prompt to determine tracks and enhance...', 'loading');
    const availableTracks = ['bassline', 'melody', 'chord', 'arpeggio', 'strings', 'lead', 'plucks', 'drums'];
    // Call the track type analysis as before
    const analysisPrompt = `From the following user request, identify which of these musical tracks should be generated: ${availableTracks.join(', ')}. List only the identified track types, separated by commas. If none are clearly identified, make a sensible guess based on the description. For example, 'house beat with a groovy bass' should result in 'drums,bassline'. User request: "${userPrompt}"`;

    const analysisUrl = `https://text.pollinations.ai/${encodeURIComponent(analysisPrompt)}?model=openai`;
    
    // 1st call: extract which track types the user wants
    const response = await fetch(analysisUrl);
    if (!response.ok) {
        throw new Error('Failed to analyze prompt for track types.');
    }
    const text = await response.text();
    const cleanedText = text.toLowerCase().replace(/[^a-z,]/g, '');
    const identifiedTracks = cleanedText.split(',').map(t => t.trim()).filter(t => availableTracks.includes(t));

    let finalTrackTypes = identifiedTracks;
    if (finalTrackTypes.length === 0) {
        ui.showMessage('Could not determine specific tracks from your prompt. Defaulting to a melody and bassline. Try being more descriptive!', 'warning');
        finalTrackTypes = ['melody', 'bassline'];
    }
    if (finalTrackTypes.length > 4) {
        ui.showMessage(`Your prompt suggested ${finalTrackTypes.length} tracks. To keep the composition focused, we'll generate the first 4: ${finalTrackTypes.slice(0, 4).join(', ')}.`, 'warning');
        finalTrackTypes = finalTrackTypes.slice(0, 4);
    }

    // 2nd call: Enhance the user's prompt
    const enhancePromptText = `Improve and enhance the following user musical request for an AI MIDI generator. Rephrase it for clarity, musical detail, and add suitable style hints. Output only the enhanced instruction, no explanations. User request: "${userPrompt}"`;
    const enhanceUrl = `https://text.pollinations.ai/${encodeURIComponent(enhancePromptText)}?model=openai`;
    let enhancedPrompt = userPrompt;
    try {
        const enhanceResponse = await fetch(enhanceUrl);
        if (enhanceResponse.ok) {
            enhancedPrompt = (await enhanceResponse.text()).trim();
            // Don't show as status, just for internal prompt building
        }
    } catch (e) {
        // Ignore, fallback to userPrompt if enhance fails
    }

    return { trackTypes: finalTrackTypes, enhancedPrompt };
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

        function extractByRegex(key, txt) {
            // Accept both double- and single-quoted keys, and tolerate whitespace
            const re = new RegExp(`"${key}"\\s*:\\s*("(.*?)"|\\'(.*?)\\')`, 'i');
            const m = txt.match(re);
            if (m) return m[2] || m[3] || '';
            // Try YAML-style as last resort
            const yamlRE = new RegExp(`${key}\\s*:\\s*(.+)`, 'i');
            const ym = txt.match(yamlRE);
            if (ym) {
                let val = ym[1].trim();
                // If folded style, concatenate next lines until a blank or quote
                if (val === '|-' || val === '>-' || val === '|') {
                    const lines = txt.split('\n');
                    const idx = lines.findIndex(l => l.match(new RegExp(`${key}\\s*:`)));
                    let block = [];
                    for (let i = idx + 1; i < lines.length; ++i) {
                        if (/^\s*\S+:/.test(lines[i])) break; // next YAML key
                        block.push(lines[i].trim());
                    }
                    return block.join(' ').trim();
                } else {
                    // Remove potential quotes
                    val = val.replace(/^("|')/, '').replace(/("|')$/, '');
                    return val;
                }
            }
            return '';
        }

        // Start: try to parse JSON
        try {
            // Try to find a top-level JSON object in the response (may be embedded in leading/trailing info)
            const jsonMatch = text.match(/{[\s\S]+}/);
            let jsonText = text;
            if (jsonMatch) {
                jsonText = jsonMatch[0];
            }
            try {
                const jsonResponse = JSON.parse(jsonText);
                // Only accept if it's actual object with notation
                if (typeof jsonResponse === "object" && jsonResponse.notation) {
                    // Accept BOTH "explanation" or "description" keys, fallback if only one exists
                    compositionTitle = jsonResponse.title || '';
                    compositionDescription = jsonResponse.explanation || jsonResponse.description || '';
                    // parse notes tracks as before...
                    if (typeof jsonResponse.notation === 'string') {
                        const rawNotation = jsonResponse.notation;
                        // Accept with or without |-
                        const lines = rawNotation
                            .replace(/^\|-\s*/, '') // strip leading |-
                            .split(/\r?\n/);

                        // Determine loop parameters
                        const loopBars = parseInt(jsonResponse.duration, 10) || bars;
                        const loopDuration = loopBars * beatsPerBar * beatDuration;

                        // Prepare a map of notes per expected track
                        const trackNoteMap = new Map();
                        expectedTracks.forEach(type => trackNoteMap.set(type, []));

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || trimmed.startsWith('|-') || trimmed.toLowerCase().startsWith('pitch,time')) continue;
                            // Split at # for track name (allow # to be anywhere after velocity)
                            let content = trimmed;
                            let comment = '';
                            if (trimmed.includes('#')) {
                                [content, comment] = trimmed.split('#', 2);
                                content = content.trim();
                                comment = comment.trim();
                            }
                            const note = this.parseNoteLine(content);
                            if (!note) continue;
                            // Determine track type from comment
                            let type = '';
                            if (comment) {
                                type = this.normalizeTrackType(comment.split(/\s/)[0]);
                            }
                            if (!type || !trackNoteMap.has(type)) {
                                if (expectedTracks.length === 1) type = expectedTracks[0];
                            }
                            if (type && trackNoteMap.has(type)) {
                                const fitted = fitToLoop(note, loopDuration);
                                trackNoteMap.get(type).push(fitted);
                            }
                        }

                        trackNoteMap.forEach((notes, type) => {
                            if (notes.length > 0) {
                                tracks.set(type, { notes });
                            }
                        });
                        return { tracks, title: compositionTitle, description: compositionDescription };
                    }
                }
                // even if not a valid MIDI JSON, try fallback below
            } catch (e) {
                console.warn("Parsed response as JSON object but encountered error or invalid structure, falling back to text parsing.", e); // DEBUG LOG
                // Not a valid JSON
            }
        } catch (e) {
            console.warn("Response is not (clean) JSON, proceeding with alternative parsing.", e); // DEBUG LOG
            // Not a valid JSON. Continue to fallback
        }
        // --- Fallback for old formats, multi-blocks ---

        // Robust YAML-like or partial JSON Title/Description extraction when not parseable
        // This should cover almost every midijourney response format (JSON, YAML, even loose).
        compositionTitle = extractByRegex("title", text);
        if (!compositionTitle) compositionTitle = extractByRegex("Title", text);
        compositionDescription =
            extractByRegex("explanation", text) ||
            extractByRegex("description", text) ||
            extractByRegex("Explanation", text);

        // Special handling for drums - generate our own pattern
        if (expectedTracks.includes('drums')) {
            const style = document.getElementById('style')?.value || 'house';
            const drumNotes = this.generateDrumPattern(bars, bpm, timeSignature, style);
            // Ensure drum notes are quantized and fit loop
            const processedDrumNotes = drumNotes.map(note => fitToLoop(note, totalDuration));
            console.log('Notes being set for drums in parseApiResponse:', processedDrumNotes); // DEBUG LOG
            tracks.set('drums', {
                notes: processedDrumNotes,
                title: 'Drums',
                description: `Auto-generated ${style} drum pattern`
            });
        }

        // Parse multi-track format (legacy)
        const trackBlockPattern = /\[TRACK:\s*([^\]]+)\]([\s\S]*?)notation:\s*\|-\s*([\s\S]*?)(?=(\[TRACK:|$))/gi;
        let match;

        while ((match = trackBlockPattern.exec(text)) !== null) {
            const [, trackName, metadataRaw, notationContent] = match;
            const normalizedTrackName = this.normalizeTrackType(trackName.trim());

            if (expectedTracks.includes(normalizedTrackName) && normalizedTrackName !== 'drums') {
                let notes = this.parseNotationContent(notationContent);
                if (notes && notes.length > 0) {
                    notes = notes.map(note => fitToLoop(note, totalDuration));
                    tracks.set(normalizedTrackName, {
                        notes,
                    });
                }
            }
        }

        // Fallback for single YAML-style multi-track (newest midijourney style as in current prompt)
        if (text.includes('notation:')) {
            // Try to extract the NOTATION multi-line field!
            let notation = '';
            const notationMatch = text.match(/notation\s*:\s*\|-\s*\n([\s\S]+)$/i);
            if (notationMatch) {
                // Grab everything after notation: |-
                notation = notationMatch[1];
                // Could be until another yaml key, e.g. (stop at first line like "title: ...")
                // OR in the case it is at the end, just use all lines
                // For each line: 36,0,0.5,110  # bassline

                // Prepare notes per expected track
                const loopDuration = totalDuration;
                const trackNoteMap = new Map();
                expectedTracks.forEach(type => trackNoteMap.set(type, []));
                const lines = notation.split(/\r?\n/);

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('|-') ||
                        trimmed.toLowerCase().startsWith('pitch,time')) continue;
                    let content = trimmed;
                    let comment = '';
                    if (trimmed.includes('#')) {
                        [content, comment] = trimmed.split('#', 2);
                        content = content.trim();
                        comment = comment.trim();
                    }
                    const note = this.parseNoteLine(content);
                    if (!note) continue;
                    let type = '';
                    if (comment) {
                        type = this.normalizeTrackType(comment.split(/\s/)[0]);
                    }
                    if (!type || !trackNoteMap.has(type)) {
                        if (expectedTracks.length === 1) type = expectedTracks[0];
                    }
                    if (type && trackNoteMap.has(type)) {
                        const fitted = fitToLoop(note, loopDuration);
                        trackNoteMap.get(type).push(fitted);
                    }
                }
                trackNoteMap.forEach((notes, type) => {
                    if (notes.length > 0) {
                        tracks.set(type, { notes });
                    }
                });
            }
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
            'pluck': 'plucks', 'plucky': 'plucks'
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
        // Prepare to capture overall composition metadata
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

                const response = await this.fetchWithRetry(
                    `https://text.pollinations.ai/${encodeURIComponent(enhancedPrompt)}?model=midijourney&seed=${Math.floor(Math.random() * 100000)}`
                );

                responseText = await response.text();
                console.log('Raw API Response:', responseText.substring(0, 800) + '...');
            } else {
                 ui.showMessage(`Generating drums locally...`, 'loading');
            }
            

            // The new parser will return composition metadata alongside tracks
            const { tracks: parsedTracks, title, description } = this.parseApiResponse(responseText, tracksForAPI);

            compositionTitle = title;
            compositionDescription = description;

            if (tracksForAPI.length > 0 && parsedTracks.size === 0) {
                // If we requested tracks from API but got none, it's an issue (unless only drums were requested)
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
                    const drumMidi = this.createMidiObject(drumNotes, bpm);
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

            // Return both track map and the overall composition metadata
            return { tracks: generatedMidis, compositionTitle, compositionDescription };

        } catch (error) {
            const message = error.name === 'AbortError' 
                ? 'Generation timed out. The server might be busy. Please try again.'
                : `Generation failed: ${error.message}`;
            ui.showMessage(message, 'error');
            throw error;
        }
    }
}

// Export the enhanced generator
export async function generateMultiTrackMIDIFromAPI(prompt, ui, expectedTracks) {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(prompt, ui, expectedTracks);
}