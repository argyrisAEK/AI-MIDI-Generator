import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';
import { trackAbbreviations } from './prompt-builder.js';

class MIDIGenerator {
    constructor() {
        this.generatedTracks = new Map();
    }

    parseApiResponse(text, expectedTracks) {
        console.log('Parsing AI response...');
        const tracks = new Map();
        let compositionTitle = 'Untitled';
        let compositionDescription = '';
        let rawJsonString = text;

        try {
            let cleanJsonText = text.trim();
            const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanJsonText = jsonMatch[0];
                rawJsonString = cleanJsonText;
            }

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

    // FIXED: Proper streaming with timeout handling
    async generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt = '') {
        const generatedMidis = new Map();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 58000); // 58 seconds (Vercel limit is 60)

            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, model: 'gemini-large', enhancedPrompt }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API error response:', errorText);
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }

            if (!response.body) {
                throw new Error('API returned empty body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullText = "";
            let done = false;

            console.log('Starting to read stream...');

            while (!done) {
                try {
                    const { value, done: doneReading } = await reader.read();
                    done = doneReading;
                    
                    if (value) {
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n');
                        
                        console.log('[CLIENT] Received chunk:', chunk.substring(0, 200));
                        
                        for (const line of lines) {
                            const trimmed = line.trim();
                            
                            // Skip empty lines and [DONE] marker
                            if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
                                continue;
                            }

                            // Parse SSE format: "data: {...}"
                            let dataStr = trimmed;
                            if (trimmed.startsWith('data: ')) {
                                dataStr = trimmed.slice(6);
                            }
                            
                            // Try to parse as JSON
                            try {
                                const data = JSON.parse(dataStr);
                                
                                // Check for errors in the data
                                if (data.error) {
                                    throw new Error(`API returned error: ${data.error}`);
                                }
                                
                                // Extract content from different response formats
                                if (data.choices?.[0]?.delta?.content) {
                                    console.log('[CLIENT] Got delta content');
                                    fullText += data.choices[0].delta.content;
                                } else if (data.choices?.[0]?.message?.content) {
                                    console.log('[CLIENT] Got message content');
                                    fullText += data.choices[0].message.content;
                                } else if (data.content) {
                                    console.log('[CLIENT] Got content field');
                                    fullText += data.content;
                                } else if (data.tracks) {
                                    // Direct JSON response with tracks
                                    console.log('[CLIENT] Got direct tracks response');
                                    fullText += JSON.stringify(data);
                                } else {
                                    console.log('[CLIENT] Unknown data format:', Object.keys(data));
                                }
                            } catch (parseErr) {
                                console.warn('[CLIENT] Could not parse JSON, treating as raw text:', dataStr.substring(0, 100));
                                // If not JSON, just accumulate as text
                                if (dataStr.trim().length > 0) {
                                    fullText += dataStr;
                                }
                            }
                        }
                    }
                } catch (readError) {
                    if (readError.name === 'AbortError') {
                        throw new Error('Request timeout - took too long to generate');
                    }
                    throw readError;
                }
            }

            console.log('Stream complete. Accumulated text length:', fullText.length);

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
            console.error('Generation error:', error.message);
            ui.showMessage(`Error: ${error.message}`, 'error');
            throw error;
        }
    }
}

export async function generateMultiTrackMIDIFromAPI(prompt, ui, expectedTracks, enhancedPrompt = '') {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt);
}
