export const config = { runtime: 'edge' };

// ── PromptBuilder (inlined) ──────────────────────────────────────────────
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

// Reverse map για normalization
const reverseAbbrev = Object.fromEntries(
    Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
);

class VariationsPromptBuilder {
    /**
     * Build prompt για track editing - αντίστοιχο του constructMultiTrackPrompt
     */
    buildEditPrompt(params = {}) {
        try {
            const {
                originalJson,
                targetTracks,
                unchangedTracks,
                editType,
                customInstructions,
                intensityChange,
                genre = 'house',
                bpm = 120,
                key = 'C',
                duration = 4,
                timeSignature = '4/4'
            } = params;

            const instructions = this.getEditInstructions(editType, {
                intensityChange,
                customInstructions
            });

            // Υπολογισμός beats
            const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
            const totalBeats = beatsPerBar * duration;

            // Track list με abbreviations (όπως στο main generation)
            const trackList = targetTracks
                .map(t => `${trackAbbreviations[t] || t}(${trackInstructions[t] || 'MIDI RANGE:48-72'})`)
                .join(' ');

            // Unchanged tracks για context
            const unchangedContext = unchangedTracks.length > 0 
                ? `UNCHANGED:${unchangedTracks.map(t => trackAbbreviations[t] || t).join(',')}`
                : 'UNCHANGED:none';

            // Compact format rules (ΙΔΙΑ με generate)
            const rules = 
                `TIME:u=beat,bar=${beatsPerBar},start_in[0,${totalBeats})` +
                `|STR:m1-2~m3-4(var:15%),m5-8=evolve` +
                `|VOX:chord_leap<7st,smooth_lead` +
                `|INT:mel->chd=sync,mel->bass=call-resp` +
                `|GRV:swing=8%,human_timing=2ms` +
                `|HUM:dens<.65,rest>=1/4bar,vel_range[3,8]`;

            // ΚΡΙΣΙΜΟ: Χρήση abbreviations στο output (όπως main generation)
            const trackAbbrList = targetTracks
                .map(t => `"${trackAbbreviations[t] || t}"`)
                .join(',');

            // Sample data από original tracks (compact format)
            const trackSamples = targetTracks.map(track => {
                const notation = originalJson.tracks?.[track] || '';
                const sample = notation.split('|').slice(0, 3).join('|');
                return `${trackAbbreviations[track] || track}:${sample}`;
            }).join(' ');

            const prompt =
`CFG:key=${key},bpm=${bpm},style=${genre},time=${timeSignature},bars=${duration}
EDIT:${instructions}
${unchangedContext}
RULES:${rules}
TRACKS:${trackList}
SAMPLES:${trackSamples}
FORMAT:pitch:beat:dur:vel|pitch:beat:dur:vel... (velocity: 1-9 = 10%-90%)
OUT:{"title":"","desc":"≤20w","tracks":{${trackAbbrList}:"pitch:beat:dur:vel|pitch:beat:dur:vel"}}
HARMONY:Fit with unchanged tracks, respect ${key} scale`;

            console.log('[VariationsPromptBuilder] Generated prompt:', prompt.substring(0, 200));
            return prompt;

        } catch (error) {
            console.error('VariationsPromptBuilder error:', error);
            return this.getFallbackPrompt(params);
        }
    }

    getEditInstructions(editType, params) {
        const { intensityChange, customInstructions } = params;
        const pct = Math.abs(Math.round(intensityChange * 100));

        const instructions = {
            intensity_up: `INTENSITY+${pct}:more_notes,vel[6-9],shorter_dur,energy`,
            intensity_down: `INTENSITY-${pct}:fewer_notes,vel[3-5],longer_dur,relaxed`,
            simplify: `SIMPLIFY:reduce_30pct,essential_only,longer_dur`,
            complexify: `COMPLEXIFY:add_30pct,passing_tones,ornaments,syncopation`,
            change_rhythm: `RHYTHM_CHANGE:same_pitches,new_timing,groove_shift`,
            transpose_up: `TRANSPOSE+12:all_notes+12,check_range_clash`,
            transpose_down: `TRANSPOSE-12:all_notes-12,check_range_clash`,
            custom: `CUSTOM:${customInstructions?.substring(0, 100) || 'modify_as_requested'}`
        };

        return instructions[editType] || instructions.custom;
    }

    getFallbackPrompt(params) {
        const { key = 'C', bpm = 120, targetTracks = ['melody'] } = params;
        const abbr = targetTracks.map(t => trackAbbreviations[t] || t).join('","');
        return `CFG:key=${key},bpm=${bpm},style=house,time=4/4,bars=4
EDIT:INTENSITY+20:more_notes,energy
RULES:TIME:u=beat,bar=4,start_in[0,16)|HUM:dens<.65,vel_range[3,8]
TRACKS:${abbr}
FORMAT:pitch:beat:dur:vel|pitch:beat:dur:vel...
OUT:{"title":"","desc":"","tracks":{${abbr}:"60:0:1:7|64:1:0.5:6"}}`;
    }
}

