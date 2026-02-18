// generate.js — Vercel Edge Function
// Robust dual-mode: tries SSE streaming from Pollinations,
// falls back to plain JSON if Pollinations ignores stream:true.
// Client always receives a plain text stream either way.
// Prompt is built server-side so prompt engineering logic is never exposed to the client.


// ── PromptBuilder (inlined to avoid Edge Function module restrictions) ──────
// Track-specific instructions (loaded only when that track is selected)
const trackInstructions = {
    bassline: "MIDI RANGE:31-55",
    chord: "MIDI RANGE:48-72",
    melody: "MIDI RANGE:60-84",
    arpeggio: "MIDI RANGE:48-84",
    lead: "MIDI RANGE:60-96",
    plucks: "MIDI RANGE:60-84",
    strings: "MIDI RANGE:48-84",
    keys: "MIDI RANGE:48-72",
    guitar: "MIDI RANGE:40-76",
    'pad-textures': "MIDI RANGE:36-72",
    brass: "MIDI RANGE:40-80",
    percs: "MIDI RANGE:36-60"
};

// Track abbreviations (loaded only when building the output format)
const trackAbbreviations = {
    bassline: 'bass',
    chord: 'chd',
    melody: 'mel',
    arpeggio: 'arp',
    lead: 'lead',
    plucks: 'plk',
    strings: 'str',
    keys: 'keys',
    guitar: 'gtr',
    'pad-textures': 'pad',
    brass: 'brss',
    percs: 'perc'
};

// Role hints: describe the musical function of each track to guide the model
const trackRoles = {
    bassline:      'root-notes,rhythmic-anchor,low-end',
    chord:         'harmonic-support,comping,mid-range',
    melody:        'main-theme,singable,motif-based',
    arpeggio:      'broken-chords,movement,mid-high',
    lead:          'expressive-solo,legato,high-range',
    plucks:        'percussive-attack,short-decay,rhythmic',
    strings:       'pad-like,sustained,harmonic-fill',
    keys:          'harmonic-rhythm,chordal,mid-range',
    guitar:        'rhythmic-strumming,riffs,mid-range',
    'pad-textures':'ambient,sustained,atmosphere',
    brass:         'stabs,accents,power,mid-high',
    percs:         'DRUMS:kick=36,snare=38,hihat=42,openhat=46,clap=39,ride=51,crash=49'
};

// Complexity descriptions so the model understands each level
const complexityDesc = { S: 'simple:few-notes,on-beat', M: 'medium:syncopation,fills', C: 'complex:dense,polyrhythm' };

class PromptBuilder {

