export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const { prompt, seed, model } = await req.json();
        const key = process.env.POLLINATIONS_GEN_KEY;
        
        // Προσθέτουμε την παράμετρο stream=true στο URL
        const url = `https://gen.pollinations.ai/text/${encodeURIComponent(prompt)}?key=${key}&seed=${seed}&model=${model || 'gemini-large'}&stream=true`;

        const response = await fetch(url);

        // Αντί για await response.text(), επιστρέφουμε το body ως stream
        return new Response(response.body, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
