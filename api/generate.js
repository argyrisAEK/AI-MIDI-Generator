// generate.js — Vercel Edge Function with AI SDK streaming
// npm install ai

import { StreamingTextResponse, streamText, createOpenAI } from 'ai';

export const config = { runtime: 'edge', timeout: 50 };

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

        const apiKey = process.env.POLLINATIONS_GEN_KEY || 'dummy'; // Pollinations may not need a key

        // ✅ Custom OpenAI-compatible provider pointing to Pollinations
        const pollinations = createOpenAI({
            baseURL: 'https://gen.pollinations.ai/v1',
            apiKey,
            headers: {
                'User-Agent': 'MIDIGenerator/1.0'
            }
        });

        const selectedModel = model || 'openai-large';

        // ✅ streamText — streams tokens directly to client, no buffering, no timeout risk
        const result = await streamText({
            model: pollinations(selectedModel),
            system: 'You are a creative musical AI. You must output ONLY valid JSON containing musical track data, no markdown, no preamble.',
            messages: [
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            maxTokens: 4096,
        });

        // ✅ StreamingTextResponse pipes the stream straight to the client
        // Edge function stays alive only as long as tokens are flowing — no 50s wall
        return result.toTextStreamResponse();

    } catch (err) {
        console.error('[EDGE] Fatal error:', err);
        return new Response(
            JSON.stringify({ error: err.message }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}
