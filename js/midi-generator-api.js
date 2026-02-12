import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { trackAbbreviations } from './prompt-builder.js';

class MIDIGenerator {
    constructor() {
        this.generatedTracks = new Map();
    }

    normalizeTrackType(trackType) {
        const lower = trackType.toLowerCase().replace(/[\s_-]/g, '');
        console.log(`[NORMALIZE] Input: "${trackType}" → Lower: "${lower}"`);
        
        const reverseAbbrev = Object.fromEntries(
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
            ...reverseAbbrev
        };
        
        const result = map[lower] || lower;
        console.log(`[NORMALIZE] Result: "${result}"`);
        return result;
    }

    parseApiResponse(text, expectedTracks) {
        console.log('[PARSER] ==========================================');
        console.log('[PARSER] Starting parse...');
        console.log('[PARSER] Raw text length:', text.length);
        console.log('[PARSER] Raw text (first 500 chars):', text.substring(0, 500));
        console.log('[PARSER] Raw text (last 200 chars):', text.slice(-200));
        console.log('[PARSER] Expected tracks:', expectedTracks);
        console.log('[PARSER] ==========================================');
        
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
                console.error('[PARSER] No JSON match found!');
                console.error('[PARSER] Clean text:', cleanJsonText.substring(0, 200));
                throw new Error("No JSON object found in response");
            }
            
            cleanJsonText = jsonMatch[0];
            rawJsonString = cleanJsonText;
            
            console.log('[PARSER] Extracted JSON length:', cleanJsonText.length);
            console.log('[PARSER] Extracted JSON (first 300 chars):', cleanJsonText.substring(0, 300));

