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
  const isMultitrack = Array.isArray(tracks) && tracks.length > 0;[cite: 1]
  if (!trackType && !isMultitrack) return jsonError('Missing trackType or tracks', 400);[cite: 1]

  const apiKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0
    ? userApiKey.trim()
    : (process.env.POLLINATIONS_GEN_KEY || '');[cite: 1]

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));[cite: 1]
      try {
        const tasks = isMultitrack ? tracks : [{ trackType, notes }];[cite: 1]

        await Promise.all(tasks.map(async (task) => {
          try {
            const midiAnalysis = analyzeMidi(task.notes || []);[cite: 1]
            const sys = buildSystemPrompt();[cite: 1]
            const usr = buildUserPrompt(task.trackType, genre, mood, scale, key, midiAnalysis, isMultitrack);[cite: 1]
            let patch = await callLLMWithRetry(sys, usr, apiKey);[cite: 1]
            
            // Έξυπνο Post-Processing
            if (task.trackType === 'pad-textures' || task.trackType === 'strings' || task.trackType === 'pad') {
              patch = smartFixPads(patch);
            }
            
            // Global Limiter/Gain Safety check
            patch.volume = Math.min(patch.volume || -12, -4); 

            send({ trackType: task.trackType, status: 'done', patch });[cite: 1]
          } catch (err) {
            send({ trackType: task.trackType, status: 'error', error: err.message });[cite: 1]
          }
        }));

        send({ status: 'complete' });[cite: 1]
      } catch (err) {
        send({ status: 'fatal_error', error: err.message });[cite: 1]
      } finally {
        controller.close();[cite: 1]
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

// ========== SMART PAD ENHANCER ==========
function smartFixPads(patch) {
  if (!patch) patch = {};
  patch.instrumentType = 'PolySynth';[cite: 1]
  
  // Διασφάλιση ατμοσφαιρικού Envelope χωρίς να καταστρέφουμε το πρωτότυπο
  if (!patch.envelope) patch.envelope = {};[cite: 1]
  patch.envelope.attack = Math.max(patch.envelope.attack || 0.8, 0.6);
  patch.envelope.release = Math.max(patch.envelope.release || 2.0, 1.5);
  patch.envelope.sustain = patch.envelope.sustain || 0.7;

  // Προσθήκη Stereo Width αν λείπει
  if (!patch.effects) patch.effects = [];[cite: 1]
  const hasSpatial = patch.effects.some(fx => ['Reverb', 'Chorus', 'Phaser'].includes(fx.type));[cite: 1]
  if (!hasSpatial) {
    patch.effects.push({ type: 'Reverb', decay: 5.0, wet: 0.35 });[cite: 1]
  }

  // Αποφυγή Phase cancellation
  if (patch.oscillator) patch.oscillator.phase = "random";

  return patch;
}

// --- LLM Logic with Timeout ---
async function callLLMWithRetry(systemPrompt, userPrompt, apiKey, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();[cite: 1]
    const timeout = setTimeout(() => controller.abort(), 15000);[cite: 1]
    try {
      const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})[cite: 1]
        },
        body: JSON.stringify({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],[cite: 1]
          model: 'openai-large',
          temperature: 0.5,
          max_tokens: 700
        }),
        signal: controller.signal[cite: 1]
      });

      clearTimeout(timeout);[cite: 1]
      const data = await response.json();[cite: 1]
      const content = data?.choices?.[0]?.message?.content || '';[cite: 1]
      return JSON.parse(content.replace(/`(?:json)?\s*|\s*`/g, '').trim());[cite: 1]
    } catch (err) {
      clearTimeout(timeout);[cite: 1]
      if (attempt === maxRetries) throw err;[cite: 1]
      await new Promise(r => setTimeout(r, 1000));[cite: 1]
    }
  }
}

// --- UPGRADED SYSTEM PROMPT ---
export function buildSystemPrompt() {
  return `Expert sound designer using Tone.js. Output: RAW JSON ONLY.
CORE PRINCIPLES:
- Use DuoSynth for thick, professional leads and basslines (it has voice0 and voice1).
- Use PolySynth for chords/pads/textures.
- Every oscillator should have "phase": "random" to prevent comb filtering.
- Master headroom: ensure individual tracks don't exceed -6dB.

INSTRUMENT MAPPING:
bassline -> DuoSynth or MonoSynth (sub-heavy, mono)
lead -> DuoSynth (harmonic richness)
percs -> MembraneSynth (kick/tom) or NoiseSynth (hats/snares)[cite: 1]
pads/strings -> PolySynth (slow attack, high reverb)[cite: 1]

OSCILLATOR TYPES:
sine, triangle, sawtooth, square, fatsawtooth, fatsine, fatsquare, pwm.[cite: 1]
Fat types REQUIRE "count" (2-8) and "spread" (10-40).[cite: 1]

DUOSYNTH SPECIAL SCHEMA:
{
  "instrumentType": "DuoSynth",
  "vibratoAmount": 0-1,
  "vibratoRate": 0-10,
  "harmonicity": 1,
  "voice0": { "oscillator": {...}, "envelope": {...}, "filterEnvelope": {...} },
  "voice1": { "oscillator": {...}, "envelope": {...}, "filterEnvelope": {...} }
}

EFFECTS PRIORITY:
1. Distortion (if aggressive)[cite: 1]
2. AutoFilter (for movement)[cite: 1]
3. Chorus/Phaser (for width)[cite: 1]
4. PingPongDelay (rhythmic depth)[cite: 1]
5. Reverb (spatial glue)[cite: 1]

MIXING & PANNING:[cite: 1]
- Bass: 0 (Mono)[cite: 1]
- Leads: -0.1 to 0.1[cite: 1]
- Pads/Strings: -0.5 to 0.5 (Wide)[cite: 1]
- Arps: -0.3 to 0.3[cite: 1]
`;
}

// --- UPGRADED USER PROMPT ---
export function buildUserPrompt(trackType, genre, mood, scale, key, midi, isMultitrack) {
  return `Track:${trackType} | Genre:${genre} | Mood:${mood} | Key:${key}${scale}[cite: 1]
MIDI DATA: Density:${midi.density}, AvgVelocity:${midi.avgVelocity}, Range:${midi.pitchRange}[cite: 1]

SYNTHESIS GOAL:
- If ${trackType} is 'lead' or 'bass', use DuoSynth for a "boutique" analog sound.
- If density is 'high', use shorter decay/release to avoid muddy mix.[cite: 1]
- Use Filter rolloff -24 or -48 for Bass, but -12 for more natural Leads.[cite: 1]
- Ensure 'volume' is balanced for a multi-track environment (Range: -25 to -6).[cite: 1]

Output RAW JSON ONLY. No text.`;[cite: 1]
}

// --- MIDI ANALYZER (No changes needed) ---
function analyzeMidi(notes) {
  if (!notes || notes.length === 0) return { density: 'low', avgVelocity: 5, pitchRange: 'mid' };[cite: 1]
  const velocities = notes.map(n => Math.round((n.velocity || 0.7) * 9));[cite: 1]
  const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;[cite: 1]
  const totalBeats = Math.max(...notes.map(n => (n.time || 0) + (n.duration || 0.5)));[cite: 1]
  const density = (notes.length / Math.max(1, totalBeats)) > 1.5 ? 'high' : 'moderate';[cite: 1]
  return { density, avgVelocity, pitchRange: 'calculated' };[cite: 1]
}

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });[cite: 1]
}
