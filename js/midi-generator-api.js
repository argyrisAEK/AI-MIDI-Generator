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

            // Common hi-hat pattern (8th notes) - can be overridden by style
            for (let i = 0; i < beatsPerBar * 2; i++) {
                const time = barStart + i * (beatDuration / 2);
                const isOffBeat = i % 2 === 1;
                addNote(hihatMidi, time, 0.05, isOffBeat ? 0.5 : 0.7);
            }

            switch (style.toLowerCase().trim()) {
                case 'house':
                case 'techno':
                case 'disco':
                    // Four-on-the-floor kick, snare on 2 and 4
                    for (let beat = 0; beat < beatsPerBar; beat++) {
                        addNote(kickMidi, barStart + beat * beatDuration, 0.1, 0.95);
                        if (beat === 1 || beat === 3) {
                            addNote(snareMidi, barStart + beat * beatDuration, 0.1, 0.85);
                        }
                    }
                    // Open hi-hat on the off-beats
                    for (let i = 0; i < beatsPerBar * 2; i++) {
                        if (i % 2 === 1) { // off-beats
                             addNote(openHihatMidi, barStart + i * (beatDuration/2), 0.1, 0.6);
                        }
                    }
                    break;

                case 'hip-hop':
                case 'trap':
                    notes.length = 0; // Clear default hi-hats for more complex pattern
                     // Kick on 1 and a syncopated beat
                    addNote(kickMidi, barStart, 0.1, 0.9);
                    addNote(kickMidi, barStart + 2 * beatDuration + 2 * sixteenth, 0.1, 0.85);
                    // Snare on 2 and 4
                    addNote(snareMidi, barStart + 1 * beatDuration, 0.1, 0.9);
                    addNote(snareMidi, barStart + 3 * beatDuration, 0.1, 0.9);
                    // 16th note hi-hats with some variation
                    for(let i=0; i < beatsPerBar * 4; i++) {
                        if(Math.random() > 0.2) { // Add some gaps
                           addNote(hihatMidi, barStart + i * sixteenth, 0.05, Math.random() * 0.4 + 0.3);
                        }
                    }
                    break;
                
                case 'rock':
                case 'pop':
                    // Kick on 1 and 3
                    addNote(kickMidi, barStart, 0.1, 0.95);
                    addNote(kickMidi, barStart + 2 * beatDuration, 0.1, 0.9);
                    // Snare on 2 and 4
                    addNote(snareMidi, barStart + 1 * beatDuration, 0.1, 0.9);
                    addNote(snareMidi, barStart + 3 * beatDuration, 0.1, 0.9);
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
                     for(let i=0; i < beatsPerBar * 4; i++) {
                        const time = barStart + i * sixteenth;
                        if(i % 4 === 2) { // open hat on the 'e' of 1 and 3
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
                    addNote(kickMidi, barStart, 0.1, 0.9);
                    addNote(kickMidi, barStart + 2 * beatDuration, 0.1, 0.85);
                    addNote(snareMidi, barStart + 1 * beatDuration, 0.1, 0.9);
                    addNote(snareMidi, barStart + 3 * beatDuration, 0.1, 0.9);
                    break;
            }
        }
        
        // Sort by time to ensure proper ordering
        notes.sort((a, b) => a.time - b.time);
        return notes;
    }

    async enhancePromptWithContext(prompt, ui, trackTypes) {
        ui.showMessage('Enhancing prompt with musical context...', 'loading');
        // This is a simplified version. The main prompt construction in main.js is now the primary source.
        // This function confirms the structure is ready for the main API call.
        return prompt; // Pass through the already constructed detailed prompt.
    }

    async _getTrackTypesFromPrompt(userPrompt) {
        this.ui.showMessage('Analyzing your prompt to determine tracks...', 'loading');
        const availableTracks = ['bassline', 'melody', 'chord', 'arpeggio', 'strings', 'lead', 'plucks', 'drums'];
        
        const analysisPrompt = `From the following user request, identify which of these musical tracks should be generated: ${availableTracks.join(', ')}. List only the identified track types, separated by commas. If none are clearly identified, make a sensible guess based on the description. For example, 'house beat with a groovy bass' should result in 'drums,bassline'. User request: "${userPrompt}"`;

        const url = `https://text.pollinations.ai/${encodeURIComponent(analysisPrompt)}?model=midijourney`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Failed to analyze prompt for track types.');
        }

        const text = await response.text();
        const cleanedText = text.toLowerCase().replace(/[^a-z,]/g, '');
        const identifiedTracks = cleanedText.split(',').map(t => t.trim()).filter(t => availableTracks.includes(t));

        if (identifiedTracks.length === 0) {
            this.ui.showMessage('Could not determine specific tracks from your prompt. Defaulting to a melody and bassline. Try being more descriptive!', 'warning');
            return ['melody', 'bassline'];
        }
        
        if (identifiedTracks.length > 4) { // Changed from 3 to 4
            this.ui.showMessage(`Your prompt suggested ${identifiedTracks.length} tracks. To keep the composition focused, we'll generate the first 4: ${identifiedTracks.slice(0, 4).join(', ')}.`, 'warning');
            return identifiedTracks.slice(0, 4);
        }

        return identifiedTracks;
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
                
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }

    parseApiResponse(text, expectedTracks) {
        console.log('Attempting to parse API response...');
        const tracks = new Map();

        // First get key timing parameters
        const bars = parseInt(document.getElementById('duration')?.value) || 4;
        const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
        const timeSignature = document.getElementById('time-signature')?.value || '4/4';
        const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
        const beatDuration = 60 / bpm;
        const totalDuration = bars * beatsPerBar * beatDuration;

        // Function to quantize note timing to grid
        const quantizeToGrid = (time, gridSize = beatDuration / 4) => {
            return Math.round(time / gridSize) * gridSize;
        };

        // Function to ensure note fits within loop boundaries
        const fitToLoop = (note, loopDuration) => {
            // Quantize start time and duration
            const quantizedTime = quantizeToGrid(note.time);
            const quantizedDuration = quantizeToGrid(note.duration);
            
            // If note starts beyond loop length, wrap it to beginning
            let adjustedTime = quantizedTime % loopDuration;
            
            // If note would extend beyond loop, truncate it
            let adjustedDuration = quantizedDuration;
            if (adjustedTime + adjustedDuration > loopDuration) {
                adjustedDuration = loopDuration - adjustedTime;
            }
            
            return {
                ...note,
                time: adjustedTime,
                duration: Math.max(0.1, adjustedDuration) // Ensure minimum duration
            };
        };

        // Special handling for drums - generate our own pattern
        if (expectedTracks.includes('drums')) {
            const style = document.getElementById('style')?.value || 'house';
            const drumNotes = this.generateDrumPattern(bars, bpm, timeSignature, style);
            // Ensure drum notes are quantized and fit loop
            const processedDrumNotes = drumNotes.map(note => fitToLoop(note, totalDuration));
            tracks.set('drums', processedDrumNotes);
            console.log(`Generated ${processedDrumNotes.length} quantized drum notes for style: ${style}`);
        }

        // Parse and process other tracks
        try {
            const jsonResponse = JSON.parse(text);
            if (jsonResponse && jsonResponse.notation) {
                console.log("Parsed response as JSON object.");
                let notes = this.parseNotationContent(jsonResponse.notation);
                if (notes && notes.length > 0 && expectedTracks.length > 0) {
                    // Process notes to fit loop duration
                    notes = notes.map(note => fitToLoop(note, totalDuration));
                    const trackType = expectedTracks.find(t => t !== 'drums') || expectedTracks[0];
                    tracks.set(trackType, notes);
                }
            }
        } catch (e) {
            console.log("Response is not JSON, proceeding with text parsing.");
        }

        // Parse multi-track format
        const trackBlockPattern = /\[TRACK:\s*([^\]]+)\]\s*notation:\s*\|-\s*([\s\S]*?)(?=\[TRACK:|$)/gi;
        let match;

        while ((match = trackBlockPattern.exec(text)) !== null) {
            const [, trackName, content] = match;
            const normalizedTrackName = this.normalizeTrackType(trackName.trim());
            
            if (expectedTracks.includes(normalizedTrackName) && normalizedTrackName !== 'drums') {
                let notes = this.parseNotationContent(content);
                if (notes && notes.length > 0) {
                    // Process notes to fit loop duration
                    notes = notes.map(note => fitToLoop(note, totalDuration));
                    tracks.set(normalizedTrackName, notes);
                }
            }
        }

        // Ensure all tracks are the same length and loop properly
        tracks.forEach((notes, trackType) => {
            if (notes.length === 0) return;

            // Sort notes by time
            notes.sort((a, b) => a.time - b.time);

            // If track is shorter than total duration, loop it
            const trackDuration = notes[notes.length - 1].time + notes[notes.length - 1].duration;
            if (trackDuration < totalDuration && notes.length > 0) {
                const originalNotes = [...notes];
                let currentTime = trackDuration;
                
                while (currentTime < totalDuration) {
                    const loopedNotes = originalNotes.map(note => ({
                        ...note,
                        time: note.time + currentTime
                    }));
                    notes.push(...loopedNotes.filter(note => note.time < totalDuration));
                    currentTime += trackDuration;
                }
            }

            // Update the track with processed notes
            tracks.set(trackType, notes);
        });

        return tracks;
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
            if (!trimmed || trimmed.includes('pitch,time,duration,velocity')) {
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
            const velocity = parseFloat(parts[3]);

            if ([time, duration, velocity].some(isNaN)) return null;
            
            let name, midi;
            if (isNaN(parseInt(pitchOrName))) {
                name = pitchOrName;
                midi = Tone.Frequency(name).toMidi();
            } else {
                midi = parseInt(pitchOrName);
                name = Tone.Frequency(midi, "midi").toNote();
            }

            return {
                name: name,
                time: Math.max(0, time),
                duration: Math.max(0.01, duration),
                velocity: Math.max(0.01, Math.min(1.0, velocity)),
                midi: midi
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

        try {
            const enhancedPrompt = await this.enhancePromptWithContext(prompt, ui, expectedTracks);
            ui.showMessage(`Generating ${expectedTracks.join(', ')}... This may take a moment.`, 'loading');

            const response = await this.fetchWithRetry(
                `https://text.pollinations.ai/${encodeURIComponent(enhancedPrompt)}?model=midijourney`
            );

            const responseText = await response.text();
            console.log('Raw API Response:', responseText.substring(0, 800) + '...');

            const parsedTracks = this.parseApiResponse(responseText, expectedTracks);

            if (parsedTracks.size === 0) {
                throw new Error('No valid tracks could be parsed from the response. Please try a different prompt.');
            }

            const bpm = parseInt(document.getElementById('bpm')?.value) || 120;

            for (const [trackType, notes] of parsedTracks.entries()) {
                if (notes.length > 0) {
                    const midi = this.createMidiObject(notes, bpm);
                    generatedMidis.set(trackType, midi);
                }
            }

            if (generatedMidis.size === 0) {
                throw new Error('MIDI generation resulted in empty tracks.');
            }

            return generatedMidis;

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