export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    const { trackType, genre, mood, scale, key, notes, userApiKey, tracks } = body;

    // Support both single track and multitrack mode
    const isMultitrack = Array.isArray(tracks) && tracks.length > 0;
    if (!trackType && !isMultitrack) return jsonError('Missing trackType or tracks', 400);

    const apiKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0
        ? userApiKey.trim()
        : (process.env.POLLINATIONS_GEN_KEY || '');

    // ── Multitrack mode: analyze all tracks and get patches for each ──
    if (isMultitrack) {
        const results = {};
        for (const track of tracks) {
            const midiAnalysis = analyzeMidi(track.notes || []);
            const systemPrompt = buildSystemPrompt();
            const userPrompt   = buildUserPrompt(track.trackType, genre, mood, scale, key, midiAnalysis, true);
            try {
                const patch = await callLLM(systemPrompt, userPrompt, apiKey);
                results[track.trackType] = patch;
            } catch (err) {
                results[track.trackType] = { error: err.message };
            }
        }
        return new Response(JSON.stringify(results), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ── Single track mode ──────────────────────────────────────────
    const midiAnalysis = analyzeMidi(notes || []);
    const systemPrompt = buildSystemPrompt();
    const userPrompt   = buildUserPrompt(trackType, genre, mood, scale, key, midiAnalysis, false);

    try {
        const patch = await callLLM(systemPrompt, userPrompt, apiKey);
        return new Response(JSON.stringify(patch), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return jsonError(err.message, 500);
    }
}

// ── LLM Call Helper ───────────────────────────────────────────────
async function callLLM(systemPrompt, userPrompt, apiKey) {
    const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'MIDIGenerator/1.0',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userPrompt }
            ],
            model: 'openai-large',
            temperature: 0.4,
            max_tokens: 900,
            stream: false
        })
    });

    if (!response.ok) throw new Error(`Pollinations error: ${response.status}`);

    const data    = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const cleaned = content.replace(/```json|```/g, '').trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        throw new Error('LLM returned invalid JSON');
    }
}
function analyzeMidi(notes) {
    if (!notes || notes.length === 0) {
        return { density: 'unknown', avgDuration: 0, pitchRange: 'mid', avgVelocity: 5, noteCount: 0 };
    }

    const durations  = notes.map(n => n.duration || 0.5);
    const velocities = notes.map(n => Math.round((n.velocity || 0.7) * 9));
    const pitches    = notes.map(n => n.midi || 60);

    const avgDuration  = durations.reduce((a, b) => a + b, 0) / durations.length;
    const avgVelocity  = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    const minPitch     = Math.min(...pitches);
    const maxPitch     = Math.max(...pitches);
    const pitchSpan    = maxPitch - minPitch;

    // Density: notes per beat
    const totalBeats = Math.max(...notes.map(n => (n.time || 0) + (n.duration || 0.5)));
    const notesPerBeat = notes.length / Math.max(1, totalBeats);

    const density = notesPerBeat > 1.5 ? 'high (16ths/8ths)'
                  : notesPerBeat > 0.5 ? 'moderate (8ths/quarters)'
                  : 'sparse (quarters/halves)';

    const pitchRange = minPitch < 48 ? 'low (bass register)'
                     : minPitch < 60 ? 'mid-low'
                     : minPitch < 72 ? 'mid-high'
                     : 'high (lead register)';

    return {
        noteCount: notes.length,
        avgDuration: Math.round(avgDuration * 100) / 100,
        avgVelocity: Math.round(avgVelocity * 10) / 10,
        density,
        pitchRange,
        pitchSpan,
        suggestedEnvelope: getSuggestedEnvelope(avgDuration, notesPerBeat),
        filterHint: getFilterHint(avgVelocity, minPitch)
    };
}

function getSuggestedEnvelope(avgDuration, notesPerBeat) {
    if (notesPerBeat > 1.5) return 'plucky: attack<0.01, decay<0.2, sustain<0.1, release<0.2';
    if (avgDuration > 2.0)  return 'pad: attack>0.5, decay>1.0, sustain>0.7, release>2.0';
    return 'medium: attack 0.01-0.05, decay 0.2-0.5, sustain 0.3-0.6, release 0.3-1.0';
}

function getFilterHint(avgVelocity, minPitch) {
    const cutoff = minPitch < 48 ? '200-600Hz (sub/bass)' : avgVelocity > 6 ? '2000-8000Hz (bright)' : '800-3000Hz (mid)';
    return cutoff;
}

