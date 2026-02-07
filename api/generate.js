export const config = { 
    runtime: 'edge', 
    timeout: 50
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

        const apiKey = process.env.POLLINATIONS_GEN_KEY || '';
        const finalPrompt = enhancedPrompt || prompt;

        // ✅ STRENGTHENED SYSTEM PROMPT - Forces exact format compliance
        const systemPrompt = `You are a MIDI data generator. You MUST output ONLY valid JSON in this EXACT format:

{"title":"Song Title","desc":"Brief description","tracks":{"trackname":"pitch:beat:dur:vel|pitch:beat:dur:vel|..."}}

CRITICAL RULES:
1. Output ONLY the JSON object - NO markdown, NO code blocks, NO explanations
2. The "tracks" object is MANDATORY
3. Track names MUST match the abbreviations requested (mel, bass, chd, etc.)
4. Note format is ALWAYS: pitch:beat:duration:velocity separated by |
5. Pitch = MIDI number (e.g., 60)
6. Beat = decimal number (e.g., 0, 0.5, 1, 2.5)
7. Duration = decimal beats (e.g., 0.5, 1, 2)
8. Velocity = integer 1-9 (represents 10%-90% intensity)
9. Use decimals as .5 not 0.5
10. NO metadata objects, NO instrumentation arrays, NO chord progressions - ONLY the format above

Example valid output:
{"title":"Example","desc":"Short desc","tracks":{"mel":"60:0:.5:8|64:1:.5:7|67:2:1:9","bass":"36:0:1:9|36:2:1:8"}}

REJECT any other format. Start your response with { and end with }`;

        const payload = {
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: finalPrompt
                }
            ],
            model: model || 'openai-large',
            temperature: 0.3,  // ✅ Lower temperature for more deterministic output
            max_tokens: 4096,
            seed: -1
        };

        console.log('[EDGE] Calling Pollinations...');
        console.log('[EDGE] Model:', payload.model);
        console.log('[EDGE] Temperature:', payload.temperature);
        
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

        // Εξάγουμε το content από την απάντηση του LLM
        let content = '';
        if (jsonData.choices?.[0]?.message?.content) {
            content = jsonData.choices[0].message.content;
        } else if (jsonData.choices?.[0]?.text) {
            content = jsonData.choices[0].text;
        } else {
            content = JSON.stringify(jsonData);
        }

        // ✅ Extra validation: Check if response contains "tracks"
        if (!content.includes('"tracks"')) {
            console.error('[EDGE] Response missing "tracks" key');
            console.error('[EDGE] Response preview:', content.substring(0, 200));
            return new Response(
                JSON.stringify({ 
                    error: 'AI returned invalid format - missing tracks object',
                    hint: 'The AI might need a different model or prompt adjustment'
                }), 
                { 
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }

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
