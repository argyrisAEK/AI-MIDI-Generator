export const config = {
    runtime: 'edge',
};

// Προεπιλεγμένα Time Signatures ανάλογα με το genre
const GENRE_TIME_SIGNATURE_DEFAULTS = {
    'progressive-rock': '5/4',
    'techno': '4/4',
    'house': '4/4',
    'jazz': '4/4',
    'default': '4/4'
};

export default async function handler(req) {
    // 1. Έλεγχος CORS & Method
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const { userPrompt } = await req.json();

        if (!userPrompt) {
            return new Response(JSON.stringify({ error: 'Prompt is required' }), { status: 400 });
        }

        // 2. Κατασκευή του System Prompt για τον Analyzer
        // Αυτό το κομμάτι είναι "κρυφό" πλέον από τον χρήστη
        const analysisSystemPrompt = `
            Analyze the following musical request and extract parameters for a MIDI generator.
            Return ONLY a valid JSON object with this exact structure:
            {
                "extractedParams": {
                    "style": "string (e.g., house, jazz, rock)",
                    "tempo": "number",
                    "key": "string (e.g., C, F#)",
                    "scale": "string (major, minor, dorian, etc.)",
                    "mood": "string",
                    "timeSignature": "string (e.g., 4/4, 3/4, 5/4)",
                    "trackTypes": ["array of strings: bassline, melody, chords, drums, pads"]
                },
                "enhancedPrompt": "A detailed 2-sentence musical description based on the user's intent."
            }

            User Request: "${userPrompt}"
        `;

        // 3. Κλήση του AI API (Pollinations ή OpenAI)
        const models = ['openai-large', 'openai', 'mistral-large'];
        let aiResponse = null;
        let lastError = null;

        // Fallback logic για τα μοντέλα
        for (const model of models) {
            try {
                const response = await fetch(`https://gen.pollinations.ai/text/${encodeURIComponent(analysisSystemPrompt)}?model=${model}&json=true&seed=${Math.floor(Math.random() * 1000)}&key=key=plln_sk_JmbRcolKjEzatmVsRROri34kyDAmSoUj`, {
                    method: 'GET',
                });

                if (response.ok) {
                    aiResponse = await response.text();
                    break;
                }
            } catch (err) {
                lastError = err;
                continue;
            }
        }

        if (!aiResponse) throw new Error(lastError || "AI Service Unavailable");

        // 4. Καθαρισμός και Parsing του JSON
        let result;
        try {
            // Αφαίρεση markdown code blocks αν υπάρχουν
            const cleanJson = aiResponse.replace(/```json\n?([\s\S]+?)\n?```/g, '$1').trim();
            result = JSON.parse(cleanJson);
        } catch (e) {
            throw new Error("Failed to parse AI response as JSON");
        }

        // 5. Post-processing λογική (Defaults)
        if (!result.extractedParams.timeSignature) {
            result.extractedParams.timeSignature = 
                GENRE_TIME_SIGNATURE_DEFAULTS[result.extractedParams.style] || 
                GENRE_TIME_SIGNATURE_DEFAULTS['default'];
        }

        // Περιορισμός των tracks στα 5 για λόγους απόδοσης
        if (result.extractedParams.trackTypes && Array.isArray(result.extractedParams.trackTypes)) {
            result.extractedParams.trackTypes = result.extractedParams.trackTypes.slice(0, 5);
        }

        // 6. Επιστροφή αποτελέσματος
        return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 's-maxage=1, stale-while-revalidate'
            }
        });

    } catch (error) {
        console.error('Edge Function Error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
