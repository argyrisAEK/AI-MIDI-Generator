export const config = { runtime: 'edge' };

// ── PromptBuilder (inlined) ──────────────────────────────────────────────
const trackInstructions = { 
    bassline:       "MIDI:36-52,HARD-CEILING:52,monophonic,roots-and-fifths,dur:0.5-2.0,leave-rests-on-beats-3-4,vel:7-9",
    chord:          "MIDI:48-72,polyphonic(2-4notes),voice-led,comping-NOT-every-beat,rests-when-melody-is-busy,vel:4-7",
    melody:         "MIDI:60-84,monophonic,clear-motifs,call-response,RESTS-ARE-MANDATORY(min-1-beat-per-2-bars),vel:6-9",
    arpeggio:       "MIDI:55-79,16th-or-8th-notes,chord-tones-only,rhythmic-pulsing,vel:4-6",
    lead:           "MIDI:62-88,monophonic,legato,soaring-phrases,syncopated-entries,vel:7-9",
    plucks:         "MIDI:60-84,staccato,dur:0.25-0.5,percussive-off-beats,sparse-not-every-beat,vel:5-8",
    strings:        "MIDI:48-79,polyphonic,sustained-long-dur:2.0-8.0,smooth-voice-leading,background-only,vel:2-5",
    keys:           "MIDI:48-76,rhythmic-comping,syncopated,jazz-voicings,interact-with-melody,vel:4-7",
    guitar:         "MIDI:40-76,strummed-or-picked,organic-rhythm,NOT-every-beat,vel:5-7",
    'pad-textures': "MIDI:45-72,ultra-long-dur:4.0+,static-harmony,NO-fast-notes,background-wash,vel:2-4",
    brass:          "MIDI:42-75,punchy-stabs,syncopated-accents,rests-between-stabs,vel:7-9",
    percs:          "MIDI:60-72,non-tonal,rhythmic-fills,anchor-groove,vel-variation:1-9",
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
                scale = 'major',
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

            // Unchanged tracks με τις νότες τους για harmonic context
            let unchangedContext = 'UNCHANGED:none';
            if (unchangedTracks.length > 0) {
                const unchangedData = unchangedTracks.map(t => {
                    const abbr = trackAbbreviations[t] || t;
                    const notation = originalJson.tracks?.[t] || originalJson.tracks?.[abbr] || '';
                    // Δίνουμε περισσότερες νότες για καλύτερο harmonic context
                    const sample = notation.split('|').slice(0, 8).join('|');
                    return `${abbr}:${sample}`;
                }).join(' ');
                unchangedContext = `UNCHANGED_TRACKS(keep harmony with these):
${unchangedData}`;
            }

            // Clear rules για harmonic consistency
            const rules = [
                `beat unit only, 0 <= beat < ${totalBeats}`,
                `use only notes that fit ${key} ${scale} scale`,
                `match rhythmic feel and density of unchanged tracks`,
                `complement unchanged tracks harmonically — no clashing pitches`,
                `motif repetition with small variation`,
                `include rests, avoid large leaps`,
                `max 2 simultaneous notes per track`,
                `stagger note onsets to avoid all tracks hitting the same beat`,
                `vel integer 1..9, beat/dur may use .5`,
                `musical and loopable`
            ].join("\n- ");

            // ΚΡΙΣΙΜΟ: Χρήση abbreviations στο output (όπως main generation)
            const trackAbbrList = targetTracks
                .map(t => `"${trackAbbreviations[t] || t}"`)
                .join(',');

            // Original data για target tracks — full context
            const trackSamples = targetTracks.map(track => {
                const abbr = trackAbbreviations[track] || track;
                const notation = originalJson.tracks?.[track] || originalJson.tracks?.[abbr] || '';
                return `${abbr}:${notation}`;
            }).join("\n");

            const prompt =
`CFG:key=${key},scale=${scale},bpm=${bpm},style=${genre},time=${timeSignature},bars=${duration},beats=${totalBeats}
TASK:Edit specific tracks of a multitrack MIDI composition. Output must be harmonically and rhythmically compatible with the unchanged tracks.
EDIT:${instructions}
${unchangedContext}
ORIGINAL_TARGET_TRACKS:
${trackSamples}
EDIT_THESE_TRACKS:${trackList}
RULES:
- ${rules}
FORMAT:pitch:beat:dur:vel|pitch:beat:dur:vel
RETURN:ONLY valid JSON
OUT:{"title":"","desc":"≤20w","tracks":{${trackAbbrList}:"pitch:beat:dur:vel|pitch:beat:dur:vel"}}
NO_TEXT_BEFORE_OR_AFTER_JSON`;

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
                content: 'You are an expert music production AI specializing in multitrack MIDI composition. When editing tracks, you MUST preserve harmonic compatibility with the unchanged tracks — same key, scale, and rhythmic feel. Output ONLY valid JSON. No markdown, no explanation, no text before or after the JSON.'
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
