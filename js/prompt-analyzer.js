export async function fetchWithModelFallbacks(endpoint, models, ui, payload = {}, byopKey = null) {
    const timeout = payload.timeout || 90000;
    let lastError = null;
    const loadingMessage = endpoint.includes("/api/generate")
        ? (m) => `🎵 Composing with ${m.replace(/-\d+k$/, "")}...`
        : endpoint.includes("/api/variations")
        ? (m) => `🎛️ Editing tracks with ${m.replace(/-\d+k$/, "")}...`
        : (m) => `🔍 Analyzing prompt with ${m.replace(/-\d+k$/, "")}...`;

    for (const model of models) {
        ui.showMessage(loadingMessage(model), 'loading');

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const headers = { 'Content-Type': 'application/json' };
            if (byopKey) headers['X-Byop-Key'] = byopKey;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ ...payload, model: model }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.status === 402) {
                const data = await response.json().catch(() => ({}));
                const err = new Error(data.message || 'Daily generation limit reached.');
                err.requiresByop = true;
                err.resetAt = data.resetAt;
                throw err;
            }

            if (response.status === 401) {
                const err = new Error('Your Pollinations key is no longer valid. Please reconnect.');
                err.requiresByopReauth = true;
                throw err;
            }

            if (!response.ok) {
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }

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

            const trimmedText = accumulatedText.trim();
            if (trimmedText.length === 0) {
                throw new Error(`Model '${model}' returned empty response`);
            }

            if (!trimmedText.includes('{') || !trimmedText.includes('}')) {
                throw new Error(`Model '${model}' did not return JSON structure`);
            }

            return new Response(trimmedText, { status: 200 });

        } catch (error) {
            if (error.requiresByop || error.requiresByopReauth) {
                throw error;
            }

            lastError = error;
            console.warn(`Attempt with ${model} failed:`, error.message);

            if (model !== models[models.length - 1]) {
                ui.showMessage(`${model} failed, trying next model...`, 'info');
            }
        }
    }

    throw lastError || new Error(`All models failed. Last error: ${lastError?.message}`);
}

export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui.showMessage('Analyzing and enhancing your prompt...', 'loading');

    try {
        const response = await fetchWithModelFallbacks('/api/analyze', ['claude-fast', 'openai'], ui, {
            userPrompt,
            timeout: 25000
        });

        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (parseError) {
            console.error('JSON parse failed:', text);
            throw new Error(`Invalid JSON from analysis: ${parseError.message}`);
        }

        if (!result.extractedParams || !result.enhancedPrompt) {
            throw new Error('Analysis response missing required keys');
        }

        return {
            extractedParams: result.extractedParams,
            enhancedPrompt: result.enhancedPrompt
        };

    } catch (e) {
        console.error("Analysis failed:", e);
        throw new Error(`Could not process your prompt: ${e.message}`);
    }
}
