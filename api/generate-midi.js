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
        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        const { prompt } = await req.json();
        
        if (!prompt) {
            return new Response(
                JSON.stringify({ error: 'Missing prompt parameter' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const API_KEY = process.env.POLLINATIONS_API_KEY;
        if (!API_KEY) {
            console.error('POLLINATIONS_API_KEY missing');
            return new Response(
                JSON.stringify({ error: 'Server configuration error' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Χρήση Chat Completions API για καλύτερη απόδοση
        const API_URL = 'https://gen.pollinations.ai/v1/chat/completions';
        
        const requestBody = {
            model: 'gemini-fast',  // Γρήγορο μοντέλο
            messages: [{ role: 'user', content: prompt }],
            seed: Math.floor(Math.random() * 1000000),
            max_tokens: 1500
        };

        // Timeout στα 20 δευτερόλεπτα
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

        // 🔴 ΚΡΙΤΙΚΟ: Διαβάζουμε το response ως text ΜΟΝΟ ΜΙΑ ΦΟΡΑ
        const responseText = await response.text();
        
        if (!response.ok) {
            console.error('Pollinations API error:', response.status, responseText);
            return new Response(
                JSON.stringify({ 
                    success: false, 
                    error: `AI service error: ${response.status}`,
                    details: responseText.substring(0, 200)
                }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse το JSON response
        let pollinationsResult;
        try {
            pollinationsResult = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse Pollinations response:', parseError);
            return new Response(
                JSON.stringify({ 
                    success: false, 
                    error: 'AI service returned invalid response'
                }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const generatedText = pollinationsResult.choices?.[0]?.message?.content || '';
        
        if (!generatedText) {
            return new Response(
                JSON.stringify({ 
                    success: false, 
                    error: 'AI service returned empty response'
                }),
                { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ 
                success: true, 
                responseText: generatedText
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Edge function error:', error);
        
        let errorMessage = 'Generation failed';
        let statusCode = 500;
        
        if (error.name === 'AbortError') {
            errorMessage = 'Request timed out (20s). Try a shorter prompt.';
            statusCode = 408;
        }

        return new Response(
            JSON.stringify({ 
                success: false, 
                error: errorMessage
            }),
            { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}
