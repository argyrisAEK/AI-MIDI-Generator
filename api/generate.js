export const config = { runtime: 'edge' };

export default async function handler(req) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, seed, model } = await req.json();
        
        // Validate required parameters
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Missing or invalid prompt parameter' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const key = process.env.POLLINATIONS_GEN_KEY;
        if (!key) {
            console.error('POLLINATIONS_GEN_KEY not found in environment');
            return new Response(JSON.stringify({ error: 'Server configuration error' }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Timeout for external API call
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 seconds

        try {
            const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...(key && { 'Authorization': `Bearer ${key}` }),
                },
                body: JSON.stringify({
                    model: model || 'gemini-large',
                    messages: [
                        { 
                            role: 'system', 
                            content: 'You are a music generation AI. Generate musical content in the exact JSON format requested. Respond ONLY with valid JSON, no markdown wrappers, no preamble.' 
                        },
                        { 
                            role: 'user', 
                            content: prompt 
                        },
                    ],
                    temperature: 0.7,
                    top_p: 0.9,
                    max_tokens: 3048,
                    seed: seed || 0,
                    stream: false,
                    response_format: {
                        type: 'text'
                    }
                }),
            });

            clearTimeout(timeoutId);

            // Check if response is OK
            if (!response.ok) {
                return new Response(
                    JSON.stringify({ 
                        error: `Upstream API error: ${response.status} ${response.statusText}` 
                    }), 
                    { 
                        status: response.status,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
            }

            // Parse the chat completions response
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            if (!content || content.trim().length === 0) {
                return new Response(
                    JSON.stringify({ error: 'API returned empty response' }), 
                    { 
                        status: 500,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
            }

            // Return the content as plain text
            return new Response(content, {
                status: 200,
                headers: {
                    'Content-Type': 'text/plain',
                    'Cache-Control': 'no-cache',
                },
            });

        } catch (fetchError) {
            clearTimeout(timeoutId);
            
            if (fetchError.name === 'AbortError') {
                return new Response(
                    JSON.stringify({ error: 'Request timeout' }), 
                    { 
                        status: 504,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
            }
            
            throw fetchError;
        }

    } catch (error) {
        console.error('Handler error:', error);
        return new Response(
            JSON.stringify({ 
                error: error.message || 'Internal server error' 
            }), 
            { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}
