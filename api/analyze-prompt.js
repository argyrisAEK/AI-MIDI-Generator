export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const { userPrompt } = await req.json();
        
        // Δημιουργία του analysis prompt (μόνο το API call γίνεται εδώ)
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
    -   For "timeSignature", extract the time signature (e.g., "4/4", "3/4", "6/8"). The value MUST be one of these: ${validTimeSignatures.join(', ')}. If not explicitly specified by user, return null (the app will assign a sensible default based on genre).
    -   For "structure", extract the musical structure/section type. The value MUST be one of these: ${validStructures.join(', ')}. If not specified, return null.
    -   For "trackTypes", create an array of strings, picking from this list: ${availableTracks.join(', ')}. Make a sensible guess based on the description if not explicit. Limit to 5 tracks max.
    -   If any parameter is not found in the user's text, its value in the JSON response MUST be null (except trackTypes, which should always be an array, defaulting to empty if not found).

2.  "enhancedPrompt": A string containing a short, evocative, one-sentence creative direction based on the user's request, focusing on the artistic feeling (e.g. "A driving techno track with dark hypnotic bass and industrial textures").

User request: "${userPrompt}"

Respond ONLY with the raw JSON object.`;
        
        const pollinationsResponse = await fetch(
            `https://gen.pollinations.ai/text/${encodeURIComponent(analysisPrompt)}?key=${process.env.POLLINATIONS_API_KEY}`,
            {
                headers: { 'Accept': 'application/json, text/plain, */*' }
            }
        );

        if (!pollinationsResponse.ok) {
            throw new Error(`Pollinations API failed: ${pollinationsResponse.status}`);
        }

        const responseText = await pollinationsResponse.text();
        
        return new Response(responseText, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Error in analyze-prompt:', error);
        return new Response(
            JSON.stringify({ error: `Failed to analyze prompt: ${error.message}` }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
