export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, model } = await req.json();

        if (!prompt) {
            return new Response(JSON.stringify({ error: 'Invalid prompt' }), { status: 400 });
        }

        const apiKey = process.env.POLLINATIONS_GEN_KEY || '';

        const payload = {
            messages: [
                {
                    role: 'system',
                    content: 'You are a creative musical AI. You must output ONLY valid JSON containing musical track data."IMPORTANT: All track data MUST be enclosed in double quotes. Example: "bass": "43:0:1:9|..." and NOT "bass": 43:0:1:9"'
                },
                { role: 'user', content: prompt }
            ],
            model: model || 'openai-large',
            temperature: 0.7,
            stream: true, // 1. Ενεργοποίηση streaming από τον πάροχο
            max_tokens: 4096,
        };

        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        });

        if (!pollResponse.ok) {
            return new Response(pollResponse.body, { status: pollResponse.status });
        }

        // 2. Επιστρέφουμε το stream απευθείας στον χρήστη
        // Χρησιμοποιούμε το 'text/event-stream' για SSE (Server-Sent Events)
        return new Response(pollResponse.body, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
