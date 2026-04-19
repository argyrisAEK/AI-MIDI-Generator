export const config = { runtime: 'edge' };export const config = { runtime: 'edge' };

const FREE_LIMIT = 4;
const WINDOW_DAYS = 30;

const GENRE_TIME_SIGNATURE_DEFAULTS = {
    'house': '4/4', 'techno': '4/4', 'trance': '4/4', 'trap': '4/4',
    'hip-hop': '4/4', 'rock': '4/4', 'pop': '4/4', 'funk': '4/4',
    'reggae': '4/4', 'jazz': '4/4', 'disco': '4/4', 'classical': '4/4',
    'ambient': '4/4', 'drum-and-bass': '4/4', 'synthwave': '4/4',
    'downtempo': '4/4', 'progressive-rock': '5/4', 'cinematic': '4/4', 'default': '4/4'
};

const AVAILABLE_TRACKS = ['bassline', 'chord', 'melody', 'arpeggio', 'lead', 'plucks', 'strings', 'keys', 'guitar', 'pad-textures', 'brass', 'percs'];
const VALID_KEYS = ["C", "Cm", "C#", "C#m", "Db", "Dbm", "D", "Dm", "D#", "D#m", "Eb", "Ebm", "E", "Em", "F", "Fm", "F#", "F#m", "Gb", "Gbm", "G", "Gm", "G#", "G#m", "Ab", "Abm", "A", "Am", "A#", "A#m", "Bb", "Bbm", "B", "Bm"];
const VALID_DURATIONS = ["4", "8", "16"];  // allow 16 bars
const VALID_STYLES = ["house", "techno", "trance", "trap", "hip-hop", "rock", "pop", "funk", "reggae", "jazz", "disco", "classical", "ambient", "drum-and-bass", "synthwave", "downtempo", "progressive-rock", "cinematic"];
const VALID_MOODS = ["peaceful", "energetic", "melancholic", "happy", "dark", "mysterious", "dreamy", "intense", "ethereal", "groovy"];
const VALID_COMPLEXITIES = ["simple", "moderate", "complex"];
const VALID_TIME_SIGNATURES = ["4/4", "3/4", "6/8", "5/4", "7/8"];
const VALID_STRUCTURES = ["intro", "build", "verse", "chorus", "bridge"];

