import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';
import { trackAbbreviations } from './prompt-builder.js';

class MIDIGenerator {
    constructor() {
        this.generatedTracks = new Map();
    }

    /**
     * Parse API response from chat/completions endpoint
     * Response is already plain text JSON without Markdown wrappers
     */
    parseApiResponse(text, expectedTracks) {
        console.log('Attempting to parse AI response…');
        const tracks = new Map();
        let compositionTitle = 'Untitled';
        let compositionDescription = '';
        let rawJsonString = text; // Store original JSON

        try {
            // Clean the text - remove any remaining whitespace/newlines at edges
            let cleanJsonText = text.trim();
            
            // Extract JSON object if there's any surrounding text
            const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanJsonText = jsonMatch[0];
                rawJsonString = cleanJsonText; // Update to cleaned version
            }

            const rawJsonResponse = JSON.parse(cleanJsonText);
            compositionTitle = rawJsonResponse.title || compositionTitle;
            compositionDescription =
    rawJsonResponse.description ||
    rawJsonResponse.desc ||
    '';

            if (!rawJsonResponse.tracks) {
                throw new Error("No 'tracks' object found in JSON.");
            }

            // Process each track with original logic
            for (const [rawName, notesData] of Object.entries(rawJsonResponse.tracks)) {
                const normalizedName = this.normalizeTrackType(rawName);
                
                // Filter: Keep only tracks requested by user
                if (expectedTracks.includes(normalizedName)) {
                    const lines = notesData.split('\n').filter(line => line.trim().length > 0);
                    const notes = lines
                        .map(line => this.parseNoteLine(line))
                        .filter(note => note !== null);

                    if (notes.length > 0) {
                        tracks.set(normalizedName, {
                            notes: notes,
                            title: normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1),
                            description: `Generated ${normalizedName} sequence`
                        });
                    }
                } else {
                    console.warn(`Skipping unexpected track: ${rawName} (normalized: ${normalizedName})`);
                }
            }

            // Log dropped tracks for debugging
            const generatedTracks = Array.from(tracks.keys());
            const droppedTracks = expectedTracks.filter(t => !generatedTracks.includes(t));
            if (droppedTracks.length > 0) {
                console.warn(`Could not generate tracks: ${droppedTracks.join(', ')}`);
            }

            return { 
                tracks, 
                title: compositionTitle, 
                description: compositionDescription,
                rawJson: rawJsonString // Return original JSON string
            };
        } catch (e) {
            console.error("Parsing failed. Raw text was:", text);
            throw new Error(`Failed to parse musical content: ${e.message}`);
        }
    }

    normalizeTrackType(trackType) {
        const lower = trackType.toLowerCase().replace(/[\s_-]/g, '');

        const reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr.replace(/[\s_-]/g, ''), full])
        );

        const map = {
            'bassline': 'bassline', 'bass': 'bassline',
            'chord': 'chord', 'chords': 'chord', 'padtextures': 'chord',
            'melody': 'melody', 'lead': 'melody',
            'arpeggio': 'arpeggio', 'arp': 'arpeggio',
            'plucks': 'plucks', 'pluck': 'plucks',
            'strings': 'strings', 'string': 'strings',
            'keys': 'keys', 'piano': 'keys',
            'guitar': 'guitar', 'padtextures': 'pad-textures',
            'brass': 'brass', 'percs': 'percs', 'drums': 'percs',
            ...reverseAbbrev
        };
        return map[lower] || lower;
    }

    /**
     * Parse a single note line (pitch,start,dur,vel)
     */
    parseNoteLine(line) {
        // Clean comments if present (e.g. # track_name)
        const cleanLine = line.split('#')[0].trim();
        const parts = cleanLine.split(',').map(p => p.trim());
        
        if (parts.length < 4) return null;

        const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
        const secondsPerBeat = 60 / bpm;

        try {
            const pitchStr = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocity = parseFloat(parts[3]);

            if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocity)) return null;

            // Convert Pitch (either MIDI number or note name like C4)
            let midiNote;
            if (!isNaN(parseInt(pitchStr))) {
                midiNote = parseInt(pitchStr);
            } else {
                midiNote = Tone.Frequency(pitchStr).toMidi();
            }

            // Normalize velocity to 0.1-1.0 range
            const normalizedVelocity = Math.max(0.1, Math.min(1.0, velocity));

            return {
                midi: midiNote,
                name: Tone.Frequency(midiNote, "midi").toNote(),
                time: startBeat * secondsPerBeat,
                duration: durationBeats * secondsPerBeat,
                velocity: normalizedVelocity
            };
        } catch (e) {
            console.warn(`Failed to parse note line: ${line}`, e);
            return null;
        }
    }

    createMidiObject(notes, bpm) {
        const midi = new Midi();
        const track = midi.addTrack();
        midi.header.setTempo(bpm);
        
        // Sort notes by time for proper MIDI ordering
        notes.sort((a, b) => a.time - b.time).forEach(n => {
            track.addNote({
                midi: n.midi,
                time: n.time,
                duration: n.duration,
                velocity: n.velocity
            });
        });
        return midi;
    }

    async generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt = '') {
        const generatedMidis = new Map();
        try {
            // Call the Edge Function
            const response = await fetchWithModelFallbacks('/api/generate', ['gemini-large', 'claude-large'], ui, {
                prompt: prompt,
                enhancedPrompt: enhancedPrompt,
                seed: Math.floor(Math.random() * 100000)
            });

            const responseText = await response.text();
            
            if (!responseText || responseText.trim().length === 0) {
                throw new Error('API returned empty response');
            }

            const { tracks, title, description, rawJson } = this.parseApiResponse(responseText, expectedTracks);

            const bpm = parseInt(document.getElementById('bpm')?.value) || 120;

            for (const [type, info] of tracks.entries()) {
                const midiObj = this.createMidiObject(info.notes, bpm);
                generatedMidis.set(type, {
                    midi: midiObj,
                    title: info.title,
                    description: info.description
                });
            }

            if (generatedMidis.size === 0) throw new Error("No tracks could be generated.");

            return { 
                tracks: generatedMidis, 
                compositionTitle: title, 
                compositionDescription: description,
                rawJson: rawJson // Return the raw JSON string
            };

        } catch (error) {
            console.error('Generation Error:', error);
            ui.showMessage(`Generation failed: ${error.message}`, 'error');
            throw error;
        }
    }
}

export async function generateMultiTrackMIDIFromAPI(prompt, ui, expectedTracks, enhancedPrompt = '') {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt);
}
