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
 */
export async function fetchWithModelFallbacks(endpoint, models, ui, payload = {}) {
    const timeout = payload.timeout || 90000; // Αυξάνουμε το timeout στα 90s
    let lastError = null;

    for (const model of models) {
        ui.showMessage(`Generating with ${model.replace(/-\d+k$/, '')}...`, 'loading');
        
        try {
            const response = await fetch(endpoint, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, model: model })
            });
            
            if (!response.ok) throw new Error(`Server error: ${response.status}`);

            // Διάβασμα του Stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                accumulatedText += chunk;
                
                // Προαιρετικά: Εμφάνιση προόδου στο UI (π.χ. πόσοι χαρακτήρες ήρθαν)
                // ui.showMessage(`Receiving data: ${accumulatedText.length} chars...`, 'loading');
            }

            if (accumulatedText.trim().length > 10) {
                return new Response(accumulatedText);
            }
            
            throw new Error(`Model '${model}' returned empty response.`);
        } catch (error) {
            lastError = error;
            console.warn(`Attempt with ${model} failed:`, error.message);
        }
    }
    throw lastError || new Error(`All models failed.`);
}

/**
 * Αναλύει το αίτημα του χρήστη και επιστρέφει παραμέτρους JSON
 */
export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui.showMessage('Analyzing and enhancing your prompt...', 'loading');
    
    // Λίστες επικύρωσης (από το αρχικό σου αρχείο prompt-analyzer(4).js)
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
    Extract parameters strictly based on the user's text. Translate key to: ${validKeys.join(', ')}. 
    Style must be one of: ${validStyles.join(', ')}.
    User request: "${userPrompt}"`;

    try {
        const response = await fetchWithModelFallbacks('/api/analyze', ['claude-fast', 'gemini-fast'], ui, { 
            prompt: analysisPrompt,
            timeout: 25000 
        });

        const text = await response.text();
        // Καθαρισμός Markdown JSON αν υπάρχει
        const jsonText = text.replace(/```json\n?([\s\S]+?)\n?```/, '$1').trim();
        
        let result;
        const cleanMatch = jsonText.match(/\{[\s\S]*\}/);
        if (cleanMatch) {
            result = JSON.parse(cleanMatch[0]);
        } else {
            throw new Error("Invalid JSON structure from AI");
        }

        // Περιορισμός tracks σε 5 max
        if (result.extractedParams.trackTypes && Array.isArray(result.extractedParams.trackTypes)) {
            result.extractedParams.trackTypes = result.extractedParams.trackTypes.slice(0, 5);
        }

        // Απόδοση προεπιλεγμένου Time Signature αν λείπει
        if (!result.extractedParams.timeSignature && result.extractedParams.style) {
            result.extractedParams.timeSignature = GENRE_TIME_SIGNATURE_DEFAULTS[result.extractedParams.style] || '4/4';
        }

        return { 
            extractedParams: result.extractedParams, 
            enhancedPrompt: result.enhancedPrompt 
        };
    } catch (e) {
        console.error("Analysis failed", e);
        throw new Error(`Could not process your prompt: ${e.message}`);
    }
}