            // Fix common issues
            cleanJsonText = cleanJsonText.replace(/,\s*([\}\]])/g, '$1');
            cleanJsonText = this.fixDuplicateKeys(cleanJsonText);
            cleanJsonText = cleanJsonText.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
            cleanJsonText = cleanJsonText.replace(/'/g, '"');
            cleanJsonText = cleanJsonText.replace(/\\n/g, ' ').replace(/\\t/g, ' ');
            cleanJsonText = cleanJsonText.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

            console.log('[PARSER] Cleaned JSON for parsing:', cleanJsonText.substring(0, 400));

            let rawJsonResponse;
            try {
                rawJsonResponse = JSON.parse(cleanJsonText);
                console.log('[PARSER] JSON parsed successfully');
                console.log('[PARSER] Parsed keys:', Object.keys(rawJsonResponse));
            } catch (parseError) {
                console.error('[PARSER] JSON parse error:', parseError.message);
                console.error('[PARSER] Failed text:', cleanJsonText.substring(0, 300));
                throw new Error(`JSON parse failed: ${parseError.message}`);
            }

            // Extract metadata (short keys)
            compositionTitle = rawJsonResponse.t || rawJsonResponse.title || 'Untitled';
            compositionDescription = rawJsonResponse.d || rawJsonResponse.desc || rawJsonResponse.description || '';
            
            console.log('[PARSER] Title:', compositionTitle);
            console.log('[PARSER] Description:', compositionDescription);

            // Get tracks (short key 'trks' or 'tracks')
            let tracksData = rawJsonResponse.trks || rawJsonResponse.tracks || {};
            
            console.log('[PARSER] tracksData type:', typeof tracksData);
            console.log('[PARSER] tracksData keys:', Object.keys(tracksData));
            console.log('[PARSER] tracksData:', JSON.stringify(tracksData).substring(0, 500));

            if (typeof tracksData !== 'object' || tracksData === null) {
                console.error('[PARSER] tracksData is not an object!');
                throw new Error('Tracks data is not an object');
            }

            if (Object.keys(tracksData).length === 0) {
                console.error('[PARSER] tracksData is empty!');
                throw new Error('No tracks found in response');
            }

            console.log('[PARSER] Processing tracks...');

            for (const [rawName, notesData] of Object.entries(tracksData)) {
                console.log(`[PARSER] ----------------------------------------`);
                console.log(`[PARSER] Processing raw track: "${rawName}"`);
                console.log(`[PARSER] Notes data type:`, typeof notesData);
                console.log(`[PARSER] Notes data:`, notesData?.toString()?.substring(0, 100));

                // Skip metadata fields
                if (['t', 'd', 'title', 'desc', 'description', 'k', 'key', 'bpm', 'ts', 'trks', 'tracks'].includes(rawName)) {
                    console.log(`[PARSER] Skipping metadata field: "${rawName}"`);
                    continue;
                }

                const normalizedName = this.normalizeTrackType(rawName);
                console.log(`[PARSER] Normalized: "${rawName}" → "${normalizedName}"`);
                console.log(`[PARSER] Checking if "${normalizedName}" is in expectedTracks:`, expectedTracks);
                console.log(`[PARSER] Includes check result:`, expectedTracks.includes(normalizedName));

                if (expectedTracks.includes(normalizedName)) {
                    const notes = this.parseHybridNotesData(notesData);
                    console.log(`[PARSER] Parsed ${notes.length} notes for "${normalizedName}"`);

                    if (notes.length > 0) {
                        tracks.set(normalizedName, {
                            notes: notes,
                            title: normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1),
                            description: `Generated ${normalizedName} sequence`
                        });
                        console.log(`[PARSER] ✓ ADDED track: ${normalizedName}`);
                    } else {
                        console.warn(`[PARSER] ✗ No notes parsed for: ${normalizedName}`);
                    }
                } else {
                    console.warn(`[PARSER] ✗ Track "${rawName}" (normalized: "${normalizedName}") NOT in expectedTracks`);
                }
            }

            console.log('[PARSER] ==========================================');
            console.log('[PARSER] Final tracks map keys:', Array.from(tracks.keys()));
            console.log('[PARSER] Total tracks parsed:', tracks.size);
            console.log('[PARSER] ==========================================');
            
            if (tracks.size === 0) {
                console.error('[PARSER] No tracks were successfully parsed!');
                throw new Error('No tracks generated from AI response');
            }
            
            return { 
                tracks, 
                title: compositionTitle, 
                description: compositionDescription, 
                rawJson: rawJsonString 
            };

        } catch (e) {
            console.error("[PARSER] ==========================================");
            console.error("[PARSER] PARSE FAILED");
            console.error("[PARSER] Error:", e.message);
            console.error("[PARSER] Full text:", text);
            console.error("[PARSER] ==========================================");
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
                if (seenKeys.has(key)) {
                    console.log(`[PARSER] Removing duplicate key: "${key}"`);
                    continue;
                }
                seenKeys.add(key);
            }
            result.unshift(line);
        }
        
        return result.join('\n');
    }

    parseHybridNotesData(notesData) {
        console.log(`[NOTES] ==========================================`);
        console.log(`[NOTES] Parsing notes data...`);
        console.log(`[NOTES] Input type:`, typeof notesData);
        console.log(`[NOTES] Input value:`, notesData?.toString()?.substring(0, 200));
        
        const notes = [];

        if (!notesData || typeof notesData !== 'string' || notesData.trim().length === 0) {
            console.warn('[NOTES] Empty or invalid notes data');
            return notes;
        }

        const entries = notesData.split('|').filter(e => e.trim().length > 0);
        console.log(`[NOTES] Found ${entries.length} entries`);

        const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
        const secondsPerBeat = 60 / bpm;

        console.log(`[NOTES] BPM: ${bpm}, secondsPerBeat: ${secondsPerBeat}`);

        entries.forEach((entry, idx) => {
            console.log(`[NOTES] ----------------------------------------`);
            console.log(`[NOTES] Entry ${idx}: "${entry}"`);
            
            try {
                const parsed = this.parseHybridEntry(entry.trim(), secondsPerBeat);
                if (parsed) {
                    if (Array.isArray(parsed)) {
                        notes.push(...parsed);
                        console.log(`[NOTES] ✓ Added chord with ${parsed.length} notes`);
                    } else {
                        notes.push(parsed);
                        console.log(`[NOTES] ✓ Added single note: ${parsed.name}`);
                    }
                } else {
                    console.log(`[NOTES] ✗ Entry returned null (rest or invalid)`);
                }
            } catch (e) {
                console.warn(`[NOTES] ✗ Entry ${idx} failed:`, e.message);
            }
        });

        console.log(`[NOTES] ==========================================`);
        console.log(`[NOTES] Total notes parsed: ${notes.length}`);
        console.log(`[NOTES] ==========================================`);
        
        return notes;
    }

    parseHybridEntry(entry, secondsPerBeat) {
        const parts = entry.split(':');
        
        console.log(`[ENTRY] Split parts:`, parts);
        
        if (parts.length !== 4) {
            console.warn(`[ENTRY] Invalid format (expected 4 parts, got ${parts.length}): "${entry}"`);
            return null;
        }

        const [pitchStr, timeStr, durStr, velStr] = parts;
        
        console.log(`[ENTRY] pitchStr: "${pitchStr}", timeStr: "${timeStr}", durStr: "${durStr}", velStr: "${velStr}"`);

        // Handle rest
        if (pitchStr === '_' || pitchStr === '-') {
            console.log(`[ENTRY] Rest detected`);
            return null;
        }

        // Parse time: bar.beat
        const [barStr, beatStr = '0'] = timeStr.split('.');
        const bar = parseInt(barStr) || 0;
        const beat = parseFloat('0.' + beatStr) || 0;
        const totalBeats = bar * 4 + beat * 4;
        const time = totalBeats * secondsPerBeat;
        
        console.log(`[ENTRY] Time: bar=${bar}, beat=${beat}, totalBeats=${totalBeats}, time=${time}s`);

        // Parse duration
        const durationBeats = parseFloat(durStr);
        const duration = durationBeats * secondsPerBeat;
        
        console.log(`[ENTRY] Duration: ${durationBeats} beats = ${duration}s`);

        // Parse velocity
        const velRaw = parseInt(velStr) || 5;
        const velocity = Math.max(0.1, Math.min(1.0, velRaw / 9));
        
        console.log(`[ENTRY] Velocity: raw=${velRaw}, normalized=${velocity}`);

        // Handle chords
        if (pitchStr.includes(',')) {
            const pitches = pitchStr.split(',').map(p => p.trim());
            console.log(`[ENTRY] Chord with ${pitches.length} notes: ${pitches.join(', ')}`);
            return pitches.map(p => this.createNote(p, time, duration, velocity));
        }

        return this.createNote(pitchStr, time, duration, velocity);
    }

    createNote(pitch, time, duration, velocity) {
        console.log(`[NOTE] Creating note from pitch: "${pitch}"`);
        
        let midi;
        try {
            if (/^\d+$/.test(pitch)) {
                midi = parseInt(pitch);
                console.log(`[NOTE] Parsed as MIDI number: ${midi}`);
            } else {
                midi = Tone.Frequency(pitch).toMidi();
                console.log(`[NOTE] Converted "${pitch}" to MIDI: ${midi}`);
            }
        } catch (e) {
            console.warn(`[NOTE] Invalid pitch: "${pitch}"`, e.message);
            return null;
        }

        if (isNaN(midi) || midi < 0 || midi > 127) {
            console.warn(`[NOTE] MIDI out of range: ${midi}`);
            return null;
        }

        const note = {
            midi,
            name: Tone.Frequency(midi, "midi").toNote(),
            time,
            duration,
            velocity
        };
        
        console.log(`[NOTE] Created: ${note.name} (midi=${note.midi}, time=${note.time.toFixed(3)}, dur=${note.duration.toFixed(3)}, vel=${note.velocity.toFixed(2)})`);
        
        return note;
    }

    createMidiObject(notes, bpm) {
        const midi = new Midi();
        const track = midi.addTrack();
        midi.header.setTempo(bpm);
        
        notes.sort((a, b) => a.time - b.time);
        
        console.log(`[MIDI] Creating MIDI with ${notes.length} notes at ${bpm} BPM`);
        
        let addedCount = 0;
        notes.forEach(n => {
            if (n && n.midi >= 0 && n.midi <= 127) {
                track.addNote({ 
                    midi: n.midi, 
                    time: n.time, 
                    duration: n.duration, 
                    velocity: n.velocity 
                });
                addedCount++;
            }
        });
        
        console.log(`[MIDI] Added ${addedCount} notes to MIDI track`);
        
        return midi;
    }

    async readStreamingResponse(response, ui) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assembled = '';
        let chunkCount = 0;

        console.log('[STREAM] Starting to read streaming response...');

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

        console.log(`[STREAM] Done. ${chunkCount} chunks → ${assembled.length} chars total`);
        console.log('[STREAM] Full response preview:', assembled.substring(0, 800));
        
        return assembled;
    }

    async generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt = '', style = '') {
        const generatedMidis = new Map();
        
        try {
            console.log('[MIDI-GEN] ==========================================');
            console.log('[MIDI-GEN] Starting generation...');
            console.log('[MIDI-GEN] Expected tracks:', expectedTracks);
            console.log('[MIDI-GEN] Style:', style);
            console.log('[MIDI-GEN] Prompt length:', prompt.length);
            console.log('[MIDI-GEN] ==========================================');

            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    model: 'gemini-fast',
                    stream: true,
                    enhancedPrompt,
                    style
                })
            });

            console.log('[MIDI-GEN] Response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[MIDI-GEN] API error:', errorText);
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }

            const fullText = await this.readStreamingResponse(response, ui);

            if (!fullText || fullText.trim().length === 0) {
                throw new Error('AI returned empty response');
            }

            const { tracks, title, description, rawJson } = this.parseApiResponse(fullText, expectedTracks);
            const bpm = parseInt(document.getElementById('bpm')?.value) || 120;

            console.log('[MIDI-GEN] ==========================================');
            console.log('[MIDI-GEN] Tracks parsed:', Array.from(tracks.keys()));
            console.log('[MIDI-GEN] Creating MIDI objects...');
            console.log('[MIDI-GEN] ==========================================');

            for (const [type, info] of tracks.entries()) {
                console.log(`[MIDI-GEN] Creating MIDI for "${type}" with ${info.notes.length} notes`);
                generatedMidis.set(type, {
                    midi: this.createMidiObject(info.notes, bpm),
                    title: info.title,
                    description: info.description
                });
            }

            if (generatedMidis.size === 0) {
                console.error('[MIDI-GEN] No tracks in generatedMidis map!');
                throw new Error("No tracks generated from the AI response.");
            }

            console.log('[MIDI-GEN] ==========================================');
            console.log('[MIDI-GEN] SUCCESS: Generated', generatedMidis.size, 'tracks');
            console.log('[MIDI-GEN] ==========================================');

            return { 
                tracks: generatedMidis, 
                compositionTitle: title, 
                compositionDescription: description, 
                rawJson 
            };

        } catch (error) {
            console.error('[MIDI-GEN] ==========================================');
            console.error('[MIDI-GEN] ERROR:', error.message);
            console.error('[MIDI-GEN] ==========================================');
            ui.showMessage(`Error: ${error.message}`, 'error');
            throw error;
        }
    }
}

export async function generateMultiTrackMIDIFromAPI(prompt, ui, expectedTracks, enhancedPrompt = '', style = '') {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(prompt, ui, expectedTracks, enhancedPrompt, style);
}