// ── Main Handler ───────────────────────────────────────────────────────────
export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let editParams, model, userApiKey;
    try {
        const body = await req.json();
        editParams = body.editParams;
        model = body.model;
        userApiKey = body.userApiKey;
    } catch {
        return jsonError('Invalid JSON body', 400);
    }

    if (!editParams || typeof editParams !== 'object') {
        return jsonError('Missing editParams', 400);
    }

    // No rate limiting for variations — user must have already passed generate's rate limit
    const hasByopKey = typeof userApiKey === 'string' && userApiKey.trim().length > 0;
    const remainingGenerations = hasByopKey ? 999 : 999; // not tracked here

    // ── Build Prompt Server-side (ΙΔΙΟ με generate) ─────────────────────────
    let prompt;
    try {
        const builder = new VariationsPromptBuilder();
        prompt = builder.buildEditPrompt(editParams);
        console.log('[VARIATIONS] Prompt built, length:', prompt.length);
    } catch (err) {
        console.error('[VARIATIONS] PromptBuilder error:', err);
        return jsonError('Failed to build edit prompt', 500);
    }

    // ── Resolve API Key (ΙΔΙΟ με generate) ──────────────────────────────────
    const apiKey = hasByopKey
        ? userApiKey.trim()
        : (process.env.POLLINATIONS_GEN_KEY || '');

    // ── Call Pollinations (ΙΔΙΟ με generate) ─────────────────────────────────
    const payload = {
        messages: [
            {
                role: 'system',
                content: 'You are an expert music production AI. Output ONLY valid JSON with track data. No markdown, no explanation.'
            },
            { role: 'user', content: prompt }
        ],
        model: model || 'midijourney',
        temperature: 0.9,
        max_tokens: 5096,
        seed: -1,
        stream: true
    };

    const TIMEOUT_MS = 25_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        console.error('[VARIATIONS] Timeout after', TIMEOUT_MS, 'ms');
    }, TIMEOUT_MS);

    try {
        console.log('[VARIATIONS] Calling Pollinations...');

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

        clearTimeout(timeoutId);
        console.log('[VARIATIONS] Pollinations status:', pollResponse.status);

        if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            console.error('[VARIATIONS] Pollinations error:', errorText);
            return jsonError(`Pollinations ${pollResponse.status}: ${errorText}`, pollResponse.status);
        }

        // ── Handle Response (ΙΔΙΟ με generate) ────────────────────────────────
        const contentType = pollResponse.headers.get('content-type') || '';
        const isSSE = contentType.includes('text/event-stream');

        console.log('[VARIATIONS] Content-Type:', contentType, '| SSE:', isSSE);

        if (isSSE) {
            // Streaming mode
            let buffer = '';

            const { readable, writable } = new TransformStream({
                transform(chunk, controller) {
                    buffer += new TextDecoder().decode(chunk);
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

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
                            // Skip malformed chunks
                        }
                    }
                },

                flush(controller) {
                    if (!buffer.trim()) return;
                    const trimmed = buffer.trim();
                    if (trimmed.startsWith('data:')) {
                        const data = trimmed.slice(5).trim();
                        if (data && data !== '[DONE]') {
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed?.choices?.[0]?.delta?.content;
                                if (content) controller.enqueue(new TextEncoder().encode(content));
                            } catch { }
                        }
                    }
                }
            });

            pollResponse.body.pipeTo(writable).catch(err => {
                console.error('[VARIATIONS] SSE pipe error:', err);
            });

            return streamResponse(readable, remainingGenerations, hasByopKey);

        } else {
            // JSON fallback mode
            console.log('[VARIATIONS] JSON fallback mode');

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

            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(content));
                    controller.close();
                }
            });

            return streamResponse(stream, remainingGenerations, hasByopKey);
        }

    } catch (err) {
        console.error('[VARIATIONS] Fatal error:', err);
        return jsonError(err.message, 500);
    }
}

// ── Helpers (ΙΔΙΑ με generate) ──────────────────────────────────────────────
function streamResponse(readable, remaining, isByop) {
    const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
    };

    if (isByop) {
        headers['X-Remaining-Generations'] = 'BYOP';
    } else if (remaining !== null && remaining !== undefined) {
        headers['X-Remaining-Generations'] = String(remaining);
    }

    return new Response(readable, { status: 200, headers });
}

function jsonError(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
