/**
 * api/v1/keys/validate.js
 * GET /api/v1/keys/validate
 * Header: Authorization: Bearer mgk_xxx
 */
// ── Inlined key helpers ────────────────────────────────────────────────
const REQUESTS_PER_MINUTE = 20;

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
    return {
        email: meta.email,
        plan: meta.plan || 'developer',
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

    const stats = await getKeyStats(key);
    if (!stats)  return cors(jsonErr('API key not found', 404));

    return cors(new Response(JSON.stringify({
        valid: stats.active,
        email: stats.email,
        plan: stats.plan,
        rateLimit: { requests: REQUESTS_PER_MINUTE, windowSeconds: 60 },
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
