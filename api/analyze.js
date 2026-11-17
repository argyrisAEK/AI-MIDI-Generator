import { SUBGENRE_PROFILES, SUPPORTED_SUBGENRES, normalizeSubgenre, detectSubgenre } from '../lib/subgenre-profiles.mjs';

export const config = { runtime: 'edge' };

const GENRE_TIME_SIGNATURE_DEFAULTS = {
    'house': '4/4', 'techno': '4/4', 'trance': '4/4', 'trap': '4/4',
    'hip-hop': '4/4', 'rock': '4/4', 'pop': '4/4', 'funk': '4/4',
    'reggae': '4/4', 'jazz': '4/4', 'disco': '4/4', 'classical': '4/4',
    'ambient': '4/4', 'drum-and-bass': '4/4', 'synthwave': '4/4',
    'downtempo': '4/4', 'progressive-rock': '5/4', 'cinematic': '4/4', 'default': '4/4'
};

const AVAILABLE_TRACKS = ['bassline', 'chord', 'melody', 'arpeggio', 'lead', 'plucks', 'strings', 'keys', 'guitar', 'pad-textures', 'brass', 'percs'];
const VALID_KEYS = ["C", "Cm", "C#", "C#m", "Db", "Dbm", "D", "Dm", "D#", "D#m", "Eb", "Ebm", "E", "Em", "F", "Fm", "F#", "F#m", "Gb", "Gbm", "G", "Gm", "G#", "G#m", "Ab", "Abm", "A", "Am", "A#", "A#m", "Bb", "Bbm", "B", "Bm"];
const VALID_DURATIONS = ["4", "8", "16"];
const VALID_STYLES = ["house", "techno", "trance", "trap", "hip-hop", "rock", "pop", "funk", "reggae", "jazz", "disco", "classical", "ambient", "drum-and-bass", "synthwave", "downtempo", "progressive-rock", "cinematic"];
const VALID_MOODS = ["peaceful", "energetic", "melancholic", "happy", "dark", "mysterious", "dreamy", "intense", "ethereal", "groovy"];
const VALID_COMPLEXITIES = ["simple", "moderate", "complex"];
const VALID_TIME_SIGNATURES = ["4/4", "3/4", "6/8", "5/4", "7/8"];
const VALID_STRUCTURES = ["intro", "verse", "chorus", "bridge", "drop"];

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

    // Pollinations Pay μόνο: χωρίς key δεν γίνεται κλήση (καμία δωρεάν χρήση).
    const userKey = typeof userApiKey === 'string' ? userApiKey.trim() : '';
    if (!userKey) return jsonError('Connect your Pollinations account to generate', 401);
    if (!userKey.startsWith('sk_') || userKey.length > 400 || /[\r\n]/.test(userKey)) {
        return jsonError('Invalid Pollinations key', 401);
    }

    const analysisPrompt = `You are a music production assistant. Analyze the user's request and extract structured parameters.
Respond ONLY with a single raw JSON object — no markdown, no explanation.

The JSON must have exactly two keys: "extractedParams" and "enhancedPrompt".

--- EXTRACTED PARAMS RULES ---
"extractedParams": {
  "key": one of ${VALID_KEYS.join(', ')} — extract root note + mode (e.g. "Am" for A minor, "F" for F major),
  "bpm": integer 40-220 — infer from genre if not stated (techno≈130, house≈124, hip-hop≈90, jazz≈120, ambient≈75),
  "duration_bars": one of ${VALID_DURATIONS.join(', ')} — default 4 if not specified,
  "style": one of ${VALID_STYLES.join(', ')} — use the parent genre "techno" for all techno subgenres, "house" for all house subgenres, "hip-hop" for all Hip-Hop subgenres (including Trap and Drill), and "ambient" for all Ambient subgenres (including New Age),
  "subgenre": one of ${SUPPORTED_SUBGENRES.join(", ")}, or null (only set when explicitly requested or clearly implied; otherwise null),
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

    const apiKey = userKey;

    const payload = {
        messages: [
            { role: 'system', content: 'You are a music analysis AI. Output ONLY valid JSON. No markdown, no explanation, no preamble.' },
            { role: 'user', content: analysisPrompt }
        ],
        model: model || 'openai/gpt-5.6-luna',
        temperature: 0.3,
        max_tokens: 1000,
        seed: -1,
        stream: false
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 16000);

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

        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 402) {
                return new Response(JSON.stringify({ error: 'insufficient_pollen', message: 'Your Pollinations key has no Pollen or budget left.' }), { status: 402, headers: { 'Content-Type': 'application/json' } });
            }
            if (response.status === 401) {
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

        const rawStyle = typeof result.extractedParams.style === 'string'
            ? result.extractedParams.style.toLowerCase().trim().replace(/[_]+/g, '-')
            : '';
        const styleSubgenre = normalizeSubgenre(rawStyle);
        if (styleSubgenre) result.extractedParams.style = SUBGENRE_PROFILES[styleSubgenre].genre;

        const rawSubgenre = normalizeSubgenre(result.extractedParams.subgenre);
        const explicitSubgenre = detectSubgenre(userPrompt, result.extractedParams.style);
        const detectedSubgenre = explicitSubgenre || rawSubgenre || styleSubgenre;
        const profile = detectedSubgenre ? SUBGENRE_PROFILES[detectedSubgenre] : null;
        result.extractedParams.subgenre = profile && profile.genre === result.extractedParams.style
            ? detectedSubgenre
            : null;

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

        const headers = { 'Content-Type': 'application/json' };

        return new Response(JSON.stringify({ extractedParams: result.extractedParams, enhancedPrompt: truncatedPrompt }), { status: 200, headers });

    } catch (err) {
        if (err.name === 'AbortError') return jsonError('Request timeout', 504);
        return jsonError(err.message || 'Internal server error', 500);
    } finally { clearTimeout(timeoutId); }
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
