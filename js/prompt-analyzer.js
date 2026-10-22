// Single-budget fallback controller. One in-flight request at a time.
// Each attempt is aborted and settled before the next model is started.
export async function fetchWithModelFallbacks(endpoint, models, ui, payload = {}, byopKey = null, userId = null) {
    const isAnalysis = endpoint.includes('/api/analyze');
    const budgetMs = Math.max(5000, Math.min(115000, Number(payload.totalTimeoutMs) || (isAnalysis ? 22000 : 110000)));
    const perModelMs = Math.max(3000, Math.min(70000, Number(payload.perModelTimeoutMs) || (isAnalysis ? 11000 : 52000)));
    const attempts = [...new Set(models.filter(Boolean))].slice(0, isAnalysis ? 2 : 3);
    const deadline = Date.now() + budgetMs;
    let lastError = null;

    for (const [index, model] of attempts.entries()) {
        const remaining = deadline - Date.now();
        if (remaining < 2500) break;
        const attemptTimeoutMs = Math.min(remaining, perModelMs);
        const controller = new AbortController();
        let localTimeout = false;
        const timer = setTimeout(() => {
            localTimeout = true;
            controller.abort('frontend_timeout');
        }, attemptTimeoutMs);
        const started = Date.now();
        let response = null;
        ui?.showMessage?.(`${isAnalysis ? 'Analyzing' : 'Composing'} with ${model} (${index + 1}/${attempts.length})...`, 'loading');
        console.info('[midi-attempt] start', { endpoint, model, attempt: index + 1, total: attempts.length, attemptTimeoutMs, budgetRemainingMs: remaining });
        try {
            const { timeout, totalTimeoutMs, perModelTimeoutMs, ...requestPayload } = payload;
            const headers = { 'Content-Type': 'application/json' };
            if (userId) headers['X-User-Id'] = userId;
            response = await fetch(endpoint, {
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
            // Keep the timeout active until the ENTIRE response has been read.
            const text = await response.text();
            if (!text.trim()) throw Object.assign(new Error('Empty model response'), { code: 'empty_response' });
            if (isAnalysis) {
                let data;
                try { data = JSON.parse(text); }
                catch { throw Object.assign(new Error('Invalid analysis JSON'), { code: 'invalid_analysis_json' }); }
                if (!data.extractedParams || !data.enhancedPrompt) {
                    throw Object.assign(new Error('Incomplete analysis JSON'), { code: 'incomplete_analysis_json' });
                }
            } else if (!text.includes('{') || !text.includes('}')) {
                throw Object.assign(new Error('No MIDI JSON in response'), { code: 'no_midi_json' });
            }
            console.info('[midi-fallback] success', { endpoint, model, elapsedMs: Date.now() - started, attemptTimeoutMs });
            return new Response(text, { status: 200, headers: response.headers });
        } catch (caught) {
            const err = localTimeout
                ? Object.assign(new Error(`Model ${model} exceeded frontend timeout`), { code: 'frontend_timeout', retryable: true })
                : caught;
            lastError = err;
            console.warn('[midi-fallback] failure', {
                endpoint, model, attempt: index + 1, elapsedMs: Date.now() - started,
                attemptTimeoutMs, status: err.status, code: err.code || err.name, message: err.message
            });
            if (err.requiresByop || err.requiresByopReauth) throw err;
            if (err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status)) throw err;
            if (err.status && ![408, 429, 500, 502, 503, 504].includes(err.status)) throw err;
            if (index < attempts.length - 1 && Date.now() < deadline - 2500) {
                ui?.showMessage?.(`${model} failed; trying backup model...`, 'info');
            }
        } finally {
            clearTimeout(timer);
            // Cancel any unfinished response stream before launching a fallback.
            if (response?.body && !response.bodyUsed && !controller.signal.aborted) {
                try { await response.body.cancel(); } catch {}
            }
        }
    }
    throw lastError || new Error('Generation deadline exceeded before a model could complete');
}

export async function analyzeAndEnhancePrompt(userPrompt, ui) {
    ui?.showMessage?.('Analyzing and enhancing your prompt...', 'loading');
    try {
        const byopKey = localStorage.getItem('byop_pollinations_key');
        const userId = localStorage.getItem('midi_user_id') || null;
        const response = await fetchWithModelFallbacks(
            '/api/analyze', ['openai/gpt-5.6-luna', 'claude-fast', 'grok', 'openai'], ui,
            { userPrompt, totalTimeoutMs: 22000, perModelTimeoutMs: 11000 }, byopKey, userId
        );
        const result = JSON.parse(await response.text());
        if (!result.extractedParams || !result.enhancedPrompt) throw new Error('Analysis response missing required keys');
        return { extractedParams: result.extractedParams, enhancedPrompt: result.enhancedPrompt };
    } catch (e) {
        console.error('Analysis failed:', e);
        throw new Error(`Could not process your prompt: ${e.message}`);
    }
}
