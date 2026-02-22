export const config = { runtime: 'edge' };

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMITING - Shared with generate.js
// ═══════════════════════════════════════════════════════════════════════════════

const FREE_LIMIT = 3;        // 3 free variations per 30 days
const WINDOW_DAYS = 30;

/** Returns caller's real IP */
function getClientIP(req) {
    return (
        req.headers.get('x-real-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown'
    );
}

/**
 * Check + increment usage counter with 30-day rolling window
 */
async function checkRateLimit(ip) {
    const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
    const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!kvUrl || !kvToken) {
        console.warn('[RATE-LIMIT] KV not configured — skipping');
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
    }

    const firstUseKey = `rl:variations:${ip}:window_start`;
    const countKey    = `rl:variations:${ip}:count`;

    try {
        // Get window start
        const firstUseRes = await fetch(`${kvUrl}/get/${firstUseKey}`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });
        const { result: firstUse } = await firstUseRes.json();

        const now = new Date();
        let windowStart, windowExpiry;

        if (firstUse) {
            windowStart = firstUse;
            const startDate = new Date(firstUse);
            windowExpiry = new Date(startDate);
            windowExpiry.setDate(startDate.getDate() + WINDOW_DAYS);
        } else {
            windowStart = now.toISOString();
            windowExpiry = new Date(now);
            windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
        }

        // Check if window expired
        if (firstUse && now > windowExpiry) {
            console.log(`[RATE-LIMIT] Window expired for ${ip}, resetting...`);
            
            await fetch(`${kvUrl}/del/${firstUseKey}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            await fetch(`${kvUrl}/del/${countKey}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            
            windowStart = now.toISOString();
            windowExpiry = new Date(now);
            windowExpiry.setDate(now.getDate() + WINDOW_DAYS);
        }

        // Increment counter
        const incrRes = await fetch(`${kvUrl}/incr/${countKey}`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });
        const { result: count } = await incrRes.json();

        // Set expiry if new
        if (count === 1 || !firstUse || now > windowExpiry) {
            await fetch(`${kvUrl}/set/${firstUseKey}/${windowStart}/ex/${WINDOW_DAYS * 86400}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            await fetch(`${kvUrl}/expire/${countKey}/${WINDOW_DAYS * 86400}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
        }

        const remaining = Math.max(0, FREE_LIMIT - count);
        const allowed = count <= FREE_LIMIT;

        console.log(`[RATE-LIMIT] IP=${ip} count=${count}/${FREE_LIMIT} allowed=${allowed}`);

        return { 
            allowed, 
            remaining, 
            resetAt: windowExpiry.getTime() 
        };

    } catch (err) {
        console.error('[RATE-LIMIT] KV error:', err.message);
        return { allowed: true, remaining: FREE_LIMIT, resetAt: 0 };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, seed, model, userApiKey } = await req.json();

        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return jsonError('Missing or invalid prompt parameter', 400);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // BYOP & RATE LIMITING
        // ═══════════════════════════════════════════════════════════════════════

        const hasByopKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0;
        let remainingGenerations = FREE_LIMIT;

        if (!hasByopKey) {
            const clientIP = getClientIP(req);
            const { allowed, remaining, resetAt } = await checkRateLimit(clientIP);
            remainingGenerations = remaining;

            if (!allowed) {
                return new Response(
                    JSON.stringify({
                        error: 'daily_limit_reached',
                        message: `You have used your ${FREE_LIMIT} free variations for this 30-day period.`,
                        resetAt,
                        requiresByop: true
                    }),
                    {
                        status: 402,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
            }
        } else {
            console.log('[RATE-LIMIT] BYOP key detected — skipping rate limit');
            remainingGenerations = 999;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // API KEY RESOLUTION
        // ═══════════════════════════════════════════════════════════════════════

        const apiKey = hasByopKey
            ? userApiKey.trim()
            : (process.env.POLLINATIONS_GEN_KEY || '');

        if (!apiKey) {
            return jsonError('No API key available. Configure POLLINATIONS_GEN_KEY or provide userApiKey.', 500);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // CALL POLLINATIONS
        // ═══════════════════════════════════════════════════════════════════════

        const url = `https://gen.pollinations.ai/text/${encodeURIComponent(prompt)}?key=${apiKey}&seed=${seed || 0}&model=${model || 'openai-large'}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);

        try {
            console.log('[VARIATIONS] Calling Pollinations...');
            
            const response = await fetch(url, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[VARIATIONS] Pollinations error:', errorText);
                return jsonError(`Pollinations ${response.status}: ${errorText}`, response.status);
            }

            // ═══════════════════════════════════════════════════════════════════
            // STREAMING RESPONSE WITH HEADERS
            // ═══════════════════════════════════════════════════════════════════

            const headers = {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            };

            if (isByop) {
                headers['X-Remaining-Generations'] = 'BYOP';
            } else if (remainingGenerations !== null) {
                headers['X-Remaining-Generations'] = String(remainingGenerations);
            }

            return new Response(response.body, {
                status: 200,
                headers
            });

        } catch (fetchError) {
            clearTimeout(timeoutId);

            if (fetchError.name === 'AbortError') {
                return jsonError('Request to Pollinations timed out after 90s', 504);
            }

            throw fetchError;
        }

    } catch (error) {
        console.error('[VARIATIONS] Handler error:', error);
        return jsonError(error.message || 'Internal server error', 500);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
