export const config = { runtime: 'edge', timeout: 55 };

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 1. Get request data
        const { prompt, model, enhancedPrompt } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'No prompt provided' });
        }
        
        console.log('[API] Request received');
        console.log('[API] Model:', model);
        
        // 2. Get API key
        const apiKey = process.env.POLLINATIONS_API_KEY || '';
        
        // 3. BUILD THE PAYLOAD (this is what changes)
        const payload = {
            messages: [
                {
                    role: 'system',
                    content: 'You are a creative musical AI. You must output ONLY valid JSON containing musical track data, no markdown, no preamble.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            model: model || 'gemini',
            max_tokens: 4096,
            temperature: 0.7,
            reasoning_effort: 'none',        // Key for speed
            thinking: {
                type: 'disabled'             // Extra speed
            },
            response_format: {
                type: 'text'
            }
           
        };
        
        console.log('[API] Calling Pollinations...');
        
        // 4. CALL POLLINATIONS API
        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGenerator/1.0',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        });
        
        console.log('[API] Response status:', pollResponse.status);
        
        // 5. ERROR HANDLING
        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            console.error('[API] HTTP Error:', pollResponse.status);
            console.error('[API] Details:', errorText);
            return res.status(pollResponse.status).json({ 
                error: `Pollinations API error: ${errorText}` 
            });
        }
        
        const data = await pollResponse.json();
        
        if (data.error) {
            console.error('[API] API Error:', data.error);
            return res.status(400).json({ 
                error: `API error: ${JSON.stringify(data.error)}` 
            });
        }
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('[API] Invalid response structure');
            return res.status(500).json({ 
                error: 'Invalid response structure from API' 
            });
        }
        
        // 6. RETURN SUCCESS
        const content = data.choices[0].message.content;
        
        console.log('[API] Success! Content length:', content.length);
        
        return res.status(200).json({
            content,
            model: model || 'openai-large',
            usage: data.usage || {}
        });
        
    } catch (error) {
        console.error('[API] Unexpected error:', error);
        return res.status(500).json({ 
            error: `Server error: ${error.message}` 
        });
    }
}
