export const config = { 
    runtime: 'edge', 
    timeout: 50  // ✅ ΜΟΝΗ ΑΛΛΑΓΗ: 55 → 50 (backend timeout)
};

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, model, enhancedPrompt } = await req.json();

        if (!prompt || typeof prompt !== 'string') {
            return new Response(JSON.stringify({ error: 'Invalid prompt' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ✅ ΙΔΙΟ ΜΕ ΠΡΙΝ: POLLINATIONS_GEN_KEY
        const apiKey = process.env.POLLINATIONS_GEN_KEY || '';

        // ✅ ΑΛΛΑΓΗ: Χρησιμοποιούμε enhancedPrompt αν υπάρχει
        const finalPrompt = enhancedPrompt || prompt;

        const payload = {
            messages: [
                {
                    role: 'system',
                    content: 'You are a creative musical AI. You must output ONLY valid JSON containing musical track data, no markdown, no preamble.'
                },
                {
                    role: 'user',
                    content: finalPrompt  // ✅ ΑΛΛΑΓΗ: χρησιμοποιούμε finalPrompt
                }
            ],
            model: model || 'openai-large',  // ✅ ΑΛΛΑΓΗ: 'openai-large' → 'openai'
            temperature: 0.7,
            max_tokens: 4096,
            seed: -1
            // ✅ ΑΦΑΙΡΕΘΗΚΑΝ: reasoning_effort και reasoning (δεν υποστηρίζονται)
        };

        console.log('[EDGE] Calling Pollinations...');
        
        // ✅ ΙΔΙΟ ΜΕ ΠΡΙΝ: Ίδιο endpoint και headers
        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGenerator/1.0',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        });

        console.log('[EDGE] Status:', pollResponse.status);

        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            console.error('[EDGE] Error:', errorText);
            return new Response(
                JSON.stringify({ error: `${pollResponse.status}: ${errorText}` }), 
                { 
                    status: pollResponse.status,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }

        const jsonData = await pollResponse.json();
        console.log('[EDGE] Got JSON response');

        // ✅ ΙΔΙΟ ΜΕ ΠΡΙΝ: Εξάγουμε το content από την απάντηση του LLM
        let content = '';
        if (jsonData.choices?.[0]?.message?.content) {
            content = jsonData.choices[0].message.content;
        } else if (jsonData.choices?.[0]?.text) {
            content = jsonData.choices[0].text;
        } else {
            content = JSON.stringify(jsonData);
        }

        // ✅ ΙΔΙΟ ΜΕ ΠΡΙΝ: Επιστρέφουμε απευθείας JSON
        return new Response(
            JSON.stringify({ content }), 
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            }
        );

    } catch (err) {
        console.error('[EDGE] Fatal error:', err);
        return new Response(
            JSON.stringify({ error: err.message }), 
            { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}
