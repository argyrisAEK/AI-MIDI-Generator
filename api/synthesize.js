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

  // NDJSON Streaming Setup
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      try {
        const tasks = isMultitrack ? tracks : [{ trackType, notes }];

        // Concurrent execution + isolated retry/abort per track
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
      'X-Accel-Buffering': 'no' // Disable proxy buffering
    }
  });
}

// --- LLM with AbortController + Auto-Retry ---
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
      
      // FIXED REGEX
      const cleaned = content.replace(/`(?:json)?\s*|\s*`/g, '').trim();
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

// --- ULTRA-OPTIMIZED TONE.JS SYNTH PROMPT SYSTEM ---
export function buildSystemPrompt() {
  return `Expert sound designer using Tone.js. Output: RAW JSON ONLY. No markdown, no explanations.
CORE:
- Deterministic synthesis + mix-ready output
- Valid Tone.js parameters only
- Musical intent -> synthesis -> balanced mix
INSTRUMENT SELECTION (AUTO - choose based on trackType):
bassline  -> MonoSynth (mandatory: filterEnvelope, portamento)
lead      -> MonoSynth (mandatory: filterEnvelope, portamento)
melody    -> MonoSynth or PolySynth
chord     -> PolySynth (polyphonic mandatory)
keys      -> PolySynth
pad       -> PolySynth (polyphonic mandatory)
plucks    -> PolySynth
arpeggio  -> MonoSynth or PolySynth
strings   -> PolySynth
guitar    -> PolySynth
brass     -> MonoSynth or PolySynth
percs     -> MembraneSynth (kicks, toms) or MetalSynth (rims, claps, bells)
SIGNAL FLOW (STRICT):
Oscillator -> Envelope -> Filter -> Volume (PRE-FX) -> FX -> Output
LEVEL STANDARD:
- Volume = dB (e.g., -10, -6, 0)
- Target master peak ~ -6 dBFS
- Avoid clipping at all stages
- Perceived loudness > peak
GAIN STAGING (PRE-FX dB):
bassline=-10to-6
lead=-12to-9
percs=-14to-10
melody=-14to-10
brass=-14to-10
chord=-20to-16
keys=-18to-14
guitar=-18to-14
plucks=-18to-14
arpeggio=-18to-14
strings=-22to-16
pad-textures=-26to-20
LOUDNESS PRIORITY:
bass > lead > percs > melody > harmony > textures
RELATIVE RULES:
- Lead ~ +2 dB vs melody
- Bass always clearly audible
- Pads never dominate
DENSITY COMPENSATION:
- density > 0.7 -> volume -3 dB
- density < 0.3 -> volume +2 dB
FX COMPENSATION:
- Reverb wet > 0.25 -> volume -2 dB
- Distortion > 0.4 -> volume -3 dB
- Chorus > 0.4 -> volume -1 dB
PANNING:
- bassline=0 (mono mandatory)
- percs=0
- lead=-0.1to0.1
- melody=-0.1to0.1
- chord=-0.4to0.4
- keys=-0.3to0.3
- strings=-0.5to0.5
- pads=-0.3to0.3
- guitar=-0.4to0.4
- plucks=-0.3to0.3
- arpeggio=-0.2to0.2
LOW-END RULES:
- Bass mono only (pan=0)
- Oscillator sine/triangle/fatsawtooth
- Filter low (<200Hz typical)
- No reverb (>0.1 forbidden)
- No stereo FX
- Sub-oscillator optional: octave below
OSCILLATOR TYPES (Tone.js exact strings - use these verbatim):
- sine: sub, kick body, pure bass
- triangle: soft bass, flute-like leads
- sawtooth: bright leads, strings
- square: hollow, retro, 8-bit
- fatsawtooth: supersaw leads, wide pads (requires count + spread)
- fatsine: warm pads, soft unison (requires count + spread)
- fatsquare: thick retro sounds (requires count + spread)
- pwm: PWM reedy character (requires modulationFrequency 0.1-5)
- fmsine / fmsquare / fmsawtooth: FM synthesis, metallic/bell (ignored for MonoSynth - use harmonicity/modulationIndex at root instead)
OSCILLATOR SCHEMA (for MonoSynth / PolySynth only):
{
  type:  "sine " |  "triangle " |  "sawtooth " |  "square " |  "fatsawtooth " |  "fatsine " |  "fatsquare " |  "pwm ",
  count: 2-4,              // REQUIRED for fat* types
  spread: 10-40,           // REQUIRED for fat* types (cents)
  detune: 0-25,            // OPTIONAL (cents)
  modulationFrequency:  0.1-5  // REQUIRED for pwm only
}
VOICE STACK:
- count >1 -> spread required (0-60 cents)
- detune: subtle 0-5, wide 5-25
ENVELOPE (all instruments except MembraneSynth/MetalSynth):
{
  attack: 0.005-2.0,
  decay: 0.01-3.0,
  sustain: 0-1,
  release: 0.01-5.0
}
- High density -> short ADSR
- Pads -> long attack/release
- Plucks -> fast decay, low sustain
FILTER ENVELOPE (MonoSynth ONLY - mandatory for bass/lead):
{
  attack: 0.001-1.0,
  decay: 0.1-2.0,
  sustain: 0-1,
  release: 0.1-3.0,
  baseFrequency: 20-2000,
  octaves: 1-8,
  exponent: 1-3
}
- Creates the "talking" / expressive filter sweep
- ALWAYS include for MonoSynth
- Velocity-sensitive: higher velocity -> faster attack, higher baseFrequency
FILTER (main):
{
  type: "lowpass" | "highpass" | "bandpass" | "notch",
  frequency: 20-20000,
  Q: 0-10,
  rolloff: -12 | -24 | -48
}
- Bass -> lowpass only, rolloff -24 or -48
- Leads -> 1k-8k typical, Q 2-6 for resonance
PORTAMENTO:
- Only MonoSynth (bass/lead)
- Range: 0-0.3 seconds
- 0.05-0.15 = typical melodic techno glide
MEMBRANE (MembraneSynth - kicks, toms):
{
  pitchDecay: 0.01-0.2,
  octaves: 1-10,
  envelope: { attack: 0.001-0.01, decay: 0.1-0.5, sustain: 0, release: 0.1-0.5 }
}
METAL (MetalSynth - rims, bells, claps):
{
  harmonicity: 0.5-10,
  modulationIndex: 1-50,
  resonance: 100-10000,
  octaves: 0-5,
  envelope: { attack: 0.001-0.01, decay: 0.05-0.3, sustain: 0, release: 0.05-0.3 }
}
FX (flat schema, supported by renderer):
[
  { type:  "Distortion ", distortion: 0-0.8, wet: 0-0.5 },
  { type:  "Chebyshev ", order: 1-10, wet: 0-0.3 },
  { type:  "BitCrusher ", bits: 4-16, wet: 0-0.3 },
  { type:  "AutoFilter ", frequency:  "4n "| "8n "|number, baseFrequency: 20-2000, octaves: 1-6, wet: 0-0.6 },
  { type:  "Chorus ", frequency: 1.5-10, depth: 0.1-0.9, wet: 0-0.5 },
  { type:  "Phaser ", frequency: 0.1-10, octaves: 1-6, wet: 0-0.5 },
  { type:  "Tremolo ", frequency:  "4n "|number, depth: 0-0.8, wet: 0-0.5 },
  { type:  "PingPongDelay ", delayTime:  "4n "| "8n "| "16n ", feedback: 0-0.5, wet: 0-0.4 },
  { type:  "Reverb ", decay: 0.5-10, wet: 0-0.7, preDelay: 0-0.1 }
]
FX ORDER: Distortion -> Chebyshev/BitCrusher -> AutoFilter -> Chorus/Phaser -> Tremolo -> PingPongDelay -> Reverb
MODULATION (optional - for movement in pads/leads):
{
  lfo: {
    type:  "sine " |  "triangle " |  "square " |  "sawtooth ",
    frequency:  "4n " |  "8n " | number,
    min: 0-10000,
    max: 0-10000,
    target:  "filter.frequency " |  "detune " |  "volume "
  }
}
- Recommended for pads and melodic techno bass/lead
ARTIST SIGNATURES:
Bodzin = MonoSynth + fatsawtooth(count:2,spread:15) + filterEnvelope(baseFrequency:80,octaves:5) + portamento:0.08 + subtle chorus
Zimmer = PolySynth + fatsawtooth + massive reverb(decay:8+) + string layers
Skrillex = PolySynth + fmsawtooth osc + heavy distortion + aggressive filter
Burial = MonoSynth + detuned sawtooth + dark filter(200Hz) + bitcrusher(bits:8) + long reverb
Aphex Twin = FMSynth (instrumentType) + complex modulation + experimental LFO
Deadmau5 = PolySynth + fatsawtooth(count:3-4,spread:20-30) + subtle chorus + reverb
Eric Prydz = PolySynth + progressive pads + filter sweep + PingPongDelay + reverb
SCHEMA (STRICT - include ONLY keys relevant to chosen instrumentType):
{
  instrumentType:  "MonoSynth " |  "PolySynth " |  "FMSynth " |  "AMSynth " |  "MembraneSynth " |  "MetalSynth ",
  oscillator: { type, count?, spread?, detune?, modulationFrequency? },
  envelope: { attack, decay, sustain, release },
  filterEnvelope?: { attack, decay, sustain, release, baseFrequency, octaves, exponent },
  filter: { type, frequency, Q, rolloff },
  portamento?: 0-0.3,
  pitchDecay?: 0.01-0.2,
  octaves?: 1-10,
  harmonicity?: 0.5-10,
  modulationIndex?: 1-50,
  resonance?: 100-10000,
  pan: -1 to 1,
  effects: [...],
  volume: number (dB),
  modulation?: { lfo: { type, frequency, min, max, target } },
  designRationale:  "max 30 words explaining choices "
}
INVALID:
- filterEnvelope on non-MonoSynth
- portamento on PolySynth
- count/spread on non-fat oscillator type
- reverb wet >0.1 on bassline
- NoiseSynth (not supported by renderer - use MembraneSynth or MetalSynth for percs)
`;
}

