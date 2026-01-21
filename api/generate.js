export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, model, stream = true } = await req.json();

        const apiKey = process.env.POLLINATIONS_GEN_KEY; // sk_... key από enter.pollinations.ai
        if (!apiKey) {
            return new Response('Missing API Key', { status: 500 });
        }

        // Νέο unified endpoint για chat completions
        const url = `https://gen.pollinations.ai/v1/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'claude', // π.χ. 'openai', 'mistral', 'qwen-coder'
                messages: [{ role: 'user', content: prompt }],
                stream: stream,
                jsonMode: true
            })
        });

        if (!response.ok) {
            const error = await response.text();
            return new Response(`Upstream error: ${error}`, { status: response.status });
        }

        // Επιστροφή του stream απευθείας στον client
        return new Response(response.body, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (err) {
        return new Response(err.message, { status: 500 });
    }
}
