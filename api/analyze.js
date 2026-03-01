export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let prompt, model;
    try {
        ({ prompt, model } = await req.json());
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return jsonError('Missing or invalid prompt parameter', 400);
    }

    const apiKey = process.env.POLLINATIONS_ANALYZE_KEY || '';

    const payload = {
        messages: [
            {
                role: 'system',
                content: 'You are a music analysis AI. Output ONLY valid JSON. No markdown, no explanation, no preamble.'
            },
            { role: 'user', content: prompt }
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

        return new Response(content, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
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
