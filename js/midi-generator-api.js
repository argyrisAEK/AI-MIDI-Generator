import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { trackAbbreviations } from './prompt-builder.js';

class MIDIGenerator {
    constructor() {
        this.generatedTracks = new Map();
    }

    normalizeTrackType(trackType) {
        const lower = trackType.toLowerCase().replace(/[\s_-]/g, '');
        const reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr.replace(/[\s_-]/g, ''), full])
        );
        const map = {
            'bassline': 'bassline', 'bass': 'bassline',
            'chord': 'chord', 'chords': 'chord',
            'melody': 'melody', 'lead': 'melody',
            'arpeggio': 'arpeggio', 'arp': 'arpeggio',
            'plucks': 'plucks', 'strings': 'strings',
            'keys': 'keys', 'guitar': 'guitar', 'padtextures': 'pad-textures',
            'brass': 'brass', 'percs': 'percs',
            ...reverseAbbrev
        };
        return map[lower] || lower;
    }

    parseApiResponse(text, expectedTracks) {
        console.log('[PARSER] Parsing response...');
        const tracks = new Map();
        let compositionTitle = 'Untitled';
        let compositionDescription = '';
        let rawJsonString = text;

        try {
            let cleanJsonText = text.trim();
            
            // ✅ Remove markdown code blocks (```json...```)
            cleanJsonText = cleanJsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            cleanJsonText = cleanJsonText.trim();
            
            // ✅ Extract JSON object if embedded in text
            const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanJsonText = jsonMatch[0];
                rawJsonString = cleanJsonText;
            }

            console.log('[PARSER] Cleaned JSON (first 200 chars):', cleanJsonText.substring(0, 200));

            const rawJsonResponse = JSON.parse(cleanJsonText);
            compositionTitle = rawJsonResponse.title || compositionTitle;
            compositionDescription = rawJsonResponse.description || rawJsonResponse.desc || '';

            if (!rawJsonResponse.tracks) {
                throw new Error("No 'tracks' object found in JSON.");
            }

            for (const [rawName, notesData] of Object.entries(rawJsonResponse.tracks)) {
                const normalizedName = this.normalizeTrackType(rawName);
                console.log(`[PARSER] Track: ${rawName} → ${normalizedName}, Expected: ${expectedTracks.join(', ')}`);
                
                if (expectedTracks.includes(normalizedName)) {
                    // ✅ DUAL PARSER: Support both formats
                    const notes = this.parseNotesData(notesData);
                    console.log(`[PARSER] ${normalizedName}: ${notes.length} notes parsed`);

                    if (notes.length > 0) {
                        tracks.set(normalizedName, {
                            notes: notes,
                            title: normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1),
                            description: `Generated ${normalizedName} sequence`
                        });
                    }
                }
            }
            return { tracks, title: compositionTitle, description: compositionDescription, rawJson: rawJsonString };
        } catch (e) {
            console.error("[PARSER] Failed:", text);
            console.error("[PARSER] Error details:", e);
            throw new Error(`Failed to parse musical content: ${e.message}`);
        }
    }

    /**
     * Dual parser supporting both formats:
     * COMPACT (new):  "50:2.5:.5:9|60:3:.5:8|..."
     * LEGACY (old):   "50,2.5,0.5,0.95\n60,3,0.5,0.8\n..."
     */
 parseNotesData(notesData) {
    const notes = [];
    if (!notesData || typeof notesData !== 'string') return notes;

    const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
    const beatsPerBar = 4; // Μπορείς να το πάρεις δυναμικά από το UI αν θες

    // Διαχωρισμός ανά μέτρο (bars)
    const bars = notesData.split('/');
    
    bars.forEach((barContent, barIndex) => {
        const entries = barContent.split('|').filter(e => e.trim().length > 0);
        
        entries.forEach(entry => {
            const note = this.parseCompactNoteLine(entry.trim());
            if (note) {
                // Υπολογισμός πραγματικού χρόνου: (Beat μέτρου) + (Index μέτρου * beats ανά μέτρο)
                const barOffset = barIndex * beatsPerBar;
                const absoluteStartTimeInBeats = (note.rawStartBeat) + barOffset;
                
                // Ενημέρωση του time σε seconds
                const secondsPerBeat = 60 / bpm;
                note.time = absoluteStartTimeInBeats * secondsPerBeat;
                
                notes.push(note);
            }
        });
    });

    return notes;
}

    /**
     * Parse COMPACT format: "50:2.5:.5:9"
     * pitch:beat:duration:velocity(1-9)
     */
  parseCompactNoteLine(line) {
    const cleanLine = line.split('#')[0].trim();
    const parts = cleanLine.split(':').map(p => p.trim());
    
    if (parts.length < 4) {
        console.warn(`[PARSER] Compact line incomplete: ${line}`);
        return null;
    }

    try {
        const pitchStr = parts[0];
        const startBeat = parseFloat(parts[1]); // Αυτό είναι το rawStartBeat
        const durationBeats = parseFloat(parts[2]);
        const velocityRaw = parseInt(parts[3]);

        if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocityRaw)) {
            return null;
        }

        const normalizedVelocity = Math.max(0.1, Math.min(0.9, velocityRaw / 10));

        let midiNote = !isNaN(parseInt(pitchStr)) 
            ? parseInt(pitchStr) 
            : Tone.Frequency(pitchStr).toMidi();

        if (isNaN(midiNote)) return null;

        return {
            midi: midiNote,
            name: Tone.Frequency(midiNote, "midi").toNote(),
            rawStartBeat: startBeat, // Επιστρέφουμε το float beat για τον υπολογισμό των bars
            durationBeats: durationBeats, // Το κρατάμε σε beats για ομοιομορφία
            velocity: normalizedVelocity
        };
    } catch (e) {
        return null;
    }
}

    /**
     * Parse LEGACY format: "50,2.5,0.5,0.95"
     * pitch,beat,duration,velocity
     */
    parseLegacyNoteLine(line) {
        const cleanLine = line.split('#')[0].trim();
        const parts = cleanLine.split(',').map(p => p.trim());
        
        if (parts.length < 4) {
            console.warn(`[PARSER] Legacy line skipped (invalid): ${line}`);
            return null;
        }

        const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
        const secondsPerBeat = 60 / bpm;

        try {
            const pitchStr = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocity = parseFloat(parts[3]);

            if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocity)) {
                console.warn(`[PARSER] Legacy line skipped (NaN): ${line}`);
                return null;
            }

            let midiNote = !isNaN(parseInt(pitchStr)) ? parseInt(pitchStr) : Tone.Frequency(pitchStr).toMidi();
            const normalizedVelocity = Math.max(0.1, Math.min(1.0, velocity));

            return {
                midi: midiNote,
                name: Tone.Frequency(midiNote, "midi").toNote(),
                time: startBeat * secondsPerBeat,
                duration: durationBeats * secondsPerBeat,
                velocity: normalizedVelocity
            };
        } catch (e) {
            console.warn(`[PARSER] Error parsing legacy note: ${line}`, e);
            return null;
        }
    }

    createMidiObject(notes, bpm) {
        const midi = new Midi();
        const track = midi.addTrack();
        midi.header.setTempo(bpm);
        notes.sort((a, b) => a.time - b.time).forEach(n => {
            track.addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
        });
        return midi;
    }

    async generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt = '') {
        const generatedMidis = new Map();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 45000); // 55 seconds

            console.log('[MIDI-GEN] Calling /api/generate...');

            const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        prompt, 
        model: 'openai',      // ← CHANGED
        enhancedPrompt,
        reasoning: false      // ← ADDED (disable reasoning)
    }),
    signal: controller.signal
});
            clearTimeout(timeoutId);

            console.log('[MIDI-GEN] Response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[MIDI-GEN] API error:', errorText);
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }

            // ✅ Parse JSON response
            const data = await response.json();
            console.log('[MIDI-GEN] Received JSON response');

            if (data.error) {
                throw new Error(`API error: ${data.error}`);
            }

            const fullText = data.content || '';

            if (!fullText || fullText.trim().length === 0) {
                throw new Error('AI returned empty response');
            }

            const { tracks, title, description, rawJson } = this.parseApiResponse(fullText, expectedTracks);
            const bpm = parseInt(document.getElementById('bpm')?.value) || 120;

            for (const [type, info] of tracks.entries()) {
                generatedMidis.set(type, {
                    midi: this.createMidiObject(info.notes, bpm),
                    title: info.title,
                    description: info.description
                });
            }

            if (generatedMidis.size === 0) {
                throw new Error("No tracks generated from the AI response.");
            }

            return { tracks: generatedMidis, compositionTitle: title, compositionDescription: description, rawJson };

        } catch (error) {
            console.error('[MIDI-GEN] Error:', error.message);
            ui.showMessage(`Error: ${error.message}`, 'error');
            throw error;
        }
    }
}

export async function generateMultiTrackMIDIFromAPI(prompt, ui, expectedTracks, enhancedPrompt = '') {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt);
}
