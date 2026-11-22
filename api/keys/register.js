/**
 * api/v1/keys/register.js
 * POST /api/v1/keys/register   { "email": "dev@example.com" }
 * CORS restricted to own domain — blocks third-party key harvesting.
 */

// ── Inlined key management (no imports needed) ─────────────────────
const API_PLAN = 'developer';

async function hashKey(plainKey) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plainKey));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return 'mgk_' + Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

const kv = {
    async get(key) {
        const { url, token } = kvCreds();
        if (!url) return null;
        const res = await fetch(`${url}/get/${enc(key)}`, { headers: kvAuth(token) });
        const d   = await res.json();
        return d.result ? JSON.parse(d.result) : null;
    },
    async set(key, value, exSeconds) {
        const { url, token } = kvCreds();
        if (!url) return;
        const ex = exSeconds ? `/ex/${exSeconds}` : '';
        await fetch(`${url}/set/${enc(key)}/${enc(JSON.stringify(value))}${ex}`, { headers: kvAuth(token) });
    }
};
function kvCreds() {
    return { url: process.env.UPSTASH_REDIS_REST_URL || '', token: process.env.UPSTASH_REDIS_REST_TOKEN || '' };
}
const enc    = encodeURIComponent;
const kvAuth = (t) => ({ Authorization: `Bearer ${t}` });

async function createApiKey(email) {
    const plainKey = generateApiKey();
    const keyHash  = await hashKey(plainKey);
    const meta = {
        keyHash,
        email:        email.toLowerCase().trim(),
        createdAt:    new Date().toISOString(),
        plan:         API_PLAN,
        active:       true
    };
    await kv.set(`apikey:hash:${keyHash}`, meta, 86400 * 730);
    return { ...meta, key: plainKey };
}

// ── Handler ───────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = 'https://midi-aigenerator.vercel.app';

export const config = { runtime: 'edge' };

export default async function handler(req) {
    const origin = req.headers.get('origin') || '';
    const reqId  = crypto.randomUUID().slice(0, 8);

    if (req.method === 'OPTIONS') return restrictedCors(new Response(null, { status: 204 }), origin);
    if (req.method !== 'POST')   return restrictedCors(jsonErr('Method Not Allowed', 405), origin);

    let body;
    try { body = await req.json(); }
    catch { return restrictedCors(jsonErr('Invalid JSON body', 400), origin); }

    const email = (body.email ?? '').toLowerCase().trim().slice(0, 254);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return restrictedCors(jsonErr('A valid email address is required', 400), origin);
    }

    const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
    const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    console.log(`[register][${reqId}] email=${email} origin=${origin || 'direct'}`);

    if (kvUrl && kvToken) {
        const emailKey = `apikey:email:${email}`;
        const existing = await kv.get(emailKey);

        if (existing) {
            console.log(`[register][${reqId}] duplicate email=${email}`);
            return restrictedCors(jsonResp({
                message: 'An API key is already registered to this email. Keys are shown only once — check your records.'
            }, 200), origin);
        }

        const meta = await createApiKey(email);

        // Store email → keyHash (NOT the plain key)
        await fetch(`${kvUrl}/set/${enc(emailKey)}/${enc(meta.keyHash)}/ex/${86400 * 730}`, {
            headers: kvAuth(kvToken)
        });

        console.log(`[register][${reqId}] created hash=${meta.keyHash.slice(0, 8)}...`);

        return restrictedCors(jsonResp({
            message:      'API key created. Save it now — it will not be shown again.',
            key:          meta.key,
            email:        meta.email,
            plan:         meta.plan,
            createdAt:    meta.createdAt,
            docs:         `${ALLOWED_ORIGIN}/api-docs`
        }, 201), origin);
    }

    // Dev mode — KV not configured
    console.warn(`[register][${reqId}] KV not configured`);
    const meta = await createApiKey(email);
    return restrictedCors(jsonResp({ message: '[DEV] KV not configured — key not persisted.', key: meta.key, email: meta.email }, 201), origin);
}

function jsonResp(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function jsonErr(msg, status = 400) {
    return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
function restrictedCors(res, origin) {
    const h = new Headers(res.headers);
    if (!origin || origin === ALLOWED_ORIGIN) {
        h.set('Access-Control-Allow-Origin', origin || ALLOWED_ORIGIN);
        h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        h.set('Access-Control-Allow-Headers', 'Content-Type');
    }
    return new Response(res.body, { status: res.status, headers: h });
}
