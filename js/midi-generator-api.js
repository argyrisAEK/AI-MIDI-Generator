import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { trackAbbreviations } from './prompt-builder.js';

class MIDIGenerator {
    constructor() {
        this.generatedTracks = new Map();
    }

    parseApiResponse(text, expectedTracks) {
        console.log('[PARSER] Parsing response...');
        const tracks = new Map();
        let compositionTitle = 'Untitled';
        let compositionDescription = '';
        let rawJsonString = text;

        try {
            let cleanJsonText = text.trim();
            
            // ✅ Αφαίρεσε markdown code blocks (```json...```)
            cleanJsonText = cleanJsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            cleanJsonText = cleanJsonText.trim();
            
            // ✅ Εξάγε το JSON object αν είναι ενσωματωμένο σε κείμενο
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
                }
            }
            return { tracks, title: compositionTitle, description: compositionDescription, rawJson: rawJsonString };
        } catch (e) {
            console.error("[PARSER] Failed:", text);
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

    parseNoteLine(line) {
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

            let midiNote = !isNaN(parseInt(pitchStr)) ? parseInt(pitchStr) : Tone.Frequency(pitchStr).toMidi();
            const normalizedVelocity = Math.max(0.1, Math.min(1.0, velocity));

            return {
                midi: midiNote,
                name: Tone.Frequency(midiNote, "midi").toNote(),
                time: startBeat * secondsPerBeat,
                duration: durationBeats * secondsPerBeat,
                velocity: normalizedVelocity
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
            const timeoutId = setTimeout(() => controller.abort(), 55000); // 55 seconds

            console.log('[MIDI-GEN] Calling /api/generate...');

            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, model: 'claude-large', enhancedPrompt }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            console.log('[MIDI-GEN] Response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[MIDI-GEN] API error:', errorText);
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }

            if (!response.body) {
                throw new Error('API returned empty body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullText = "";
            let done = false;

            console.log('[MIDI-GEN] Starting to read stream...');

            let buffer = '';
            let chunkCount = 0;

            while (!done) {
                try {
                    const { value, done: doneReading } = await reader.read();
                    done = doneReading;
                    
                    if (value) {
                        chunkCount++;
                        const chunk = decoder.decode(value, { stream: true });
                        buffer += chunk;
                        
                        console.log(`[MIDI-GEN] Chunk ${chunkCount}: ${chunk.length} bytes, buffer size: ${buffer.length}`);
                        
                        // Split by \n\n to find complete SSE events
                        const eventBoundary = buffer.lastIndexOf('\n\n');
                        
                        if (eventBoundary !== -1) {
                            // Process all complete events
                            const completeBuffer = buffer.substring(0, eventBoundary);
                            const events = completeBuffer.split('\n\n');
                            
                            for (const event of events) {
                                const lines = event.split('\n').filter(l => l.trim());
                                
                                for (const line of lines) {
                                    const trimmed = line.trim();
                                    
                                    if (!trimmed || trimmed === '[DONE]') {
                                        continue;
                                    }

                                    // Parse SSE format: "data: {...}"
                                    if (trimmed.startsWith('data: ')) {
                                        const dataStr = trimmed.slice(6);
                                        
                                        try {
                                            const data = JSON.parse(dataStr);
                                            
                                            if (data.error) {
                                                throw new Error(`API error: ${data.error}`);
                                            }
                                            
                                            // Extract content - συντομία του line, όχι ολόκληρη σειρά
                                            if (data.content) {
                                                fullText += data.content;
                                            }
                                        } catch (parseErr) {
                                            console.warn('[MIDI-GEN] SSE parse error:', parseErr.message);
                                        }
                                    }
                                }
                            }
                            
                            // Keep only the incomplete part for next iteration
                            buffer = buffer.substring(eventBoundary + 2);
                        }
                    }
                } catch (readError) {
                    if (readError.name === 'AbortError') {
                        throw new Error('Request timeout');
                    }
                    throw readError;
                }
            }

            // Process any remaining buffer (last incomplete event)
            if (buffer.trim()) {
                console.log('[MIDI-GEN] Processing remaining buffer:', buffer.length, 'bytes');
                const lines = buffer.split('\n').filter(l => l.trim());
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        const dataStr = line.slice(6);
                        try {
                            const data = JSON.parse(dataStr);
                            if (data.content) {
                                fullText += data.content;
                            }
                        } catch (e) {
                            console.warn('[MIDI-GEN] Final buffer parse error:', e.message);
                        }
                    }
                }
            }

            console.log('[MIDI-GEN] Accumulated text length:', fullText.length);

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
