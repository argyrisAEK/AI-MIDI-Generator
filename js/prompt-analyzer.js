// Shared single-budget fallback controller. Each model uses remaining global budget.
export async function fetchWithModelFallbacks(endpoint, models, ui, payload = {}, byopKey = null, userId = null) {
    const isAnalysis = endpoint.includes('/api/analyze');
    const budgetMs = Math.max(5000, Math.min(90000, Number(payload.totalTimeoutMs) || (isAnalysis ? 22000 : 72000)));
    const perModelMs = Math.max(3000, Math.min(65000, Number(payload.perModelTimeoutMs) || (isAnalysis ? 11000 : 34000)));
    const attempts = [...new Set(models.filter(Boolean))].slice(0, isAnalysis ? 2 : 3);
    const deadline = Date.now() + budgetMs;
    let lastError = null;
    for (const [index, model] of attempts.entries()) {
        const remaining = deadline - Date.now();
        if (remaining < 2500) break;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(remaining, perModelMs));
        const started = Date.now();
        ui?.showMessage?.(`${isAnalysis ? ' Analyzing' : 'Composing'} with ${model} (${index + 1}/${attempts.length})...`, 'loading');
        try {
            const { timeout, totalTimeoutMs, perModelTimeoutMs, ...requestPayload } = payload;
            const headers = { 'Content-Type': 'application/json' };
            if (userId) headers['X-User-Id'] = userId;
            const response = await fetch(endpoint, {
                method: 'POST', headers, signal: controller.signal,
                body: JSON.stringify({ ...requestPayload, model, ...(byopKey ? { userApiKey: byopKey } : {}) })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                const err = new Error(data.message || data.error || `Server error: ${response.status} ${response.statusText}`);
                err.status = response.status;
                err.code = data.error;
                err.resetAt = data.resetAt;
                if (response.status === 402) err.requiresByop = true;
                if (response.status === 401 && byopKey) err.requiresByopReauth = true;
                throw err;
            }
            // Keep abort timer alive while reading body: fetch() resolves at headers, not body completion.
            const text = await response.text();
            if (!text.trim()) throw Object.assign(new Error('Empty model response'), { retryable: true });
            if (isAnalysis) {
                let data;
                try { data = JSON.parse(text); } catch { throw Object.assign(new Error('Invalid analysis JSON'), { retryable: true }); }
                if (!data.extractedParams || !data.enhancedPrompt) throw Object.assign(new Error('Incomplete analysis JSON'), { retryable: true });
            } else if (!text.includes('{') || !text.includes('}')) {
                throw Object.assign(new Error('No MIDI JSON in response'), { retryable: true });
            }
            console.info('[midi-fallback] success', { endpoint, model, elapsedMs: Date.now() - started });
            return new Response(text, { status: 200, headers: response.headers });
        } catch (err) {
            if (controller.signal.aborted) err = Object.assign(new Error(`Model ${model} exceeded timeout`), { retryable: true, code: 'timeout' });
            lastError = err;
            console.warn('[midi-fallback] failure', { endpoint, model, elapsedMs: Date.now() - started, status: err.status, code: err.code, message: err.message });
            if (err.requiresByop || err.requiresByopReauth) throw err;
            // 4xx other than 408/429 cannot be corrected by switching models.
            if (err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status)) throw err;
            if (err.status && ![408, 429, 500, 502, 503, 504].includes(err.status)) throw err;
            if (index < attempts.length - 1 && Date.now() < deadline - 2500) ui?.showMessage?.(`${model} failed; trying backup model...`, 'info');
        } finally { clearTimeout(timer); }
    }
    throw lastError || new Error('Generation deadline exceeded before a model could complete');
}

export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui.showMessage('Analyzing and enhancing your prompt...', 'loading');
    
    try {
        const byopKey = localStorage.getItem('byop_pollinations_key');
        const userId = localStorage.getItem('midi_user_id') || null;

        const response = await fetchWithModelFallbacks(
            '/api/analyze', 
            ['openai/gpt-5.6-luna','claude-fast', 'grok','openai'], 
            ui, 
            {
                userPrompt,
                totalTimeoutMs: 22000, perModelTimeoutMs: 11000
            },
            byopKey,
            userId  // β… ΞΞ­Ξ± Ο€Ξ±ΟΞ¬ΞΌΞµΟ„ΟΞΏΟ‚
        );

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
