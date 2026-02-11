// Track MIDI ranges
const trackInstructions = {
    bassline:      "MIDI RANGE:31-55",
    chord:         "MIDI RANGE:48-72",
    melody:        "MIDI RANGE:60-84",
    arpeggio:      "MIDI RANGE:48-84",
    lead:          "MIDI RANGE:60-96",
    plucks:        "MIDI RANGE:60-84",
    strings:       "MIDI RANGE:48-84",
    keys:          "MIDI RANGE:48-72",
    guitar:        "MIDI RANGE:40-76",
    'pad-textures':"MIDI RANGE:36-72",
    brass:         "MIDI RANGE:40-80",
    percs:         "MIDI RANGE:36-60"
};

const trackAbbreviations = {
    bassline:      'bass',
    chord:         'chd',
    melody:        'mel',
    arpeggio:      'arp',
    lead:          'lead',
    plucks:        'plk',
    strings:       'str',
    keys:          'key',
    guitar:        'gtr',
    'pad-textures':'pad',
    brass:         'brss',
    percs:         'perc'
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-track musical directives — injected only for selected tracks.
// Written in plain English so the LLM actually follows them.
// ─────────────────────────────────────────────────────────────────────────────
const trackDirectives = {
    bassline: [
        "Play root notes on beat 1 of each bar, add passing notes on beats 2-4.",
        "Vary rhythm every 2 bars: alternate between quarter notes and syncopated eighth patterns.",
        "Add a short fill (2-3 quick notes) approaching the last beat of bars 4, 8, 12.",
        "Slightly vary velocity: root notes vel=7, passing notes vel=5-6.",
    ],
    chord: [
        "Use block chords (3-4 notes struck together) on strong beats.",
        "Vary voicing every 2 bars — don't repeat the exact same chord shape.",
        "Add rhythmic variation: some bars use off-beat stabs, others use sustained pads.",
        "Velocity: accented chords vel=7-8, sustained/background chords vel=4-5.",
    ],
    melody: [
        "Build a motif in bars 1-2, vary it in bars 3-4 (invert, transpose, or extend it).",
        "Use a mix of step movement and occasional leaps (3rds, 4ths).",
        "Add rests — silence is musical. Not every beat needs a note.",
        "Climax note should appear around bar 3 or 7. End phrases on stable scale degrees.",
        "Vary note duration: mix quarter, eighth, and dotted rhythms.",
    ],
    arpeggio: [
        "Use consistent 16th-note or 8th-note arpeggio pulse throughout.",
        "Vary the note order every 2 bars (e.g., up→up-down→down→random).",
        "Include octave jumps occasionally to add width.",
        "Velocity should be even (vel=5-6) with slight accent on beat 1 (vel=7).",
    ],
    lead: [
        "Write a melodic phrase 2-4 bars long, then vary or develop it in the next phrase.",
        "Use vibrato effect via velocity variation on sustained notes (alternate vel 6↔8).",
        "Leave space — don't play on every beat. Rests add tension.",
        "End each phrase on a scale tone that creates expectation or resolution.",
    ],
    plucks: [
        "Short, staccato notes (duration 0.25-0.5 beats). Use syncopated rhythm.",
        "Vary note pattern every 2 bars — avoid exact repetition.",
        "Interact with the bassline: play fills in the gaps between bass notes.",
        "Velocity: vel=6-8 for main notes, vel=4-5 for decorative grace notes.",
    ],
    strings: [
        "Long sustained notes (2-4 beats duration). Move slowly and expressively.",
        "Swell in velocity over the first bar: start vel=3, reach vel=6-7 by bar 2.",
        "Change harmony every 2-4 bars — avoid holding the same notes for 8+ bars.",
        "Can include slow passing notes between chord tones for smooth voice leading.",
    ],
    keys: [
        "Combine short staccato notes and sustained harmonic notes.",
        "Add rhythmic fills in the second half of phrases (bars 3-4, 7-8).",
        "Vary left-hand bass against right-hand melody/harmony patterns.",
        "Velocity contrast: accents vel=7-8, background accompaniment vel=4-5.",
    ],
    guitar: [
        "Mix strummed chords (multiple notes same beat) and single-note riffs.",
        "Add palm-muted-style short notes (duration 0.25) for rhythmic drive.",
        "Vary between chord voicings across bars — don't repeat the same shape.",
        "Velocity: strums vel=6-8, riffs vel=7, muted notes vel=4-5.",
    ],
    'pad-textures': [
        "Very long notes (4-8 beats). Pads are atmospheric background, not foreground.",
        "Layer 3-4 notes as sustained chords. Change chord every 4-8 bars.",
        "Keep velocity low and consistent: vel=3-5. Pads should not dominate.",
        "Slight voice movement allowed: one note can shift by a step while others sustain.",
    ],
    brass: [
        "Short punchy stabs on off-beats (vel=8-9) mixed with occasional sustained notes.",
        "Use call-and-response patterns: a 2-beat phrase followed by 2 beats of rest.",
        "Vary between unison hits and short melodic runs.",
        "Accent the upbeat before bar changes for rhythmic momentum.",
    ],
    percs: [
        "Use MIDI notes 36(kick), 38(snare), 42(hihat-closed), 46(hihat-open), 49(crash).",
        "Standard pattern: kick on 1+3, snare on 2+4, hihat 8ths. Vary every 2 bars.",
        "Add ghost notes (vel=2-3) between main hits for groove.",
        "Drop elements occasionally (e.g., bar 4 = kick only) for dynamic variation.",
    ],
};

export class PromptBuilder {

    constructMultiTrackPrompt(params = {}) {
        try {
            // ── Normalize params ──────────────────────────────────────────────
            const key  = params.key || 'C';
            const bpm  = Math.max(40, Math.min(300, parseInt(params.bpm || params.tempo) || 120));
            const bars = Math.max(1,  Math.min(64,  parseInt(params.duration_bars || params.duration) || 4));

            const style         = params.style || 'house';
            const mood          = params.mood  || 'neutral';
            const timeSignature = params.timeSignature || '4/4';
            const enhancedPrompt = params.enhancedPrompt || '';
            const complexity    = (params.rhythmicComplexity || 'medium').charAt(0).toUpperCase(); // S/M/C

            const trackTypes = Array.isArray(params.trackTypes) ? params.trackTypes : [];

            // ── Validate tracks ───────────────────────────────────────────────
            const validTracks = Object.keys(trackInstructions);
            const tracks = trackTypes.filter(t => validTracks.includes(t));
            if (tracks.length === 0) tracks.push('melody', 'bassline');

            // ── Timing ───────────────────────────────────────────────────────
            const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
            const totalBeats  = beatsPerBar * bars;
            const halfBeats   = totalBeats / 2; // midpoint — useful for variation cue

            // ── Track section: range + directives ────────────────────────────
            const trackSection = tracks.map(t => {
                const abbr       = trackAbbreviations[t];
                const range      = trackInstructions[t];
                const directives = (trackDirectives[t] || []).join(' ');
                return `${abbr}[${range} | ${directives}]`;
            }).join('\n');

            // ── Output format keys ────────────────────────────────────────────
            const trackAbbrList = tracks.map(t => trackAbbreviations[t]).join('","');

            // ── Variation rules (plain English, not cryptic DSL) ─────────────
            const variationRules = [
                `Total beats: ${totalBeats} (bars 1-${Math.ceil(bars/2)} = establish, bars ${Math.ceil(bars/2)+1}-${bars} = develop/vary).`,
                `NEVER repeat the exact same rhythm or note pattern for more than 2 consecutive bars.`,
                `Beat positions start at 0. Notes must stay within [0, ${totalBeats}).`,
                `Velocity integers 1-9 (1=very soft, 5=medium, 9=very loud). Use contrast.`,
                `Durations in beats: 0.25=16th, 0.5=8th, 1=quarter, 2=half, 4=whole.`,
                `Decimals without leading zero: .5 not 0.5, .25 not 0.25.`,
            ].join(' ');

            // ── Final prompt ─────────────────────────────────────────────────
            const prompt =
`CFG: key=${key} bpm=${bpm} style=${style} mood=${mood} time=${timeSignature} bars=${bars} complexity=${complexity}

TRACKS:
${trackSection}

RULES: ${variationRules}

FORMAT: pitch:beat:duration:velocity separated by |
Example: 60:0:.5:7|62:.5:.5:6|64:1:1:8

OUTPUT (valid JSON only, no markdown):
{"title":"...","desc":"max 20 words","tracks":{"${trackAbbrList}":"notes..."}}
${enhancedPrompt ? `\nCONTEXT: ${enhancedPrompt}` : ''}`;

            console.log('[PromptBuilder] Generated prompt for tracks:', tracks.join(', '));
            return prompt;

        } catch (error) {
            console.error('[PromptBuilder] Error:', error);
            return (
`CFG: key=C bpm=120 style=house mood=neutral time=4/4 bars=4 complexity=M
TRACKS:
mel[MIDI RANGE:60-84 | Build a motif in bars 1-2, vary it in bars 3-4.]
bass[MIDI RANGE:31-55 | Root on beat 1, passing notes on beats 2-4.]
RULES: Total beats:16. Never repeat exact pattern >2 bars. Beats start at 0.
FORMAT: pitch:beat:duration:velocity separated by |
OUTPUT: {"title":"","desc":"","tracks":{"mel":"...","bass":"..."}}`
            );
        }
    }

    getTrackInstruction(trackType) {
        return trackInstructions[trackType] || 'default';
    }

    getTrackAbbreviation(trackType) {
        return trackAbbreviations[trackType] || trackType;
    }
}

export { trackAbbreviations };
