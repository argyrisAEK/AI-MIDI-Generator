export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, model } = await req.json();

        if (!prompt || typeof prompt !== 'string') {
            return new Response('Invalid prompt', { status: 400 });
        }

        const apiKey = process.env.POLLINATIONS_GEN_KEY;
        if (!apiKey) {
            return new Response('Server misconfiguration', { status: 500 });
        }

        /**
         * CRITICAL:
         * - text endpoint
         * - streaming passthrough
         * - NO JSON parsing here
         */
        const url =
            `https://gen.pollinations.ai/text/` +
            encodeURIComponent(prompt) +
            `?model=${encodeURIComponent(model || 'claude')}` +
            `&json=true`;

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${apiKey}`
           
            }
        });

        if (!response.ok || !response.body) {
            return new Response(
                `Upstream error ${response.status}`,
                { status: 502 }
            );
        }

        /**
         * PASSTHROUGH STREAM
         * This keeps the edge function alive indefinitely
         */
        return new Response(response.body, {
            status: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        });

    } catch (err) {
        console.error('Generate error:', err);
        return new Response('Generation failed', { status: 500 });
    }
}
