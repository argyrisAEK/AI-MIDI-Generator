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
  const brief = sanitizeBrief(body.brief);
  const isMultitrack = Array.isArray(tracks) && tracks.length > 0;
  if (!trackType && !isMultitrack) return jsonError('Missing trackType or tracks', 400);
  // Pollinations Pay μόνο: κανένα server key, καμία δωρεάν χρήση.
  const apiKey = typeof userApiKey === 'string' ? userApiKey.trim() : '';
  if (!apiKey) return jsonError('Connect your Pollinations account to export with AI synthesis', 401);
  if (!apiKey.startsWith('sk_') || apiKey.length > 400 || /[\r\n]/.test(apiKey)) return jsonError('Invalid Pollinations key', 401);

  // NDJSON Streaming Setup
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      try {
        const tasks = isMultitrack ? tracks : [{ trackType, notes }];

        await Promise.all(tasks.map(async (task) => {
          try {
            const midiAnalysis = analyzeMidi(task.notes || []);
            const sys = buildSystemPrompt(genre, brief);
            const usr = buildUserPrompt(task.trackType, genre, mood, scale, key, midiAnalysis, isMultitrack, brief);
            const patch = await callLLMWithRetry(sys, usr, apiKey);
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

// --- LLM with AbortController + Auto-Retry (timeout 15s) ---
async function callLLMWithRetry(systemPrompt, userPrompt, apiKey, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 sec
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
          model: 'openai/gpt-6.1-sol',
          temperature: 0.4,
          max_tokens: 800,
          stream: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      if (!response.ok) {
        const httpErr = new Error(response.status === 402 ? 'Out of Pollen — top up at enter.pollinations.ai' : `Pollinations HTTP ${response.status}`);
        if ([401, 402, 403].includes(response.status)) httpErr.fatal = true; // μην ξαναδοκιμάσεις
        throw httpErr;
      }

      const data    = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const cleaned = content.replace(/`(?:json)?\s*|\s*`/g, '').trim();
      return JSON.parse(cleaned);

    } catch (err) {
      clearTimeout(timeout);
      if (err.fatal) throw err;
      if (err.name === 'AbortError') throw new Error('LLM request timed out');
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

const GENRE_PALETTES = {
  "progressive-rock": "warm analog character; sawtooth/square/pwm with mild drive (Distortion 0.1-0.3 on lead); picked, guitar-like arpeggios and guitar parts (fast decay, lowpass/bandpass 1.5-4k); organ-like sustained PolySynth for keys and pads with Chorus; round bass (triangle or low saw, light drive); short natural rooms (Reverb decay 1.2-2.5, wet 0.1-0.2); wide dynamics, no EDM sweeps",
  "rock": "gritty sawtooth/square, Distortion 0.2-0.5 on lead and guitar, punchy bass, tight short reverb, no synth-pop shimmer",
  "house": "detuned saws, plucks and stabs, rounded sub bass, tasteful delay, spacious reverb",
  "techno": "hypnotic saws and square plucks, dark lowpass movement, dry tight bass, long-ish filtered delays; pad-textures should be sustained evolving triads, while plucks remain short and articulate",
  "trance": "bright supersaw leads (fatsawtooth count 3-4), gated pads, long reverb, rolling bass",
  "trap": "dark 808-style sub bass, bell-like and plucked leads, sparse short reverb, hard transients",
  "hip-hop": "warm dusty keys, mellow lowpass, round bass, short reverb, soft saturation",
  "pop": "bright clean saws and plucks, polished chorus, moderate reverb, clear mid-range",
  "funk": "tight plucky clavinet-like PolySynth, snappy short envelopes, rubbery MonoSynth bass with filter envelope, little reverb",
  "reggae": "soft round bass, short offbeat plucky keys, warm tape-like delay, dry mix",
  "jazz": "soft sine/triangle/fm electric-piano-like keys, mellow filters, gentle chorus, light room reverb, no heavy distortion",
  "disco": "bright plucky strings and keys, rubbery bass, Chorus and Phaser, moderate reverb",
  "classical": "soft sine/triangle/fatsine PolySynth strings and woodwind-like tones, slow attacks, long natural reverb, no distortion or EDM FX",
  "ambient": "sine/triangle/fatsine pads, very long attacks and releases, big Reverb (decay 6-10), slow modulation, gentle filtering",
  "drum-and-bass": "tight reese-style MonoSynth bass (detuned saws, lowpass movement), crisp plucks, short reverb",
  "synthwave": "warm fat saw leads, chorused pads, gated reverb feel, analog bass",
  "downtempo": "soft mellow keys and pads, round bass, tape-like delay, relaxed envelopes",
  "cinematic": "wide evolving PolySynth strings and pads, slow attacks, large reverb, dramatic dynamics"
};

const ARTIST_SIGNATURES = {
  "Bodzin": "MonoSynth + fatsawtooth(count:2,spread:15) + filterEnvelope(baseFrequency:80,octaves:5) + portamento:0.08 + subtle chorus",
  "Zimmer": "PolySynth + fatsawtooth + massive reverb(decay:8+) + string layers",
  "Skrillex": "PolySynth + fmsawtooth + heavy distortion + aggressive filter",
  "Burial": "MonoSynth + detuned sawtooth + dark filter(200Hz) + bitcrusher(bits:8) + long reverb",
  "Aphex Twin": "FMSynth + complex modulation + experimental LFO",
  "Deadmau5": "PolySynth + fatsawtooth(count:3-4,spread:20-30) + subtle chorus + reverb",
  "Eric Prydz": "PolySynth + progressive pads + filter sweep + PingPongDelay + reverb"
};

function getGenrePalette(genre) {
  const normalized = typeof genre === 'string' ? genre.trim().toLowerCase() : '';
  return GENRE_PALETTES[normalized] || 'Use the creative brief and track role to choose an appropriate timbre. Avoid imposing an unrelated electronic or club sound.';
}

function getRequestedArtistSignature(brief) {
  if (!brief || typeof brief !== 'object') return 'None. Do not infer or apply an artist signature.';
  const request = [brief.title, brief.description, brief.userPrompt]
    .filter(value => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  const match = Object.keys(ARTIST_SIGNATURES)
    .find(name => request.includes(name.toLowerCase()));
  return match
    ? `${match}: ${ARTIST_SIGNATURES[match]}`
    : 'None. Do not infer or apply an artist signature.';
}

export function buildSystemPrompt(genre = '', brief = null) {
  const palette = getGenrePalette(genre);
  const artistSignature = getRequestedArtistSignature(brief);
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
pad-textures -> PolySynth (polyphonic mandatory; sustained triad texture)
plucks    -> PolySynth
arpeggio  -> MonoSynth or PolySynth
strings   -> PolySynth
guitar    -> PolySynth
brass     -> MonoSynth or PolySynth
percs     -> MembraneSynth (kicks, toms) OR MetalSynth (rims, claps, bells) — NO NoiseSynth (not supported)

SIGNAL FLOW (STRICT):
Oscillator -> Envelope -> Filter -> Volume (PRE-FX) -> FX -> Output

LEVEL STANDARD (IMPROVED GAIN STAGING):
- Volume = dB (e.g., -10, -6, 0)
- Target master peak: -6dBFS (absolute max -3dB)
- Leave 3dB headroom for mastering
- If multiple FX (cumulative wet gain), reduce volume by additional -2dB
- Check reverb+delay → can cause +3dB peaks → compensate

GAIN STAGING (PRE-FX dB) – REVISED FOR BETTER MIX:
bassline      = -10 to -6
lead          = -12 to -9
percs         = -14 to -10
melody        = -14 to -10
brass         = -14 to -10
chord         = -20 to -16
keys          = -18 to -14
guitar        = -18 to -14
plucks        = -18 to -14
arpeggio      = -18 to -14
strings       = -20 to -16
pad-textures  = -16 to -12   
LOUDNESS PRIORITY (high to low):
bass > lead > percs > melody > harmony > textures

RELATIVE RULES:
- Lead ~ +2 dB vs melody
- Bass always clearly audible
- Pads now at -16dB typical (audible but not dominant)

DENSITY COMPENSATION:
- density > 0.7 -> volume -3 dB
- density < 0.3 -> volume +2 dB

FX COMPENSATION:
- Reverb wet > 0.25 -> volume -2 dB
- Distortion > 0.4 -> volume -3 dB
- Chorus > 0.4 -> volume -1 dB

PANNING (stereo field):
bassline   = 0 (mono mandatory)
percs      = 0
lead       = -0.1 to 0.1
melody     = -0.1 to 0.1
chord      = -0.4 to 0.4
keys       = -0.3 to 0.3
strings    = -0.5 to 0.5
pads       = -0.3 to 0.3
guitar     = -0.4 to 0.4
plucks     = -0.3 to 0.3
arpeggio   = -0.2 to 0.2

LOW-END RULES (sub + bass):
- Sub-bass (below 60Hz): sine or triangle only, no filter envelope
- Bass with harmonics (60-200Hz): triangle or fatsawtooth, filter envelope allowed
- Never apply chorus/phaser on bassline (phase issues)
- Use subtle saturation (Distortion wet<0.1) for presence instead of harmonics
- Bass mono only (pan=0)
- No reverb (wet>0.1 forbidden)
- Sub-oscillator optional: octave below

ANTI-MASKING RULES (full mix):
- Bassline: frequency <250Hz, no reverb
- Lead: frequency 800Hz-5kHz, pan ±0.1
- Chords: frequency 200Hz-2kHz, pan -0.3 to +0.3, volume -18dB
- Pads: frequency 600Hz-4kHz, pan spread, reverb wet>0.3
- Percs: transient-focused, high-pass >100Hz
- No two tracks occupy same frequency range with same pan position

CREATIVE BRIEF PRIORITY:
- The user message may start with a CREATIVE BRIEF (title, description, original request). It is the highest authority on genre and character.
- If the brief conflicts with the "Genre" field, follow the brief and ignore the field.
- NEVER fall back to house/techno/EDM sounds when the brief or genre describes something else. Do not add pumping, sweeping EDM filters or club-style reverbs to non-electronic genres.

GENRE PALETTE (selected genre only):
${palette}

OSCILLATOR TYPES (Tone.js exact strings):
sine, triangle, sawtooth, square, fatsawtooth, fatsine, fatsquare, pwm, fmsine, fmsquare, fmsawtooth

OSCILLATOR SCHEMA (for MonoSynth / PolySynth):
{
  type: "sine" | "triangle" | "sawtooth" | "square" | "fatsawtooth" | "fatsine" | "fatsquare" | "pwm",
  count: 2-4,              // required for fat* types
  spread: 10-40,           // required for fat* types (cents)
  detune: 0-25,            // optional
  modulationFrequency: 0.1-5  // required for pwm only
}

VOICE STACK:
- count >1 -> spread required (10-60 cents)
- detune: subtle 0-5, wide 5-25

ENVELOPE (all except MembraneSynth/MetalSynth):
{
  attack: 0.005-2.0,
  decay: 0.01-3.0,
  sustain: 0-1,
  release: 0.01-5.0
}
- High density -> short ADSR
- Pads and pad-textures -> sustained envelopes, long attack/release; never use a short-stab envelope for pad-textures
- pad-textures -> attack 0.12-0.35s, decay 0.5-1.2s, sustain 0.35-0.6, release 0.6-1.5s
- Plucks -> fast decay, low sustain; for techno plucks use decay 0.18-0.30s and sustain 0-0.05

FILTER ENVELOPE (MonoSynth ONLY, mandatory for bass/lead):
{
  attack: 0.001-1.0,
  decay: 0.1-2.0,
  sustain: 0-1,
  release: 0.1-3.0,
  baseFrequency: 20-2000,
  octaves: 1-8,
  exponent: 1-3
}
- Creates expressive filter sweep
- Velocity-sensitive: higher velocity -> faster attack, higher baseFrequency

FILTER (main):
{
  type: "lowpass" | "highpass" | "bandpass" | "notch",
  frequency: 20-20000,
  Q: 0-10,
  rolloff: -12 | -24 | -48
}
- Bass -> lowpass only, rolloff -24 or -48
- Leads -> 1k-8k typical, Q 2-6

PORTAMENTO (MonoSynth only):
- Range: 0-0.3 seconds
- Typical: 0.05-0.15

MEMBRANE (MembraneSynth for kicks/toms):
{
  pitchDecay: 0.01-0.2,
  octaves: 1-10,
  envelope: { attack: 0.001-0.01, decay: 0.1-0.5, sustain: 0, release: 0.1-0.5 }
}

METAL (MetalSynth for rims/bells/claps):
{
  harmonicity: 0.5-10,
  modulationIndex: 1-50,
  resonance: 100-10000,
  octaves: 0-5,
  envelope: { attack: 0.001-0.01, decay: 0.05-0.3, sustain: 0, release: 0.05-0.3 }
}

FX (flat schema, supported by renderer):
[
  { type: "Distortion", distortion: 0-0.8, wet: 0-0.5 },
  { type: "Chebyshev", order: 1-10, wet: 0-0.3 },
  { type: "BitCrusher", bits: 4-16, wet: 0-0.3 },
  { type: "AutoFilter", frequency: "4n"|"8n"|number, baseFrequency: 20-2000, octaves: 1-6, wet: 0-0.6 },
  { type: "Chorus", frequency: 1.5-10, depth: 0.1-0.9, wet: 0-0.5 },
  { type: "Phaser", frequency: 0.1-10, octaves: 1-6, wet: 0-0.5 },
  { type: "Tremolo", frequency: "4n"|number, depth: 0-0.8, wet: 0-0.5 },
  { type: "PingPongDelay", delayTime: "4n"|"8n"|"16n", feedback: 0-0.5, wet: 0-0.4 },
  { type: "Reverb", decay: 0.5-10, wet: 0-0.7, preDelay: 0-0.1 }
]

FX ORDER: Distortion -> Chebyshev/BitCrusher -> AutoFilter -> Chorus/Phaser -> Tremolo -> PingPongDelay -> Reverb

MODULATION (optional for movement in pads/leads):
{
  lfo: {
    type: "sine"|"triangle"|"square"|"sawtooth",
    frequency: "4n"|"8n"|number,
    min: 0-10000,
    max: 0-10000,
    target: "filter.frequency"|"detune"|"volume"
  }
}

ARTIST SIGNATURE (only when explicitly requested):
${artistSignature}

SCHEMA (STRICT - include only keys relevant to chosen instrumentType):
{
  instrumentType: "MonoSynth" | "PolySynth" | "FMSynth" | "AMSynth" | "MembraneSynth" | "MetalSynth",
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
  designRationale: "max 30 words explaining choices"
}

INVALID:
- filterEnvelope on non-MonoSynth
- portamento on PolySynth
- count/spread on non-fat oscillator type
- reverb wet >0.1 on bassline
- NoiseSynth (not supported)
`;
}

export function buildUserPrompt(
  trackType,
  genre,
  mood,
  scale,
  key,
  midi,
  isMultitrack = false,
  brief = null
) {
  const instrumentRec = {
    bassline: 'MonoSynth (filterEnvelope + portamento mandatory)',
    lead: 'MonoSynth (filterEnvelope + portamento mandatory)',
    melody: 'MonoSynth or PolySynth',
    chord: 'PolySynth (polyphonic mandatory)',
    keys: 'PolySynth or PolySynth',
    pad: 'PolySynth (polyphonic, long release)',
    'pad-textures': 'PolySynth (polyphonic sustained triad layer; long attack, sustain, and release)',
    plucks: 'PolySynth (short envelope)',
    arpeggio: 'MonoSynth (filter sweep) or PolySynth',
    strings: 'PolySynth (detuned, wide spread)',
    guitar: 'PolySynth or PolySynth',
    brass: 'MonoSynth or PolySynth (punchy filter)',
    percs: 'MembraneSynth (kick/tom) OR MetalSynth (rim/clap/bell) — NO NoiseSynth'
  };
  const briefText = brief && (brief.title || brief.description || brief.userPrompt)
    ? `CREATIVE BRIEF (highest priority; overrides the Genre field if they conflict):
${brief.title ? `Title: ${brief.title}\n` : ''}${brief.description ? `Description: ${brief.description}\n` : ''}${brief.userPrompt ? `User request: ${brief.userPrompt}\n` : ''}Resolved genre: ${genre}

`
    : '';
  return `${briefText}Track:${trackType} | Genre:${genre} | Mood:${mood} | Key:${key}${scale}
INSTRUMENT RECOMMENDATION: ${instrumentRec[trackType] || 'PolySynth'}
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
- ${trackType === 'chord' || trackType === 'pad' || trackType === 'pad-textures' || trackType === 'strings' ? 'MANDATORY: Use PolySynth with multiple voices' : ''}
- ${trackType === 'pad-textures' ? 'PAD TEXTURE (MANDATORY; OVERRIDES MIDI envHint): Create a sustained, evolving triad layer, not a short chord stab. Envelope attack 0.12-0.35s, decay 0.5-1.2s, sustain 0.35-0.6, release 0.6-1.5s. Prefer a warm saw/fatsaw oscillator with restrained detuning; use a broad lowpass or gentle bandpass that retains midrange body. Moderate chorus/reverb only; do not compensate for a short envelope with excessive FX.' : ''}
- ${trackType === 'plucks' && String(genre).toLowerCase() === 'techno' ? 'TECHNO PLUCK: Keep a sharp transient but retain audible body: attack 0.005-0.015s, decay 0.18-0.30s, sustain 0-0.05, release 0.08-0.18s. Prefer lowpass 4-7kHz or a broad bandpass with Q no higher than 1.2; avoid a narrow high-Q bandpass. Keep volume around -16 to -14dB and delay wet at or below 0.12.' : ''}
- ${trackType === 'percs' ? 'MANDATORY: Use MembraneSynth (kick/tom) or MetalSynth (clap/rim) — no oscillator' : ''}
${isMultitrack ? `MIX MODE (STRICT): - Apply gain staging - Respect loudness priority - Apply density compensation - Apply FX compensation - Use stereo field correctly - Avoid masking (no identical brightness layers)` : ''}
Output RAW JSON only.`;
}

function sanitizeBrief(b) {
  if (!b || typeof b !== 'object') return null;
  const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
  const out = { title: clean(b.title, 120), description: clean(b.description, 500), userPrompt: clean(b.userPrompt, 600) };
  return out.title || out.description || out.userPrompt ? out : null;
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
