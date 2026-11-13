export const config = { runtime: 'edge' };

// POST /api/suno
// Writes Suno-ready fields (title, style, exclude, tags, lyrics) from a composition summary.
// Pollinations Pay only: every call is paid with the user's own sk_ key. No server key, no free tier.

const MAX_BODY_BYTES = 30_000;
const DEFAULT_MODEL = 'openai/gpt-6-luna';

export default async function handler(req) {
    if (req.method !== 'POST') return jsonError('Method Not Allowed', 405);

    let body;
    try {
        const raw = await req.text();
        if (raw.length > MAX_BODY_BYTES) return jsonError('Payload too large', 413);
        body = JSON.parse(raw);
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    const userKey = typeof body?.userApiKey === 'string' ? body.userApiKey.trim() : '';
    if (!userKey) return jsonError('Connect your Pollinations account to generate', 401);
    if (!userKey.startsWith('sk_') || userKey.length > 400 || /[\r\n]/.test(userKey)) {
        return jsonError('Invalid Pollinations key', 401);
    }

    const model = typeof body.model === 'string' && /^[a-zA-Z0-9][\w./:-]{0,100}$/.test(body.model)
        ? body.model : DEFAULT_MODEL;

    const c = sanitizeComposition(body.composition);
    const o = sanitizeOptions(body.options);
    if (!c) return jsonError('Missing composition', 400);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 40000);

    try {
        const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGenerator/1.0',
                'Authorization': `Bearer ${userKey}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: buildSystemPrompt(o) },
                    { role: 'user', content: buildUserPrompt(c, o) }
                ],
                temperature: 0.8,
                max_tokens: 2400,
                stream: false
            })
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            if (response.status === 402) return jsonError('Your Pollinations key has no Pollen or budget left.', 402, 'insufficient_pollen');
            if (response.status === 401) return jsonError('Your Pollinations key is no longer valid. Please reconnect.', 401, 'invalid_byop_key');
            return jsonError(`Pollinations error: ${response.status} ${text.slice(0, 200)}`, response.status === 429 ? 429 : 502);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) return jsonError('AI did not return JSON', 502);

        let parsed;
        try { parsed = JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')); }
        catch (e) { return jsonError(`Invalid JSON from AI: ${e.message}`, 502); }

        const result = normalize(parsed, o);
        if (!result.style) return jsonError('AI response had no style', 502);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
    } catch (err) {
        if (err.name === 'AbortError') return jsonError('Request timeout', 504);
        return jsonError(err.message || 'Internal server error', 500);
    } finally {
        clearTimeout(timeoutId);
    }
}

// ── prompts ────────────────────────────────────────────────────────────────
function buildSystemPrompt(o) {
    return `You are an expert prompt engineer for Suno (AI music generator).
Output ONLY one raw JSON object, no markdown, no commentary, with exactly these keys:
"title" (string, max 80 chars),
"style" (string, comma-separated descriptors, HARD MAX ${o.limit} characters),
"exclude" (string, comma-separated styles/elements to avoid, max 120 characters),
"tags" (array of 6-10 short lowercase tags),
"lyrics" (string).

STYLE RULES
- Lowercase comma-separated descriptors. Order: genre/subgenre first, mood, tempo as "<n> bpm", key (e.g. "e minor"), then instruments and production details, then texture/space/dynamics.
- Be concrete and sonic (e.g. "pulsing sub bass", "glassy arpeggios"), never vague filler.
- NEVER write artist, band, producer or song names (Suno does not allow them). Translate any such reference in the user's request into sonic descriptors instead.
- Keep the user's creative vision: preserve specific instruments, atmosphere and structure hints from their request and the description.
- The tempo, key and instruments come from real MIDI analysis: do not contradict them.

LYRICS RULES
${o.mode === 'instrumental'
        ? `- The track is INSTRUMENTAL. "lyrics" must contain ONLY bracketed structure/performance tags, one per line, 6-12 lines, e.g. [Intro – soft pulsing sub, glassy arpeggios fade in] [Build-up – rising filter] [Main groove] [Breakdown] [Outro – resolve to the tonic]. No sung words at all.
- "exclude" should contain vocals-related terms.`
        : `- Write ORIGINAL lyrics in ${o.language}, fitting the title, mood, description and the user's request${o.theme ? ` and this theme: "${o.theme}"` : ''}.
- Use Suno meta tags in square brackets: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Outro]. Keep it under 2800 characters.
- Never reproduce existing song lyrics and never mention real artists.
- Match syllable flow to the tempo and energy.`}`;
}

function buildUserPrompt(c, o) {
    const L = [];
    L.push('COMPOSITION');
    if (c.title) L.push(`Title: ${c.title}`);
    if (c.description) L.push(`Description: ${c.description}`);
    if (c.userPrompt) L.push(`User's original request: ${c.userPrompt}`);
    if (c.enhancedPrompt) L.push(`Enhanced brief: ${c.enhancedPrompt}`);
    L.push(`Tempo: ${c.bpm} BPM | Key: ${c.key || 'unknown'} | Time signature: ${c.timeSignature} | Loop: ${c.bars} bars (~${c.seconds}s) | Energy: ${c.energy}`);
    if (c.genre || c.mood) L.push(`App genre: ${c.genre || '-'} | Mood: ${c.mood || '-'}`);
    if (c.chords) L.push(`Detected chord progression (approximate): ${c.chords}`);
    if (c.tracks.length) {
        L.push('', 'TRACKS (from MIDI analysis)');
        for (const t of c.tracks) L.push(`- ${t.type}: ${t.feel}; ${t.notesPerBeat} notes/beat; MIDI range ${t.range}; syncopation ${t.syncopation}`);
    }
    if (c.audio) {
        L.push('', 'RENDERED AUDIO (analysis of the WAV)');
        L.push(`- traits: ${c.audio.traits.join(', ')}; RMS ${c.audio.rmsDb} dB; spectral centroid ~${c.audio.centroidHz} Hz; ${c.audio.seconds}s`);
    }
    if (c.draftStyle) L.push('', `LOCAL DRAFT (improve it, do not just copy): ${c.draftStyle}`);
    L.push('', `MODE: ${o.mode} | STYLE LIMIT: ${o.limit} characters`);
    return L.join('\n');
}

// ── sanitising input ───────────────────────────────────────────────────────
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

function sanitizeComposition(c) {
    if (!c || typeof c !== 'object') return null;
    const tracks = Array.isArray(c.tracks) ? c.tracks.slice(0, 12).map(t => ({
        type: str(t?.type, 30), feel: str(t?.feel, 60),
        notesPerBeat: num(t?.notesPerBeat, 0, 64, 0), range: str(t?.range, 12), syncopation: num(t?.syncopation, 0, 1, 0)
    })) : [];
    const audio = c.audio && typeof c.audio === 'object' ? {
        traits: Array.isArray(c.audio.traits) ? c.audio.traits.slice(0, 8).map(x => str(x, 40)) : [],
        rmsDb: num(c.audio.rmsDb, -120, 6, 0), centroidHz: num(c.audio.centroidHz, 0, 24000, 0), seconds: num(c.audio.seconds, 0, 3600, 0)
    } : null;
    return {
        title: str(c.title, 120), description: str(c.description, 600),
        userPrompt: str(c.userPrompt, 1200), enhancedPrompt: str(c.enhancedPrompt, 900),
        bpm: num(c.bpm, 30, 300, 120), key: str(c.key, 30), timeSignature: str(c.timeSignature, 8) || '4/4',
        genre: str(c.genre, 40), mood: str(c.mood, 40),
        bars: num(c.bars, 1, 64, 4), seconds: num(c.seconds, 0, 600, 0), energy: str(c.energy, 12),
        chords: str(c.chords, 120), tracks, audio,
        draftStyle: str(c.localDraft?.style, 1100)
    };
}

function sanitizeOptions(o) {
    return {
        mode: o?.mode === 'lyrics' ? 'lyrics' : 'instrumental',
        limit: Number(o?.limit) === 200 ? 200 : 1000,
        theme: str(o?.lyricsTheme, 300),
        language: str(o?.lyricsLanguage, 40) || 'English'
    };
}

// ── normalising output ─────────────────────────────────────────────────────
function normalize(p, o) {
    const fit = (parts, limit) => {
        const out = []; let len = 0;
        for (const x of parts) {
            const add = (out.length ? 2 : 0) + x.length;
            if (len + add > limit) continue;
            out.push(x); len += add;
        }
        return out.join(', ');
    };
    const style = fit(String(p?.style || '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean), o.limit);
    let lyrics = typeof p?.lyrics === 'string' ? p.lyrics.replace(/\r/g, '').trim().slice(0, 4500) : '';
    if (o.mode === 'instrumental') {
        lyrics = lyrics.split('\n').filter(l => l.trim().startsWith('[')).join('\n');
    }
    const tags = Array.isArray(p?.tags)
        ? [...new Set(p.tags.map(t => String(t).toLowerCase().trim().slice(0, 30)).filter(Boolean))].slice(0, 12) : [];
    return {
        title: String(p?.title || '').trim().slice(0, 80),
        style,
        exclude: String(p?.exclude || '').trim().slice(0, 120),
        tags,
        lyrics
    };
}

function jsonError(message, status = 500, code) {
    return new Response(JSON.stringify({ error: code || message, message }), {
        status, headers: { 'Content-Type': 'application/json' }
    });
}