/** Returns caller's identifier: User ID (priority) or IP (fallback) */
function getClientIdentifier(req) {
    const userId = req.headers.get('x-user-id');
    if (userId && userId.startsWith('usr_')) {
        return userId;
    }
    return (
        req.headers.get('x-real-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown'
    );
}

async function checkRateLimit(identifier) {
    const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
    const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!kvUrl || !kvToken) {
        console.warn('[RATE-LIMIT-ANALYZE] KV not configured — skipping');
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
    }
    
    const firstUseKey = `rl:analyze:${identifier}:window_start`;
    const countKey    = `rl:analyze:${identifier}:count`;
    
    try {
        const [firstUseRes, countRes] = await Promise.all([
            fetch(`${kvUrl}/get/${firstUseKey}`, { headers: { Authorization: `Bearer ${kvToken}` } }),
            fetch(`${kvUrl}/get/${countKey}`,    { headers: { Authorization: `Bearer ${kvToken}` } }),
        ]);
        
        const { result: firstUse } = await firstUseRes.json();
        const { result: countRaw } = await countRes.json();
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
            await Promise.all([
                fetch(`${kvUrl}/del/${firstUseKey}`, { headers: { Authorization: `Bearer ${kvToken}` } }),
                fetch(`${kvUrl}/del/${countKey}`,    { headers: { Authorization: `Bearer ${kvToken}` } }),
            ]);
            windowStart  = now.toISOString();
            windowExpiry = new Date(now);
            windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
        }

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
            return { allowed: false, remaining: 0, resetAt: windowExpiry.getTime() };
        }

        const remaining = Math.max(0, FREE_LIMIT - newCount);
        const allowed   = newCount <= FREE_LIMIT;
        return { allowed, remaining, resetAt: windowExpiry.getTime() };
        
    } catch (err) {
        console.error('[RATE-LIMIT-ANALYZE] KV error:', err.message);
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
    }
}

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    
    let userPrompt, model, userApiKey;
    try {
        const body = await req.json();
        userPrompt = body.userPrompt || body.prompt;
        model = body.model;
        userApiKey = body.userApiKey;
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim().length === 0) {
        return jsonError('Missing or invalid userPrompt parameter', 400);
    }

    const hasByopKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0;
    let remainingGenerations = FREE_LIMIT;

    if (!hasByopKey) {
        const clientIdentifier = getClientIdentifier(req);
        const { allowed, remaining, resetAt } = await checkRateLimit(clientIdentifier);
        remainingGenerations = remaining;
        
        if (!allowed) {
            return new Response(
                JSON.stringify({
                    error: 'daily_limit_reached',
                    message: `You have used your free analysis requests for this 30-day period.`,
                    resetAt,
                    requiresByop: true
                }),
                { status: 402, headers: { 'Content-Type': 'application/json' } }
            );
        }
    } else {
        remainingGenerations = 999;
    }

    const analysisPrompt = `You are a music production assistant. Analyze the user's request and extract structured parameters.
Respond ONLY with a single raw JSON object — no markdown, no explanation.

The JSON must have exactly two keys: "extractedParams" and "enhancedPrompt".

--- EXTRACTED PARAMS RULES ---
"extractedParams": {
  "key": one of ${VALID_KEYS.join(', ')} — extract root note + mode (e.g. "Am" for A minor, "F" for F major),
  "bpm": integer 40-220 — infer from genre if not stated (techno≈130, house≈124, hip-hop≈90, jazz≈120, ambient≈75),
  "duration_bars": one of ${VALID_DURATIONS.join(', ')} — default 4 if not specified,
  "style": one of ${VALID_STYLES.join(', ')},
  "mood": one of ${VALID_MOODS.join(', ')},
  "trackTypes": array from [${AVAILABLE_TRACKS.join(', ')}] — infer from genre if not specified (max 5),
  "rhythmicComplexity": one of ${VALID_COMPLEXITIES.join(', ')},
  "timeSignature": one of ${VALID_TIME_SIGNATURES.join(', ')},
  "structure": one of ${VALID_STRUCTURES.join(', ')} or null
}

--- ENHANCED PROMPT RULES (CRITICAL) ---
"enhancedPrompt": This will be sent verbatim as the USER_INTENT with highest priority in the MIDI generation engine.
Its job is to FAITHFULLY carry the user's creative vision — every specific detail, reference, vibe, and intention.

Rules for enhancedPrompt:
• PRESERVE all artist/style references (e.g. "Bodzin-style", "Burial vibe", "Arca-inspired")
• PRESERVE all specific instrument descriptions (e.g. "portamento bass", "gated snare", "supersaw lead")
• PRESERVE all structural/arrangement hints (e.g. "builds gradually", "intro only", "no melody")
• PRESERVE all emotional language (e.g. "haunting", "euphoric drop", "melancholic but driving")
• ADD musical context only if it genuinely helps (e.g. implied chord function, register suggestion)
• DO NOT water down, generalize, or replace specifics with generic terms
• Max 120 words — prioritize preservation over brevity
• Write as a direct instruction to a composer, starting with the style/vibe

User request: "${userPrompt}"
Return ONLY valid JSON, no markdown, no preamble.`;

    const apiKey = hasByopKey ? userApiKey.trim() : (process.env.POLLINATIONS_ANALYZE_KEY || '');

    const payload = {
        messages: [
            { role: 'system', content: 'You are a music analysis AI. Output ONLY valid JSON. No markdown, no explanation, no preamble.' },
            { role: 'user', content: analysisPrompt }
        ],
        model: model || 'openai',
        temperature: 0.3,
        max_tokens: 1000,
        seed: -1,
        stream: false
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGenerator/1.0',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 401 && hasByopKey) {
                return new Response(JSON.stringify({ error: 'invalid_byop_key', message: 'Your Pollinations key is no longer valid. Please reconnect.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            }
            return jsonError(`Pollinations error: ${response.status} ${errorText}`, response.status);
        }

        const jsonData = await response.json();
        let content = jsonData?.choices?.[0]?.message?.content || jsonData?.choices?.[0]?.text || JSON.stringify(jsonData);
        if (!content || content.trim().length === 0) return jsonError('Empty response from Pollinations', 502);

        let jsonText = content.trim();
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonText = jsonMatch[0];

        let result;
        try {
            result = JSON.parse(jsonText);
        } catch (parseError) {
            return jsonError(`Invalid JSON from analysis: ${parseError.message}`, 502);
        }

        if (!result.extractedParams || !result.enhancedPrompt) {
            return jsonError('Analysis response missing required keys', 502);
        }

        if (result.extractedParams.trackTypes && Array.isArray(result.extractedParams.trackTypes)) {
            result.extractedParams.trackTypes = result.extractedParams.trackTypes.slice(0, 5).filter(t => AVAILABLE_TRACKS.includes(t));
        } else {
            result.extractedParams.trackTypes = [];
        }

        if (!result.extractedParams.timeSignature && result.extractedParams.style) {
            result.extractedParams.timeSignature = GENRE_TIME_SIGNATURE_DEFAULTS[result.extractedParams.style] || '4/4';
        }

        if (result.extractedParams.bpm) {
            result.extractedParams.bpm = Math.max(40, Math.min(300, parseInt(result.extractedParams.bpm) || 120));
        } else {
            result.extractedParams.bpm = 120;
        }

        {
            const raw = parseInt(result.extractedParams.duration_bars) || 4;
            const closest = VALID_DURATIONS.map(v => parseInt(v)).reduce((prev, curr) => Math.abs(curr - raw) < Math.abs(prev - raw) ? curr : prev);
            result.extractedParams.duration_bars = closest;
        }

        const truncatedPrompt = result.enhancedPrompt ? result.enhancedPrompt.substring(0, 800).trim() : '';

        const headers = { 
            'Content-Type': 'application/json',
            'Access-Control-Expose-Headers': 'X-Remaining-Generations'
        };
        if (hasByopKey) {
            headers['X-Remaining-Generations'] = 'BYOP';
        } else if (remainingGenerations !== null && remainingGenerations !== undefined) {
            headers['X-Remaining-Generations'] = String(remainingGenerations);
        }

        return new Response(JSON.stringify({ extractedParams: result.extractedParams, enhancedPrompt: truncatedPrompt }), { status: 200, headers });

    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') return jsonError('Request timeout', 504);
        return jsonError(err.message || 'Internal server error', 500);
    }
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