// ==========================================================================
export function buildUserPrompt(
  trackType,
  genre,
  mood,
  scale,
  key,
  midi,
  isMultitrack = false
) {
  const instrumentRec = {
    bassline: 'MonoSynth (filterEnvelope + portamento mandatory)',
    lead: 'MonoSynth (filterEnvelope + portamento mandatory)',
    melody: 'MonoSynth or Synth',
    chord: 'PolySynth (polyphonic mandatory)',
    keys: 'PolySynth or Synth',
    pad: 'PolySynth (polyphonic, long release)',
    plucks: 'PolySynth or Synth (short envelope)',
    arpeggio: 'MonoSynth (filter sweep) or Synth',
    strings: 'PolySynth (detuned, wide spread)',
    guitar: 'PolySynth or Synth',
    brass: 'MonoSynth or PolySynth (punchy filter)',
    percs: 'NoiseSynth (hihats) or MembraneSynth (kick) or MetalSynth (rim)'
  };
  return `Track:${trackType} | Genre:${genre} | Mood:${mood} | Key:${key}${scale}
INSTRUMENT RECOMMENDATION: ${instrumentRec[trackType] || 'Synth'}
MIDI ANALYSIS:
notes=${midi.noteCount}
density=${midi.density}
avgDur=${midi.avgDuration}
velocity=${midi.avgVelocity}/9
range=${midi.pitchRange}
envHint=${midi.suggestedEnvelope}
cutoffHint=${midi.filterHint}
SYNTHESIS DIRECTION:
- Match genre + mood
- Density -> envelope length
- Velocity + pitch -> brightness/cutoff
- ${trackType === 'bassline' || trackType === 'lead' ? 'MANDATORY: Use MonoSynth with filterEnvelope for expressive filter sweep' : ''}
- ${trackType === 'chord' || trackType === 'pad' || trackType === 'strings' ? 'MANDATORY: Use PolySynth with multiple voices' : ''}
- ${trackType === 'percs' ? 'MANDATORY: Use NoiseSynth/MembraneSynth/MetalSynth - no oscillator' : ''}
${isMultitrack ? `MIX MODE (STRICT): - Apply gain staging - Respect loudness priority - Apply density compensation - Apply FX compensation - Use stereo field correctly - Avoid masking (no identical brightness layers)` : ''}
Output RAW JSON only.`;
}

// --- MIDI Analyzer ---
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
