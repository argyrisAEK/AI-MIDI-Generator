import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { trackAbbreviations } from './track-config.js';

export class MIDIGenerator {
    // Stateless by design — a new instance is created per generation call.

    
    normalizeTrackType(trackType) {
        const lower = trackType.toLowerCase().replace(/[\s_-]/g, '');
        console.log(`[NORMALIZE] Input: "${trackType}" → Lower: "${lower}"`);
        
        const reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr.replace(/[\s_-]/g, ''), full])
        );
        
        // reverseAbbrev covers abbreviations (e.g. 'mel'→'melody', 'lead'→'lead').
        // The map below adds extra common aliases.
        // NOTE: 'lead' is its own track type — do NOT map it to 'melody'.
        const map = {
            'bassline': 'bassline', 'bass': 'bassline',
            'chord': 'chord', 'chords': 'chord',
            'melody': 'melody', 'mel': 'melody',
            'arpeggio': 'arpeggio', 'arp': 'arpeggio',
            'lead': 'lead',
            'plucks': 'plucks', 'plk': 'plucks',
            'strings': 'strings', 'str': 'strings',
            'keys': 'keys', 'key': 'keys',
            'guitar': 'guitar', 'gtr': 'guitar',
            'padtextures': 'pad-textures', 'pad': 'pad-textures',
            'brass': 'brass', 'brss': 'brass',
            'percs': 'percs', 'perc': 'percs',
            ...reverseAbbrev  // reverseAbbrev takes priority for abbreviation overlaps
        };
        
        const result = map[lower] || lower;
        console.log(`[NORMALIZE] Result: "${result}"`);
        return result;
    }

    parseApiResponse(text, expectedTracks, bpm = 120) {
        console.log('[PARSER] Parsing response...');
        console.log('[PARSER] Expected tracks:', expectedTracks);
        
        const tracks = new Map();
        let compositionTitle = 'Untitled';
        let compositionDescription = '';
        let rawJsonString = text;

        try {
            let cleanJsonText = text.trim();

            // ✅ Remove markdown code blocks
            cleanJsonText = cleanJsonText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
            cleanJsonText = cleanJsonText.trim();

            // ✅ Extract JSON object - find the outermost braces
            const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("No JSON object found in response");
            }
            cleanJsonText = jsonMatch[0];
            rawJsonString = cleanJsonText;

            // ✅ Fix common JSON corruption issues
            
            // 1. Remove trailing commas before } or ]
            cleanJsonText = cleanJsonText.replace(/,\s*([\}\]])/g, '$1');
            
            // 2. Fix duplicate keys - keep only the last occurrence (for tracks)
            cleanJsonText = this.fixDuplicateKeys(cleanJsonText);
            
            // 3. Fix unquoted keys
            cleanJsonText = cleanJsonText.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
            
            // 4. Fix single quotes to double quotes
            cleanJsonText = cleanJsonText.replace(/'/g, '"');
            
            // 5. Fix escaped newlines and tabs in strings
            cleanJsonText = cleanJsonText.replace(/\\n/g, ' ').replace(/\\t/g, ' ');
            
            // 6. Remove control characters
            cleanJsonText = cleanJsonText.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

            console.log('[PARSER] Cleaned JSON (first 300 chars):', cleanJsonText.substring(0, 300));

            let rawJsonResponse;
            try {
                rawJsonResponse = JSON.parse(cleanJsonText);
            } catch (parseError) {
                console.warn('[PARSER] Standard parse failed, trying fallback...');
                rawJsonResponse = this.fallbackJsonParse(cleanJsonText);
            }

            compositionTitle = rawJsonResponse.title || rawJsonResponse.t || compositionTitle;
            compositionDescription = rawJsonResponse.description || rawJsonResponse.desc || rawJsonResponse.d || '';

            let tracksData = rawJsonResponse.tracks || rawJsonResponse.tks || rawJsonResponse;
            
            if (typeof tracksData !== 'object' || tracksData === null) {
                tracksData = rawJsonResponse;
            }

            if (!tracksData || Object.keys(tracksData).length === 0) {
                throw new Error("No 'tracks' object found in JSON.");
            }

            console.log('[PARSER] Raw tracks found:', Object.keys(tracksData));
            console.log('[PARSER] Expected tracks for comparison:', expectedTracks);

            for (const [rawName, notesData] of Object.entries(tracksData)) {
                if (['title', 'desc', 'description', 't', 'd', 'bpm', 'tempo', 'style', 'mood'].includes(rawName)) {
                    console.log(`[PARSER] Skipping metadata field: "${rawName}"`);
                    continue;
                }

                const normalizedName = this.normalizeTrackType(rawName);
                console.log(`[PARSER] Processing track: "${rawName}" → normalized: "${normalizedName}"`);
                console.log(`[PARSER] Checking if "${normalizedName}" is in expectedTracks:`, expectedTracks);
                console.log(`[PARSER] Includes check:`, expectedTracks.includes(normalizedName));

                if (expectedTracks.includes(normalizedName)) {
                    const notes = this.parseNotesData(notesData, bpm);
                    console.log(`[PARSER] ${normalizedName}: ${notes.length} notes parsed`);

                    if (notes.length > 0) {
                        tracks.set(normalizedName, {
                            notes: notes,
                            title: normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1),
                            description: `Generated ${normalizedName} sequence`
                        });
                        console.log(`[PARSER] ✓ Added track: ${normalizedName}`);
                    } else {
                        console.warn(`[PARSER] ✗ No notes parsed for: ${normalizedName}`);
                    }
                } else {
                    console.warn(`[PARSER] ✗ Track "${rawName}" (normalized: "${normalizedName}") not in expectedTracks`);
                }
            }
            
            console.log('[PARSER] Final tracks generated:', Array.from(tracks.keys()));

            // 🔥 FIX: Χτίσε normalized rawJson με τα ΣΩΣΤΑ ονόματα tracks (όχι abbreviations)
            // Χρησιμοποιούμε το ήδη-parsed tracksData — ΔΕΝ κάνουμε re-parse του rawJsonString
            // που μπορεί να είναι malformed και να αποτύχει.
            // Για κάθε normalized name (π.χ. "bassline"), βρίσκουμε το original key
            // (π.χ. "bass") στο tracksData και αντιγράφουμε τα notes με το σωστό key.
            const normalizedTracksObj = {};
            for (const [normalizedName] of tracks.entries()) {
                const originalKey = Object.keys(tracksData).find(k =>
                    this.normalizeTrackType(k) === normalizedName
                );
                if (originalKey && tracksData[originalKey]) {
                    normalizedTracksObj[normalizedName] = tracksData[originalKey];
                }
            }

            const normalizedRawJson = JSON.stringify({
                title: compositionTitle,
                desc: compositionDescription,
                tracks: normalizedTracksObj
            }, null, 2);
            console.log('[PARSER] Built normalized rawJson with keys:', Object.keys(normalizedTracksObj));
            
            return { 
                tracks, 
                title: compositionTitle, 
                description: compositionDescription, 
                rawJson: normalizedRawJson
            };

        } catch (e) {
            console.error("[PARSER] Failed:", text.substring(0, 500));
            console.error("[PARSER] Error details:", e);
            throw new Error(`Failed to parse musical content: ${e.message}`);
        }
    }

    /**
     * Fixes duplicate keys in JSON.
     * The old line-by-line approach was fragile (broke multi-line values and
     * confused same-named keys at different nesting levels).
     * V8's JSON.parse already keeps the LAST duplicate key, so we just return
     * the string as-is and let the engine handle it naturally.
     * We keep this method to avoid breaking the call-site.
     */
    fixDuplicateKeys(jsonText) {
        return jsonText;
    }

    /**
     * Fallback parser for severely corrupted JSON
     */
    fallbackJsonParse(text) {
        console.log('[PARSER] Using fallback parser');
        
        const result = {
            title: '',
            description: '',
            tracks: {}
        };
        
        const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
        if (titleMatch) result.title = titleMatch[1];
        
        const descMatch = text.match(/"desc(?:ription)?"\s*:\s*"([^"]+)"/);
        if (descMatch) result.description = descMatch[1];
        
        const trackPattern = /"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:\s*"([0-9:|.\s]+)"/g;
        let match;
        while ((match = trackPattern.exec(text)) !== null) {
            const [, trackName, trackData] = match;
            if (!['title', 'desc', 'description', 't', 'd', 'bpm'].includes(trackName)) {
                result.tracks[trackName] = trackData;
            }
        }
        
        return result;
    }

    /**
     * Dual parser supporting both formats:
     * COMPACT (new):  "50:2.5:.5:9|60:3:.5:8|..."
     * LEGACY (old):   "50,2.5,0.5,0.95\n60,3,0.5,0.8\n..."
     */
    parseNotesData(notesData, bpm = 120) {
        const notes = [];

        if (!notesData || typeof notesData !== 'string' || notesData.trim().length === 0) {
            console.warn('[PARSER] Empty or invalid notes data');
            return notes;
        }

        // Detect format by inspecting the first token of the first entry.
        // Compact format: "pitch:beat:dur:vel|..."  → first entry matches N:N:N:N
        // Legacy format:  "pitch,beat,dur,vel\n..."  → first entry uses commas
        // Using structural inspection rather than loose includes() avoids misdetection
        // when note values happen to contain | or : characters.
        const firstEntry = notesData.trim().split(/[|\n]/)[0].trim();
        const isCompact = /^[A-G#0-9]+:[.\d]+:[.\d]+:[.\d]+/.test(firstEntry);
        console.log(`[PARSER] Detected format: ${isCompact ? 'COMPACT' : 'LEGACY'} (first entry: "${firstEntry}")`);

        try {
            if (isCompact) {
                const entries = notesData.split('|').filter(e => e.trim().length > 0);
                console.log(`[PARSER] Compact: ${entries.length} entries found`);
                entries.forEach((entry, idx) => {
                    const note = this.parseCompactNoteLine(entry.trim(), bpm);
                    if (note) notes.push(note);
                    else console.warn(`[PARSER] Compact entry ${idx} skipped: "${entry}"`);
                });
            } else {
                const lines = notesData.split('\n').filter(line => line.trim().length > 0);
                console.log(`[PARSER] Legacy: ${lines.length} lines found`);
                lines.forEach((line, idx) => {
                    const note = this.parseLegacyNoteLine(line, bpm);
                    if (note) notes.push(note);
                    else console.warn(`[PARSER] Legacy line ${idx} skipped: "${line}"`);
                });
            }
        } catch (e) {
            console.error('[PARSER] Error in parseNotesData:', e);
        }

        return notes;
    }

    parseCompactNoteLine(line, bpm = 120) {
        const cleanLine = line.split('#')[0].trim();
        const parts = cleanLine.split(':').map(p => p.trim());

        if (parts.length < 4) {
            console.warn(`[PARSER] Compact line incomplete (${parts.length}/4 fields): ${line}`);
            return null;
        }

        const secondsPerBeat = 60 / bpm;

        try {
            const pitchStr = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocityRaw = parseInt(parts[3]);

            if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocityRaw)) {
                console.warn(`[PARSER] Compact line has NaN values: beat=${startBeat}, dur=${durationBeats}, vel=${velocityRaw}`);
                return null;
            }

            const normalizedVelocity = Math.max(0.1, Math.min(0.9, velocityRaw / 10));

            let midiNote;
            if (!isNaN(parseInt(pitchStr))) {
                midiNote = parseInt(pitchStr);
            } else {
                midiNote = Tone.Frequency(pitchStr).toMidi();
            }

            if (isNaN(midiNote)) {
                console.warn(`[PARSER] Invalid pitch: ${pitchStr}`);
                return null;
            }

            return {
                midi: midiNote,
                name: Tone.Frequency(midiNote, "midi").toNote(),
                time: startBeat * secondsPerBeat,
                duration: durationBeats * secondsPerBeat,
                velocity: normalizedVelocity
            };
        } catch (e) {
            console.warn(`[PARSER] Error parsing compact note "${line}":`, e.message);
            return null;
        }
    }

    parseLegacyNoteLine(line, bpm = 120) {
        const cleanLine = line.split('#')[0].trim();
        const parts = cleanLine.split(',').map(p => p.trim());

        if (parts.length < 4) {
            console.warn(`[PARSER] Legacy line skipped (invalid): ${line}`);
            return null;
        }

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

    /**
     * ✅ FIXED: Reads plain text streaming response from the edge function.
     */
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
        return assembled;
    }

    async generateMultiTrackMIDI(promptParams, ui, expectedTracks) {
        const MAX_ATTEMPTS = 3;
        const RETRY_DELAY_MS = 1500;
        let lastError;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const generatedMidis = new Map();

            try {
                if (attempt > 1) {
                    console.log(`[MIDI-GEN] Retry attempt ${attempt}/${MAX_ATTEMPTS}...`);
                    ui?.showMessage?.(`Generation failed, retrying... (${attempt - 1}/${MAX_ATTEMPTS - 1})`, 'loading');
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                }

                console.log('[MIDI-GEN] Calling /api/generate (streaming)...');
                console.log('[MIDI-GEN] Expected tracks:', expectedTracks);

                // Retrieve BYOP key from localStorage if present
                const userApiKey = localStorage.getItem('byop_pollinations_key') || undefined;

                const response = await fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        promptParams,
                        model: 'step-3.5-flash',
                        ...(userApiKey ? { userApiKey } : {})
                    })
                });

                console.log('[MIDI-GEN] Response status:', response.status);

                // 402 = daily limit reached — signal UI to show BYOP modal
                if (response.status === 402) {
                    const data = await response.json();
                    const err = new Error(data.message || 'Daily generation limit reached.');
                    err.requiresByop = true;
                    err.resetAt = data.resetAt;
                    throw err;
                }

                // 401 = BYOP key was deleted/revoked on Pollinations side
                if (response.status === 401) {
                    localStorage.removeItem('byop_pollinations_key');
                    const err = new Error('Your Pollinations key is no longer valid. Please reconnect.');
                    err.requiresByopReauth = true;
                    throw err;
                }

                              // Update the free-generations counter in the UI if header present
                // FIXED: Check both cases of header name
                const remaining = response.headers.get('X-Remaining-Generations') || 
                                  response.headers.get('x-remaining-generations');
                if (remaining !== null && remaining !== undefined) {
                    ui?.updateFreeGenerations?.(parseInt(remaining, 10));
                }

                // Don't retry on client errors (4xx) — they won't be fixed by retrying
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('[MIDI-GEN] API error:', errorText);
                    const err = new Error(`Server error: ${response.status} - ${errorText}`);
                    if (response.status >= 400 && response.status < 500) throw err; // non-retryable
                    throw err;
                }

                const fullText = await this.readStreamingResponse(response, ui);

                if (!fullText || fullText.trim().length === 0) {
                    throw new Error('AI returned empty response');
                }

                const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
                const { tracks, title, description, rawJson } = this.parseApiResponse(fullText, expectedTracks, bpm);

                console.log('[MIDI-GEN] Tracks parsed:', Array.from(tracks.keys()));

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

                // Success — return immediately
                if (attempt > 1) {
                    console.log(`[MIDI-GEN] Succeeded on attempt ${attempt}`);
                }
                return { tracks: generatedMidis, compositionTitle: title, compositionDescription: description, rawJson };

            } catch (error) {
                lastError = error;
                console.error(`[MIDI-GEN] Attempt ${attempt} failed:`, error.message);

                // Immediately throw BYOP errors — no point retrying
                if (error.requiresByop) throw error;
                if (error.requiresByopReauth) throw error;

                // Don't retry on client errors (4xx)
                const is4xx = error.message.includes('Server error: 4');
                if (is4xx) {
                    console.warn('[MIDI-GEN] Client error — not retrying');
                    break;
                }
            }
        }

        // All attempts failed
        console.error('[MIDI-GEN] All attempts failed. Last error:', lastError?.message);
        try {
            ui?.showMessage?.(`Generation failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`, 'error');
        } catch (uiError) {
            console.warn('[MIDI-GEN] Could not display error in UI:', uiError.message);
        }
        throw lastError;
    }
}

export async function generateMultiTrackMIDIFromAPI(promptParams, ui, expectedTracks) {
    const generator = new MIDIGenerator();
    return await generator.generateMultiTrackMIDI(promptParams, ui, expectedTracks);
}
