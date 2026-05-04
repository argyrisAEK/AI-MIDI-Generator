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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      try {
        const tasks = isMultitrack ? tracks : [{ trackType, notes }];

        await Promise.all(tasks.map(async (task) => {
          try {
            const midiAnalysis = analyzeMidi(task.notes || []);
            const sys = buildSystemPrompt();
            const usr = buildUserPrompt(task.trackType, genre, mood, scale, key, midiAnalysis, isMultitrack);
            let patch = await callLLMWithRetry(sys, usr, apiKey);
            
            if (['pad-textures', 'strings', 'pad'].includes(task.trackType)) {
              patch = smartFixPads(patch);
            }
            
            patch.volume = Math.min(patch.volume || -12, -4); 

            send({ trackType: task.trackType, status: 'done', patch });
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
      'X-Accel-Buffering': 'no'
    }
  });
}

function smartFixPads(patch) {
  if (!patch) patch = {};
  patch.instrumentType = 'PolySynth';
  
  if (!patch.envelope) patch.envelope = {};
  patch.envelope.attack = Math.max(patch.envelope.attack || 0.8, 0.6);
  patch.envelope.release = Math.max(patch.envelope.release || 2.0, 1.5);
  patch.envelope.sustain = patch.envelope.sustain || 0.7;

  if (!patch.effects) patch.effects = [];
  const hasSpatial = patch.effects.some(fx => ['Reverb', 'Chorus', 'Phaser'].includes(fx.type));
  if (!hasSpatial) {
    patch.effects.push({ type: 'Reverb', decay: 5.0, wet: 0.35 });
  }

  if (patch.oscillator) patch.oscillator.phase = "random";

  return patch;
}

async function callLLMWithRetry(systemPrompt, userPrompt, apiKey, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          model: 'openai-large',
          temperature: 0.5,
          max_tokens: 700
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';
      return JSON.parse(content.replace(/`(?:json)?\s*|\s*`/g, '').trim());
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export function buildSystemPrompt() {
  return `Expert sound designer using Tone.js. Output: RAW JSON ONLY.
CORE:
- Use DuoSynth for leads and bass (voice0, voice1).
- Use PolySynth for chords/pads.
- Oscillator "phase": "random" mandatory.
- Master headroom: individual tracks < -6dB.

INSTRUMENT MAPPING:
bassline -> DuoSynth or MonoSynth
lead -> DuoSynth
percs -> MembraneSynth or MetalSynth
pads/strings -> PolySynth

OSCILLATOR TYPES:
sine, triangle, sawtooth, square, fatsawtooth, fatsine, fatsquare, pwm.
Fat types REQUIRE "count" (2-8) and "spread" (10-40).

DUOSYNTH SCHEMA:
{
  "instrumentType": "DuoSynth",
  "vibratoAmount": 0-1,
  "voice0": { "oscillator": {...}, "envelope": {...}, "filterEnvelope": {...} },
  "voice1": { "oscillator": {...}, "envelope": {...}, "filterEnvelope": {...} }
}
`;
}

export function buildUserPrompt(trackType, genre, mood, scale, key, midi, isMultitrack) {
  return `Track:${trackType} | Genre:${genre} | Mood:${mood} | Key:${key}${scale}
MIDI: Density:${midi.density}, AvgVelocity:${midi.avgVelocity}
Output RAW JSON ONLY.`;
}

function analyzeMidi(notes) {
  if (!notes || notes.length === 0) return { density: 'low', avgVelocity: 5, pitchRange: 'mid' };
  const velocities = notes.map(n => Math.round((n.velocity || 0.7) * 9));
  const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  const totalBeats = Math.max(...notes.map(n => (n.time || 0) + (n.duration || 0.5)));
  const density = (notes.length / Math.max(1, totalBeats)) > 1.5 ? 'high' : 'moderate';
  return { density, avgVelocity, pitchRange: 'calculated' };
}

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
