import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';

class MIDIGenerator {
    constructor() {
        this.generatedTracks = new Map();
    }

    /**
     * ΕΠΑΝΑΦΟΡΑ: Η αξιόπιστη μέθοδος καθαρισμού JSON από τον αρχικό σου κώδικα
     */
    parseApiResponse(text, expectedTracks) {
        console.log('Attempting to parse AI response…');
        const tracks = new Map();
        let compositionTitle = 'Untitled';
        let compositionDescription = '';

        try {
            // 1. Καθαρισμός του κειμένου από Markdown (```json ... ```) ή πρόλογο
            let cleanJsonText = text.trim();
            const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanJsonText = jsonMatch[0];
            }

            const rawJsonResponse = JSON.parse(cleanJsonText);
            compositionTitle = rawJsonResponse.title || compositionTitle;
            compositionDescription = rawJsonResponse.description || '';

            if (!rawJsonResponse.tracks) {
                throw new Error("No 'tracks' object found in JSON.");
            }

            // 2. Επεξεργασία κάθε track με την αρχική σου λογική
            for (const [rawName, notesData] of Object.entries(rawJsonResponse.tracks)) {
                const normalizedName = this.normalizeTrackType(rawName);
                
                // Φιλτράρισμα: Κρατάμε μόνο όσα tracks ζήτησε ο χρήστης
                if (expectedTracks.includes(normalizedName)) {
                    const lines = notesData.split('\n').filter(line => line.trim().length > 0);
                    const notes = lines
                        .map(line => this.parseNoteLine(line))
                        .filter(note => note !== null);

                    if (notes.length > 0) {
                        tracks.set(normalizedName, {
                            notes: notes,
                            title: normalizedName.toUpperCase(),
                            description: `Generated ${normalizedName} sequence`
                        });
                    }
                }
            }

            return { tracks, title: compositionTitle, description: compositionDescription };
        } catch (e) {
            console.error("Parsing failed. Raw text was:", text);
            throw new Error(`Failed to parse musical content: ${e.message}`);
        }
    }

    /**
     * ΕΠΑΝΑΦΟΡΑ: Η αρχική σου μέθοδος normalize
     */
    normalizeTrackType(trackType) {
        const lower = trackType.toLowerCase().replace(/[\s_-]/g, '');
        const map = {
            'bassline': 'bassline', 'bass': 'bassline',
            'chord': 'chord', 'chords': 'chord', 'pad': 'chord',
            'melody': 'melody', 'lead': 'melody',
            'arpeggio': 'arpeggio', 'arp': 'arpeggio',
            'plucks': 'plucks', 'pluck': 'plucks',
            'strings': 'strings', 'string': 'strings',
            'keys': 'keys', 'piano': 'keys',
            'guitar': 'guitar', 'padtextures': 'pad-textures',
            'brass': 'brass', 'percs': 'percs', 'drums': 'percs'
        };
        return map[lower] || lower;
    }

    /**
     * ΕΠΑΝΑΦΟΡΑ: Η ακριβής λογική μετατροπής γραμμής σε νότα (pitch,start,dur,vel)
     */
    parseNoteLine(line) {
        // Καθαρισμός σχολίων αν υπάρχουν (π.χ. # track_name)
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

            // Μετατροπή Pitch (είτε είναι MIDI νούμερο είτε όνομα νότας π.χ. C4)
            let midiNote;
            if (!isNaN(parseInt(pitchStr))) {
                midiNote = parseInt(pitchStr);
            } else {
                midiNote = Tone.Frequency(pitchStr).toMidi();
            }

            return {
                midi: midiNote,
                name: Tone.Frequency(midiNote, "midi").toNote(),
                time: startBeat * secondsPerBeat,
                duration: durationBeats * secondsPerBeat,
                velocity: Math.min(Math.max(velocity, 0.1), 1.0)
            };
        } catch (e) {
            return null;
        }
    }

    createMidiObject(notes, bpm) {
        const midi = new Midi();
        const track = midi.addTrack();
        midi.header.setTempo(bpm);
        notes.forEach(n => {
            track.addNote({
                midi: n.midi,
                time: n.time,
                duration: n.duration,
                velocity: n.velocity
            });
        });
        return midi;
    }

    async generateMultiTrackMIDI(prompt, ui, expectedTracks) {
        const generatedMidis = new Map();
        try {
            // Κλήση στην Edge Function (με streaming πλέον)
            const response = await fetchWithModelFallbacks('/api/generate', ['gemini', 'gemini-large'], ui, {
                prompt: prompt,
                seed: Math.floor(Math.random() * 100000)
            });

            const responseText = await response.text();
            const { tracks, title, description } = this.parseApiResponse(responseText, expectedTracks);

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

            return { tracks: generatedMidis, compositionTitle: title, compositionDescription: description };

        } catch (error) {
            ui.showMessage(`Generation failed: ${error.message}`, 'error');
            throw error;
        }
    }
}

export async function generateMultiTrackMIDIFromAPI(prompt, ui, expectedTracks) {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(prompt, ui, expectedTracks);
}
