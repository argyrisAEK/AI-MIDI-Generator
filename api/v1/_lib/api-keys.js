/**
 * api/v1/_lib/api-keys.js
 * Key management — SHA-256 hashing, monthly usage, stats.
 * Plain-text keys are NEVER stored. Only SHA-256 hashes persist.
 */

export const FREE_MONTHLY_LIMIT = 50;

// ── Crypto ────────────────────────────────────────────────────────────
export async function hashKey(plainKey) {
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plainKey));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return 'mgk_' + Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

// ── KV primitives ─────────────────────────────────────────────────────
const kv = {
    async get(key) {
        const { url, token } = kvCreds();
        if (!url) return null;
        const res  = await fetch(`${url}/get/${enc(key)}`, { headers: auth(token) });
        const data = await res.json();
        return data.result ? JSON.parse(data.result) : null;
    },
    async set(key, value, exSeconds) {
        const { url, token } = kvCreds();
        if (!url) return;
        const ex = exSeconds ? `/ex/${exSeconds}` : '';
        await fetch(`${url}/set/${enc(key)}/${enc(JSON.stringify(value))}${ex}`, { headers: auth(token) });
    },
    async incr(key) {
        const { url, token } = kvCreds();
        if (!url) return 1;
        const res  = await fetch(`${url}/incr/${enc(key)}`, { headers: auth(token) });
        const data = await res.json();
        return data.result || 1;
    },
    async expire(key, seconds) {
        const { url, token } = kvCreds();
        if (!url) return;
        await fetch(`${url}/expire/${enc(key)}/${seconds}`, { headers: auth(token) });
    }
};

function kvCreds() {
    return {
        url:   process.env.UPSTASH_REDIS_REST_URL   || '',
        token: process.env.UPSTASH_REDIS_REST_TOKEN || ''
    };
}
const enc  = encodeURIComponent;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

// ── Public API ────────────────────────────────────────────────────────

/**
 * Create a new key. Returns { key (plain, shown once), keyHash, email, ... }
 */
export async function createApiKey(email) {
    const plainKey = generateApiKey();
    const keyHash  = await hashKey(plainKey);
    const meta = {
        keyHash,
        email:        email.toLowerCase().trim(),
        createdAt:    new Date().toISOString(),
        plan:         'free',
        monthlyLimit: FREE_MONTHLY_LIMIT,
        active:       true
    };
    await kv.set(`apikey:hash:${keyHash}`, meta, 86400 * 730);
    return { ...meta, key: plainKey }; // plain key returned to caller only
}

/**
 * Validate key + increment usage. Returns { valid, meta, used, remaining, resetAt }
 */
export async function validateAndUseKey(plainKey) {
    if (!plainKey?.startsWith('mgk_')) {
        return { valid: false, reason: 'Invalid key format — keys start with mgk_' };
    }

    const keyHash = await hashKey(plainKey);
    const meta    = await kv.get(`apikey:hash:${keyHash}`);
    if (!meta)        return { valid: false, reason: 'API key not found' };
    if (!meta.active) return { valid: false, reason: 'API key deactivated' };

    const { usageKey, resetAt } = usagePeriod(keyHash);
    const count = await kv.incr(usageKey);
    if (count === 1) await kv.expire(usageKey, 2764800); // 32-day expiry

    const limit = meta.monthlyLimit ?? FREE_MONTHLY_LIMIT;
    if (count > limit) {
        return { valid: false, reason: `Monthly limit of ${limit} calls reached`, remaining: 0, resetAt };
    }

    meta.lastUsedAt = new Date().toISOString();
    await kv.set(`apikey:hash:${keyHash}`, meta, 86400 * 730);

    return { valid: true, meta, used: count, remaining: limit - count, resetAt };
}

/**
 * Get stats without incrementing (for /keys/validate endpoint).
 */
export async function getKeyStats(plainKey) {
    if (!plainKey?.startsWith('mgk_')) return null;
    const keyHash = await hashKey(plainKey);
    const meta    = await kv.get(`apikey:hash:${keyHash}`);
    if (!meta) return null;

    const { usageKey, resetAt } = usagePeriod(keyHash);
    const raw  = await kv.get(usageKey);
    const used = parseInt(raw ?? '0', 10);
    const limit = meta.monthlyLimit ?? FREE_MONTHLY_LIMIT;

    return {
        email: meta.email, plan: meta.plan, active: meta.active,
        monthlyLimit: limit, used, remaining: Math.max(0, limit - used),
        createdAt: meta.createdAt, lastUsedAt: meta.lastUsedAt ?? null, resetAt
    };
}

function usagePeriod(keyHash) {
    const now   = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return {
        usageKey: `apikey:usage:${keyHash}:${month}`,
        resetAt:  new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
    };
}
