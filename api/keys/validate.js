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
        if (!url) return null;
        const res = await fetch(`${url}/get/${enc(key)}`, { headers: kvAuth(token) });
        const d   = await res.json();
        return d.result ? JSON.parse(d.result) : null;
    }
};
function kvCreds() {
    return { url: process.env.UPSTASH_REDIS_REST_URL || '', token: process.env.UPSTASH_REDIS_REST_TOKEN || '' };
}
const enc    = encodeURIComponent;
const kvAuth = (t) => ({ Authorization: `Bearer ${t}` });

async function getKeyStats(plainKey) {
    if (!plainKey?.startsWith('mgk_')) return null;
    const keyHash = await hashKey(plainKey);
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

    const key = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim();
    if (!key) return cors(jsonErr('Missing Authorization header', 401));

    let stats;
    try { stats = await getKeyStats(key); }
    catch { return cors(jsonErr('API usage data is temporarily unavailable.', 503)); }
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

function jsonErr(msg, status = 400) {
    return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
function cors(res) {
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Authorization');
    return new Response(res.body, { status: res.status, headers: h });
}
