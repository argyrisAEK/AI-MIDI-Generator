export const config = {
    runtime: 'edge',
};

// Genre to typical time signature mapping
const GENRE_TIME_SIGNATURE_DEFAULTS = {
    'house': '4/4',
    'techno': '4/4',
    'trance': '4/4',
    'trap': '4/4',
    'hip-hop': '4/4',
    'rock': '4/4',
    'pop': '4/4',
    'funk': '4/4',
    'reggea': '4/4',
    'jazz': '4/4',
    'disco': '4/4',
    'classical': '4/4',
    'ambient': '4/4',
    'drum-and-bass': '4/4',
    'synthwave': '4/4',
    'downtempo': '4/4',
    'progressive-rock': '5/4',
    'cinematic': '4/4',
    'default': '4/4'
};

// Helper function for model fallbacks
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
        const { 
            userPrompt, 
            availableTracks, 
            validKeys, 
            validDurations, 
            validStyles, 
            validMoods, 
            validComplexities, 
            validTimeSignatures, 
            validStructures 
        } = await req.json();
        
        if (!userPrompt) {
            throw new Error('Missing userPrompt parameter');
        }

        // Get API key from environment variable
        const apiKey = process.env.POLLINATIONS_API_KEY;
        if (!apiKey) {
            throw new Error('API key not configured on server');
        }

        // Create the analysis prompt (same as in the original)
        const analysisPrompt = `Analyze the user's musical request to extract parameters for a MIDI generation tool. Respond ONLY with a single raw JSON object.

The JSON object must have two top-level keys: "extractedParams" and "enhancedPrompt".

1.  "extractedParams": An object containing musical parameters. This object must have these keys: "key", "bpm", "duration_bars", "style", "mood", "trackTypes", "rhythmicComplexity", "timeSignature", "structure".
    -   Extract parameters strictly based on the user's text.
    -   For "key", translate the user's input (e.g., "f sharp minor", "C major") into one of these exact values: ${validKeys.join(', ')}. If no key is specified, return null.
    -   For "bpm", extract the number as a string. If not specified, return null.
    -   For "duration_bars", extract the number of bars. It must be one of these exact string values: ${validDurations.join(', ')}. Find the closest valid option if the user provides a different number. If not specified, return null.
    -   For "style", extract the genre. The value MUST be one of these: ${validStyles.join(', ')}. If an artist is mentioned, determine their most representative genre from this list. If not specified, return null.
    -   For "mood", extract the described mood. The value MUST be one of these: ${validMoods.join(', ')}. If not specified, return null.
    -   For "rhythmicComplexity", extract the rhythmic complexity. The value MUST be one of these: ${validComplexities.join(', ')}. If not specified, return null.
    -   For "timeSignature", extract the time signature (e.g., "4/4", "3/4", "6/8"). The value MUST be one of these: ${validTimeSignatures.join(', ')}. If not explicitly specified by user, return null.
    -   For "structure", extract the musical structure/section type. The value MUST be one of these: ${validStructures.join(', ')}. If not specified, return null.
    -   For "trackTypes", create an array of strings, picking from this list: ${availableTracks.join(', ')}. Make a sensible guess based on the description if not explicit. Limit to 5 tracks max.
    -   If any parameter is not found in the user's text, its value in the JSON response MUST be null (except trackTypes, which should always be an array, defaulting to empty if not found).

2.  "enhancedPrompt": A string containing a short, evocative, one-sentence creative direction based on the user's request, focusing on the artistic feeling.

User request: "${userPrompt}"

Respond ONLY with the raw JSON object.`;

        // Prepare base URL for Pollinations.ai
        const baseUrl = `https://gen.pollinations.ai/text/${encodeURIComponent(analysisPrompt)}?key=${apiKey}`;
        
        // List of models to try (in order of preference)
        const analysisModels = ['gemini', 'gemini-fast'];

        // Call Pollinations.ai API with fallback models
        const responseText = await fetchWithModelFallbacks(baseUrl, analysisModels, {
            timeout: 20000,
            headers: {
                'Accept': 'application/json, text/plain, */*'
            }
        });

        // Parse and clean the response
        const jsonText = responseText.replace(/```json\n?([\s\S]+?)\n?```/, '$1').trim();
        
        let result;
        try {
            result = JSON.parse(jsonText);
        } catch (parseError) {
            const cleanMatch = jsonText.match(/\{[\s\S]*\}/);
            if (cleanMatch) {
                result = JSON.parse(cleanMatch[0]);
            } else {
                throw new Error(`Failed to parse JSON response: ${parseError.message}`);
            }
        }

        if (!result.extractedParams || !result.enhancedPrompt) {
            throw new Error("API response is missing required 'extractedParams' or 'enhancedPrompt' keys.");
        }

        // Post-process: Limit track types
        if (result.extractedParams.trackTypes && Array.isArray(result.extractedParams.trackTypes)) {
            result.extractedParams.trackTypes = result.extractedParams.trackTypes.slice(0, 5);
        }

        // Post-process: Apply default time signature based on genre
        if (!result.extractedParams.timeSignature && result.extractedParams.style) {
            const defaultSig = GENRE_TIME_SIGNATURE_DEFAULTS[result.extractedParams.style] || GENRE_TIME_SIGNATURE_DEFAULTS['default'];
            result.extractedParams.timeSignature = defaultSig;
        } else if (!result.extractedParams.timeSignature) {
            result.extractedParams.timeSignature = GENRE_TIME_SIGNATURE_DEFAULTS['default'];
        }

        return new Response(
            JSON.stringify({
                success: true,
                extractedParams: result.extractedParams,
                enhancedPrompt: result.enhancedPrompt,
                metadata: {
                    userPromptLength: userPrompt.length,
                    modelsTried: analysisModels,
                    timestamp: new Date().toISOString()
                }
            }),
            {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            }
        );

    } catch (error) {
        console.error('Error in analyze-prompt edge function:', error);
        
        let errorMessage = error.message;
        let statusCode = 500;
        
        if (error.message.includes('API key')) {
            errorMessage = 'Server configuration error: Missing API key';
            statusCode = 500;
        } else if (error.message.includes('timeout') || error.message.includes('AbortError')) {
            errorMessage = 'Analysis timed out. The AI service is taking too long to respond. Please try again.';
            statusCode = 408;
        } else if (error.message.includes('empty')) {
            errorMessage = 'The AI service returned an empty response. Please try a different prompt.';
            statusCode = 422;
        } else if (error.message.includes('parse JSON')) {
            errorMessage = 'Could not understand the AI response. Please try rephrasing your request.';
            statusCode = 422;
        }

        return new Response(
            JSON.stringify({ 
                success: false,
                error: errorMessage,
                suggestion: 'Please try rephrasing your musical request or check your internet connection.'
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
