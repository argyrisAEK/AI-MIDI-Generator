// Genre to typical time signature mapping
const GENRE_TIME_SIGNATURE_DEFAULTS = {
    'house': '4/4', 'techno': '4/4', 'trance': '4/4', 'trap': '4/4',
    'hip-hop': '4/4', 'rock': '4/4', 'pop': '4/4', 'funk': '4/4',
    'reggae': '4/4', 'jazz': '4/4', 'disco': '4/4', 'classical': '4/4',
    'ambient': '4/4', 'drum-and-bass': '4/4', 'synthwave': '4/4',
    'downtempo': '4/4', 'progressive-rock': '5/4', 'cinematic': '4/4', 'default': '4/4'
};

/**
 * Εκτελεί το αίτημα στο API μας (Edge Function) με υποστήριξη fallbacks
 * FIXED: Proper stream handling and validation
 */
export async function fetchWithModelFallbacks(endpoint, models, ui, payload = {}) {
    const timeout = payload.timeout || 90000; // 90 seconds
    let lastError = null;

    for (const model of models) {
        ui.showMessage(`Generating with ${model.replace(/-\d+k$/, '')}...`, 'loading');
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(endpoint, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, model: model }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }

            // Proper stream handling
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = "";

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    accumulatedText += decoder.decode(value, { stream: true });
                }
            } catch (streamError) {
                throw new Error(`Stream reading failed: ${streamError.message}`);
            }

            // Validate response is not empty and contains JSON
            const trimmedText = accumulatedText.trim();
            if (trimmedText.length === 0) {
                throw new Error(`Model '${model}' returned empty response`);
            }

            // Check if response contains valid JSON structure
            if (!trimmedText.includes('{') || !trimmedText.includes('}')) {
                throw new Error(`Model '${model}' did not return JSON structure`);
            }

            // Return a proper Response object with the accumulated text
            return new Response(trimmedText, { status: 200 });

        } catch (error) {
            lastError = error;
            console.warn(`Attempt with ${model} failed:`, error.message);
            
            // Continue to next model on error
            if (model !== models[models.length - 1]) {
                ui.showMessage(`${model} failed, trying next model...`, 'info');
            }
        }
    }

    // All models failed
    throw lastError || new Error(`All models failed. Last error: ${lastError?.message}`);
}

/**
 * Αναλύει το αίτημα του χρήστη και επιστρέφει παραμέτρους JSON
 * FIXED: Better error handling and validation
 */
export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui.showMessage('Analyzing and enhancing your prompt...', 'loading');
    
    // Λίστες επικύρωσης
    const availableTracks = ['bassline', 'chord', 'melody', 'arpeggio', 'lead', 'plucks', 'strings', 'keys', 'guitar', 'pad-textures', 'brass', 'percs'];
    const validKeys = ["C", "Cm", "C#", "C#m", "Db", "Dbm", "D", "Dm", "D#", "D#m", "Eb", "Ebm", "E", "Em", "F", "Fm", "F#", "F#m", "Gb", "Gbm", "G", "Gm", "G#", "G#m", "Ab", "Abm", "A", "Am", "A#", "A#m", "Bb", "Bbm", "B", "Bm"];
    const validDurations = ["4", "8", "16", "32"];
    const validStyles = Array.from(document.querySelectorAll('#style option')).map(opt => opt.value);
    const validMoods = Array.from(document.querySelectorAll('#mood option')).map(opt => opt.value);
    const validComplexities = Array.from(document.querySelectorAll('#rhythmic-complexity option')).map(opt => opt.value);
    const validTimeSignatures = ["4/4", "3/4", "6/8", "5/4", "7/8"];
    const validStructures = ["intro", "build", "verse", "chorus", "bridge"];

    const analysisPrompt = `Analyze the user's musical request to extract parameters for a MIDI generation tool. Respond ONLY with a single raw JSON object.
The JSON object must have two top-level keys: "extractedParams" and "enhancedPrompt".
1. "extractedParams": { "key", "bpm", "duration_bars", "style", "mood", "trackTypes", "rhythmicComplexity", "timeSignature", "structure" }.
Extract parameters strictly based on the user's text. 
Translate key to one of: ${validKeys.join(', ')}. 
Style must be one of: ${validStyles.join(', ')}.
Mood must be one of: ${validMoods.join(', ')}.
Rhythmic complexity must be one of: ${validComplexities.join(', ')}.
Track types must be from: ${availableTracks.join(', ')}.

User request: "${userPrompt}"

Return ONLY valid JSON, no markdown, no preamble.`;

    try {
        const response = await fetchWithModelFallbacks('/api/analyze', ['claude', 'gemini'], ui, { 
            prompt: analysisPrompt,
            timeout: 25000 
        });

        const text = await response.text();
        
        // Clean markdown if present
        let jsonText = text.trim();
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonText = jsonMatch[0];
        }
        
        let result;
        try {
            result = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('JSON parse failed. Raw response was:', text);
            throw new Error(`Invalid JSON from analysis: ${parseError.message}`);
        }

        // Validate structure
        if (!result.extractedParams || !result.enhancedPrompt) {
            throw new Error('Analysis response missing required keys: extractedParams and/or enhancedPrompt');
        }

        // Validate and limit track types
        if (result.extractedParams.trackTypes && Array.isArray(result.extractedParams.trackTypes)) {
            result.extractedParams.trackTypes = result.extractedParams.trackTypes
                .slice(0, 5)
                .filter(t => availableTracks.includes(t));
        } else {
            result.extractedParams.trackTypes = [];
        }

        // Set time signature default if missing
        if (!result.extractedParams.timeSignature && result.extractedParams.style) {
            result.extractedParams.timeSignature = GENRE_TIME_SIGNATURE_DEFAULTS[result.extractedParams.style] || '4/4';
        }

        // Validate BPM
        if (result.extractedParams.bpm) {
            result.extractedParams.bpm = Math.max(40, Math.min(300, parseInt(result.extractedParams.bpm) || 120));
        } else {
            result.extractedParams.bpm = 120;
        }

        // Validate duration
        if (result.extractedParams.duration_bars) {
            result.extractedParams.duration_bars = Math.max(1, Math.min(64, parseInt(result.extractedParams.duration_bars) || 4));
        } else {
            result.extractedParams.duration_bars = 4;
        }

        // Truncate enhancedPrompt to save tokens (max 200 chars)
        const truncatedPrompt = result.enhancedPrompt 
            ? result.enhancedPrompt.substring(0, 200).trim() 
            : '';

        return { 
            extractedParams: result.extractedParams, 
            enhancedPrompt: truncatedPrompt
        };

    } catch (e) {
        console.error("Analysis failed:", e);
        throw new Error(`Could not process your prompt: ${e.message}`);
    }
}
