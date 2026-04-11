const FREE_LIMIT = 2;
const WINDOW_DAYS = 30;

/** Returns caller's identifier: User ID (priority) or IP (fallback) */
function getClientIdentifier(req) {
  const userId = req.headers.get('x-user-id');
  if (userId && userId.startsWith('usr_')) return userId;
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** Check + increment usage counter with 30-day rolling window */
async function checkRateLimit(identifier) {
  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!kvUrl || !kvToken) {
    console.warn('[RATE-LIMIT] KV not configured — skipping');
    return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
  }

  const firstUseKey = `rl:midi:${identifier}:window_start`;
  const countKey    = `rl:midi:${identifier}:count`;

  try {
    const [firstUseRes, countRes] = await Promise.all([
      fetch(`${kvUrl}/get/${firstUseKey}`, { headers: { Authorization: `Bearer ${kvToken}` } }),
      fetch(`${kvUrl}/get/${countKey}`,    { headers: { Authorization: `Bearer ${kvToken}` } }),
    ]);

    const { result: firstUse } = await firstUseRes.json();
    const { result: countRaw } = await countRes.json();
    const currentCount = parseInt(countRaw || '0', 10);
    const now = new Date();

    let windowStart, windowExpiry;
    if (firstUse) {
      windowStart  = firstUse;
      const startDate = new Date(firstUse);
      windowExpiry = new Date(startDate);
      windowExpiry.setDate(startDate.getDate() + WINDOW_DAYS);
    } else {
      windowStart  = now.toISOString();
      windowExpiry = new Date(now);
      windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
    }

    if (firstUse && now > windowExpiry) {
      console.log(`[RATE-LIMIT] Window expired for ${identifier}, resetting...`);
      await Promise.all([
        fetch(`${kvUrl}/del/${firstUseKey}`, { headers: { Authorization: `Bearer ${kvToken}` } }),
        fetch(`${kvUrl}/del/${countKey}`,    { headers: { Authorization: `Bearer ${kvToken}` } }),
      ]);
      windowStart  = now.toISOString();
      windowExpiry = new Date(now);
      windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
    }

    // INCR first για race condition protection
    const incrRes = await fetch(`${kvUrl}/incr/${countKey}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const { result: newCount } = await incrRes.json();

    if (newCount === 1 || !firstUse || (firstUse && now > windowExpiry)) {
      await Promise.all([
        fetch(`${kvUrl}/set/${firstUseKey}/${windowStart}/ex/${WINDOW_DAYS * 86400}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        }),
        fetch(`${kvUrl}/expire/${countKey}/${WINDOW_DAYS * 86400}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        }),
      ]); 
    }

    if (newCount > FREE_LIMIT) {
      await fetch(`${kvUrl}/decr/${countKey}`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
      console.log(`[RATE-LIMIT] identifier=${identifier} BLOCKED count=${newCount}/${FREE_LIMIT}`);
      return { allowed: false, remaining: 0, resetAt: windowExpiry.getTime() };
    }

    const remaining = Math.max(0, FREE_LIMIT - newCount);
    const allowed   = newCount <= FREE_LIMIT;
    console.log(`[RATE-LIMIT] identifier=${identifier} count=${newCount}/${FREE_LIMIT} allowed=${allowed}`);

    return { allowed, remaining, resetAt: windowExpiry.getTime() };
  } catch (err) {
    console.error('[RATE-LIMIT] KV error:', err.message);
    return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
  }
}

// ── Scale Notes Helper ──────────────────────────────────────────────
const SCALE_INTERVALS = {
  major:              [0,2,4,5,7,9,11],
  minor:              [0,2,3,5,7,8,10],
  aeolian:            [0,2,3,5,7,8,10],
  dorian:             [0,2,3,5,7,9,10],
  phrygian:           [0,1,3,5,7,8,10],
  lydian:             [0,2,4,6,7,9,11],
  mixolydian:         [0,2,4,5,7,9,10],
  locrian:            [0,1,3,5,6,8,10],
  'harmonic-minor':   [0,2,3,5,7,8,11],
  'melodic-minor':    [0,2,3,5,7,9,11],
  pentatonic:         [0,2,4,7,9],
  'minor-pentatonic': [0,3,5,7,10],
  blues:              [0,3,5,6,7,10],
};

const NOTE_NAMES = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };

function getScaleNotes(key, scale) {
  const root = NOTE_NAMES[key] ?? 0;
  const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.major;
  const notes = intervals.map(i => (root + i) % 12);
  return notes.join(',');
}

// ── Track Instructions (Optimized) ──────────────────────────────────
const trackInstructions = {
  bassline:       "MIDI:36-52,monophonic,mostly-roots,STRICT-SCALE-ONLY,duration:1.0-4.0,vel:7-9,leave 15% rests",
  chord:          "MIDI:48-72,polyphonic(3-4 notes),mid-range,block-voicings,vel:5-7",
  melody:         "MIDI:60-84,monophonic,expressive-phrasing,call-response,20% rests,vel:5-8",
  arpeggio:       "MIDI:55-84,8th-or-16th-notes,chord-tones,rhythmic-pulsing,steady-vel:4-6",
  lead:           "MIDI:60-88,monophonic,legato,soaring-solo,high-energy,vel:6-9",
  plucks:         "MIDI:60-84,staccato,short-decay,percussive-rhythms,syncopated,vel:6-8",
  strings:        "MIDI:48-79,sustained,slow-attack,harmonic-pads,low-velocity,vel:3-5",
  keys:           "MIDI:48-76,rhythmic-comping,syncopated,jazz/pop-voicings,vel:4-7",
  guitar:         "MIDI:40-76,strummed-patterns,open-voicings,organic-strum,vel:5-7",
  'pad-textures': "MIDI:45-72,ultra-long-notes,ambient-wash,static-harmony,low-vel:2-4",
  brass:          "MIDI:42-79,punchy-stabs,syncopated-accents,short-attack,forte-vel:7-9",
  percs:          "MIDI:60-72,non-melodic,rhythmic-fills,high-velocity-variation(4-9),leave space"
};

const trackAbbreviations = {
  bassline: 'bass', chord: 'chd', melody: 'mel', arpeggio: 'arp',
  lead: 'lead', plucks: 'plk', strings: 'str', keys: 'keys',
  guitar: 'gtr', 'pad-textures': 'pad', brass: 'brss', percs: 'perc'
};

// ── Structural Guidance (Fixed Backticks + Generic Fallback) ───────
function getStructuralGuidance(bars, beatsPerBar) {
  const totalBeats = bars * beatsPerBar;
  const peakBar = Math.ceil(bars * 0.7);
  const resolveBeat = totalBeats - 0.5;
  
  if (bars === 4) {
    return `STRUCTURE:Call(1-2)→Response(3-4)|ENERGY:Statement→Stability→Variation→Resolution|B3-4:+density,add turnaround fill|RESOLVE:all tracks to root by beat ${resolveBeat}|LOOP_GAP:last 0.25 beats empty`;
  }
  if (bars === 8) {
    return `STRUCTURE:A(1-2)→A'(3-4)→B(5-6)→A''(7-8)|ENERGY:Steady→Rise→Contrast→Climax|B5-6:new rhythm/melody,NO REPEAT|B7-8:return motif,+1vel downbeats|RESOLVE:by beat ${resolveBeat}|LOOP_GAP:last 0.25 beats empty`;
  }
  // Generic fallback για 2, 16, 32 κλπ.
  return `STRUCTURE:Motif(1-${Math.ceil(bars/4)})→Development(${Math.ceil(bars/4)+1}-${peakBar})→Climax(${peakBar+1}-${bars-1})→Resolution(${bars})|ENERGY:gradual build,peak@bar ${peakBar}|RESOLVE:to root by beat ${resolveBeat}|LOOP_GAP:last 0.25 beats empty|NOTE:divide ${bars} bars into 4 equal phases, stagger track entries`;
}

