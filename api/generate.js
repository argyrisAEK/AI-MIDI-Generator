export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const { prompt, seed, model } = await req.json();
        const apiKey = process.env.POLLINATIONS_GEN_KEY;
        const url = `https://gen.pollinations.ai/text/${encodeURIComponent(prompt)}?seed=${seed}&key=${apiKey}&model=${model}`;

        const response = await fetch(url);
        const data = await response.text();

        return new Response(data, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
