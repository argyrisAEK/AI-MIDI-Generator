import { kv } from '@vercel/kv'; // ή χρησιμοποίησε Upstash Redis

export const config = { runtime: 'edge' };

const DEV_KEY = process.env.POLLINATIONS_GEN_KEY;
const FREE_LIMIT = 5;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { prompt, model, userKey } = await req.json();
    
    // Πάρε IP (Vercel specific headers)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const key = `gen_count:${ip}`;
    
    let apiKeyToUse;
    let isFreeTier = false;
    
    // Αν ο user στείλει δικό του key (BYOP), το χρησιμοποιούμε
    if (userKey && userKey.startsWith('sk_')) {
      apiKeyToUse = userKey;
      console.log('[BYOP] Using user provided key');
    } else {
      // Αλλιώς κοιτάμε το rate limit
      const currentCount = await kv.get(key) || 0;
      
      if (currentCount >= FREE_LIMIT) {
        return new Response(JSON.stringify({ 
          error: 'FREE_LIMIT_REACHED',
          message: 'You have used your 5 free generations. Please connect your Pollinations account.',
          remaining: 0,
          byopRequired: true
        }), { 
          status: 402, // Payment Required (conceptually)
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Έχει ακόμα δωρεάν
      apiKeyToUse = DEV_KEY;
      isFreeTier = true;
      
      // Αύξησε counter (expire σε 24 ώρες)
      await kv.incr(key);
      await kv.expire(key, 86400); // 24 hours
    }

    // Κάλεσε Pollinations με το κατάλληλο key
    const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeyToUse}`,
        'User-Agent': 'MIDIGenerator/1.0'
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'You are a creative musical AI. Output ONLY valid JSON containing musical track data, no markdown, no preamble.'
          },
          { role: 'user', content: prompt }
        ],
        model: model || 'claude',
        temperature: 0.8,
        max_tokens: 6000,
        seed: -1,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.text();
      
      // Αν το BYOP key του χρήστη έχει θέμα (invalid/expired), το πιάνουμε εδώ
      if (userKey && response.status === 401) {
        return new Response(JSON.stringify({
          error: 'INVALID_USER_KEY',
          message: 'Your API key is invalid or expired. Please reconnect your account.'
        }), { status: 401, headers: { 'Content-Type': 'application/json' }});
      }
      
      throw new Error(`Pollinations error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    return new Response(JSON.stringify({ 
      content,
      tier: isFreeTier ? 'free' : 'byop',
      remaining: isFreeTier ? FREE_LIMIT - (await kv.get(key)) : null
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[EDGE] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