// ── PromptBuilder (Optimized & Clean) ───────────────────────────────
class PromptBuilder {
  constructMultiTrackPrompt(params = {}) {
    try {
      const key = params.key || 'C';
      const bpm = Math.max(40, Math.min(300, parseInt(params.bpm || params.tempo) || 120));
      const bars = Math.max(1, Math.min(64, parseInt(params.duration_bars || params.duration) || 4));
      const style = params.style || 'house';
      const mood = params.mood || 'neutral';
      const trackTypes = Array.isArray(params.trackTypes) ? params.trackTypes : [];
      const complexityMap = { simple: 'simple', moderate: 'moderate', medium: 'moderate', complex: 'complex' };
      const complexity = complexityMap[(params.rhythmicComplexity || 'moderate').toLowerCase()] || 'moderate';
      const timeSignature = params.timeSignature || '4/4';
      const scale = params.scale || params.scaleType || 'major';
      const enhancedPrompt = params.enhancedPrompt || '';

      const validTracks = Object.keys(trackInstructions);
      const tracks = trackTypes.filter(t => validTracks.includes(t));
      if (tracks.length === 0) tracks.push('melody', 'bassline');

      const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
      const totalBeats = beatsPerBar * bars;

      const trackList = tracks.map(t => `${trackAbbreviations[t]}(${trackInstructions[t]})`).join(' ');
      const trackSchema = tracks.map(t => `"${trackAbbreviations[t]}":""`).join(',');
      const scaleNotes = getScaleNotes(key, scale);
      const structuralGuidance = getStructuralGuidance(bars, beatsPerBar);

      const prompt = [
        `CFG:key=${key},scale=${scale},bpm=${bpm},style=${style},mood=${mood},time=${timeSignature},bars=${bars},beats=${totalBeats},cmp=${complexity}`,
        enhancedPrompt ? `CONTEXT:${enhancedPrompt}` : '',
        `SCALE_NOTES:[${scaleNotes}]`,
        `TASK:Compose tight loopable multi-track MIDI. HARMONY:ONLY scale notes.`,
        `LOOP:seamless. Resolve all tension by beat ${totalBeats - 1}. Leave 0.25 beats empty at end.`,
        `RHYTHM:beats 0..${totalBeats - 0.001}. dur≥0.25. No overlaps past end.`,
        `DENSITY:${complexity === 'simple' ? 'sparse, leave breathing room' : complexity === 'complex' ? 'rich but not cluttered' : 'moderate — quality over quantity'}.`,
        `VELOCITY:vary 1-9. Accent downbeats(7-9), offbeats(3-6), ghosts(1-2). Never flat.`,
        `VOICE_LEADING:stepwise preferred, leaps<7st. Bass<55, Melody>60. Max 3 notes/track.`,
        `GROOVE:stagger entries(bass→chords→melody/lead).`,
        `${structuralGuidance}`,
        `FORMAT:pitch:beat:dur:vel (pitch=int, beat/dur=float≥0.25, vel=1-9)`,
        `TRACKS:${trackList}`,
        `RETURN:ONLY valid JSON. NO_TEXT. NO_MARKDOWN.`,
        `JSON:{"title":"","desc":"max 20 words","tracks":{${trackSchema}}}`
      ].filter(Boolean).join(' ');

      console.log('[PromptBuilder] Generated enhanced prompt');
      return prompt;
    } catch (error) {
      console.error('PromptBuilder error:', error);
      return `CFG:key=C,bpm=120,style=house,time=4/4,bars=4,cmp=mod TRACKS:mel(MIDI:60-84) bass(MIDI:36-52) FORMAT:pitch:beat:dur:vel OUT:{"title":"","desc":"","tracks":{"mel":"","bass":""}}`;
    }
  }
}

