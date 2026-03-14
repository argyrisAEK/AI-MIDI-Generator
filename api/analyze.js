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
const VALID_DURATIONS = ["4", "8"];
const VALID_STYLES = ["house", "techno", "trance", "trap", "hip-hop", "rock", "pop", "funk", "reggae", "jazz", "disco", "classical", "ambient", "drum-and-bass", "synthwave", "downtempo", "progressive-rock", "cinematic"];
const VALID_MOODS = ["peaceful", "energetic", "melancholic", "happy", "dark", "mysterious", "dreamy", "intense", "ethereal", "groovy"];
const VALID_COMPLEXITIES = ["simple", "moderate", "complex"];
const VALID_TIME_SIGNATURES = ["4/4", "3/4", "6/8", "5/4", "7/8"];
const VALID_STRUCTURES = ["intro", "build", "verse", "chorus", "bridge"];

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let userPrompt, model;
    try {
        const body = await req.json();
        userPrompt = body.userPrompt || body.prompt;
        model = body.model;
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim().length === 0) {
        return jsonError('Missing or invalid userPrompt parameter', 400);
    }

    const analysisPrompt = `Analyze the user's musical request to extract parameters for a MIDI generation tool. Respond ONLY with a single raw JSON object.
The JSON object must have two top-level keys: "extractedParams" and "enhancedPrompt".
1. "extractedParams": { "key", "bpm", "duration_bars", "style", "mood", "trackTypes", "rhythmicComplexity", "timeSignature", "structure" }.
Extract parameters strictly based on the user's text.
Translate key to one of: ${VALID_KEYS.join(', ')}.
Style must be one of: ${VALID_STYLES.join(', ')}.
Mood must be one of: ${VALID_MOODS.join(', ')}.
Rhythmic complexity must be one of: ${VALID_COMPLEXITIES.join(', ')}.
Track types must be from: ${AVAILABLE_TRACKS.join(', ')}.
Duration in bars must be one of: ${VALID_DURATIONS.join(', ')}.
2. "enhancedPrompt": A SHORT enhanced version (max 50 words) of the user's request with musical details and clarity. Keep it concise and direct.

User request: "${userPrompt}"

Return ONLY valid JSON, no markdown, no preamble.`;

    const apiKey = process.env.POLLINATIONS_ANALYZE_KEY || '';

    const payload = {
        messages: [
            {
                role: 'system',
                content: 'You are a music analysis AI. Output ONLY valid JSON. No markdown, no explanation, no preamble.'
            },
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
            return jsonError(`Pollinations error: ${response.status} ${errorText}`, response.status);
        }

        const jsonData = await response.json();

        let content = '';
        if (jsonData?.choices?.[0]?.message?.content) {
            content = jsonData.choices[0].message.content;
        } else if (jsonData?.choices?.[0]?.text) {
            content = jsonData.choices[0].text;
        } else {
            content = JSON.stringify(jsonData);
        }

        if (!content || content.trim().length === 0) {
            return jsonError('Empty response from Pollinations', 502);
        }

        let jsonText = content.trim();
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonText = jsonMatch[0];
        }

        let result;
        try {
            result = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('JSON parse failed. Raw response:', content);
            return jsonError(`Invalid JSON from analysis: ${parseError.message}`, 502);
        }

        if (!result.extractedParams || !result.enhancedPrompt) {
            return jsonError('Analysis response missing required keys: extractedParams and/or enhancedPrompt', 502);
        }

        if (result.extractedParams.trackTypes && Array.isArray(result.extractedParams.trackTypes)) {
            result.extractedParams.trackTypes = result.extractedParams.trackTypes
                .slice(0, 5)
                .filter(t => AVAILABLE_TRACKS.includes(t));
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
            const closest = VALID_DURATIONS
                .map(v => parseInt(v))
                .reduce((prev, curr) =>
                    Math.abs(curr - raw) < Math.abs(prev - raw) ? curr : prev
                );
            result.extractedParams.duration_bars = closest;
        }

        const truncatedPrompt = result.enhancedPrompt
            ? result.enhancedPrompt.substring(0, 500).trim()
            : '';

        return new Response(JSON.stringify({
            extractedParams: result.extractedParams,
            enhancedPrompt: truncatedPrompt
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            return jsonError('Request timeout', 504);
        }
        return jsonError(err.message || 'Internal server error', 500);
    }
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
