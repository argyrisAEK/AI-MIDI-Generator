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

        // 🔥 Concurrent execution + isolated retry/abort per track
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
      'X-Accel-Buffering': 'no' // Απενεργοποίηση proxy buffering
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
          model: 'openai-large',
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
      
      // ✅ ΔΙΟΡΘΩΜΕΝΟ REGEX
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

// ── ULTRA-OPTIMIZED TONE.JS SYNTH PROMPT SYSTEM ─────────────────────────────

export function buildSystemPrompt() {
  return `Expert sound designer using Tone.js. Output: RAW JSON ONLY. No markdown, no explanations.

CORE:
• Deterministic synthesis + mix-ready output
• Valid Tone.js parameters only
• Musical intent → synthesis → balanced mix

SIGNAL FLOW (STRICT):
Oscillator → Envelope → Filter → Volume (PRE-FX) → FX → Output

LEVEL STANDARD:
• Volume = dBFS (PRE-FX)
• Target master peak ≈ -6 dBFS
• Avoid clipping at all stages
• Perceived loudness > peak

GAIN STAGING (PRE-FX dBFS):
bassline=-10to-6
lead=-12to-9
percs=-12to-8
melody=-14to-10
brass=-14to-10
chord=-18to-14
keys=-18to-14
guitar=-18to-14
plucks=-18to-14
arpeggio=-20to-16
strings=-22to-16
pad-textures=-26to-20

LOUDNESS PRIORITY:
bass > lead > percs > melody > harmony > textures

RELATIVE RULES:
• Lead ≈ +2 dB vs melody
• Bass always clearly audible
• Pads never dominate

DENSITY COMPENSATION:
• density > 0.7 → volume -3 dB
• density < 0.3 → volume +2 dB

FX COMPENSATION:
• Reverb wet > 0.25 → volume -2 dB
• Distortion > 0.4 → volume -3 dB
• Chorus > 0.4 → volume -1 dB

PANNING:
• bassline=0 (mono mandatory)
• percs=0
• lead=-0.1to0.1
• melody=-0.1to0.1
• chord=-0.4to0.4
• keys=-0.3to0.3
• strings=-0.5to0.5
• pads=-0.3to0.3
• guitar=-0.4to0.4
• plucks=-0.3to0.3
• arpeggio=-0.2to0.2

LOW-END RULES:
• Bass mono only (pan=0)
• Oscillator sine/triangle
• Filter low (<200Hz typical)
• No reverb (>0.1 forbidden)
• No stereo FX

OSCILLATOR:
• Low freq → sine/triangle
• Lead → sawtooth + detune
• Pads → multi-voice + wide detune
• Plucks → bright + short
• FM allowed for aggressive timbre

VOICE STACK:
• count >1 → spread required (0–60)
• detune:
  - subtle: 0–5
  - wide: 5–25

ENVELOPE:
• High density → short ADSR
• Pads → long attack/release
• Plucks → fast decay, low sustain
• attack ≥ 0.005 (no clicks)

FILTER:
• Velocity ↑ → cutoff ↑
• High pitch → higher cutoff
• Bass → lowpass only
• Leads → 1k–8k typical

PORTAMENTO:
• Only bass/lead
• Range: 0–0.3
• Only if legato feel

FX (flat schema):
Reverb:{type:"Reverb",decay:0.5-8,wet:0-0.7}
Delay:{type:"Delay",delayTime:"4n|8n|16n",feedback:0-0.5,wet:0-0.4}
Distortion:{type:"Distortion",distortion:0-0.8,wet:0-0.5}
Chorus:{type:"Chorus",frequency:1.5-10,depth:0.1-0.9,wet:0-0.5}

FX ORDER:
Distortion → Delay → Reverb

ARTIST SIGNATURES:
Bodzin = MonoSynth + fat saw + portamento + lowpass + subtle chorus
Zimmer = slow pads/strings + long reverb + layering
Skrillex = FM + distortion + aggressive modulation
Burial = detune + dark filter + lo-fi + reverb
Aphex Twin = complex FM + experimental modulation

SCHEMA (STRICT):
instrumentType,
oscillator:{type,count,spread,detune},
envelope:{attack,decay,sustain,release},
filter:{type,frequency,Q,rolloff},
portamento,
pan,
effects:[{type,...}],
volume,
designRationale

INVALID:
• Missing keys
• Out-of-range values
• Non Tone.js params
`;
}

// ───────────────────────────────────────────────────────────────────────────

export function buildUserPrompt(
  trackType,
  genre,
  mood,
  scale,
  key,
  midi,
  isMultitrack = false
) {
  return `Track:${trackType} | Genre:${genre} | Mood:${mood} | Key:${key}${scale}

MIDI:
notes=${midi.noteCount}
density=${midi.density}
avgDur=${midi.avgDuration}
velocity=${midi.avgVelocity}/9
range=${midi.pitchRange}
envHint=${midi.suggestedEnvelope}
cutoffHint=${midi.filterHint}

SYNTHESIS:
• Match genre + mood
• Density → envelope
• Velocity + pitch → brightness

${isMultitrack ? `
MIX MODE (STRICT):
• Apply gain staging
• Respect loudness priority
• Apply density compensation
• Apply FX compensation
• Use stereo field correctly
• Avoid masking (no identical brightness layers)
` : ''}

Output RAW JSON only.`;
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
