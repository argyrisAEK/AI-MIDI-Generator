import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { trackAbbreviations } from './track-config.js';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';

// ── Track name normalization map ───────────────────────────────────────
const TRACK_NAME_MAP = {
    bassline:'bassline', bass:'bassline',
    chord:'chord', chords:'chord', chd:'chord',
    melody:'melody', mel:'melody',
    arpeggio:'arpeggio', arp:'arpeggio',
    lead:'lead',
    plucks:'plucks', plk:'plucks', pluck:'plucks',
    strings:'strings', str:'strings',
    keys:'keys', key:'keys',
    guitar:'guitar', gtr:'guitar',
    padtextures:'pad-textures', pad:'pad-textures',
    brass:'brass', brss:'brass',
    percs:'percs', perc:'percs',
};

// ── Per-track MIDI pitch ranges (matches trackInstructions in generate.js) ──
// Notes outside these ranges are clamped to the nearest octave within range.
const TRACK_MIDI_RANGES = {
    bassline:       { min: 36, max: 52 },
    chord:          { min: 48, max: 72 },
    melody:         { min: 60, max: 84 },
    arpeggio:       { min: 55, max: 79 },
    lead:           { min: 62, max: 88 },
    plucks:         { min: 60, max: 84 },
    strings:        { min: 48, max: 79 },
    keys:           { min: 48, max: 76 },
    guitar:         { min: 40, max: 76 },
    'pad-textures': { min: 42, max: 75 },
    brass:          { min: 42, max: 75 },
    percs:          { min: 60, max: 72 },
};

/**
 * Clamps a MIDI note into the track's allowed range by transposing octaves.
 * Preserves the pitch class (note name) — only moves octave.
 */
function clampToRange(midiNote, trackType) {
    const range = TRACK_MIDI_RANGES[trackType];
    if (!range) return Math.max(0, Math.min(127, midiNote));

    let note = midiNote;
    // Transpose up by octaves until within range
    while (note < range.min) note += 12;
    // Transpose down by octaves until within range
    while (note > range.max) note -= 12;
    // Final safety clamp in case range span < 12
    return Math.max(range.min, Math.min(range.max, note));
}

// ── Retryable error detection ──────────────────────────────────────────
// Only retry on transient failures — never on definitive errors
function isRetryable(error) {
    const msg = error.message || '';
    // Parse errors → worth retrying (AI formatting fluke)
    if (msg.includes('parse') || msg.includes('JSON') || msg.includes('No JSON') || msg.includes('empty response')) return true;
    // Network timeouts → worth retrying
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('fetch')) return true;
    // 5xx server errors → worth retrying
    if (msg.includes('Server error: 5')) return true;
    // Everything else: 4xx, auth, validation → NOT retryable
    return false;
}

// ── Auto-healing JSON cleaner ──────────────────────────────────────────
// Fixes common AI output issues BEFORE attempting parse, reducing retries
function healJson(text) {
    let s = text.trim();

    // Strip markdown fences
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

    // Extract outermost JSON object
    const start = s.indexOf('{');
    const end   = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return s;
    s = s.slice(start, end + 1);

    // Remove trailing commas before } or ]
    s = s.replace(/,\s*([\}\]])/g, '$1');

    // Quote unquoted object keys:  key: → "key":
    s = s.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*:/g, '$1"$2":');

    // Replace single-quoted strings
    s = s.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');

    // Strip control characters
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    return s;
}

export class MIDIGenerator {