// ── Edge Handler ────────────────────────────────────────────────────
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let promptParams, model, userApiKey;
  try {
    ({ promptParams, model, userApiKey } = await req.json());
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  if (!promptParams || typeof promptParams !== 'object') {
    return jsonError('Invalid promptParams', 400);
  }

  const hasByopKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0;
  let remainingGenerations = FREE_LIMIT;

  if (!hasByopKey) {
    const clientIdentifier = getClientIdentifier(req);
    const { allowed, remaining, resetAt } = await checkRateLimit(clientIdentifier);
    remainingGenerations = remaining;
    
    console.log(`[RATE-LIMIT] identifier=${clientIdentifier} allowed=${allowed} remaining=${remaining}`);

    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: 'daily_limit_reached',
          message: `You have used your ${FREE_LIMIT} free generations for this 30-day period.`,
          resetAt,
          requiresByop: true
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } else {
    console.log('[RATE-LIMIT] BYOP key detected — skipping rate limit');
    remainingGenerations = 999;
  }

  let prompt;
  try {
    const builder = new PromptBuilder();
    prompt = builder.constructMultiTrackPrompt(promptParams);
  } catch (err) {
    console.error('[EDGE] PromptBuilder error:', err);
    return jsonError('Failed to build prompt', 500);
  }

  const apiKey = hasByopKey ? userApiKey.trim() : (process.env.POLLINATIONS_GEN_KEY || '');

  const payload = {
    messages: [
      { role: 'system', content: 'You are an expert MIDI composer and music theory specialist. You produce tight, professional, genre-accurate MIDI arrangements. You output ONLY valid JSON — no markdown, no explanation, no preamble, no trailing text. Every note you write is musically justified: correct scale, correct register, correct rhythm for the genre. You never output notes outside the given scale or beat range.' },
      { role: 'user', content: prompt }
    ],
    model: model || 'midijourney',
    temperature: 0.75,
    max_tokens: 5096,
    seed: -1,
    response_format: { type: 'json_object' },
    stream: true
  };

  const TIMEOUT_MS = 25_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MIDIGenerator/1.0',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(payload)
    }).catch(err => {
      if (err.name === 'AbortError') throw new Error('Request to Pollinations timed out after 25s');
      throw err;
    });

    clearTimeout(timeoutId);

    if (!pollResponse.ok) {
      const errorText = await pollResponse.text();
      return jsonError(`Pollinations ${pollResponse.status}: ${errorText}`, pollResponse.status);
    }

    const contentType = pollResponse.headers.get('content-type') || '';
    const isSSE = contentType.includes('text/event-stream');

    if (isSSE) {
      let buffer = '';
      const { readable, writable } = new TransformStream({
        transform(chunk, controller) {
          buffer += new TextDecoder().decode(chunk);
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') return;
            try {
              const parsed = JSON.parse(data);
              const content = parsed?.choices?.[0]?.delta?.content;
              if (content) controller.enqueue(new TextEncoder().encode(content));
            } catch { /* Incomplete JSON frame */ }
          }
        },
        flush(controller) {
          if (!buffer.trim()) return;
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim();
            if (data && data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data);
                const content = parsed?.choices?.[0]?.delta?.content;
                if (content) controller.enqueue(new TextEncoder().encode(content));
              } catch { /* ignore */ }
            }
          }
        }
      });
      pollResponse.body.pipeTo(writable).catch(err => console.error('[EDGE] SSE pipe error:', err));
      return streamResponse(readable, remainingGenerations, hasByopKey);
    } else {
      const jsonData = await pollResponse.json();
      let content = jsonData?.choices?.[0]?.message?.content || jsonData?.choices?.[0]?.text || JSON.stringify(jsonData);
      if (!content || content.trim().length === 0) return jsonError('Pollinations returned empty content', 500);
      
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(content));
          controller.close();
        }
      });
      return streamResponse(stream, remainingGenerations, hasByopKey);
    }
  } catch (err) {
    console.error('[EDGE] Fatal error:', err);
    return jsonError(err.message, 500);
  }
}

function streamResponse(readable, remaining, isByop) {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    'Access-Control-Expose-Headers': 'X-Remaining-Generations'
  };
  if (isByop) {
    headers['X-Remaining-Generations'] = 'BYOP';
  } else if (remaining !== null && remaining !== undefined) {
    headers['X-Remaining-Generations'] = String(remaining);
  }
  return new Response(readable, { status: 200, headers });
}

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
