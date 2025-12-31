export async function fetchWithModelFallbacks(baseUrl, models, ui, options = {}) {
export async function fetchWithModelFallbacks(endpoint, models, ui, baseParams = {}) {
    const { timeout = 60000 } = baseParams;
    let lastError = null;

    for (const model of models) {
        const modelNameForUI = model.replace(/-\d+k$/, '');
        ui.showMessage(`Trying model: ${modelNameForUI}...`, 'loading');
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            // Καλούμε το δικό μας Edge Function με POST
            const response = await fetch(endpoint, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...baseParams, model }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const responseText = await response.text();
                if (responseText && responseText.trim().length > 10) {
                    return new Response(responseText, { status: 200 });
                }
                throw new Error(`Model '${model}' returned empty response.`);
            }
            lastError = new Error(`Status ${response.status} from proxy`);
        } catch (error) {
            lastError = error;
            console.warn(`Request with model '${model}' failed:`, error.message);
        }
    }
    throw lastError || new Error(`All fallback models failed.`);
}

const GENRE_TIME_SIGNATURE_DEFAULTS = {
    'house': '4/4', 'techno': '4/4', 'trance': '4/4', 'trap': '4/4',
    'hip-hop': '4/4', 'rock': '4/4', 'pop': '4/4', 'funk': '4/4',
    'reggae': '4/4', 'jazz': '4/4', 'disco': '4/4', 'classical': '4/4',
    'ambient': '4/4', 'drum-and-bass': '4/4', 'synthwave': '4/4',
    'downtempo': '4/4', 'progressive-rock': '5/4', 'cinematic': '4/4', 'default': '4/4'
};

export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui.showMessage('Analyzing and enhancing your prompt...', 'loading');
    
    const availableTracks = ['bassline', 'chord', 'melody', 'arpeggio', 'lead', 'plucks', 'strings', 'keys', 'guitar', 'pad-textures', 'brass', 'percs'];
    const validKeys = ["C", "Cm", "C#", "C#m", "Db", "Dbm", "D", "Dm", "D#", "D#m", "Eb", "Ebm", "E", "Em", "F", "Fm", "F#", "F#m", "Gb", "Gbm", "G", "Gm", "G#", "G#m", "Ab", "Abm", "A", "Am", "A#", "A#m", "Bb", "Bbm", "B", "Bm"];
    const validDurations = ["4", "8", "16", "32"];
    const validStyles = Array.from(document.querySelectorAll('#style option')).map(opt => opt.value);
    const validMoods = Array.from(document.querySelectorAll('#mood option')).map(opt => opt.value);
    const validComplexities = Array.from(document.querySelectorAll('#rhythmic-complexity option')).map(opt => opt.value);
    const validTimeSignatures = ["4/4", "3/4", "6/8", "5/4", "7/8"];
    const validStructures = ["intro", "build", "verse", "chorus", "bridge"];

    // Η εντολή (Prompt) παραμένει ίδια όπως ζητήθηκε
    const analysisPrompt = `Analyze the user's musical request to extract parameters for a MIDI generation tool. Respond ONLY with a single raw JSON object... (ίδιο με πριν) ... User request: "${userPrompt}"`;

    try {
        const response = await fetchWithModelFallbacks('/api/analyze', ['gemini', 'gemini-fast'], ui, { 
            prompt: analysisPrompt,
            timeout: 30000 
        });

        const text = await response.text();
        const jsonText = text.replace(/```json\n?([\s\S]+?)\n?```/, '$1').trim();
        
        let result;
        try {
            result = JSON.parse(jsonText);
        } catch (e) {
            const match = jsonText.match(/\{[\s\S]*\}/);
            result = match ? JSON.parse(match[0]) : null;
        }

        if (!result) throw new Error("Could not parse JSON");

        if (result.extractedParams.trackTypes) {
            result.extractedParams.trackTypes = result.extractedParams.trackTypes.slice(0, 5);
        }

        if (!result.extractedParams.timeSignature && result.extractedParams.style) {
            result.extractedParams.timeSignature = GENRE_TIME_SIGNATURE_DEFAULTS[result.extractedParams.style] || '4/4';
        }

        return { 
            extractedParams: result.extractedParams, 
            enhancedPrompt: result.enhancedPrompt 
        };
    } catch (e) {
        throw new Error(`Analysis failed: ${e.message}`);
    }
}
