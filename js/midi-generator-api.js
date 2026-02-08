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

    /**
     * Hardened Parser: Προσπαθεί να καθαρίσει και να διορθώσει το JSON του AI
     */
    parseApiResponse(text, expectedTracks) {
        console.log('[PARSER] Attempting to parse text length:', text.length);
        
        let cleanJsonText = text.trim();

        // 1. Αφαίρεση Markdown blocks αν υπάρχουν
        cleanJsonText = cleanJsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');

        // 2. Διόρθωση συνηθισμένων συντακτικών λαθών του LLM (σαν αυτό που είδαμε στο log)
        cleanJsonText = cleanJsonText.replace(/"tracks"\s*\{/g, '"tracks": {'); // Fix: missing colon
        cleanJsonText = cleanJsonText.replace(/""\s*:\s*"/g, '"description": "'); // Fix: empty key

        // 3. Εντοπισμός του κυρίως JSON αντικειμένου
        const firstBrace = cleanJsonText.indexOf('{');
        if (firstBrace !== -1) {
            cleanJsonText = cleanJsonText.substring(firstBrace);
        } else {
            cleanJsonText = '{' + cleanJsonText; // Force start
        }

        // 4. Auto-close JSON: Αν το stream κόπηκε απότομα, προσθέτουμε αγκύλες
        let rawJsonResponse = null;
        let attempts = 0;
        let tempText = cleanJsonText;

        while (attempts < 5) {
            try {
                rawJsonResponse = JSON.parse(tempText);
                cleanJsonText = tempText; // Update working text on success
                break;
            } catch (e) {
                tempText += "}";
                attempts++;
                if (attempts === 5) {
                    console.error("[PARSER] Last failed attempt text:", tempText);
                    throw new Error(`Invalid JSON structure even after fixes: ${e.message}`);
                }
            }
        }

        // 5. Επεξεργασία των δεδομένων
        const tracks = new Map();
        const compositionTitle = rawJsonResponse.title || 'Untitled';
        const compositionDescription = rawJsonResponse.description || rawJsonResponse.desc || '';

        if (!rawJsonResponse.tracks) {
            throw new Error("No 'tracks' object found in the fixed JSON.");
        }

        for (const [rawName, notesData] of Object.entries(rawJsonResponse.tracks)) {
            const normalizedName = this.normalizeTrackType(rawName);
            
            if (expectedTracks.includes(normalizedName)) {
                const notes = this.parseNotesData(notesData);
                if (notes.length > 0) {
                    tracks.set(normalizedName, {
                        notes: notes,
                        title: normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1),
                        description: `Generated ${normalizedName} sequence`
                    });
                }
            }
        }

        return { tracks, title: compositionTitle, description: compositionDescription, rawJson: cleanJsonText };
    }

    parseNotesData(notesData) {
        const notes = [];
        if (!notesData || typeof notesData !== 'string') return notes;
        
        const isCompact = notesData.includes('|') || (notesData.includes(':') && !notesData.includes(','));

        try {
            if (isCompact) {
                const entries = notesData.split('|').filter(e => e.trim().length > 0);
                entries.forEach(entry => {
                    const note = this.parseCompactNoteLine(entry.trim());
                    if (note) notes.push(note);
                });
            } else {
                const lines = notesData.split('\n').filter(line => line.trim().length > 0);
                lines.forEach(line => {
                    const note = this.parseLegacyNoteLine(line);
                    if (note) notes.push(note);
                });
            }
        } catch (e) {
            console.error('[PARSER] Error in notes extraction:', e);
        }
        return notes;
    }

    parseCompactNoteLine(line) {
        const parts = line.split(':').map(p => p.trim());
        if (parts.length < 4) return null;

        const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
        const secondsPerBeat = 60 / bpm;

        try {
            const pitchStr = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocityRaw = parseInt(parts[3]);

            const normalizedVelocity = Math.max(0.1, Math.min(0.9, velocityRaw / 10));
            let midiNote = !isNaN(parseInt(pitchStr)) ? parseInt(pitchStr) : Tone.Frequency(pitchStr).toMidi();

            return {
                midi: midiNote,
                name: Tone.Frequency(midiNote, "midi").toNote(),
                time: startBeat * secondsPerBeat,
                duration: durationBeats * secondsPerBeat,
                velocity: normalizedVelocity
            };
        } catch (e) { return null; }
    }

    parseLegacyNoteLine(line) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 4) return null;

        const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
        const secondsPerBeat = 60 / bpm;

        try {
            const pitchStr = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocity = parseFloat(parts[3]);

            let midiNote = !isNaN(parseInt(pitchStr)) ? parseInt(pitchStr) : Tone.Frequency(pitchStr).toMidi();
            return {
                midi: midiNote,
                name: Tone.Frequency(midiNote, "midi").toNote(),
                time: startBeat * secondsPerBeat,
                duration: durationBeats * secondsPerBeat,
                velocity: Math.max(0.1, Math.min(1.0, velocity))
            };
        } catch (e) { return null; }
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
            const timeoutId = setTimeout(() => controller.abort(), 58000); 

            console.log('[MIDI-GEN] Starting Stream from /api/generate...');

            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    prompt, 
                    model: 'openai',
                    enhancedPrompt,
                    reasoning: false
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }

            // --- STREAMING LOGIC ---
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedContent = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine.startsWith('data: ')) continue;
                    
                    const dataStr = trimmedLine.replace('data: ', '');
                    if (dataStr === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(dataStr);
                        const delta = parsed.choices?.[0]?.delta?.content || "";
                        accumulatedContent += delta;
                        
                        // Προαιρετικά: Ενημέρωση UI για το "γράψιμο"
                        if (ui && ui.showProgress) ui.showProgress(accumulatedContent.length);
                    } catch (e) { /* ignore chunk errors */ }
                }
            }

            console.log('[MIDI-GEN] Stream complete. Processing JSON...');

            const { tracks, title, description, rawJson } = this.parseApiResponse(accumulatedContent, expectedTracks);
            const bpm = parseInt(document.getElementById('bpm')?.value) || 120;

            for (const [type, info] of tracks.entries()) {
                generatedMidis.set(type, {
                    midi: this.createMidiObject(info.notes, bpm),
                    title: info.title,
                    description: info.description
                });
            }

            if (generatedMidis.size === 0) {
                throw new Error("AI output was valid but no matching tracks were found.");
            }

            return { tracks: generatedMidis, compositionTitle: title, compositionDescription: description, rawJson };

        } catch (error) {
            console.error('[MIDI-GEN] Error:', error.message);
            if (ui && ui.showMessage) ui.showMessage(`Error: ${error.message}`, 'error');
            throw error;
        }
    }
}

export async function generateMultiTrackMIDIFromAPI(prompt, ui, expectedTracks, enhancedPrompt = '') {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt);
}
