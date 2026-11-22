/**
 * api/v1/keys/validate.js
 * GET /api/v1/keys/validate
 * Header: Authorization: Bearer mgk_xxx
 */
// ── Inlined key helpers ────────────────────────────────────────────────
const DEFAULTS = { monthlyGlobal: 300, monthlyPerKey: 100, dailyPerKey: 20, requestsPerMinute: 5 };

async function hashKey(plainKey) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plainKey));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const kv = {
    async get(key) {
        const { url, token } = kvCreds();
        if (!url) throw new Error('Redis is not configured');
        const res = await fetch(`${url.replace(/\\/$/, '')}/get/${enc(key)}`, { headers: kvAuth(token) });
        const d = await res.json();
        if (!res.ok || d.error) throw new Error('Redis unavailable');
        return d.result ? JSON.parse(d.result) : null;
    },
    async validationRate(key) {
        const { url, token } = kvCreds();
        if (!url) throw new Error('Redis is not configured');
        const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n";
        const response = await fetch(url.replace(/\\/$/, ''), {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(['EVAL', script, '1', key])
        });
        const payload = await response.json();
        if (!response.ok || payload.error) throw new Error('Redis unavailable');
        return Number(payload.result || 0);
    }
};
function kvCreds() {
    return { url: process.env.UPSTASH_REDIS_REST_URL || '', token: process.env.UPSTASH_REDIS_REST_TOKEN || '' };
}
const enc    = encodeURIComponent;
const kvAuth = (t) => ({ Authorization: `Bearer ${t}` });

async function getKeyStats(plainKey) {
    if (!/^mgk_[A-Za-z0-9]{32}$/.test(plainKey || '')) return null;
    const keyHash = await hashKey(plainKey);
    const validationCount = await kv.validationRate(`apiusage:key:validate:${keyHash}:${Math.floor(Date.now() / 60000)}`);
    if (validationCount > 10) throw Object.assign(new Error('API key validation rate limit reached. Retry shortly.'), { status: 429 });
    const meta = await kv.get(`apikey:hash:${keyHash}`);
    if (!meta) return null;
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const day = now.toISOString().slice(0, 10);
    const usageKeys = [
        `apiusage:key:month:${keyHash}:${month}`,
        `apiusage:key:day:${keyHash}:${day}`,
        `apiusage:global:month:${month}`,
        `apiusage:key:rate:${keyHash}:${Math.floor(Date.now() / 60000)}`
    ];
    const usageResponse = await fetch(`${kvCreds().url}/mget/${usageKeys.map(enc).join('/')}`, { headers: kvAuth(kvCreds().token) });
    const usagePayload = await usageResponse.json();
    if (!usageResponse.ok || usagePayload.error) throw new Error('Usage data unavailable');
    const [monthlyUsed, dailyUsed, globalUsed, rateUsed] = (usagePayload.result || []).map(value => Number(value || 0));
    const configuredLimit = (name, fallback) => { const n = Number(process.env[name]); return Number.isSafeInteger(n) && n > 0 ? n : fallback; };
    const monthlyLimit = configuredLimit('API_KEY_MONTHLY_CREDITS', DEFAULTS.monthlyPerKey);
    const dailyLimit = configuredLimit('API_KEY_DAILY_CREDITS', DEFAULTS.dailyPerKey);
    const globalLimit = configuredLimit('API_GLOBAL_MONTHLY_CREDITS', DEFAULTS.monthlyGlobal);
    const requestsPerMinute = configuredLimit('API_KEY_REQUESTS_PER_MINUTE', DEFAULTS.requestsPerMinute);
    return {
        usage: {
            monthly: { used: monthlyUsed, limit: monthlyLimit, remaining: Math.max(0, monthlyLimit - monthlyUsed), resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() },
            daily: { used: dailyUsed, limit: dailyLimit, remaining: Math.max(0, dailyLimit - dailyUsed), resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString() },
            globalMonthly: { used: globalUsed, limit: globalLimit, remaining: Math.max(0, globalLimit - globalUsed) },
            rateLimit: { requests: requestsPerMinute, used: rateUsed, remaining: Math.max(0, requestsPerMinute - rateUsed), windowSeconds: 60 }
        },
        email: meta.email,
        plan: meta.plan === 'free' ? 'developer' : (meta.plan || 'developer'),
        active: meta.active === true,
        createdAt: meta.createdAt,
        lastUsedAt: meta.lastUsedAt ?? null
    };
}

// ── Handler ────────────────────────────────────────────────────────────
export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (req.method !== 'GET')    return cors(jsonErr('Method Not Allowed', 405));

    const key = (req.headers.get('authorization') ?? '').replace(/^Bearer\\s+/i, '').trim();
    if (!key) return cors(jsonErr('Missing Authorization header', 401));

    let stats;
    try { stats = await getKeyStats(key); }
    catch (error) {
        if (error.status === 429) return cors(jsonErr(error.message, 429, { 'Retry-After': '60' }));
        return cors(jsonErr('API usage data is temporarily unavailable.', 503));
    }
    if (!stats)  return cors(jsonErr('API key not found', 404));

    return cors(new Response(JSON.stringify({
        valid: stats.active,
        email: stats.email,
        plan: stats.plan,
        usage: stats.usage,
        createdAt: stats.createdAt,
        lastUsedAt: stats.lastUsedAt
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function jsonErr(msg, status = 400, extraHeaders = {}) {
    return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json', ...extraHeaders } });
}
function cors(res) {
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Authorization');
    return new Response(res.body, { status: res.status, headers: h });
}
