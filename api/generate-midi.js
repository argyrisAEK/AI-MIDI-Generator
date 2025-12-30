export const config = {
    runtime: 'edge',
};

// Helper function for model fallbacks (μόνο για το API call)
async function fetchWithModelFallbacks(baseUrl, models, options = {}) {
    const { timeout = 60000 } = options;
    let lastError = null;

    for (const model of models) {
        const url = `${baseUrl}&model=${model}`;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await fetch(url, { 
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const responseText = await response.text();
                // Some models return empty or near-empty responses on failure.
                if (responseText && responseText.trim().length > 10) {
                    return responseText;
                }
                throw new Error(`Model '${model}' returned an empty or invalid response.`);
            }
            
            lastError = new Error(`Model '${model}' failed with status ${response.status}: ${response.statusText}`);

        } catch (error) {
            lastError = error;
        }
    }
    // If we're here, all models failed.
    throw lastError || new Error(`All fallback models failed: ${models.join(', ')}`);
}

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
            },
        });
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    try {
        // Extract parameters from request
        const { prompt, seed } = await req.json();
        
        if (!prompt) {
            throw new Error('Missing prompt parameter');
        }

        // Get API key from environment variable
        const apiKey = process.env.POLLINATIONS_API_KEY;
        if (!apiKey) {
            throw new Error('API key not configured on server');
        }

        // Prepare the base URL for Pollinations.ai
        const baseUrl = `https://gen.pollinations.ai/text/${encodeURIComponent(prompt)}?key=${apiKey}&seed=${seed || Math.floor(Math.random() * 100000)}`;
        
        // List of models to try (in order of preference)
        const generationModels = ['openai-large', 'gemini-large'];

        // Make the API call with fallback models
        const responseText = await fetchWithModelFallbacks(baseUrl, generationModels, {
            timeout: 60000,
            headers: {
                'Accept': 'application/json, text/plain, */*'
            }
        });

        // Validate that we got a meaningful response
        if (!responseText || responseText.trim().length < 20) {
            throw new Error('API returned an empty or too short response');
        }

        // Return the raw API response
        return new Response(
            JSON.stringify({ 
                success: true,
                responseText,
                metadata: {
                    modelsTried: generationModels,
                    promptLength: prompt.length,
                    responseLength: responseText.length,
                    timestamp: new Date().toISOString()
                }
            }),
            {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
                },
            }
        );

    } catch (error) {
        console.error('Error in generate-midi edge function:', error);
        
        // Provide user-friendly error messages
        let errorMessage = error.message;
        let statusCode = 500;
        
        if (error.message.includes('API key')) {
            errorMessage = 'Server configuration error: Missing API key';
            statusCode = 500;
        } else if (error.message.includes('timeout') || error.message.includes('AbortError')) {
            errorMessage = 'Request timed out. The AI service is taking too long to respond. Please try again.';
            statusCode = 408;
        } else if (error.message.includes('empty')) {
            errorMessage = 'The AI service returned an empty response. Please try a different prompt.';
            statusCode = 422;
        }

        return new Response(
            JSON.stringify({ 
                success: false,
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }),
            {
                status: statusCode,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            }
        );
    }
}
