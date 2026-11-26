import { getByopKey, byopRequiredError } from './byop-session.js';

// Single-budget fallback controller. One in-flight request at a time.
// Each attempt is aborted and settled before the next model is started.
// Model-agnostic deadlines: favor the user-selected model, preserve fallback time.
// These are upper bounds; any early failure/success returns unused time to the pool.
function calculateAttemptTimeout({ remainingMs, attemptIndex, totalAttempts, isAnalysis, perModelTimeoutMs }) {
    if (isAnalysis) return Math.min(remainingMs, perModelTimeoutMs);
    const futureAttempts = totalAttempts - attemptIndex - 1;
    if (attemptIndex === 0) {
        // Give the preferred model up to 80s while reserving 15s for each remaining fallback.
        return Math.min(futureAttempts ? 80000 : 110000, Math.max(2500, remainingMs - futureAttempts * 15000));
    }
    if (futureAttempts > 0) {
        // Give each fallback a fair window while preserving at least 15s per later attempt.
        return Math.min(65000, Math.max(2500, remainingMs - futureAttempts * 15000));
    }
    // Last model gets all remaining time (the server still enforces its own limit).
    return remainingMs;
}

export async function fetchWithModelFallbacks(endpoint, models, ui, payload = {}, byopKey = null) {
    // Pollinations Pay μόνο: χωρίς συνδεδεμένο key δεν γίνεται καμία κλήση.
    if (!byopKey) throw byopRequiredError();
    const isAnalysis = endpoint.includes('/api/analyze');
    const budgetMs = Math.max(5000, Math.min(150000, Number(payload.totalTimeoutMs) || (isAnalysis ? 47000 : 150000)));
    const configuredPerModelTimeoutMs = Math.max(2500, Math.min(120000, Number(payload.perModelTimeoutMs) || (isAnalysis ? 22000 : 0)));
    const attempts = [...new Set(models.filter(Boolean))].slice(0, isAnalysis ? 2 : 5);
    const deadline = Date.now() + budgetMs;
    let lastError = null;

    for (const [index, model] of attempts.entries()) {
        const remaining = deadline - Date.now();
        if (remaining < 2500) break;
        const attemptTimeoutMs = Math.min(remaining, calculateAttemptTimeout({ remainingMs: remaining, attemptIndex: index, totalAttempts: attempts.length, isAnalysis, perModelTimeoutMs: configuredPerModelTimeoutMs }));
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
            response = await fetch(endpoint, {
                method: 'POST', headers, signal: controller.signal,
                body: JSON.stringify({ ...requestPayload, model, userApiKey: byopKey })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                const err = new Error(data.message || data.error || `Server error: ${response.status} ${response.statusText}`);
                err.status = response.status;
                err.code = data.error;
                // 402 = το Pollen / budget του key τελείωσε. 401 = άκυρο ή ληγμένο key.
                if (response.status === 402) err.insufficientPollen = true;
                if (response.status === 401) err.requiresByopReauth = true;
                throw err;
            }
            // Keep the timeout active until the ENTIRE response has been read.
            const text = await response.text();
            if (!text.trim()) throw Object.assign(new Error('Empty model response'), { code: 'empty_response' });
            if (isAnalysis) {
                let data;
                try { data = JSON.parse(text); }
                catch { throw Object.assign(new Error('Invalid analysis JSON'), { code: 'invalid_analysis_json' }); }
                const p = data.extractedParams;
                const validKeys = new Set(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
                const validScales = new Set(['major', 'minor', 'dorian', 'phrygian', 'aeolian', 'lydian', 'mixolydian', 'locrian', 'harmonic-minor', 'melodic-minor', 'pentatonic', 'minor-pentatonic', 'blues']);
                const validTracks = new Set(['bassline', 'chord', 'melody', 'arpeggio', 'lead', 'plucks', 'strings', 'keys', 'guitar', 'pad-textures', 'brass', 'percs']);
                const bpm = Number(p?.bpm);
                const tracksValid = Array.isArray(p?.trackTypes) && p.trackTypes.length > 0 &&
                    p.trackTypes.length <= 5 && p.trackTypes.every(track => validTracks.has(track));
                if (!p || typeof p !== 'object' || typeof data.enhancedPrompt !== 'string' ||
                    !data.enhancedPrompt.trim() || !validKeys.has(p.key) || !validScales.has(p.scale) ||
                    !Number.isInteger(bpm) || bpm < 40 || bpm > 300 ||
                    ![4, 8].includes(Number(p.duration_bars)) || !tracksValid) {
                    throw Object.assign(new Error('Incomplete or invalid analysis parameters'), { code: 'incomplete_analysis_json' });
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
            if (err.requiresByop || err.requiresByopReauth || err.insufficientPollen) throw err;
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

export async function analyzeAndEnhancePrompt(userPrompt, ui, selectedTrackTypes = []) {
    ui?.showMessage?.('Analyzing and enhancing your prompt...', 'loading');
    try {
        const byopKey = getByopKey();
        const isProTier = localStorage.getItem('preferred_model') === 'pro';
        const analysisModels = isProTier
            ? ['openai/gpt-6.1-terra', 'openai/gpt-6-luna']
            : ['openai/gpt-6-luna', 'openai/gpt-5.6-luna', 'claude-fast', 'grok', 'openai'];

        console.info('[midi-analysis-routing]', {
            tier: isProTier ? 'pro' : 'standard',
            models: analysisModels.slice(0, 2)
        });

        const response = await fetchWithModelFallbacks(
            '/api/analyze', analysisModels, ui,
            { userPrompt, selectedTrackTypes, totalTimeoutMs: 47000, perModelTimeoutMs: 22000 }, byopKey
        );
        const result = JSON.parse(await response.text());
        if (!result.extractedParams || !result.enhancedPrompt) throw new Error('Analysis response missing required keys');
        return { extractedParams: result.extractedParams, enhancedPrompt: result.enhancedPrompt };
    } catch (e) {
        console.error('Analysis failed:', e);
        // Κράτα τα flags (requiresByop κ.λπ.) ώστε το UI να δείξει το σωστό modal.
        if (e.requiresByop || e.requiresByopReauth || e.insufficientPollen) throw e;
        throw new Error(`Could not process your prompt: ${e.message}`);
    }
}
