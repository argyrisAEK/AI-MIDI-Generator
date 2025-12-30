// Vercel Serverless Function (Node.js) - /api/generate
// Use as a Node serverless function so @tonejs/midi works correctly.
//
// NOTE: ensure package.json supports ESM or adapt imports if needed.
// This implementation uses CommonJS require + module.exports for maximum compatibility.

const { Midi } = require('@tonejs/midi');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const body = req.body || {};
    const musicalContext = body.musicalContext || {};
    const expectedTracks = Array.isArray(musicalContext.trackTypes) ? musicalContext.trackTypes : (body.expectedTracks || []);
    const bpm = musicalContext.tempo || musicalContext.bpm || (parseInt(musicalContext.bpm, 10) || 120);
    const bars = parseInt(musicalContext.duration || body.bars || 4, 10) || 4;
    const timeSignature = musicalContext.timeSignature || body.timeSignature || '4/4';

    const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY || '';
    if (!POLLINATIONS_KEY) {
      res.status(500).json({ error: 'Server misconfiguration: missing POLLINATIONS_KEY' });
      return;
    }

    // Helper: Uint8Array -> base64 (Node)
    function uint8ToBase64(u8) {
      return Buffer.from(u8).toString('base64');
    }

    // Model fallback fetch (uses global fetch - Node 18+ on Vercel supports it)
    async function fetchWithFallback(urlBase, models = ['openai-large','gemini-large'], opts = {}) {
      let lastErr = null;
      for (const m of models) {
        const url = `${urlBase}&model=${encodeURIComponent(m)}`;
        try {
          const r = await fetch(url, opts);
          if (!r.ok) {
            lastErr = new Error(`Model ${m} failed ${r.status}`);
            continue;
          }
          const text = await r.text();
          if (text && text.trim().length > 10) return text;
          lastErr = new Error(`Model ${m} returned empty/invalid response`);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('All models failed');
    }

    function constructMultiTrackPromptServerSide(context) {
      const beatsPerBar = parseInt((context.timeSignature || '4/4').split('/')[0], 10) || 4;
      const totalBeats = (parseInt(context.duration || 4, 10) || 4) * beatsPerBar;
      const chordProgression = (context.chordProgression && context.chordProgression.join) ? context.chordProgression.join(' -> ') : (context.chordProgression || 'I - V - vi - IV');

      let prompt = `Act as a world-class Music Producer specializing in ${context.style || 'unknown'}.
Generate a professional multi-track MIDI composition in strict JSON format.

The JSON object must have exactly these three keys:
{
  "title": "String - A creative title for the composition",
  "explanation": "String - One short sentence describing the musical piece, mood, and style",
  "notation": "String - All musical notes in a single string with escaped newlines (\\n)"
}

MUSICAL PARAMETERS:
- Key: ${context.key || 'C'} ${context.scale || 'major'}
- Tempo: ${context.tempo || context.bpm || 120} BPM
- Total Length: ${context.duration || 4} bars (${totalBeats} beats)
- Mood: ${context.mood || 'neutral'}
- Structure: ${context.structure || 'A-B-A (Intro-Main-Outro)'}
- Chord Progression: ${chordProgression}

TRACK GUIDELINES:`;

      (context.trackTypes || []).forEach(trackType => {
        prompt += `\n- ${trackType.toUpperCase()}: Create a musical part appropriate for ${trackType}, follow stylistic context: ${context.style || 'general'}.`;
      });

      prompt += `

CRITICAL RULES FOR AI GENERATION:
1. TIME UNIT = BEATS. Use floats in beats (e.g. 0.0, 1.5, ...). Max start_beat must be < ${totalBeats}.
2. OUTPUT FORMAT: pitch,start_beat,duration_beats,velocity # track_name (use MIDI note numbers 36-96, velocities 0.0-1.0).
3. Use escaped newlines (\\n) only inside "notation".
4. Maintain key, tempo, and time signature.
5. Avoid exact repetition; humanize slightly.
6. Response must be ONLY a valid JSON object with keys: title, explanation, notation.

Generate the composition now.`;

      if (context.enhancedPrompt) prompt += `\n\nCreativeHint: ${context.enhancedPrompt}`;

      return prompt;
    }

    function parseNoteLineBeatUnits(line, bpmVal) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length < 4) return null;
      const pitchOrName = parts[0];
      const startBeats = parseFloat(parts[1]);
      const durBeats = parseFloat(parts[2]);
      const rawVel = parseFloat(parts[3]);
      if (isNaN(startBeats) || isNaN(durBeats) || isNaN(rawVel)) return null;
      const secondsPerBeat = 60 / (parseInt(bpmVal, 10) || 120);
      const time = Math.max(0, startBeats * secondsPerBeat);
      const duration = Math.max(0.01, durBeats * secondsPerBeat);
      const velocity = rawVel > 1 ? Math.max(0.0, Math.min(1.0, rawVel / 100)) : Math.max(0.0, Math.min(1.0, rawVel));
      let midi = 60, name = 'C4';
      if (!isNaN(parseInt(pitchOrName, 10))) {
        midi = parseInt(pitchOrName, 10);
        name = `MIDI${midi}`;
      } else {
        const m = pitchOrName.match(/(-?\d+)$/);
        if (m) midi = parseInt(m[1], 10);
        name = pitchOrName;
      }
      return { name, midi, time, duration, velocity };
    }

    function buildMidiFromNotesArray(notes, bpmVal) {
      const m = new Midi();
      m.header.setTempo(bpmVal);
      const track = m.addTrack();
      notes.sort((a, b) => a.time - b.time);
      for (const n of notes) {
        track.addNote({
          name: n.name || `N${n.midi}`,
          midi: n.midi,
          time: n.time,
          duration: n.duration,
          velocity: n.velocity
        });
      }
      return m;
    }

    // Build prompt and call remote AI
    const prompt = constructMultiTrackPromptServerSide(musicalContext);
    const baseUrl = `https://gen.pollinations.ai/text/${encodeURIComponent(prompt)}?seed=${Math.floor(Math.random()*100000)}&key=${encodeURIComponent(POLLINATIONS_KEY)}`;

    const rawText = await fetchWithFallback(baseUrl, ['openai-large','gemini-large'], { method: 'GET', headers: { 'Accept': 'text/plain' } });

    const cleaned = rawText.replace(/```(?:json)?\s*|\s*```/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last === -1) {
      res.status(500).json({ error: 'No JSON found in AI response' });
      return;
    }
    const aiObj = JSON.parse(cleaned.substring(first, last + 1));
    if (!aiObj.notation) {
      res.status(500).json({ error: 'AI response missing notation' });
      return;
    }

    const rawNotation = String(aiObj.notation).replace(/\\n/g, '\n');
    const lines = rawNotation.split(/\r?\n/);

    const beatsPerBar = parseInt(timeSignature.split('/')[0], 10) || 4;
    const loopBars = parseInt(aiObj.duration || bars, 10) || bars;
    const totalBeats = loopBars * beatsPerBar;

    const trackNotes = new Map();
    expectedTracks.forEach(t => trackNotes.set(t, []));

    for (const rawLine of lines) {
      const l = rawLine.trim();
      if (!l) continue;
      if (/pitch\s*,\s*time/i.test(l)) continue;
      let content = l;
      let comment = '';
      if (l.includes('#')) {
        [content, comment] = l.split('#', 2);
        content = content.trim();
        comment = comment.trim();
      }
      const note = parseNoteLineBeatUnits(content, bpm);
      if (!note) continue;
      const trackName = comment ? comment.split(/\s+/)[0] : (expectedTracks[0] || 'track');
      if (!trackNotes.has(trackName)) trackNotes.set(trackName, []);
      const loopDurationSeconds = totalBeats * (60 / bpm);
      if (note.time >= loopDurationSeconds) note.time = Math.max(0, loopDurationSeconds - 0.01);
      trackNotes.get(trackName).push(note);
    }

    const tracksOut = {};
    const bpmInt = parseInt(bpm, 10) || 120;
    for (const [trackName, notes] of trackNotes.entries()) {
      if (!notes || notes.length === 0) continue;
      const midi = buildMidiFromNotesArray(notes, bpmInt);
      const ui8 = midi.toArray();
      const base64 = uint8ToBase64(ui8);
      const filename = `${(aiObj.title||'composition').replace(/[\/\\?%*:|"<>]/g,'-').trim()} - ${trackName}.mid`;
      tracksOut[trackName] = { base64, filename, notesCount: notes.length };
    }

    // Combined multitrack
    const combined = new Midi();
    combined.header.setTempo(bpmInt);
    for (const [trackName, notes] of trackNotes.entries()) {
      if (!notes || notes.length === 0) continue;
      const t = combined.addTrack();
      t.name = trackName;
      for (const n of notes.sort((a,b)=>a.time-b.time)) {
        t.addNote({ name: n.name, midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
      }
    }
    const combinedUi8 = combined.toArray();
    const combinedBase64 = uint8ToBase64(combinedUi8);
    const combinedFilename = `${(aiObj.title||'composition').replace(/[\/\\?%*:|"<>]/g,'-').trim()}-COMBINED.mid`;

    const result = {
      title: aiObj.title || 'Generated Composition',
      description: aiObj.explanation || aiObj.description || '',
      tracks: tracksOut,
      combined: { base64: combinedBase64, filename: combinedFilename }
    };

    res.status(200).json(result);
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
};
