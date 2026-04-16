/**
 * api/v1/keys/validate.js
 * GET /api/v1/keys/validate
 * Header: Authorization: Bearer mgk_xxx
 */

import { getKeyStats } from '../_lib/api-keys.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (req.method !== 'GET')    return cors(err('Method Not Allowed', 405));

    const key = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim();
    if (!key) return cors(err('Missing Authorization header', 401));

    const stats = await getKeyStats(key);
    if (!stats)  return cors(err('API key not found', 404));

    return cors(new Response(JSON.stringify({
        valid:        stats.active,
        email:        stats.email,
        plan:         stats.plan,
        used:         stats.used,
        remaining:    stats.remaining,
        monthlyLimit: stats.monthlyLimit,
        resetAt:      stats.resetAt,
        createdAt:    stats.createdAt,
        lastUsedAt:   stats.lastUsedAt
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function err(msg, status) {
    return new Response(JSON.stringify({ error: msg }), {
        status, headers: { 'Content-Type': 'application/json' }
    });
}
function cors(res) {
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin',  '*');
    h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Authorization');
    return new Response(res.body, { status: res.status, headers: h });
}
