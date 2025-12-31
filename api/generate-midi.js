export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    try {
        const { prompt } = await req.json();
        
        if (!prompt) {
            throw new Error('Missing prompt parameter');
        }

        const API_KEY = process.env.POLLINATIONS_API_KEY;
        if (!API_KEY) {
            throw new Error('API key not configured');
        }

        // Χρησιμοποίησε το Chat Completions API για καλύτερη απόδοση
        const API_URL = 'https://gen.pollinations.ai/v1/chat/completions';
        
        const requestBody = {
            model: 'gemini',  // Γρήγορο μοντέλο για ταχύτερη απόκριση
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            seed: Math.floor(Math.random() * 1000000),
            max_tokens: 3000  // Περιορισμός για να μην είναι πολύ μεγάλη απάντηση
        };

        // Timeout στα 20s για να μην ξεπεράσει το 25s limit του Vercel
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY.trim()}`
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`API returned error: ${response.status}`);
        }

        const result = await response.json();
        const responseText = result.choices?.[0]?.message?.content || '';
        
        return new Response(
            JSON.stringify({ 
                success: true, 
                responseText,
                metadata: {
                    model: requestBody.model,
                    promptLength: prompt.length,
                    responseLength: responseText.length
                }
            }),
            {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );

    } catch (error) {
        console.error('Edge function error:', error);
        
        let errorMessage = 'Generation failed';
        if (error.name === 'AbortError') {
            errorMessage = 'Generation timed out (20s). Try a shorter prompt.';
        } else if (error.message.includes('API key')) {
            errorMessage = 'Server configuration error';
        }

        return new Response(
            JSON.stringify({ 
                success: false, 
                error: errorMessage,
                details: error.message
            }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );
    }
}