// ── System Prompt ──────────────────────────────────────────────────
function buildSystemPrompt() {
    return `You are an expert music producer and sound designer with deep knowledge of synthesis. ` +
        `You analyze MIDI data and genre context to design professional Tone.js patches. ` +
        `You think like a real producer: you consider note density when setting ADSR, ` +
        `pitch range when choosing oscillators, and velocity range when setting filter cutoff. ` +
        `You output ONLY valid JSON — no markdown, no explanation, no extra text. ` +

        `ARTIST TRANSLATION: If the genre or context references a known artist or style (e.g. "Bodzin", "Zimmer", "Skrillex", "Burial", "Aphex Twin"), ` +
        `translate their signature sound into Tone.js parameters. ` +
        `Examples: Stephan Bodzin = MonoSynth + fatsawtooth + portamento 0.1-0.3 + ladder-style lowpass + subtle chorus. ` +
        `Hans Zimmer = slow-attack strings/pads + high reverb + orchestral layering. ` +
        `Skrillex = heavy distortion + FMSynth + aggressive filter + fast LFO-style movement. ` +
        `Burial = detuned oscillators + lo-fi feel + moderate reverb + dark filter. ` +

        `INSTRUMENT TYPES available in Tone.js: MonoSynth, PolySynth, FMSynth, AMSynth. ` +
        `Use MonoSynth for mono bass/lead (supports portamento). Use FMSynth for metallic/digital tones. ` +
        `Use AMSynth for tremolo/AM modulation sounds. Use PolySynth for pads/chords/plucks. ` +

        `GOLDEN RULES for MIDI-aware design: ` +
        `1. HIGH note density (16ths) → short decay+release (plucky). Long notes (pads) → long attack+release. ` +
        `2. LOW pitch range (bass) → sine/triangle oscillator body, minimal distortion, low filter cutoff. ` +
        `   HIGH pitch range (leads) → sawtooth/detuned, can use more harmonic complexity. ` +
        `3. LOW average velocity → dark closed filter (low cutoff). HIGH velocity → open bright filter. ` +
        `4. Never add heavy reverb to bass. Never use long release on fast 16th patterns. ` +
        `5. Reverb wet > 0.4 only for pads/atmosphere. Delay only for leads/melodies. ` +
        `6. Use portamento (0.05-0.5) for leads and bass when notes slide between pitches (MonoSynth only). ` +
        `7. Use detune (-50 to +50 cents) for warmth and width — especially on fat/supersaw sounds.`;
}

// ── User Prompt ────────────────────────────────────────────────────
function buildUserPrompt(trackType, genre, mood, scale, key, midi, isMultitrack = false) {
    return `Design a Tone.js patch for: "${trackType}" track in ${genre} style. ` +
        `Key: ${key} ${scale}. Mood: ${mood}. ` +
        (isMultitrack ? `CONTEXT: This is part of a FULL MIX — apply gain staging (lower volumes) to prevent clipping when all tracks play together. ` : '') +

        `MIDI ANALYSIS of this specific track: ` +
        `- Notes: ${midi.noteCount}, Density: ${midi.density} ` +
        `- Avg note duration: ${midi.avgDuration} beats, Avg velocity: ${midi.avgVelocity}/9 ` +
        `- Pitch range: ${midi.pitchRange} (span: ${midi.pitchSpan} semitones) ` +
        `- Suggested envelope: ${midi.suggestedEnvelope} ` +
        `- Suggested filter cutoff: ${midi.filterHint} ` +

        `Use your knowledge of ${genre} production to design the patch. ` +
        `Think about what synth a professional ${genre} producer would use for this ${trackType}. ` +

        `Return ONLY this JSON (all fields required): ` +
        `{` +
        `"instrumentType": "MonoSynth|PolySynth|FMSynth|AMSynth",` +
        `"oscillator": {"type": "sine|square|sawtooth|triangle|fatsine|fatsquare|fatsawtooth|pwm|fmsine|fmsquare", "count": 1-5, "spread": 0-80, "detune": -50 to 50},` +
        `"envelope": {"attack": 0.001-3.0, "decay": 0.01-4.0, "sustain": 0.0-1.0, "release": 0.05-6.0},` +
        `"filter": {"type": "lowpass|highpass|bandpass", "frequency": 100-18000, "Q": 0.1-20, "rolloff": -12|-24|-48},` +
        `"portamento": 0 to 0.5,` +
        `"pan": -1.0 to 1.0 (0=center, -1=left, 1=right — spread instruments across stereo field),` +
        `"effects": [` +
        `{"type": "Reverb", "decay": 0.5-8.0, "wet": 0.0-0.7},` +
        `{"type": "Delay", "delayTime": "4n|8n|16n", "feedback": 0.0-0.5, "wet": 0.0-0.4},` +
        `{"type": "Distortion", "distortion": 0.0-0.8, "wet": 0.0-0.5},` +
        `{"type": "Chorus", "frequency": 1.5-10, "depth": 0.1-0.9, "wet": 0.0-0.5}` +
        `],` +
        `"volume": -20 to -3 (lower for mix context, never 0 in multitrack),` +
        `"designRationale": "one sentence explaining the sound design choice"` +
        `}`;
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
