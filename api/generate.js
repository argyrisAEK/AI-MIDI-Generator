export const config = { 
    runtime: 'edge', 
    timeout: 50  // ✅ 50 seconds
};

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, model, enhancedPrompt } = await req.json();

        if (!prompt || typeof prompt !== 'string') {
            return new Response(JSON.stringify({ error: 'Invalid prompt' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ✅ Get API key from environment (optional but recommended)
        const apiKey = process.env.POLLINATIONS_API_KEY || '';
        
        // ✅ Use enhancedPrompt if available
        const finalPrompt = enhancedPrompt || prompt;

        // ✅ Correct Pollinations API payload structure
        const payload = {
            messages: [
                {
                    role: 'system',
                    content: 'You are a creative musical AI. You must output ONLY valid JSON containing musical track data, no markdown, no preamble.'
                },
                {
                    role: 'user',
                    content: finalPrompt
                }
            ],
            model: model || 'openai-large',  // ✅ Valid models: openai, claude, gemini, mistral, etc.
            temperature: 0.7,
            max_tokens: 4096,
            seed: -1,
            jsonMode: true  // ✅ This helps ensure JSON output
        };

        console.log('[EDGE] Calling Pollinations API...');
        console.log('[EDGE] Model:', payload.model);
        console.log('[EDGE] Prompt length:', finalPrompt.length);
        
        // ✅ Correct endpoint: https://gen.pollinations.ai/v1/chat/completions
        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        });

        console.log('[EDGE] Response status:', pollResponse.status);

        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            console.error('[EDGE] API Error:', errorText);
            
            // ✅ Better error handling with specific messages
            let errorMessage = `Pollinations API error: ${pollResponse.status}`;
            if (pollResponse.status === 429) {
                errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
            } else if (pollResponse.status === 401) {
                errorMessage = 'Authentication failed. Check your API key.';
            }
            
            return new Response(
                JSON.stringify({ 
                    error: errorMessage,
                    details: errorText,
                    status: pollResponse.status
                }), 
                { 
                    status: pollResponse.status,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }

        const jsonData = await pollResponse.json();
        console.log('[EDGE] Successfully received response');

        // ✅ Extract content from OpenAI-compatible response
        let content = '';
        if (jsonData.choices?.[0]?.message?.content) {
            content = jsonData.choices[0].message.content;
        } else if (jsonData.choices?.[0]?.text) {
            content = jsonData.choices[0].text;
        } else if (jsonData.content) {
            // Some responses might have content directly
            content = jsonData.content;
        } else {
            console.error('[EDGE] Unexpected response structure:', JSON.stringify(jsonData).substring(0, 200));
            return new Response(
                JSON.stringify({ 
                    error: 'Invalid API response structure',
                    received: jsonData
                }), 
                { 
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }

        if (!content || content.trim().length === 0) {
            console.error('[EDGE] Empty content received');
            return new Response(
                JSON.stringify({ error: 'Empty content from API' }), 
                { 
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }

        console.log('[EDGE] Content length:', content.length);
        console.log('[EDGE] Content preview:', content.substring(0, 100));

        // ✅ Return JSON response
        return new Response(
            JSON.stringify({ content }), 
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            }
        );

    } catch (err) {
        console.error('[EDGE] Fatal error:', err);
        console.error('[EDGE] Error stack:', err.stack);
        
        return new Response(
            JSON.stringify({ 
                error: 'Internal server error',
                message: err.message,
                type: err.name
            }), 
            { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}
