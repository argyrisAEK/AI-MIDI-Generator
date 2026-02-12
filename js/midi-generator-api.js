import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { trackAbbreviations } from './prompt-builder.js';

class MIDIGenerator {
    constructor() {
        this.generatedTracks = new Map();
    }

    normalizeTrackType(trackType) {
        const lower = trackType.toLowerCase().replace(/[\s_-]/g, '');
        
        // Reverse lookup from abbreviations
        const abbrToFull = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
        );
        
        const map = {
            'bassline': 'bassline', 'bass': 'bassline',
            'chord': 'chord', 'chords': 'chord', 'pad': 'chord',
            'melody': 'melody', 'lead': 'melody',
            'arpeggio': 'arpeggio', 'arp': 'arpeggio',
            'plucks': 'plucks', 'pluck': 'plucks',
            'strings': 'strings', 'str': 'strings',
            'keys': 'keys', 'key': 'keys',
            'guitar': 'guitar', 'gtr': 'guitar',
            'padtextures': 'pad-textures', 'pad-textures': 'pad-textures',
            'brass': 'brass', 'brs': 'brass',
            'percs': 'percs', 'perc': 'percs',
            ...abbrToFull
        };
        
        return map[lower] || lower;
    }

    parseApiResponse(text, expectedTracks) {
        console.log('[PARSER] Parsing response...');
        console.log('[PARSER] Expected tracks:', expectedTracks);
        
        const tracks = new Map();
        let compositionTitle = 'Untitled';
        let compositionDescription = '';
        let rawJsonString = text;

        try {
            let cleanJsonText = text.trim();

            // Remove markdown
            cleanJsonText = cleanJsonText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
            cleanJsonText = cleanJsonText.trim();

            // Extract JSON
            const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("No JSON object found in response");
            }
            cleanJsonText = jsonMatch[0];
            rawJsonString = cleanJsonText;

            // Fix common issues
            cleanJsonText = cleanJsonText.replace(/,\s*([\}\]])/g, '$1');
            cleanJsonText = this.fixDuplicateKeys(cleanJsonText);
            cleanJsonText = cleanJsonText.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
            cleanJsonText = cleanJsonText.replace(/'/g, '"');
            cleanJsonText = cleanJsonText.replace(/\\n/g, ' ').replace(/\\t/g, ' ');
            cleanJsonText = cleanJsonText.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

            console.log('[PARSER] Cleaned JSON (first 300 chars):', cleanJsonText.substring(0, 300));

            let rawJsonResponse;
            try {
                rawJsonResponse = JSON.parse(cleanJsonText);
            } catch (parseError) {
                console.warn('[PARSER] Standard parse failed, trying fallback...');
                rawJsonResponse = this.fallbackJsonParse(cleanJsonText);
            }

            // Extract metadata (short keys)
            compositionTitle = rawJsonResponse.t || rawJsonResponse.title || 'Untitled';
            compositionDescription = rawJsonResponse.d || rawJsonResponse.desc || rawJsonResponse.description || '';

            // Get tracks (short key 'trks' or 'tracks')
            let tracksData = rawJsonResponse.trks || rawJsonResponse.tracks || {};
            
            if (typeof tracksData !== 'object' || tracksData === null) {
                tracksData = {};
            }

            console.log('[PARSER] Raw tracks found:', Object.keys(tracksData));

            for (const [rawName, notesData] of Object.entries(tracksData)) {
                // Skip metadata fields
                if (['t', 'd', 'title', 'desc', 'description', 'k', 'key', 'bpm', 'ts', 'trks', 'tracks'].includes(rawName)) {
                    continue;
                }

                const normalizedName = this.normalizeTrackType(rawName);
                console.log(`[PARSER] Processing: "${rawName}" → "${normalizedName}"`);

                if (expectedTracks.includes(normalizedName)) {
                    const notes = this.parseHybridNotesData(notesData);
                    console.log(`[PARSER] ${normalizedName}: ${notes.length} notes parsed`);

                    if (notes.length > 0) {
                        tracks.set(normalizedName, {
                            notes: notes,
                            title: normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1),
                            description: `Generated ${normalizedName} sequence`
                        });
                    }
                } else {
                    console.warn(`[PARSER] Track "${rawName}" not in expected:`, expectedTracks);
                }
            }

            console.log('[PARSER] Final tracks:', Array.from(tracks.keys()));
            
            return { 
                tracks, 
                title: compositionTitle, 
                description: compositionDescription, 
                rawJson: rawJsonString 
            };

        } catch (e) {
            console.error("[PARSER] Failed:", text.substring(0, 500));
            console.error("[PARSER] Error:", e);
            throw new Error(`Failed to parse musical content: ${e.message}`);
        }
    }

    fixDuplicateKeys(jsonText) {
        const seenKeys = new Set();
        const lines = jsonText.split('\n');
        const result = [];
        
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const keyMatch = line.match(/^\s*"([^"]+)"\s*:/);
            
            if (keyMatch) {
                const key = keyMatch[1];
                if (seenKeys.has(key)) continue;
                seenKeys.add(key);
            }
            result.unshift(line);
        }
        
        return result.join('\n');
    }

    fallbackJsonParse(text) {
        console.log('[PARSER] Fallback parser');
        
        const result = { t: '', d: '', trks: {} };
        
        const titleMatch = text.match(/"t"\s*:\s*"([^"]+)"/) || text.match(/"title"\s*:\s*"([^"]+)"/);
        if (titleMatch) result.t = titleMatch[1];
        
        const descMatch = text.match(/"d"\s*:\s*"([^"]+)"/) || text.match(/"desc(?:ription)?"\s*:\s*"([^"]+)"/);
        if (descMatch) result.d = descMatch[1];
        
        // Match track data: "trackname":"note:data|note:data"
        const trackPattern = /"([a-z_]+)"\s*:\s*"([A-G0-9_,.:|~-]+)"/g;
        let match;
        while ((match = trackPattern.exec(text)) !== null) {
            const [, name, data] = match;
            if (!['t', 'd', 'title', 'desc', 'k', 'bpm', 'ts'].includes(name)) {
                result.trks[name] = data;
            }
        }
        
        return result;
    }

    /**
     * Parse hybrid format: note:bar.beat:dur:vel|note:bar.beat:dur:vel...
     * Supports:
     * - Single notes: C2:0.0:1:7
     * - Chords: C3,Eb3,G3:0.0:4:5
     * - Rests: _:0.0:1:0
     */
    parseHybridNotesData(notesData) {
        const notes = [];

        if (!notesData || typeof notesData !== 'string' || notesData.trim().length === 0) {
            console.warn('[PARSER] Empty notes data');
            return notes;
        }

        const entries = notesData.split('|').filter(e => e.trim().length > 0);
        console.log(`[PARSER] Hybrid format: ${entries.length} entries`);

        const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
        const secondsPerBeat = 60 / bpm;

        entries.forEach((entry, idx) => {
            try {
                const parsed = this.parseHybridEntry(entry.trim(), secondsPerBeat);
                if (parsed) {
                    if (Array.isArray(parsed)) {
                        notes.push(...parsed);
                    } else {
                        notes.push(parsed);
                    }
                }
            } catch (e) {
                console.warn(`[PARSER] Entry ${idx} failed: "${entry}"`, e.message);
            }
        });

        return notes;
    }

    parseHybridEntry(entry, secondsPerBeat) {
        const parts = entry.split(':');
        if (parts.length !== 4) {
            console.warn(`[PARSER] Invalid entry format (expected 4 parts): ${entry}`);
            return null;
        }

        const [pitchStr, timeStr, durStr, velStr] = parts;

        // Handle rest
        if (pitchStr === '_' || pitchStr === '-') {
            return null;
        }

        // Parse time: bar.beat
        const [barStr, beatStr = '0'] = timeStr.split('.');
        const bar = parseInt(barStr) || 0;
        const beat = parseFloat('0.' + beatStr) || 0; // 0.5 = beat 2, 0.75 = beat 3.75
        const totalBeats = bar * 4 + beat * 4; // Convert to quarter notes
        const time = totalBeats * secondsPerBeat;

        // Parse duration
        const durationBeats = parseFloat(durStr);
        const duration = durationBeats * secondsPerBeat;

        // Parse velocity (1-9 → 0.11-1.0)
        const velRaw = parseInt(velStr) || 5;
        const velocity = Math.max(0.1, Math.min(1.0, velRaw / 9));

        // Handle chords (comma-separated)
        if (pitchStr.includes(',')) {
            const pitches = pitchStr.split(',').map(p => p.trim());
            return pitches.map(p => this.createNote(p, time, duration, velocity));
        }

        return this.createNote(pitchStr, time, duration, velocity);
    }

    createNote(pitch, time, duration, velocity) {
        // Validate pitch
        let midi;
        try {
            if (/^\d+$/.test(pitch)) {
                midi = parseInt(pitch);
            } else {
                midi = Tone.Frequency(pitch).toMidi();
            }
        } catch (e) {
            console.warn(`[PARSER] Invalid pitch: ${pitch}`);
            return null;
        }

        if (isNaN(midi) || midi < 0 || midi > 127) {
            console.warn(`[PARSER] MIDI out of range: ${pitch} = ${midi}`);
            return null;
        }

        return {
            midi,
            name: Tone.Frequency(midi, "midi").toNote(),
            time,
            duration,
            velocity
        };
    }

    createMidiObject(notes, bpm) {
        const midi = new Midi();
        const track = midi.addTrack();
        midi.header.setTempo(bpm);
        
        // Sort by time
        notes.sort((a, b) => a.time - b.time);
        
        notes.forEach(n => {
            if (n && n.midi >= 0 && n.midi <= 127) {
                track.addNote({ 
                    midi: n.midi, 
                    time: n.time, 
                    duration: n.duration, 
                    velocity: n.velocity 
                });
            }
        });
        
        return midi;
    }

    async readStreamingResponse(response, ui) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assembled = '';
        let chunkCount = 0;

        console.log('[STREAM] Starting to read...');

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const textChunk = decoder.decode(value, { stream: true });
                assembled += textChunk;
                chunkCount++;

                if (ui?.onStreamProgress) {
                    ui.onStreamProgress(assembled);
                }
            }
        } finally {
            reader.releaseLock();
        }

        console.log(`[STREAM] Done: ${chunkCount} chunks, ${assembled.length} chars`);
        return assembled;
    }

    async generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt = '') {
        const generatedMidis = new Map();
        
        try {
            console.log('[MIDI-GEN] Starting generation...');
            console.log('[MIDI-GEN] Expected:', expectedTracks);

            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    model: 'openai-large',
                    stream: true,
                    enhancedPrompt,
                    style: prompt.match(/sty=(\w+)/)?.[1] || 'house'
                })
            });

            console.log('[MIDI-GEN] Status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }

            const fullText = await this.readStreamingResponse(response, ui);

            if (!fullText || fullText.trim().length === 0) {
                throw new Error('AI returned empty response');
            }

            const { tracks, title, description, rawJson } = this.parseApiResponse(fullText, expectedTracks);
            const bpm = parseInt(document.getElementById('bpm')?.value) || 120;

            console.log('[MIDI-GEN] Parsed tracks:', Array.from(tracks.keys()));

            for (const [type, info] of tracks.entries()) {
                generatedMidis.set(type, {
                    midi: this.createMidiObject(info.notes, bpm),
                    title: info.title,
                    description: info.description
                });
            }

            if (generatedMidis.size === 0) {
                throw new Error("No tracks generated from AI response");
            }

            return { 
                tracks: generatedMidis, 
                compositionTitle: title, 
                compositionDescription: description, 
                rawJson 
            };

        } catch (error) {
            console.error('[MIDI-GEN] Error:', error);
            ui.showMessage(`Error: ${error.message}`, 'error');
            throw error;
        }
    }
}

export async function generateMultiTrackMIDIFromAPI(prompt, ui, expectedTracks, enhancedPrompt = '') {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt);
}
