export async function fetchWithModelFallbacks(baseUrl, models, ui, options = {}) {
    const { timeout = 60000 } = options;
    let lastError = null;

    for (const model of models) {
        const url = `${baseUrl}&model=${model}`;
        const modelNameForUI = model.replace(/-\d+k$/, ''); // Clean up model names for display
        ui.showMessage(`Trying model: ${modelNameForUI}...`, 'loading');
        
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
                    return new Response(responseText, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }
                throw new Error(`Model '${model}' returned an empty or invalid response.`);
            }
            
            lastError = new Error(`Model '${model}' failed with status ${response.status}: ${response.statusText}`);
            console.warn(lastError.message);

        } catch (error) {
            lastError = error;
            console.warn(`Request with model '${model}' failed:`, error.message);
        }
    }
    // If we're here, all models failed.
    throw lastError || new Error(`All fallback models failed: ${models.join(', ')}`);
}

export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui.showMessage('Analyzing and enhancing your prompt...', 'loading');
    
    // MATCHED with PromptBuilder instructions to avoid hallucinations
    const availableTracks = [
        'bassline', 'chord', 'melody', 'arpeggio', 'lead', 
        'plucks', 'strings', 'keys', 'guitar', 'pad-textures'
    ];

    // EXPANDED KEYS: Added Sharps (#) and Flats (b) for musical variety
    const validKeys = [
        "C", "Cm", "C#", "C#m", "Db", "Dbm",
        "D", "Dm", "D#", "D#m", "Eb", "Ebm",
        "E", "Em", 
        "F", "Fm", "F#", "F#m", "Gb", "Gbm",
        "G", "Gm", "G#", "G#m", "Ab", "Abm",
        "A", "Am", "A#", "A#m", "Bb", "Bbm",
        "B", "Bm"
    ];

    const validDurations = ["4", "8", "16", "32"]; // Main.js handles the int conversion
    const validStyles = Array.from(document.querySelectorAll('#style option')).map(opt => opt.value);
    const validMoods = Array.from(document.querySelectorAll('#mood option')).map(opt => opt.value);
    const validComplexities = Array.from(document.querySelectorAll('#rhythmic-complexity option')).map(opt => opt.value);

    const analysisPrompt = `Analyze the user's musical request to extract parameters for a MIDI generation tool. Respond ONLY with a single raw JSON object.

The JSON object must have two top-level keys: "extractedParams" and "enhancedPrompt".

1.  "extractedParams": An object containing musical parameters. This object must have these keys: "key", "bpm", "duration_bars", "style", "mood", "trackTypes", "rhythmicComplexity".
    -   Extract parameters strictly based on the user's text.
    -   For "key", translate the user's input (e.g., "f sharp minor", "C major") into one of these exact values: ${validKeys.join(', ')}. If no key is specified, return null.
    -   For "bpm", extract the number as a string.
    -   For "duration_bars", extract the number of bars. It must be one of these exact string values: ${validDurations.join(', ')}. Find the closest valid option if the user provides a different number.
    -   For "style", extract the genre. The value MUST be one of these: ${validStyles.join(', ')}. If an artist is mentioned, determine their most representative genre from this list.
    -   For "mood", extract the described mood. The value MUST be one of these: ${validMoods.join(', ')}.
    -   For "rhythmicComplexity", extract the rhythmic complexity. The value MUST be one of these: ${validComplexities.join(', ')}.
    -   For "trackTypes", create an array of strings, picking from this list: ${availableTracks.join(', ')}. Make a sensible guess based on the description if not explicit. Limit to 5 tracks max.
    -   If any parameter is not found in the user's text, its value in the JSON response MUST be null. Do not guess or add default values (except for tracks).

2.  "enhancedPrompt": A string containing a short, evocative, one-sentence creative direction based on the user's request, focusing on the artistic feeling (e.g. "A driving techno track with dark hypnotic bass and industrial textures").

User request: "${userPrompt}"

Respond ONLY with the raw JSON object.`;

    const analysisBaseUrl = `https://text.pollinations.ai/${encodeURIComponent(analysisPrompt)}?token=bMdm4yB_MTujU2E9`;
    const analysisModels = ['openai-large', 'midijourney', 'openai-fast'];

    try {
        const response = await fetchWithModelFallbacks(analysisBaseUrl, analysisModels, ui, { timeout: 20000 });

        const text = await response.text();
        // Clean up potential markdown formatting around the JSON
        const jsonText = text.replace(/```json\n?([\s\S]+?)\n?```/, '$1').trim();
        
        let result;
        try {
            result = JSON.parse(jsonText);
        } catch (parseError) {
            // Fallback cleaner if direct parse fails
            const cleanMatch = jsonText.match(/\{[\s\S]*\}/);
            if (cleanMatch) {
                result = JSON.parse(cleanMatch[0]);
            } else {
                throw parseError;
            }
        }

        if (!result.extractedParams || !result.enhancedPrompt) {
            throw new Error("API response is missing required 'extractedParams' or 'enhancedPrompt' keys.");
        }

        return { 
            extractedParams: result.extractedParams, 
            enhancedPrompt: result.enhancedPrompt 
        };

    } catch (e) {
        console.error("Failed to analyze or parse prompt analysis from API.", e);
       
        throw new Error(`Could not process your creative prompt. The AI might be busy or the request was unclear. Details: ${e.message}`);
    }
}