    constructMultiTrackPrompt(params = {}) {
        try {
            // -------- Normalization --------
            const key      = params.key || 'C';
            const scale    = params.scale || params.scaleType || 'major';
            const bpm      = Math.max(40, Math.min(300, parseInt(params.bpm || params.tempo) || 120));
            const bars     = Math.max(1,  Math.min(64,  parseInt(params.duration_bars || params.duration) || 4));
            const style    = params.style || 'house';
            const mood     = params.mood  || 'neutral';
            const trackTypes   = Array.isArray(params.trackTypes) ? params.trackTypes : [];
            const timeSignature = params.timeSignature || '4/4';
            const enhancedPrompt = params.enhancedPrompt || '';

            // Complexity: map full word or first char → S/M/C
            const cmpRaw = (params.rhythmicComplexity || 'medium').toLowerCase();
            const cmpKey = cmpRaw.startsWith('s') ? 'S' : cmpRaw.startsWith('c') ? 'C' : 'M';
            const complexity = `${cmpKey}(${complexityDesc[cmpKey]})`;

            // Chord progression — use provided or sensible scale default
            const defaultProgressions = {
                major: 'I-V-vi-IV', minor: 'i-VI-III-VII',
                dorian: 'i-IV-i-IV', mixolydian: 'I-VII-IV-I',
                pentatonic: 'I-IV-I-V', jazz: 'ii7-V7-Imaj7-vi7'
            };
            const chords = (params.chordProgression && params.chordProgression.length > 0)
                ? (Array.isArray(params.chordProgression) ? params.chordProgression.join('-') : params.chordProgression)
                : (defaultProgressions[scale] || defaultProgressions.major);

            // -------- Track validation --------
            const validTracks = Object.keys(trackInstructions);
            const tracks = trackTypes.filter(t => validTracks.includes(t));
            if (tracks.length === 0) tracks.push('melody', 'bassline');

            // -------- Timing --------
            const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
            const totalBeats  = beatsPerBar * bars;

            // -------- Track DSL: abbr(RANGE|role) --------
            const trackList = tracks
                .map(t => `${trackAbbreviations[t]}(${trackInstructions[t]}|${trackRoles[t]})`)
                .join(' ');

            const trackAbbrList = tracks.map(t => trackAbbreviations[t]).join('","');

            // -------- Rules --------
            const rules =
                `TIME:u=beat,bar=${beatsPerBar},start∈[0,${totalBeats})` +
                `|REP:m12>rv34,bass@1-2,!rnd` +
                `|INT:mel→chd=consonant,mel→bass=complementary,all→chords=${chords}` +
                `|HUM:dens<.65,rep<.45,rest≥1/4bar,vel±2`;

            // -------- Concrete format example (1 bar) --------
            const example = `60:0:.5:7|62:.5:.5:6|64:1:1:8|60:2:.5:7`;

            const prompt =
`CFG:key=${key},scale=${scale},bpm=${bpm},style=${style},mood=${mood},time=${timeSignature},bars=${bars},cmp=${complexity},chords=${chords}
RULES:${rules}
TRACKS:${trackList}
FORMAT:pitch:beat:dur:vel|... (vel:1-9=10%-90%, decimals:.5 not 0.5)
EXAMPLE(1bar):${example}
OUT:{"title":"","desc":"≤20w","tracks":{"${trackAbbrList}":"<notes>"}}
${enhancedPrompt ? `CONTEXT:${enhancedPrompt}` : ''}`.trim();

            console.log('[PromptBuilder] Prompt built — tracks:', tracks.join(','), '| key:', key, scale, '| chords:', chords);
            return prompt;

        } catch (error) {
            console.error('PromptBuilder error:', error);
            return (
`CFG:key=C,scale=major,bpm=120,style=house,time=4/4,bars=4,cmp=M(medium),chords=I-V-vi-IV
RULES:TIME:u=beat,bar=4,start∈[0,16)|INT:all→chords=I-V-vi-IV
TRACKS:mel(MIDI RANGE:60-84|main-theme,singable) bass(MIDI RANGE:31-55|root-notes,rhythmic-anchor)
FORMAT:pitch:beat:dur:vel|...
EXAMPLE(1bar):60:0:.5:7|62:.5:.5:6|64:1:1:8|60:2:.5:7
OUT:{"title":"","desc":"","tracks":{"mel":"<notes>","bass":"<notes>"}}`
            );
        }
    }

    getTrackInstruction(trackType) { return trackInstructions[trackType] || 'default'; }
    getTrackAbbreviation(trackType) { return trackAbbreviations[trackType] || trackType; }
}


