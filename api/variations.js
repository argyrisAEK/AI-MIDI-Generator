export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, seed, model } = await req.json();

        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return jsonError('Missing or invalid prompt parameter', 400);
        }

        const key = process.env.POLLINATIONS_GEN_KEY;
        if (!key) {
            return jsonError('Server configuration error', 500);
        }

        const url = `https://gen.pollinations.ai/text/${encodeURIComponent(prompt)}?key=${key}&seed=${seed || 0}&model=${model || 'openai'}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s για variations

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                return jsonError(`Pollinations ${response.status}: ${errorText}`, response.status);
            }

            // Simple streaming response - no BYOP headers needed
            return new Response(response.body, {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                },
            });

        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                return jsonError('Request timeout', 504);
            }
            throw fetchError;
        }

    } catch (error) {
        console.error('[VARIATIONS] Error:', error);
        return jsonError(error.message || 'Internal server error', 500);
    }
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
