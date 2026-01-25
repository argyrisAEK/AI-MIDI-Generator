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

        const apiKey = process.env.POLLINATIONS_GEN_KEY || ''; // Αν έχεις κλειδί, αλλιώς κενό

        // Κατασκευή του payload σύμφωνα με το νέο format που έστειλες
        const payload = {
            messages: [
                {
                    role: 'system',
                    content: 'You are a creative musical AI. You must output ONLY valid JSON containing musical track data.',
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            model: model || 'openai', // Το default μοντέλο
            stream: true,             // ΕΝΕΡΓΟΠΟΙΗΣΗ STREAMING
            frequency_penalty: 0,
            presence_penalty: 0,
            temperature: 0.8,
            top_p: 1,
            response_format: {
                type: 'json_object'   // Ζητάμε ρητά JSON για να μην χαλάσει ο parser
            },
            seed: Math.floor(Math.random() * 10000)
        };

        const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Αν το Pollinations ζητάει Auth (συνήθως είναι free, αλλά αν έχεις κλειδί):
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Upstream error:', errorText);
            return new Response(`Pollinations API Error: ${response.status}`, { status: 502 });
        }

        // Passthrough: Επιστρέφουμε το stream του Pollinations απευθείας στον browser
        // Αυτό κρατάει το Vercel function ζωντανό
        return new Response(response.body, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            }
        });

    } catch (err) {
        console.error('Generate error:', err);
        return new Response('Generation failed', { status: 500 });
    }
}
