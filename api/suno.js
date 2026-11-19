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

    // Slow (reasoning / Pro) models can take longer than an Edge function may stay silent (25s),
    // so answer immediately with a streamed body: whitespace keep-alives, then the JSON result.
    // JSON.parse ignores leading whitespace, so the client still just calls res.json().
    // Because the HTTP status is already sent, upstream errors are returned in the body as { error, message, status }.
    return streamJson(() => generate({ model, userKey, c, o }));
}

async function generate({ model, userKey, c, o }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 110000);

    const call = async (extra) => fetch('https://gen.pollinations.ai/v1/chat/completions', {
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
            max_tokens: 4096,
            stream: false,
            ...extra
        })
    });

    try {
        let response = await call({});
        if (response.status === 400) {
            // Reasoning models can spend the whole token budget thinking: retry once with more room and low effort.
            const errText = await response.text().catch(() => '');
            if (/output_token_limit_exceeded/i.test(errText)) response = await call({ max_tokens: 8000, reasoning_effort: 'low' });
            else return err(`Pollinations error: 400 ${errText.slice(0, 200)}`, 502);
        }

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            if (response.status === 402) return err('Your Pollinations key has no Pollen or budget left for this model.', 402, 'insufficient_pollen');
            if (response.status === 401) return err('Your Pollinations key is no longer valid. Please reconnect.', 401, 'invalid_byop_key');
            return err(`Pollinations error: ${response.status} ${text.slice(0, 200)}`, response.status === 429 ? 429 : 502);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) return err('AI did not return JSON', 502);

        let parsed;
        try { parsed = JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')); }
        catch (e) { return err(`Invalid JSON from AI: ${e.message}`, 502); }

        const result = normalize(parsed, o, c);
        if (!result.style) return err('AI response had no style', 502);
        return result;
    } catch (e) {
        if (e.name === 'AbortError') return err('Request timeout', 504);
        return err(e.message || 'Internal server error', 500);
    } finally {
        clearTimeout(timeoutId);
    }
}

function err(message, status = 500, code) {
    return { error: code || message, message, status };
}

function streamJson(work) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
        async start(ctrl) {
            const keepAlive = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch { /* closed */ } }, 8000);
            try {
                ctrl.enqueue(enc.encode(' '));
                ctrl.enqueue(enc.encode(JSON.stringify(await work())));
            } catch (e) {
                ctrl.enqueue(enc.encode(JSON.stringify(err(e.message || 'Internal server error', 500))));
            } finally {
                clearInterval(keepAlive);
                ctrl.close();
            }
        }
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }
    });
}

// ── prompts ────────────────────────────────────────────────────────────────
function buildSystemPrompt(o) {
    const arrangement = o.length === 'extended'
        ? 'Create an extended full-length DJ mix with a patient intro, several development/build phases, multiple substantial energy sections, breakdowns, a final peak and a long mix-friendly outro. Never return a short sketch or simple loop.'
        : 'Create a complete full-length track with a real beginning, development, contrasting middle sections, a satisfying climax and a resolved ending. Never return a short sketch or simple loop.';
    const structure = o.structure === 'club' ? 'Use club/DJ sections: [Intro], [Build up], [Beat Drop], [Breakdown], [Instrumental Break], [Outro].'
        : o.structure === 'journey' ? 'Use an evolving cinematic journey: [Intro], [Main Theme], [Build up], [Climax], [Breakdown], [Bridge], [Final Climax], [Outro].'
        : o.structure === 'song' ? 'Use a song form: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro].'
        : 'Choose a coherent structure for the genre; do not force every track into the same verse/chorus template.';
    const vocal = o.vocal === 'auto' ? 'Choose vocal delivery that fits the song.' : 'Honor this vocal direction: ' + o.vocal + '.';
    return `You are an expert songwriter, music arranger and prompt engineer for Suno.
Output ONLY one raw JSON object with exactly these keys: title, style, exclude, tags, lyrics.

STYLE RULES
- Lowercase comma-separated descriptors. Order: genre, mood, tempo, key, instruments, production, texture and dynamics.
- Be concrete and sonic. Never include artist, band, producer or song names.
- GENRE ADHERENCE IS A HARD CONSTRAINT: the app genre supplied in the composition brief is the primary genre. Keep it clearly recognizable in the first Style descriptor and throughout the arrangement.
- Do not replace, reinterpret or drift away from the selected genre because of mood, instrumentation, tempo, MIDI track names, sample characteristics or incidental words in the brief.
- Use subgenres only when they belong to the selected genre. Cross-genre fusion is allowed only when the user explicitly requests it, and the selected genre must remain primary.
- Preserve the user's vision and the analyzed MIDI/WAV tempo, key, harmony, instruments and sonic identity.

ARRANGEMENT / DURATION RULES
- ${arrangement}
- Follow the explicit SAMPLE ROLE supplied in the composition brief. Its role-specific instruction takes precedence over generic arrangement assumptions.
- Develop the source motifs, harmony, groove and instrumentation with new transitions, counter-melodies, breakdowns, builds and variations; do not merely replay the source loop.
- Use the supplied sample as the actual intro ONLY when its role is "intro". For every other role, create a separate opening appropriate to the arrangement.
- MIDI bar count and audio duration describe the reference only, NOT the requested final duration.
- ${structure}
- Put Suno section tags on separate lines: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Post-Chorus], [Verse 2], [Bridge], [Instrumental Break], [Build up], [Beat Drop], [Breakdown], [Final Chorus], [Outro]. Add relevant instrument/performance/dynamic tags such as [Synth Solo], [Guitar Solo], [Male Vocal], [Female Vocal], [Whisper], [Choir], [Silence].

LYRICS RULES
${o.mode === 'instrumental'
        ? `- Instrumental only: lyrics must contain ONLY meaningful bracketed section/performance tags, one per line, about 10-18 lines for a full arrangement. No sung words, phonetic vocals or spoken word.
- Show a clear progression of sections and dynamics, not a handful of generic labels.
- Exclude vocals-related terms.`
        : `- Write original, complete, singable lyrics in ${o.language}, fitting the title, mood, description, user request${o.theme ? ' and theme: ' + o.theme : ''}.
- Do not use a short fixed template. For a conventional song, normally include two developed verses (4-8 lines each), a memorable chorus (4-6 lines), a pre-chorus where useful, a bridge and final chorus. For club/electronic music, balance concise vocal hooks with substantial instrumental sections.
- Aim for 2500-4200 characters when the genre supports it; never pad with filler and stay below 4800 characters.
- Put section tags on their own lines. Do not substitute arrangement notes for actual lyrics in vocal sections.
- Put vocal/performance tags immediately above the lyrics they affect. ${vocal}
- Vary imagery, phrasing, line counts and section patterns; create a coherent emotional progression.
- Never reproduce existing lyrics or mention real artists. Match syllable flow to tempo and energy.`}`;
}

