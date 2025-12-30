export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui.showMessage('Analyzing and enhancing your prompt...', 'loading');
    
    const availableTracks = [
        'bassline', 'chord', 'melody', 'arpeggio', 'lead', 
        'plucks', 'strings', 'keys', 'guitar', 'pad-textures', 'brass', 'percs'
    ];

    const validKeys = [
        "C", "Cm", "C#", "C#m", "Db", "Dbm",
        "D", "Dm", "D#", "D#m", "Eb", "Ebm",
        "E", "Em", 
        "F", "Fm", "F#", "F#m", "Gb", "Gbm",
        "G", "Gm", "G#", "G#m", "Ab", "Abm",
        "A", "Am", "A#", "A#m", "Bb", "Bbm",
        "B", "Bm"
    ];

    const validDurations = ["4", "8", "16", "32"];
    const validStyles = Array.from(document.querySelectorAll('#style option')).map(opt => opt.value);
    const validMoods = Array.from(document.querySelectorAll('#mood option')).map(opt => opt.value);
    const validComplexities = Array.from(document.querySelectorAll('#rhythmic-complexity option')).map(opt => opt.value);
    const validTimeSignatures = ["4/4", "3/4", "6/8", "5/4", "7/8"];
    const validStructures = ["intro", "build", "verse", "chorus", "bridge"];

    try {
        // Καλούμε το edge function για ανάλυση
        const response = await fetch('/api/analyze-prompt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userPrompt,
                availableTracks,
                validKeys,
                validDurations,
                validStyles,
                validMoods,
                validComplexities,
                validTimeSignatures,
                validStructures
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Analysis failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.error) {
            throw new Error(result.error);
        }

        return {
            extractedParams: result.extractedParams,
            enhancedPrompt: result.enhancedPrompt
        };

    } catch (e) {
        console.error("Failed to analyze prompt:", e);
        throw new Error(`Could not process your creative prompt. Details: ${e.message}`);
    }
}

// Η συνάρτηση fetchWithModelFallbacks δεν χρειάζεται πλέον γιατί είναι στο edge function
// Μπορείς να την αφαιρέσεις ή να την κρατήσεις για local testing
