const DEFAULTS = Object.freeze({
  monthlyGlobal: 300,
  monthlyPerKey: 100,
  dailyPerKey: 20,
  requestsPerMinute: 5,
  concurrentPerKey: 2,
  leaseMs: 120000
});
export const API_MODELS = Object.freeze({
  standard: ['openai/gpt-6.1-terra', 'openai/gpt-6-luna', 'openai/gpt-6.1-sol'],
  pro: ['openai/gpt-6.2-sol', 'google/gemini-4-neon', 'google/gemini-4-argon', 'google/gemini-3.8-flash', 'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5']
});
export const ALL_API_MODELS = Object.freeze([...API_MODELS.standard, ...API_MODELS.pro]);
export function resolveModel(value, fallback = 'openai/gpt-6.1-terra') {
  const model = value == null || value === '' ? fallback : String(value);
  if (!ALL_API_MODELS.includes(model)) throw Object.assign(new Error('Unsupported model. Choose one of the documented Standard or Pro model IDs.'), { status: 400 });
  return model;
}
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders } });
}
function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Pollinations-Key');
  return new Response(response.body, { status: response.status, headers });
}
async function hashKey(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function redisEval(script, keys, args = []) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('API usage protection is not configured.');
  const response = await fetch(url.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(['EVAL', script, String(keys.length), ...keys, ...args.map(String)])
  });
  if (!response.ok) throw new Error('API usage protection is temporarily unavailable.');
  const payload = await response.json();
  if (payload.error) throw new Error('API usage protection is temporarily unavailable.');
  return payload.result;
}
function limit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
const RESERVE_SCRIPT = `
local credits = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
local keyMonthLimit = tonumber(ARGV[3])
local keyDayLimit = tonumber(ARGV[4])
local rateLimit = tonumber(ARGV[5])
local concurrentLimit = tonumber(ARGV[6])
local now = tonumber(ARGV[7])
local leaseMs = tonumber(ARGV[8])
local requestId = ARGV[9]
local metaRaw = redis.call('GET', KEYS[6])
if not metaRaw then return {0, 'invalid', 0, 0, 0, 0, 0} end
local meta = cjson.decode(metaRaw)
if meta.active ~= true then return {0, 'inactive', 0, 0, 0, 0, 0} end
local globalUsed = tonumber(redis.call('GET', KEYS[1]) or '0')
local monthUsed = tonumber(redis.call('GET', KEYS[2]) or '0')
local dayUsed = tonumber(redis.call('GET', KEYS[3]) or '0')
local rateUsed = tonumber(redis.call('GET', KEYS[4]) or '0')
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now)
local concurrentUsed = redis.call('ZCARD', KEYS[5])
if globalUsed + credits > globalLimit then return {0, 'global', globalUsed, monthUsed, dayUsed, rateUsed, concurrentUsed} end
if monthUsed + credits > keyMonthLimit then return {0, 'monthly', globalUsed, monthUsed, dayUsed, rateUsed, concurrentUsed} end
if dayUsed + credits > keyDayLimit then return {0, 'daily', globalUsed, monthUsed, dayUsed, rateUsed, concurrentUsed} end
if rateUsed + 1 > rateLimit then return {0, 'rate', globalUsed, monthUsed, dayUsed, rateUsed, concurrentUsed} end
if concurrentUsed + 1 > concurrentLimit then return {0, 'concurrency', globalUsed, monthUsed, dayUsed, rateUsed, concurrentUsed} end
globalUsed = redis.call('INCRBY', KEYS[1], credits)
monthUsed = redis.call('INCRBY', KEYS[2], credits)
dayUsed = redis.call('INCRBY', KEYS[3], credits)
rateUsed = redis.call('INCR', KEYS[4])
redis.call('ZADD', KEYS[5], now + leaseMs, requestId)
redis.call('EXPIRE', KEYS[1], 3456000)
redis.call('EXPIRE', KEYS[2], 3456000)
redis.call('EXPIRE', KEYS[3], 172800)
redis.call('EXPIRE', KEYS[4], 120)
redis.call('EXPIRE', KEYS[5], math.ceil(leaseMs / 1000) + 30)
return {1, 'ok', globalUsed, monthUsed, dayUsed, rateUsed, concurrentUsed + 1}
`;
const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end
return 1
`;
function monthStamp(date) { return date.toISOString().slice(0, 7); }
function dayStamp(date) { return date.toISOString().slice(0, 10); }
export async function authenticate(req, options = {}) {
  const apiKey = (req.headers.get('authorization') || '').replace(/^Bearer\\s+/i, '').trim();
  const pollenKey = (req.headers.get('x-pollinations-key') || '').trim();
  if (!/^mgk_[A-Za-z0-9]{32}$/.test(apiKey)) return { response: cors(json({ error: 'Missing or invalid API access key.' }, 401)) };
  if (!pollenKey || pollenKey.length > 4096 || /[\\r\\n]/.test(pollenKey)) return { response: cors(json({ error: 'Missing or invalid X-Pollinations-Key header.' }, 400)) };
  if (process.env.API_V1_ENABLED === 'false' || process.env.API_V1_KILL_SWITCH === 'true') {
    return { response: cors(json({ error: 'The public API is temporarily disabled.' }, 503)) };
  }
  try {
    const keyHash = await hashKey(apiKey);
    const nowDate = new Date();
    const month = monthStamp(nowDate);
    const day = dayStamp(nowDate);
    const requestId = crypto.randomUUID();
    const credits = Math.max(1, Math.min(10, Number(options.credits) || 1));
    const globalLimit = limit('API_GLOBAL_MONTHLY_CREDITS', DEFAULTS.monthlyGlobal);
    const keyMonthLimit = limit('API_KEY_MONTHLY_CREDITS', DEFAULTS.monthlyPerKey);
    const keyDayLimit = limit('API_KEY_DAILY_CREDITS', DEFAULTS.dailyPerKey);
    const rateLimit = limit('API_KEY_REQUESTS_PER_MINUTE', DEFAULTS.requestsPerMinute);
    const concurrentLimit = limit('API_KEY_MAX_CONCURRENT', DEFAULTS.concurrentPerKey);
    const leaseMs = DEFAULTS.leaseMs;
    const keys = [
      'apiusage:global:month:' + month,
      'apiusage:key:month:' + keyHash + ':' + month,
      'apiusage:key:day:' + keyHash + ':' + day,
      'apiusage:key:rate:' + keyHash + ':' + Math.floor(Date.now() / 60000),
      'apiusage:key:inflight:' + keyHash,
      'apikey:hash:' + keyHash
    ];
    const result = await redisEval(RESERVE_SCRIPT, keys, [
      credits, globalLimit, keyMonthLimit, keyDayLimit, rateLimit, concurrentLimit,
      Date.now(), leaseMs, requestId
    ]);
    const [allowed, reason, globalUsed, monthUsed, dayUsed, rateUsed, concurrentUsed] = result.map((v, i) => i === 1 ? v : Number(v));
    const usage = {
      credits,
      monthly: { used: monthUsed, limit: keyMonthLimit, remaining: Math.max(0, keyMonthLimit - monthUsed) },
      daily: { used: dayUsed, limit: keyDayLimit, remaining: Math.max(0, keyDayLimit - dayUsed) },
      globalMonthly: { used: globalUsed, limit: globalLimit, remaining: Math.max(0, globalLimit - globalUsed) },
      rateLimit: { used: rateUsed, limit: rateLimit, remaining: Math.max(0, rateLimit - rateUsed), windowSeconds: 60 },
      concurrency: { active: concurrentUsed, limit: concurrentLimit }
    };
    if (!allowed) {
      const resetAt = reason === 'daily'
        ? new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() + 1)).toISOString()
        : new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 1)).toISOString();
      const messages = {
        invalid: 'API key not found.',
        inactive: 'API key deactivated.',
        global: 'The public API monthly capacity has been reached. Please try again next month.',
        monthly: 'This API key has reached its monthly credit limit.',
        daily: 'This API key has reached its daily credit limit. Please try again tomorrow.',
        rate: 'API rate limit reached. Retry shortly.',
        concurrency: 'Too many concurrent requests for this API key. Wait for an active request to finish.'
      };
      const retryAfter = Math.max(1, Math.ceil((Date.parse(resetAt) - Date.now()) / 1000));
      const status = reason === 'invalid' || reason === 'inactive' ? 401 : 429;
      return { response: cors(json({ error: messages[reason] || 'API usage limit reached.', code: 'API_' + String(reason).toUpperCase() + '_LIMIT', usage, resetAt }, status, {
        'Retry-After': String(reason === 'rate' || reason === 'concurrency' ? 10 : retryAfter),
        'X-Usage-Monthly-Limit': String(keyMonthLimit),
        'X-Usage-Monthly-Remaining': String(usage.monthly.remaining),
        'X-Usage-Global-Remaining': String(usage.globalMonthly.remaining)
      })) };
    }
    let released = false;
    return {
      pollenKey,
      remaining: Math.max(0, rateLimit - rateUsed),
      usage,
      release: async () => {
        if (released) return;
        released = true;
        try { await redisEval(RELEASE_SCRIPT, [keys[4]], [requestId]); }
        catch (error) { console.error('[api-usage] concurrency lease release failed:', error.message); }
      }
    };
  } catch (error) {
    console.error('[api-usage] reservation failed:', error.message);
    return { response: cors(json({ error: 'API usage protection is temporarily unavailable. Requests are blocked until it recovers.' }, 503)) };
  }
}
export function withUsageRelease(response, auth) {
  if (!auth?.usage) return response;
  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Limit', String(auth.usage.rateLimit.limit));
  headers.set('X-RateLimit-Remaining', String(auth.usage.rateLimit.remaining));
  headers.set('X-RateLimit-Window', '60');
  headers.set('X-Usage-Monthly-Limit', String(auth.usage.monthly.limit));
  headers.set('X-Usage-Monthly-Remaining', String(auth.usage.monthly.remaining));
  headers.set('X-Usage-Daily-Limit', String(auth.usage.daily.limit));
  headers.set('X-Usage-Daily-Remaining', String(auth.usage.daily.remaining));
  headers.set('X-Usage-Global-Remaining', String(auth.usage.globalMonthly.remaining));
  response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  if (!auth.release || !response.body) {
    auth.release?.();
    return response;
  }
  const reader = response.body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await auth.release();
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        await auth.release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } finally { await auth.release(); }
    }
  });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}
export async function callPollinations({ pollenKey, model, prompt, maxTokens = 5000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pollenKey },
      body: JSON.stringify({ model: model || 'midijourney', temperature: 0.65, max_tokens: maxTokens, stream: false,
        messages: [{ role: 'system', content: 'You are an expert MIDI arranger. Return only valid JSON, without markdown.' }, { role: 'user', content: prompt }] })
    });
    if (!response.ok) {
      const status = [401, 402, 403, 429].includes(response.status) ? response.status : 502;
      const messages = { 401: 'Pollinations rejected your key.', 402: 'Insufficient Pollen or budget.', 403: 'Pollinations denied access to the selected model.', 429: 'Pollinations rate limit reached.' };
      throw Object.assign(new Error(messages[status] || 'Pollinations generation failed.'), { status });
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const match = content.replace(/\`\`\`json|\`\`\`/g, '').match(/\\{[\\s\\S]*\\}/);
    if (!match) throw Object.assign(new Error('AI returned no valid JSON.'), { status: 502 });
    return JSON.parse(match[0]);
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('Pollinations request timed out.'), { status: 504 });
    throw error;
  } finally { clearTimeout(timer); }
}
export function fail(error) { return cors(json({ error: error.message || 'Internal server error' }, error.status || 500)); }
export { cors, json };