function buildUserPrompt(c, o) {
    const L = [];
    L.push('COMPOSITION');
    if (c.title) L.push(`Title: ${c.title}`);
    if (c.description) L.push(`Description: ${c.description}`);
    if (c.userPrompt) L.push(`User's original request: ${c.userPrompt}`);
    if (c.enhancedPrompt) L.push(`Enhanced brief: ${c.enhancedPrompt}`);
    L.push(`Tempo: ${c.bpm} BPM | Key: ${c.key || 'unknown'} | Time signature: ${c.timeSignature} | Supplied reference: ${c.bars} bars (~${c.seconds}s; reference length only) | Energy: ${c.energy}`);
    if (c.genre || c.mood) L.push(`PRIMARY APP GENRE (must remain the main genre): ${c.genre || '-'} | Mood: ${c.mood || '-'}`);
    const roleGuidance = {
        base: 'Treat the sample as the core musical foundation. Preserve its identity, groove and harmonic character, and develop its material across the arrangement. Do not automatically use it as the intro.',
        melody: 'The sample is the lead melody or melodic motif. Preserve its recognizable contour, rhythm and identity; build bass, harmony, counter-melodies and sections around it. Do not replace it with an unrelated topline.',
        intro: 'The user explicitly assigned the supplied sample to the actual opening intro. Use it there, then transition naturally into newly developed sections.',
        drop: 'The supplied sample is intended as the central drop hook. Feature and develop it in the main high-energy drop sections; create a separate intro.',
        chorus: 'The supplied sample is intended as the recurring chorus hook. Make it recognizable in the chorus sections and develop variations around it.',
        verse: 'The supplied sample is intended for the verse sections. Feature it in verses while allowing the chorus and other sections to develop contrast.',
        bridge: 'The supplied sample is intended for the bridge. Reserve its defining material for the bridge and create contrast elsewhere.',
        outro: 'The supplied sample is intended for the outro. Use it to shape the ending, not as the automatic opening.',
        inspiration: 'Use the sample as creative inspiration for mood, texture and broad musical character. Reinterpret freely; do not force a literal copy of its notes or structure.'
    };
    L.push(`SAMPLE ROLE: ${c.sampleRole}. ${roleGuidance[c.sampleRole] || roleGuidance.base}`);
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
    L.push('', `ARRANGEMENT SETTINGS: length=${o.length}; structure=${o.structure}; vocal=${o.vocal}`);
    L.push(`MODE: ${o.mode} | STYLE LIMIT: ${o.limit} characters`);
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
        sampleRole: ['base', 'melody', 'intro', 'drop', 'chorus', 'verse', 'bridge', 'outro', 'inspiration'].includes(c.sampleRole) ? c.sampleRole : 'base',
        bars: num(c.bars, 1, 64, 4), seconds: num(c.seconds, 0, 600, 0), energy: str(c.energy, 12),
        chords: str(c.chords, 120), tracks, audio,
        draftStyle: str(c.localDraft?.style, 1100)
    };
}

function sanitizeOptions(o) {
    return {
        mode: o?.mode === 'lyrics' ? 'lyrics' : 'instrumental',
        limit: Number(o?.limit) === 200 ? 200 : 1000,
        length: o?.length === 'extended' ? 'extended' : 'full',
        structure: ['song', 'club', 'journey'].includes(o?.structure) ? o.structure : 'auto',
        vocal: ['male', 'female', 'duet', 'choir', 'whisper', 'spoken'].includes(o?.vocal) ? o.vocal : 'auto',
        theme: str(o?.lyricsTheme, 300),
        language: str(o?.lyricsLanguage, 40) || 'English'
    };
}

// ── normalising output ─────────────────────────────────────────────────────
function normalize(p, o, c) {
    const fit = (parts, limit) => {
        const out = []; let len = 0;
        for (const x of parts) {
            const add = (out.length ? 2 : 0) + x.length;
            if (len + add > limit) continue;
            out.push(x); len += add;
        }
        return out.join(', ');
    };
    const styleParts = String(p?.style || '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
    const primaryGenre = String(c?.genre || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    if (primaryGenre && !styleParts[0]?.toLowerCase().includes(primaryGenre)) styleParts.unshift(primaryGenre);
    const style = fit(styleParts, o.limit);
    let lyrics = typeof p?.lyrics === 'string' ? p.lyrics.replace(/\r/g, '').trim().slice(0, 5000) : '';
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
