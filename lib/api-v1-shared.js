const REQUESTS_PER_MINUTE = 20;
export const API_MODELS = Object.freeze({
  standard: ['openai/gpt-6.1-terra', 'openai/gpt-6-luna', 'openai/gpt-6.1-sol'],
  pro: ['openai/gpt-6.2-sol', 'google/gemini-4-neon', 'google/gemini-4-argon', 'google/gemini-3.8-flash', 'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5']
});
export const ALL_API_MODELS = Object.freeze([...API_MODELS.standard, ...API_MODELS.pro]);
export function resolveModel(value, fallback = 'openai/gpt-6.1-terra') {
  const model = value == null || value === '' ? fallback : String(value);
  if (!ALL_API_MODELS.includes(model)) {
    throw Object.assign(new Error('Unsupported model. Choose one of the documented Standard or Pro model IDs.'), { status: 400 });
  }
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
async function redis(command, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('API key storage is not configured.');
  const encoded = args.map(value => encodeURIComponent(String(value))).join('/');
  const response = await fetch(url.replace(/\/$/, '') + '/' + command + (encoded ? '/' + encoded : ''), {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!response.ok) throw new Error('API key storage is temporarily unavailable.');
  const payload = await response.json();
  if (payload.error) throw new Error('API key storage is temporarily unavailable.');
  return payload.result;
}
export async function authenticate(req) {
  const apiKey = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const pollenKey = (req.headers.get('x-pollinations-key') || '').trim();
  if (!/^mgk_[A-Za-z0-9]{32}$/.test(apiKey)) return { response: cors(json({ error: 'Missing or invalid API access key.' }, 401)) };
  if (!pollenKey || pollenKey.length > 4096 || /[\r\n]/.test(pollenKey)) return { response: cors(json({ error: 'Missing or invalid X-Pollinations-Key header.' }, 400)) };
  try {
    const keyHash = await hashKey(apiKey);
    const raw = await redis('get', 'apikey:hash:' + keyHash);
    const meta = raw ? JSON.parse(raw) : null;
    if (!meta || !meta.active) return { response: cors(json({ error: 'API key not found or deactivated.' }, 401)) };
    const windowId = Math.floor(Date.now() / 60000);
    const rateKey = 'apikey:rate:' + keyHash + ':' + windowId;
    const count = Number(await redis('incr', rateKey));
    if (count === 1) await redis('expire', rateKey, 120);
    if (count > REQUESTS_PER_MINUTE) return { response: cors(json({ error: 'API rate limit reached. Retry shortly.' }, 429, { 'Retry-After': '60' })) };
    return { pollenKey, remaining: REQUESTS_PER_MINUTE - count };
  } catch (error) {
    return { response: cors(json({ error: error.message === 'API key storage is not configured.' ? error.message : 'API authentication service is temporarily unavailable.' }, 503)) };
  }
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
    const match = content.replace(/\`\`\`json|\`\`\`/g, '').match(/\{[\s\S]*\}/);
    if (!match) throw Object.assign(new Error('AI returned no valid JSON.'), { status: 502 });
    return JSON.parse(match[0]);
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('Pollinations request timed out.'), { status: 504 });
    throw error;
  } finally { clearTimeout(timer); }
}
export function fail(error) { return cors(json({ error: error.message || 'Internal server error' }, error.status || 500)); }
export { cors, json };
