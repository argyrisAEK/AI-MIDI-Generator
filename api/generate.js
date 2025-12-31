export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const { prompt, seed, model } = await req.json();
        const key = process.env.POLLINATIONS_GEN_KEY;
        const url = `https://gen.pollinations.ai/text/${encodeURIComponent(prompt)}?key=${key}&seed=${seed}&model=${model || 'gemini-large'}`;

        const response = await fetch(url);
        const text = await response.text();
        return new Response(text, { status: 200 });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