    normalizeTrackType(trackType) {
        const key = trackType.toLowerCase().replace(/[\s_-]/g, '');
        // Check dynamic abbreviations from track-config first
        const reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr.replace(/[\s_-]/g, ''), full])
        );
        return reverseAbbrev[key] || TRACK_NAME_MAP[key] || trackType;
    }

    // ── Parser ─────────────────────────────────────────────────────────
    parseApiResponse(text, expectedTracks, bpm = 120) {
        const tracks = new Map();
        let title       = 'Untitled';
        let description = '';

        // 1. Auto-heal then parse
        const healed = healJson(text);
        let raw;
        try {
            raw = JSON.parse(healed);
        } catch {
            // Last resort: regex-extract track strings directly
            raw = this._regexFallback(healed);
            if (!raw.tracks || Object.keys(raw.tracks).length === 0) {
                throw new Error(`JSON parse failed after healing. Response preview: ${text.slice(0, 200)}`);
            }
        }

        title       = raw.title || raw.t || title;
        description = raw.desc  || raw.description || raw.d || '';

        const tracksData = (typeof raw.tracks === 'object' && raw.tracks !== null)
            ? raw.tracks
            : raw;

        if (!tracksData || Object.keys(tracksData).length === 0) {
            throw new Error('No tracks object in response');
        }

        // Metadata fields to skip
        const META = new Set(['title','desc','description','t','d','bpm','tempo','style','mood','explanation']);

        for (const [rawName, notesStr] of Object.entries(tracksData)) {
            if (META.has(rawName)) continue;

            const normalized = this.normalizeTrackType(rawName);
            if (!expectedTracks.includes(normalized)) continue;

            const notes = this._parseNotes(notesStr, bpm, normalized);
            if (notes.length === 0) continue;

            tracks.set(normalized, {
                notes,
                title:       normalized.charAt(0).toUpperCase() + normalized.slice(1),
                description: `Generated ${normalized} sequence`
            });
        }

        // Build normalized rawJson for Edit Tracks / JSON paste zone
        const normalizedTracksObj = {};
        for (const [name] of tracks.entries()) {
            const originalKey = Object.keys(tracksData).find(k => this.normalizeTrackType(k) === name);
            if (originalKey) normalizedTracksObj[name] = tracksData[originalKey];
        }

        return {
            tracks,
            title,
            description,
            rawJson: JSON.stringify({ title, desc: description, tracks: normalizedTracksObj }, null, 2)
        };
    }

    // ── Note parsing ───────────────────────────────────────────────────
    _parseNotes(notesData, bpm, trackType = null) {
        if (!notesData || typeof notesData !== 'string' || !notesData.trim()) return [];

        const spb      = 60 / bpm; // seconds per beat
        const entries  = notesData.split('|').map(e => e.trim()).filter(Boolean);
        const notes    = [];

        for (const entry of entries) {
            const clean = entry.split('#')[0].trim(); // strip inline comments
            const parts = clean.split(':').map(p => p.trim());
            if (parts.length < 4) continue;

            const pitchStr     = parts[0];
            const startBeat    = parseFloat(parts[1]);
            const durationBeats= parseFloat(parts[2]);
            const velocityRaw  = parseInt(parts[3]);

            if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocityRaw)) continue;

            let midiNote;
            try {
                midiNote = !isNaN(parseInt(pitchStr))
                    ? parseInt(pitchStr)
                    : Tone.Frequency(pitchStr).toMidi();
            } catch { continue; }

            if (isNaN(midiNote)) continue;

            // Clamp to track's allowed MIDI range (transposes by octave, preserves pitch class)
            midiNote = clampToRange(midiNote, trackType);

            // velocity 1-9 → 0.0-1.0 (full range: /9)
            const velocity = Math.max(0.08, Math.min(1.0, velocityRaw / 9));

            // Quantize to 16th-note grid, enforce minimum 1/64th
            const quantStart = Math.max(0, Math.round(startBeat * 4) / 4);
            const quantDur   = Math.max(0.0625, Math.round(durationBeats * 4) / 4);

            notes.push({
                midi:     midiNote,
                name:     Tone.Frequency(midiNote, 'midi').toNote(),
                time:     quantStart * spb,
                duration: quantDur   * spb,
                velocity
            });
        }

        return notes;
    }

    // Regex fallback — extracts track strings without full JSON parse
    _regexFallback(text) {
        const result = { title: '', desc: '', tracks: {} };
        const tMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
        if (tMatch) result.title = tMatch[1];
        const dMatch = text.match(/"desc(?:ription)?"\s*:\s*"([^"]+)"/);
        if (dMatch) result.desc = dMatch[1];
        // Match track values: "key": "notes|string"
        const re = /"([a-zA-Z_-][a-zA-Z0-9_-]*)"\s*:\s*"([^"]+)"/g;
        let m;
        const META = new Set(['title','desc','description','bpm','style','mood']);
        while ((m = re.exec(text)) !== null) {
            if (!META.has(m[1]) && m[2].includes(':')) {
                result.tracks[m[1]] = m[2];
            }
        }
        return result;
    }

    createMidiObject(notes, bpm) {
        const midi  = new Midi();
        const track = midi.addTrack();
        midi.header.setTempo(bpm);
        [...notes].sort((a, b) => a.time - b.time).forEach(n => {
            track.addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
        });
        return midi;
    }

    async readStreamingResponse(response, ui) {
        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let assembled = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                assembled += chunk;
                ui?.onStreamProgress?.(assembled);
            }
        } finally {
            reader.releaseLock();
        }
        return assembled;
    }

    // ── Main generation with smart retries ────────────────────────────
    async generateMultiTrackMIDI(promptParams, ui, expectedTracks) {
        const MAX_ATTEMPTS  = 3;
        const HARD_CAP_MS   = 45_000; // 45s total across all attempts
        const startTime     = Date.now();
        let lastError;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            // Hard cap check before starting a new attempt
            if (Date.now() - startTime > HARD_CAP_MS) {
                throw new Error('Generation timed out (45s). Please try again.');
            }

            try {
                if (attempt > 1) {
                    // Short delay only for parse retries — no delay for first attempt
                    await new Promise(r => setTimeout(r, 800));
                    ui?.showMessage?.(
                        `🔄 Regenerating (${attempt}/${MAX_ATTEMPTS}) — AI formatting issue, retrying...`,
                        'loading'
                    );
                }

                const userApiKey    = localStorage.getItem('byop_pollinations_key') || undefined;
                const userId        = localStorage.getItem('midi_user_id') || null;
                const selectedModel = localStorage.getItem('preferred_model') || null;
                const modelList     = selectedModel && userApiKey
                    ? [selectedModel, 'midijourney', 'claude-fast']
                    : ['kimi-k2.5', 'midijourney', 'claude-fast'];

                const response = await fetchWithModelFallbacks(
                    '/api/generate',
                    modelList,
                    ui,
                    { promptParams, ...(userApiKey ? { userApiKey } : {}) },
                    userApiKey || null,
                    userId
                );

                // ── Handle specific HTTP errors — never retry these ────
                if (response.status === 402) {
                    const data = await response.json();
                    const err  = new Error(data.message || 'Daily generation limit reached.');
                    err.requiresByop = true;
                    err.resetAt      = data.resetAt;
                    throw err;
                }
                if (response.status === 401) {
                    localStorage.removeItem('byop_pollinations_key');
                    const err = new Error('Your Pollinations key is no longer valid. Please reconnect.');
                    err.requiresByopReauth = true;
                    throw err;
                }
                if (!response.ok) {
                    const errorText = await response.text();
                    const err = new Error(`Server error: ${response.status} - ${errorText}`);
                    // 4xx → not retryable, throw immediately
                    if (response.status >= 400 && response.status < 500) throw err;
                    throw err;
                }

                // ── Update free-gen counter ────────────────────────────
                const remaining = response.headers.get('X-Remaining-Generations') ||
                                  response.headers.get('x-remaining-generations');
                if (remaining != null) ui?.updateFreeGenerations?.(parseInt(remaining, 10));

                // ── Read & parse ───────────────────────────────────────
                const fullText = await this.readStreamingResponse(response, ui);
                if (!fullText || !fullText.trim()) throw new Error('AI returned empty response');

                const bpm = parseInt(document.getElementById('bpm')?.value) || 120;
                const { tracks, title, description, rawJson } = this.parseApiResponse(fullText, expectedTracks, bpm);

                if (tracks.size === 0) throw new Error('No tracks generated from AI response');

                const generatedMidis = new Map();
                for (const [type, info] of tracks.entries()) {
                    generatedMidis.set(type, {
                        midi:        this.createMidiObject(info.notes, bpm),
                        title:       info.title,
                        description: info.description
                    });
                }

                return { tracks: generatedMidis, compositionTitle: title, compositionDescription: description, rawJson };

            } catch (error) {
                lastError = error;

                // Never retry auth/limit errors
                if (error.requiresByop || error.requiresByopReauth) throw error;

                // Never retry 4xx client errors
                if ((error.message || '').includes('Server error: 4')) throw error;

                // Only retry if error is transient/retryable
                if (!isRetryable(error)) throw error;

                // Don't start another attempt if we've hit the hard cap
                if (Date.now() - startTime > HARD_CAP_MS) break;
            }
        }

        ui?.showMessage?.(`Generation failed: ${lastError?.message}`, 'error');
        throw lastError;
    }
}

export async function generateMultiTrackMIDIFromAPI(promptParams, ui, expectedTracks) {
    return new MIDIGenerator().generateMultiTrackMIDI(promptParams, ui, expectedTracks);
}
