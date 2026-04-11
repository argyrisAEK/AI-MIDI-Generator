export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return jsonError('Method Not Allowed', 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { trackType, genre, mood, scale, key, notes, userApiKey, tracks } = body;
  const isMultitrack = Array.isArray(tracks) && tracks.length > 0;
  if (!trackType && !isMultitrack) return jsonError('Missing trackType or tracks', 400);

  const apiKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0
    ? userApiKey.trim()
    : (process.env.POLLINATIONS_GEN_KEY || '');

  // 🔥 NDJSON Streaming Setup
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));

      try {
        const tasks = isMultitrack ? tracks : [{ trackType, notes }];

        // 🔥 Concurrent execution με individual retry & abort
        await Promise.all(tasks.map(async (task) => {
          try {
            const midiAnalysis = analyzeMidi(task.notes || []);
            const sys = buildSystemPrompt();
            const usr = buildUserPrompt(task.trackType, genre, mood, scale, key, midiAnalysis, isMultitrack);
            const patch = await callLLMWithRetry(sys, usr, apiKey);
            send({ trackType: task.trackType, status: 'done',  patch });
          } catch (err) {
            send({ trackType: task.trackType, status: 'error', error: err.message });
          }
        }));

        send({ status: 'complete' });
      } catch (err) {
        send({ status: 'fatal_error', error: err.message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Απενεργοποίηση buffering σε Vercel/Cloudflare
    }
  });
}

// ── LLM with AbortController + Auto-Retry ─────────────────────────
async function callLLMWithRetry(systemPrompt, userPrompt, apiKey, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s hard timeout

    try {
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
          model: 'glm',
          temperature: 0.4,
          max_tokens: 600,
          stream: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      if (!response.ok) throw new Error(`Pollinations HTTP ${response.status}`);

      const data    = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const cleaned = content.replace(/```(?:json)?\s*|\s*```/g, '').trim();
      return JSON.parse(cleaned);

    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('LLM request timed out');
      if (attempt === maxRetries) throw err;
      // Exponential backoff
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// ── System Prompt (με Artist Signatures) ─────────────────────────────
function buildSystemPrompt() {
  return `Expert sound designer. Output: RAW JSON ONLY. No markdown, no explanations.
RULES:
• Density↑ → ADSR↓ | Pads/long notes → long ADSR
• Bass(low pitch) → sine/triangle, low cutoff, dry (no reverb)
• Lead/high → sawtooth/detuned, moderate FX allowed
• Velocity↑ → filter cutoff↑ | Velocity↓ → cutoff↓
• Portamento: bass/lead only | Reverb wet ≤0.4 (except pads)
• Multitrack: volume -18 to -6, stereo panning, gain staging
ARTIST SIGNATURES (translate to Tone.js if context matches):
Bodzin = MonoSynth + fatsaw + portamento 0.1-0.3 + ladder lowpass + subtle chorus
Zimmer = slow-attack strings/pads + high reverb + orchestral layering
Skrillex = heavy distortion + FMSynth + aggressive filter + fast LFO movement
Burial = detuned oscillators + lo-fi + moderate reverb + dark filter
Aphex Twin = complex FM/glitch + wide detune + grainy attack + experimental FX
SCHEMA KEYS (keep exact): instrumentType, oscillator(type,count,spread,detune), envelope(attack,decay,sustain,release), filter(type,frequency,Q,rolloff), portamento, pan, effects[{type,params}], volume, designRationale`;
}

function buildUserPrompt(trackType, genre, mood, scale, key, midi, isMultitrack = false) {
  return `Track:${trackType} | Genre:${genre} | Mood:${mood} | Key:${key}${scale}
MIDI: ${midi.noteCount} notes | Density:${midi.density} | AvgDur:${midi.avgDuration}b | Vel:${midi.avgVelocity}/9 | Range:${midi.pitchRange} | EnvHint:${midi.suggestedEnvelope} | Cutoff:${midi.filterHint}
${isMultitrack ? 'MIX MODE: apply gain staging & stereo panning. ' : ''}Output RAW JSON only.`;
}

// ── MIDI Analyzer ──────────────────────────────────────────────────
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
  return minPitch < 48 ? '200-600Hz (sub/bass)'
       : avgVelocity > 6 ? '2000-8000Hz (bright)'
       : '800-3000Hz (mid)';
}

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
