export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    const { trackType, genre, mood, scale, key, userApiKey } = body;

    if (!trackType) return jsonError('Missing trackType', 400);

    const apiKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0
        ? userApiKey.trim()
        : (process.env.POLLINATIONS_GEN_KEY || '');

    const prompt = buildSynthesisPrompt(trackType, genre, mood, scale, key);

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
                    {
                        role: 'system',
                        content: 'You are an expert sound designer for Tone.js. You output ONLY valid JSON — no markdown, no explanation. All values must be valid Tone.js parameters.'
                    },
                    { role: 'user', content: prompt }
                ],
                model: 'openai-large',
                temperature: 0.5,
                max_tokens: 800,
                stream: false
            })
        });

        if (!response.ok) {
            return jsonError(`Pollinations error: ${response.status}`, response.status);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';

        // Clean and validate JSON
        const cleaned = content.replace(/```json|```/g, '').trim();
        try {
            const settings = JSON.parse(cleaned);
            return new Response(JSON.stringify(settings), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } catch {
            return jsonError('LLM returned invalid JSON', 500);
        }

    } catch (err) {
        return jsonError(err.message, 500);
    }
}

function buildSynthesisPrompt(trackType, genre, mood, scale, key) {
    return `Generate Tone.js synthesis settings for a "${trackType}" track in a ${genre} song. ` +
        `Key: ${key || 'C'} ${scale || 'minor'}. Mood: ${mood || 'neutral'}. ` +
        `Return ONLY this JSON structure with appropriate values for the genre/mood: ` +
        `{` +
        `"oscillator": {"type": "fatsawtooth|sawtooth|square|triangle|sine|pwm|fmsine|fmsquare", "count": 1-5, "spread": 0-80},` +
        `"envelope": {"attack": 0.001-2.0, "decay": 0.05-3.0, "sustain": 0.0-1.0, "release": 0.05-5.0},` +
        `"filter": {"type": "lowpass|highpass|bandpass", "frequency": 200-18000, "Q": 0.1-20, "rolloff": -12|-24|-48},` +
        `"effects": {` +
        `"reverb": {"decay": 0.5-8.0, "wet": 0.0-0.6},` +
        `"delay": {"delayTime": "4n|8n|16n", "feedback": 0.0-0.5, "wet": 0.0-0.4},` +
        `"distortion": {"distortion": 0.0-0.8, "wet": 0.0-0.5}` +
        `},` +
        `"volume": -20.0 to 0.0` +
        `}` +
        ` Choose appropriate values for ${genre} ${trackType}. ` +
        `For pad/strings use high reverb wet (0.4-0.6), slow attack. ` +
        `For bass use low reverb (0-0.1), fast attack. ` +
        `For lead use moderate reverb + delay. ` +
        `For percs use zero reverb, fast attack/decay, no sustain.`;
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
