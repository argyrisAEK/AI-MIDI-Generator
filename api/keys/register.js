/**
 * api/v1/keys/register.js
 * POST /api/v1/keys/register   { email: "dev@example.com" }
 *
 * CORS: restricted to own domain — blocks third-party key harvesting.
 * One key per email. Plain key shown only once at creation.
 */

import { createApiKey, hashKey } from '../_lib/api-keys.js';

export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = 'https://midi-aigenerator.vercel.app';
const KV_TTL         = 86400 * 730; // 2 years

export default async function handler(req) {
    const origin = req.headers.get('origin') || '';
    const reqId  = crypto.randomUUID().slice(0, 8);

    if (req.method === 'OPTIONS') return restrictedCors(new Response(null, { status: 204 }), origin);
    if (req.method !== 'POST')   return restrictedCors(err('Method Not Allowed', 405), origin);

    let body;
    try { body = await req.json(); }
    catch { return restrictedCors(err('Invalid JSON body', 400), origin); }

    // Sanitize + validate email
    const email = (body.email ?? '').toLowerCase().trim().slice(0, 254);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return restrictedCors(err('A valid email address is required', 400), origin);
    }

    const kvUrl   = process.env.UPSTASH_REDIS_REST_URL;
    const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    console.log(`[register][${reqId}] email=${email} origin=${origin || 'direct'}`);

    if (kvUrl && kvToken) {
        const emailKey = `apikey:email:${email}`;
        const res      = await fetch(`${kvUrl}/get/${encodeURIComponent(emailKey)}`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });
        const existing = await res.json();

        if (existing.result) {
            // Key exists — don't reveal it. Security: keys shown only once.
            console.log(`[register][${reqId}] duplicate email=${email}`);
            return restrictedCors(new Response(JSON.stringify({
                message: 'An API key is already registered to this email. Keys are shown only once — check your records.'
            }), { status: 200, headers: json() }), origin);
        }

        const meta = await createApiKey(email);

        // Store email → keyHash (NOT plain key)
        await fetch(`${kvUrl}/set/${encodeURIComponent(emailKey)}/${encodeURIComponent(meta.keyHash)}/ex/${KV_TTL}`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });

        console.log(`[register][${reqId}] created hash=${meta.keyHash.slice(0, 8)}...`);

        return restrictedCors(new Response(JSON.stringify({
            message:      'API key created. Save it now — it will not be shown again.',
            key:          meta.key,
            email:        meta.email,
            plan:         meta.plan,
            monthlyLimit: meta.monthlyLimit,
            createdAt:    meta.createdAt,
            docs:         `${ALLOWED_ORIGIN}/api-docs`
        }), { status: 201, headers: json() }), origin);
    }

    // Dev/test mode — KV not configured
    console.warn(`[register][${reqId}] KV not configured — key not persisted`);
    const meta = await createApiKey(email);
    return restrictedCors(new Response(JSON.stringify({
        message: '[DEV] KV not configured — key will not persist.',
        key: meta.key, email: meta.email
    }), { status: 201, headers: json() }), origin);
}

function err(msg, status) {
    return new Response(JSON.stringify({ error: msg }), { status, headers: json() });
}
function json() {
    return { 'Content-Type': 'application/json' };
}
function restrictedCors(res, origin) {
    const h = new Headers(res.headers);
    // Allow own domain and direct curl calls (no origin header)
    if (!origin || origin === ALLOWED_ORIGIN) {
        h.set('Access-Control-Allow-Origin',  origin || ALLOWED_ORIGIN);
        h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        h.set('Access-Control-Allow-Headers', 'Content-Type');
    }
    return new Response(res.body, { status: res.status, headers: h });
}
