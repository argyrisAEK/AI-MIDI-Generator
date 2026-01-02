export const config = { runtime: 'edge' };

export default async function handler(req) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, model } = await req.json();
        
        // Validate required parameters
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Missing or invalid prompt parameter' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const key = process.env.POLLINATIONS_ANALYZE_KEY;
        if (!key) {
            console.error('POLLINATIONS_ANALYZE_KEY not found in environment');
            return new Response(JSON.stringify({ error: 'Server configuration error' }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Construct the URL with proper encoding
        const url = `https://gen.pollinations.ai/text/${encodeURIComponent(prompt)}?key=${key}&model=${model || 'gemini'}`;

        // Timeout for external API call
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds for analysis

        try {
            const response = await fetch(url, {
                signal: controller.signal
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

            // Read full response text
            const text = await response.text();

            // Validate response is not empty
            if (!text || text.trim().length === 0) {
                return new Response(
                    JSON.stringify({ error: 'Upstream API returned empty response' }), 
                    { 
                        status: 502,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
            }

            // Return the text response
            return new Response(text, { 
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
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
