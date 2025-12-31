export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    // CORS Headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // ✅ ΑΠΟΔΕΧΟΜΑΣΤΕ ΚΑΙ GET ΚΑΙ POST
    if (req.method !== 'GET' && req.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        let prompt;
        
        // ✅ ΧΕΙΡΙΣΜΟΣ ΚΑΙ GET ΚΑΙ POST REQUESTS
        if (req.method === 'POST') {
            const body = await req.json();
            prompt = body.prompt;
        } else if (req.method === 'GET') {
            const url = new URL(req.url);
            prompt = url.searchParams.get('prompt');
        }
        
        if (!prompt) {
            return new Response(
                JSON.stringify({ 
                    success: false, 
                    error: 'Missing prompt parameter' 
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const API_KEY = process.env.POLLINATIONS_API_KEY;
        if (!API_KEY) {
            console.error('❌ POLLINATIONS_API_KEY missing');
            return new Response(
                JSON.stringify({ 
                    success: false, 
                    error: 'Server configuration error' 
                }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log('🟡 Calling Pollinations.ai Text API...');
        console.log('Prompt length:', prompt.length);
        
        // ✅ ΧΡΗΣΙΜΟΠΟΙΗΣΕ GET REQUEST ΓΙΑ ΤΟ TEXT API
        const encodedPrompt = encodeURIComponent(prompt.substring(0, 1500)); // Κόψε για ασφάλεια
        const pollinationsUrl = `https://gen.pollinations.ai/text/${encodedPrompt}?key=${API_KEY}&model=gemini&seed=${Math.floor(Math.random() * 1000000)}`;
        
        console.log('🟡 Pollinations URL (first 200 chars):', pollinationsUrl.substring(0, 200));

        // Timeout στα 25 δευτερόλεπτα
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        const response = await fetch(pollinationsUrl, {
            method: 'GET', // ✅ ΣΩΣΤΗ ΜΕΘΟΔΟΣ
            headers: { 
                'Accept': 'text/plain, application/json, */*',
                'User-Agent': 'MidiGeneratorApp/1.0'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log('🟡 Pollinations response status:', response.status);
        
        // Διάβασε την απάντηση
        const responseText = await response.text();
        console.log('🟡 Pollinations response length:', responseText.length);
        console.log('🟡 First 300 chars:', responseText.substring(0, 300));

        if (!response.ok) {
            console.error('❌ Pollinations API error:', response.status, response.statusText);
            
            // Προσπάθεια με διαφορετικό μοντέλο
            const fallbackUrl = `https://gen.pollinations.ai/text/${encodedPrompt}?key=${API_KEY}&model=openai`;
            console.log('🔄 Trying fallback with OpenAI model...');
            
            const fallbackResponse = await fetch(fallbackUrl, {
                method: 'GET',
                headers: { 'Accept': 'text/plain' },
                signal: AbortSignal.timeout(25000)
            });
            
            if (fallbackResponse.ok) {
                const fallbackText = await fallbackResponse.text();
                if (fallbackText && fallbackText.trim().length > 10) {
                    console.log('✅ Fallback successful!');
                    return new Response(
                        JSON.stringify({ 
                            success: true, 
                            responseText: fallbackText,
                            metadata: { model: 'openai-fallback' }
                        }),
                        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
            }
            
            throw new Error(`AI service error: ${response.status} ${response.statusText}`);
        }

        if (!responseText || responseText.trim().length < 20) {
            console.error('❌ Pollinations returned empty or too short response');
            throw new Error('AI service returned empty response');
        }

        console.log('✅ Pollinations.ai response successful!');
        
        return new Response(
            JSON.stringify({ 
                success: true, 
                responseText: responseText,
                metadata: {
                    responseLength: responseText.length,
                    model: 'gemini',
                    promptLength: prompt.length
                }
            }),
            { 
                status: 200, 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
        );

    } catch (error) {
        console.error('🔴 Edge function error:', error.message);
        
        let errorMessage = 'AI service temporarily unavailable';
        let statusCode = 503;
        
        if (error.name === 'AbortError') {
            errorMessage = 'Request timed out (25s). Please try a shorter prompt.';
            statusCode = 408;
        } else if (error.message.includes('AI service')) {
            errorMessage = error.message;
            statusCode = 502;
        }

        // Επιστροφή fallback MIDI data
        return new Response(
            JSON.stringify({ 
                success: false, 
                error: errorMessage,
                fallback: true,
                fallbackResponse: JSON.stringify({
                    title: "Fallback Composition",
                    explanation: "Generated locally due to AI service unavailability",
                    notation: this.generateFallbackNotation()
                })
            }),
            { 
                status: statusCode, 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
        );
    }
}

// Helper function για fallback notation
function generateFallbackNotation() {
    return `60,0.0,1.0,0.8 #melody
60,1.0,1.0,0.8 #melody
60,2.0,1.0,0.8 #melody
60,3.0,1.0,0.8 #melody
36,0.0,0.5,0.9 #bassline
36,2.0,0.5,0.9 #bassline
48,0.0,4.0,0.6 #chord
67,0.5,0.25,0.7 #lead
67,2.5,0.25,0.7 #lead`;
}