// ─────────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }; 
export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let promptParams, model;
    try {
        ({ promptParams, model } = await req.json());
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    if (!promptParams || typeof promptParams !== 'object') {
        return jsonError('Invalid promptParams', 400);
    }

    // Build the prompt server-side — logic never leaves the edge function
    let prompt;
    try {
        const builder = new PromptBuilder();
        prompt = builder.constructMultiTrackPrompt(promptParams);
        console.log('[EDGE] Prompt built server-side, length:', prompt.length);
    } catch (err) {
        console.error('[EDGE] PromptBuilder error:', err);
        return jsonError('Failed to build prompt', 500);
    }

    const apiKey = process.env.POLLINATIONS_GEN_KEY || '';

    const payload = {
        messages: [
            {
                role: 'system',
                content: 'You are a creative musical AI, genre-style specialist. Output ONLY valid JSON with musical track data. No markdown, no explanation, no preamble.'
            },
            { role: 'user', content: prompt }
        ],
        model: model || 'openai-large',
        temperature: 0.7,
        max_tokens: 5096,
        seed: -1,
        stream: true
    };

    // Vercel Edge Functions have a hard execution limit (~25s on hobby, ~30s on pro).
    // Without an explicit timeout the fetch can hang until Vercel kills the function,
    // returning an opaque 504 with no useful error message to the client.
    const TIMEOUT_MS = 25_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        console.error('[EDGE] Pollinations request timed out after', TIMEOUT_MS, 'ms');
    }, TIMEOUT_MS);

    try {
        console.log('[EDGE] Calling Pollinations...');

        const pollResponse = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MIDIGenerator/1.0',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(payload)
        }).catch(err => {
            if (err.name === 'AbortError') {
                throw new Error('Request to Pollinations timed out after 25s');
            }
            throw err;
        });

        clearTimeout(timeoutId); // Response received — cancel the abort timer
        console.log('[EDGE] Pollinations status:', pollResponse.status);

        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            console.error('[EDGE] Pollinations error:', errorText);
            return jsonError(`Pollinations ${pollResponse.status}: ${errorText}`, pollResponse.status);
        }

        // ── Detect response type from Content-Type header ──────────────────
        const contentType = pollResponse.headers.get('content-type') || '';
        const isSSE = contentType.includes('text/event-stream');

        console.log('[EDGE] Content-Type:', contentType, '| SSE mode:', isSSE);

        if (isSSE) {
            // ── MODE A: True SSE streaming ─────────────────────────────────
            // Pollinations sends:  data: {"choices":[{"delta":{"content":"..."}}]}\n\n
            // We extract text content and pipe it as plain text to the client.
            console.log('[EDGE] Mode: SSE streaming');

            let buffer = '';

            const { readable, writable } = new TransformStream({
                transform(chunk, controller) {
                    buffer += new TextDecoder().decode(chunk);

                    // Process all complete lines (split on newline, keep last incomplete)
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // last element may be incomplete

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith('data:')) continue;

                        const data = trimmed.slice(5).trim();
                        if (data === '[DONE]') return;

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed?.choices?.[0]?.delta?.content;
                            if (content) {
                                controller.enqueue(new TextEncoder().encode(content));
                            }
                        } catch {
                            // Incomplete JSON frame across chunk boundary — skip
                        }
                    }
                },

                flush(controller) {
                    // Flush any remaining buffer content
                    if (!buffer.trim()) return;
                    const trimmed = buffer.trim();
                    if (trimmed.startsWith('data:')) {
                        const data = trimmed.slice(5).trim();
                        if (data && data !== '[DONE]') {
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed?.choices?.[0]?.delta?.content;
                                if (content) controller.enqueue(new TextEncoder().encode(content));
                            } catch { /* ignore */ }
                        }
                    }
                }
            });

            pollResponse.body.pipeTo(writable).catch(err => {
                console.error('[EDGE] SSE pipe error:', err);
            });

            return streamResponse(readable);

        } else {
            // ── MODE B: Plain JSON (Pollinations ignored stream:true) ──────
            // Read full JSON, extract content, wrap in ReadableStream.
            // Client code is identical — it always reads a stream.
            console.log('[EDGE] Mode: JSON fallback → wrapping as stream');

            const jsonData = await pollResponse.json();

            let content = '';
            if (jsonData?.choices?.[0]?.message?.content) {
                content = jsonData.choices[0].message.content;
            } else if (jsonData?.choices?.[0]?.text) {
                content = jsonData.choices[0].text;
            } else {
                content = JSON.stringify(jsonData);
            }

            if (!content || content.trim().length === 0) {
                return jsonError('Pollinations returned empty content', 500);
            }

            console.log(`[EDGE] Content: ${content.length} chars — wrapping in stream`);

            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(content));
                    controller.close();
                }
            });

            return streamResponse(stream);
        }

    } catch (err) {
        console.error('[EDGE] Fatal error:', err);
        return jsonError(err.message, 500);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function streamResponse(readable) {
    return new Response(readable, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    });
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
