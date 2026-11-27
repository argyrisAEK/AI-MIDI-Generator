/**
 * midi-import-manager.js
 *
 * Το #import-tab button και το #import-panel div υπάρχουν ήδη στο index.html.
 * Αυτό το module γεμίζει το panel και διαχειρίζεται όλη τη λογική.
 *
 * ΑΡΧΙΤΕΚΤΟΝΙΚΗ — ταυτόσημη με handleGenerate στο main.js:
 *   • Parse:    @tonejs/midi client-side (ήδη dependency)
 *   • Notation: pitch:beat:dur:vel|... (ίδια μορφή με generate.js)
 *   • Generate: generateMultiTrackMIDIFromAPI (ίδια συνάρτηση)
 *   • Merge:    γεμίζει app.generatedTracks track-by-track (ΟΧΙ replace)
 *               ώστε το locked imported track να μην χαθεί
 *   • Visualizer / UI calls: ίδιες με handleGenerate
 */
import { Midi } from '@tonejs/midi';
import { generateMultiTrackMIDIFromAPI } from './midi-generator-api.js';
import { getByopKey } from './byop-session.js';
import { PERCUSSION_REQUEST_PATTERN } from '../lib/percussion-vocabulary.mjs';

// ── Constants (mirrors generate.js) ──────────────────────────────────────────

const AVAILABLE_TRACKS = [
    { value: 'bassline',     label: 'Bassline',  icon: '🎸' },
    { value: 'chord',        label: 'Chords',    icon: '🎹' },
    { value: 'melody',       label: 'Melody',    icon: '🎵' },
    { value: 'arpeggio',     label: 'Arpeggio',  icon: '✨' },
    { value: 'lead',         label: 'Lead',      icon: '🎙️' },
    { value: 'plucks',       label: 'Plucks',    icon: '🪕' },
    { value: 'strings',      label: 'Strings',   icon: '🎻' },
    { value: 'keys',         label: 'Keys',      icon: '🎼' },
    { value: 'pad-textures', label: 'Pad',       icon: '🌊' },
    { value: 'brass',        label: 'Brass',     icon: '🎺' },
    { value: 'percs',        label: 'Drum Kit',  icon: '🥁' },
    { value: 'guitar',       label: 'Guitar',    icon: '🎸' },
];

const VALID_STYLES = [
    'house','techno','trance','trap','hip-hop','rock','pop','funk',
    'reggae','jazz','disco','classical','ambient','drum-and-bass',
    'synthwave','downtempo','progressive-rock','cinematic'
];

const VALID_MOODS = [
    'peaceful','energetic','melancholic','happy','dark',
    'mysterious','dreamy','intense','ethereal','groovy'
];

const VALID_STRUCTURES = ['intro','verse','chorus','bridge','drop'];

const IMPORT_STANDARD_MODELS = [
    'openai/gpt-6.1-terra',
    'openai/gpt-6-luna',
    'openai/gpt-6.1-sol'
];

// Mirrors generate.js trackAbbreviations
const TRACK_ABBR = {
    bassline:'bass', chord:'chd', melody:'mel', arpeggio:'arp',
    lead:'lead', plucks:'plk', strings:'str', keys:'keys',
    guitar:'gtr', 'pad-textures':'pad', brass:'brss', percs:'perc'
};

// ── Key detection (Krumhansl-Schmuckler) ──────────────────────────────────────

const KEY_PROFILES = {
    major: [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],
    minor: [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]
};
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function detectKey(notes) {
    const pitchClass = new Array(12).fill(0);
    notes.forEach(n => { pitchClass[n.midi % 12] += (n.velocity || 0.5); });
    const total = pitchClass.reduce((a, b) => a + b, 1);
    const norm  = pitchClass.map(v => v / total);

    let bestRoot = 0, bestScore = -Infinity, bestMode = 'major';
    for (const [mode, profile] of Object.entries(KEY_PROFILES)) {
        for (let root = 0; root < 12; root++) {
            let score = 0;
            for (let i = 0; i < 12; i++) score += norm[(i + root) % 12] * profile[i];
            if (score > bestScore) { bestScore = score; bestRoot = root; bestMode = mode; }
        }
    }
    return {
        key:   NOTE_NAMES[bestRoot] + (bestMode === 'minor' ? 'm' : ''),
        scale: bestMode
    };
}

/**
 * Classify a MIDI part from musical behavior, not pitch register alone.
 * Track name / GM program / channel are supporting evidence, not the only signal.
 */
export function classifyTrack(notes, metadata = {}, bpm = 120) {
    const valid = (Array.isArray(notes) ? notes : []).filter(n =>
        Number.isFinite(Number(n?.midi)) && Number.isFinite(Number(n?.time)) &&
        Number.isFinite(Number(n?.duration)) && Number(n.duration) > 0
    );
    if (!valid.length) return { type: 'melody', confidence: 0, scores: {}, features: {} };

    const beatSec = 60 / Math.max(40, Math.min(240, Number(bpm) || 120));
    const sorted = valid.slice().sort((a, b) => a.time - b.time);
    const pitches = sorted.map(n => Number(n.midi)).sort((a, b) => a - b);
    const durations = sorted.map(n => Number(n.duration) / beatSec).sort((a, b) => a - b);
    const starts = sorted.map(n => Number(n.time) / beatSec);
    const totalBeats = Math.max(1, (Math.max(...sorted.map(n => n.time + n.duration)) - sorted[0].time) / beatSec);
    const medianOf = a => a.length ? a[Math.floor(a.length / 2)] : 0;
    const q = (a, p) => a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] || 0;
    const medianPitch = medianOf(pitches);
    const meanPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    const pitchRange = pitches[pitches.length - 1] - pitches[0];
    const medianDuration = medianOf(durations);
    const shortRatio = durations.filter(d => d <= 0.35).length / durations.length;
    const longRatio = durations.filter(d => d >= 1.5).length / durations.length;
    const density = valid.length / totalBeats;

    const onsetGroups = [];
    for (const beat of starts) {
        const last = onsetGroups[onsetGroups.length - 1];
        if (last && beat - last.last <= 0.035) {
            last.count++;
            last.last = beat;
        } else onsetGroups.push({ first: beat, last: beat, count: 1 });
    }
    const simultaneousRatio = onsetGroups.reduce((n, g) => n + (g.count > 1 ? g.count : 0), 0) / valid.length;
    const intervals = starts.slice(1).map((v, i) => v - starts[i]).filter(v => v > 0.025);
    const meanInterval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    const intervalCv = intervals.length && meanInterval
        ? Math.sqrt(intervals.reduce((a, b) => a + (b - meanInterval) ** 2, 0) / intervals.length) / meanInterval
        : 1;
    const regularity = Math.max(0, Math.min(1, 1 - intervalCv));

    // Estimate overlap from note-on / note-off events.
    const events = [];
    sorted.forEach(n => {
        events.push({ time: n.time, delta: 1 });
        events.push({ time: n.time + n.duration, delta: -1 });
    });
    events.sort((a, b) => a.time - b.time || a.delta - b.delta);
    let active = 0, overlapEvents = 0;
    for (const event of events) {
        active += event.delta;
        if (active > 1) overlapEvents++;
    }
    const polyphony = Math.max(0, Math.min(1, overlapEvents / Math.max(1, events.length) * 2));
    const uniquePitchRatio = new Set(pitches).size / pitches.length;
    const label = (String(metadata.name || '') + ' ' + String(metadata.instrumentName || '')).toLowerCase();
    const program = Number.isFinite(Number(metadata.program)) ? Number(metadata.program) : -1;
    const channel = Number(metadata.channel);
    const features = { count: valid.length, medianPitch, meanPitch, pitchRange, medianDuration,
        shortRatio, longRatio, density, simultaneousRatio, polyphony, regularity, uniquePitchRatio,
        intervalCv, totalBeats, program, channel };

    const roles = ['bassline','chord','melody','arpeggio','lead','plucks','strings','keys','pad-textures','brass','percs','guitar'];
    const scores = Object.fromEntries(roles.map(role => [role, 0]));
    const add = (role, points) => { scores[role] += points; };

    if (channel === 9 || PERCUSSION_REQUEST_PATTERN.test(label) || /\bbeat\b/i.test(label)) add('percs', 8);
    if (medianPitch <= 48) add('bassline', 2.4);
    if (q(pitches, 0.25) <= 40) add('bassline', 1.1);
    if (pitchRange <= 24 && polyphony < 0.25) add('bassline', 0.5);

    if (density >= 1.35) add('arpeggio', 1.1);
    if (density >= 2.1) add('arpeggio', 0.8);
    if (regularity >= 0.62 && density >= 1) add('arpeggio', 1.1);
    if (medianDuration <= 0.55 && density >= 1) add('arpeggio', 0.6);
    if (pitchRange <= 24 && uniquePitchRatio < 0.7) add('arpeggio', 0.5);
    if (simultaneousRatio >= 0.28 || polyphony >= 0.25) scores.arpeggio -= 2.2;

    if (medianDuration >= 1.5) add('pad-textures', 1.8);
    if (longRatio >= 0.45) add('pad-textures', 1.4);
    if (polyphony >= 0.28) add('pad-textures', 0.8);
    if (density <= 1.2) add('pad-textures', 0.5);

    if (simultaneousRatio >= 0.28) add('chord', 1.8);
    if (polyphony >= 0.2) add('chord', 1);
    if (simultaneousRatio >= 0.5 && medianDuration < 1.5) add('keys', 0.8);
    if (shortRatio >= 0.65) add('plucks', 1.8);
    if (shortRatio >= 0.8 && density < 1.8) add('plucks', 0.7);
    if (polyphony < 0.18 && pitchRange >= 12 && medianPitch >= 58) add('melody', 1.2);
    if (medianPitch >= 70 && pitchRange >= 12 && polyphony < 0.2) add('lead', 1.7);
    if (medianDuration >= 0.45 && medianDuration <= 1.6 && polyphony < 0.2 && pitchRange >= 12) add('lead', 0.5);
    if (polyphony >= 0.12 && medianPitch >= 48 && medianPitch <= 78) add('keys', 0.8);

    // General MIDI program families; only supporting evidence.
    if (program >= 32 && program <= 39) add('bassline', 2.2);
    if (program >= 24 && program <= 31) add('guitar', 2);
    if (program >= 40 && program <= 55) add('strings', 2);
    if (program >= 56 && program <= 63) add('brass', 2.2);
    if (program >= 80 && program <= 87) add('lead', 1.8);
    if (program >= 88 && program <= 95) add('pad-textures', 2);
    if (program >= 0 && program <= 7) add('keys', 1.4);

    const hints = [
        ['bassline', /bass|sub|808/], ['arpeggio', /arp|arpegg/],
        ['pad-textures', /pad|texture|ambient|atmos/], ['chord', /chord/],
        ['plucks', /pluck|mallet|marimba/], ['lead', /lead|solo|synth lead/],
        ['strings', /string|violin|cello|viola/], ['keys', /piano|keyboard|keys|organ|epiano/],
        ['brass', /brass|trumpet|trombone|horn/], ['percs', PERCUSSION_REQUEST_PATTERN],
        ['guitar', /guitar/], ['melody', /melody|melodic/]
    ];
    for (const [role, re] of hints) if (re.test(label)) add(role, 3.2);

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [rankedType, top] = ranked[0];
    const type = top < 1.5 ? 'melody' : rankedType;
    const second = ranked[1]?.[1] || 0;
    const confidence = Math.max(35, Math.min(97, Math.round(42 + top * 3.5 + (top - second) * 4.5)));
    return { type, confidence, scores, features };
}

function trackMetaName(type) {
    return AVAILABLE_TRACKS.find(t => t.value === type)?.label || type;
}

function detectTrackType(notes, metadata = {}, bpm = 120) {
    return classifyTrack(notes, metadata, bpm).type;
}

function estimateBars(notes, bpm) {
    if (!notes.length) return 4;
    const maxTime = Math.max(...notes.map(n => n.time + (n.duration || 0)));
    const beats   = maxTime / (60 / bpm);
    const bars    = Math.ceil(beats / 4);
    // Complementary-track generation supports 4- or 8-bar arrangements only.
    return bars <= 4 ? 4 : 8;
}

// pitch:beat:dur:vel|...  — ίδιο format με generate.js OUTPUT
function notesToPipeNotation(notes, bpm) {
    const spb       = 60 / bpm;
    const firstTime = notes.length ? Math.min(...notes.map(n => n.time)) : 0;
    return notes
        .slice()
        .sort((a, b) => a.time - b.time)
        .map(n => {
            const beat = Math.round(((n.time - firstTime) / spb) * 4) / 4;
            const dur  = Math.max(0.25, Math.round((n.duration / spb) * 4) / 4);
            const vel  = Math.max(1, Math.min(9, Math.round((n.velocity || 0.5) * 9)));
            return `${n.midi}:${beat}:${dur}:${vel}`;
        })
        .join('|');
}

// ── Harmonic analysis ────────────────────────────────────────────────────────
// Μετατρέπει τα notes σε chord symbols ανά bar ώστε το LLM να καταλαβαίνει
// ακριβώς ποια αρμονία πρέπει να ακολουθήσουν τα companion tracks.

const CHORD_TEMPLATES = [
    { name: 'maj',  intervals: [0, 4, 7],       priority: 10 },
    { name: 'min',  intervals: [0, 3, 7],        priority: 10 },
    { name: 'maj7', intervals: [0, 4, 7, 11],    priority: 8  },
    { name: 'min7', intervals: [0, 3, 7, 10],    priority: 8  },
    { name: '7',    intervals: [0, 4, 7, 10],    priority: 7  },
    { name: 'dim',  intervals: [0, 3, 6],        priority: 6  },
    { name: 'sus2', intervals: [0, 2, 7],        priority: 5  },
    { name: 'sus4', intervals: [0, 5, 7],        priority: 5  },
];

function detectChordForPitchClasses(pitchClasses) {
    if (pitchClasses.size === 0) return null;
    if (pitchClasses.size === 1) {
        return NOTE_NAMES[[...pitchClasses][0]];
    }

    let bestChord = null, bestScore = -1;

    for (let root = 0; root < 12; root++) {
        for (const tmpl of CHORD_TEMPLATES) {
            const chordPCs = new Set(tmpl.intervals.map(i => (root + i) % 12));
            // Score: how many chord tones appear in the played notes
            let matches = 0;
            for (const pc of pitchClasses) {
                if (chordPCs.has(pc)) matches++;
            }
            // Penalize for notes outside the chord
            let outsiders = 0;
            for (const pc of pitchClasses) {
                if (!chordPCs.has(pc)) outsiders++;
            }
            const score = matches * tmpl.priority - outsiders * 2;
            if (score > bestScore) {
                bestScore  = score;
                bestChord  = NOTE_NAMES[root] + (tmpl.name === 'maj' ? '' : tmpl.name);
            }
        }
    }
    return bestChord;
}

/**
 * Produces bar-aligned harmony evidence while keeping each instrument separate.
 * The imported part remains the primary anchor; conflicting companion estimates
 * are exposed rather than silently blended into a possibly false chord.
 */
function analyzeHarmonyByBar(importedNotes, references, bpm, bars, beatsPerBar = 4) {
    const secPerBar = (60 / bpm) * beatsPerBar;
    const sources = [
        { label: 'I', notes: importedNotes || [] },
        ...(references || []).map(track => ({ label: TRACK_ABBR[track.type] || track.type, notes: track.notes || [] }))
    ];
    const sourceBars = sources.map(source => {
        const byBar = Array.from({ length: bars }, () => new Set());
        for (const note of source.notes) {
            const midi = Number(note.midi), time = Number(note.time);
            const duration = Math.max(0, Number(note.duration) || 0);
            if (!Number.isFinite(midi) || !Number.isFinite(time)) continue;
            const first = Math.max(0, Math.floor(time / secPerBar));
            const last = Math.min(bars - 1, Math.floor((time + duration - 0.000001) / secPerBar));
            for (let bar = first; bar <= last; bar++) {
                if (time < (bar + 1) * secPerBar && time + duration > bar * secPerBar) byBar[bar].add(midi % 12);
            }
        }
        return { label: source.label, byBar };
    });

    const harmonyMap = [];
    for (let bar = 0; bar < bars; bar++) {
        const evidence = sourceBars.map(source => {
            const pcs = source.byBar[bar];
            const names = [...pcs].sort((a,b) => a-b).map(pc => NOTE_NAMES[pc]);
            return { label: source.label, names, chord: pcs.size >= 3 ? detectChordForPitchClasses(pcs) : null };
        }).filter(item => item.names.length);
        const imported = evidence.find(item => item.label === 'I');
        const companionChords = evidence.filter(item => item.label !== 'I' && item.chord);
        const uniqueCompanionChords = [...new Set(companionChords.map(item => item.chord))];
        let guide = imported?.chord || null;
        if (!guide && uniqueCompanionChords.length === 1) guide = uniqueCompanionChords[0];
        if (!guide && uniqueCompanionChords.length > 1) guide = 'AMBIGUOUS';
        if (!guide && evidence.length) guide = 'NOT ENOUGH NOTES';
        const details = evidence.map(item => item.label + ':' + (item.chord || item.names.join(',')));
        harmonyMap.push('M' + String(bar + 1).padStart(2, '0') + '=' + (guide || '?') +
            (details.length ? '[' + details.join('|') + ']' : ''));
    }
    return { harmonyMap };
}

/**
 * Builds a compact, deterministic reference for companion tracks already in the
 * current composition. Selected tracks are excluded because they are being
 * regenerated; every other existing track remains an immutable reference.
 */
function collectReferenceTracks(trackMap, excludedTypes, bpm, bars, beatsPerBar = 4) {
    const result = [];
    if (!(trackMap instanceof Map)) return result;
    const secPerBeat = 60 / bpm, secPerBar = secPerBeat * beatsPerBar;
    for (const [type, entry] of trackMap.entries()) {
        if (excludedTypes.has(type) || entry?.locked) continue;
        const notes = entry?.midi?.tracks?.flatMap(track => track.notes || []) || [];
        const valid = notes.filter(n =>
            Number.isFinite(Number(n.midi)) && Number.isFinite(Number(n.time)) &&
            Number.isFinite(Number(n.duration)) && Number(n.duration) > 0
        ).sort((a,b) => a.time - b.time);
        if (!valid.length) continue;
        const pitches = valid.map(n => Number(n.midi));
        const pitchClasses = [...new Set(pitches.map(p => p % 12))].sort((a,b) => a-b)
            .map(pc => NOTE_NAMES[pc]).join(',');
        const barSummaries = [];
        for (let bar = 0; bar < bars; bar++) {
            const start = bar * secPerBar, end = start + secPerBar;
            const barNotes = valid.filter(n => Number(n.time) < end &&
                Number(n.time) + Number(n.duration) > start);
            if (!barNotes.length) continue;
            const pcs = [...new Set(barNotes.map(n => Number(n.midi) % 12))].sort((a,b) => a-b)
                .map(pc => NOTE_NAMES[pc]).join(',');
            const samples = [];
            const count = Math.min(2, barNotes.length);
            for (let i = 0; i < count; i++) {
                const note = barNotes[count === 1 ? 0 : Math.round(i * (barNotes.length - 1) / (count - 1))];
                const beat = Math.round((Number(note.time) / secPerBeat) * 4) / 4;
                const dur = Math.max(0.25, Math.round((Number(note.duration) / secPerBeat) * 4) / 4);
                samples.push(Number(note.midi) + '@' + beat + ':' + dur);
            }
            barSummaries.push('b' + (bar + 1) + '[' + pcs + ';' + samples.join(',') + ']');
        }
        result.push({
            type,
            notes: valid.map(n => ({ midi:Number(n.midi), time:Number(n.time), duration:Number(n.duration), velocity:Number(n.velocity)||0.5 })),
            summary: (TRACK_ABBR[type] || type) + '[r' + Math.min(...pitches) + '-' + Math.max(...pitches) +
                ';pc:' + pitchClasses + ';' + barSummaries.join(';') + ']'
        });
    }
    return result;
}

function scalePitchClassNames(key, scale) {
    const match = /^([A-G])([#b]?)/i.exec(String(key || 'C'));
    const roots = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };
    const rootName = (match?.[1] || 'C').toUpperCase() + (match?.[2] || '');
    const root = roots[rootName] ?? 0;
    const intervalsByScale = {
        major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10], aeolian:[0,2,3,5,7,8,10],
        dorian:[0,2,3,5,7,9,10], phrygian:[0,1,3,5,7,8,10], lydian:[0,2,4,6,7,9,11],
        mixolydian:[0,2,4,5,7,9,10], locrian:[0,1,3,5,6,8,10],
        'harmonic-minor':[0,2,3,5,7,8,11], 'melodic-minor':[0,2,3,5,7,9,11],
        pentatonic:[0,2,4,7,9], 'minor-pentatonic':[0,3,5,7,10], blues:[0,3,5,6,7,10]
    };
    const normalizedScale = String(scale || 'minor').toLowerCase().replaceAll('_', '-').replace(/\s+/g, '-');
    const intervals = intervalsByScale[normalizedScale] || intervalsByScale.minor;
    return intervals.map(interval => NOTE_NAMES[(root + interval) % 12]);
}

// ── trackInstructions — mirrors generate.js and variations.js exactly ─────────
const COMPANION_TRACK_INSTRUCTIONS = {
    bassline:       'MIDI:31-52,monophonic,roots-and-fifths,typical-dur:0.5-4.0,sustained-or-rhythmic,vel:7-9',
    chord:          'MIDI:52-72,polyphonic(2-4notes),voice-led,comping,vel:4-7',
    melody:         'MIDI:60-84,monophonic,clear-motifs,call-response,vel:6-9',
    arpeggio:       'MIDI:55-79,16th-or-8th-notes,chord-tones,rhythmic-pulsing,vel:4-6',
    lead:           'MIDI:62-88,monophonic,legato,soaring-phrases,vel:7-9',
    plucks:         'MIDI:60-84,staccato,typical-dur:0.25-0.5,percussive,vel:5-8',
    strings:        'MIDI:48-79,polyphonic,sustained,smooth-voice-leading,vel:2-5',
    keys:           'MIDI:52-76,rhythmic-comping,syncopated,vel:4-7',
    guitar:         'MIDI:52-76,polyphonic(2-3notes),strummed-or-picked,organic-rhythm,vel:5-8',
    'pad-textures': 'MIDI:50-72,long-notes,harmonic-wash,vel:2-4',
    brass:          'MIDI:42-75,punchy-stabs,syncopated-accents,vel:7-9',
    percs:          'GM-DRUM-KEYS:35-81,non-tonal,GM-voice-accurate,rhythmic-patterns,vel:1-9',
};

const GENRE_BEHAVIOR_HINTS = {
    house:      'Bass plays steady quarters. Chords hit offbeats. Melody: 4-8 notes/bar with space. Pads hold long.',
    techno:     'Bass drives 8th notes. Pads sustain. Percs fill 16ths. Lead phrases with gaps between.',
    trance:     'Arpeggio runs 16ths. Bass on beats 1 and 3. Melody soars in long phrases. Pads swell.',
    'hip-hop':  'Bass syncopates and rests. Keys comp sparsely. Melody phrases loosely.',
    jazz:       'All tracks swing 8ths. Frequent rests. Instruments converse — one moves while others hold.',
    cinematic:  'Strings and pads sustain for bars. Bass uses whole or half notes. Melody enters sparingly.',
    ambient:    'Pads hold 4+ bars. All tracks play slowly and sparsely. Silence is structural.',
    rock:       'Guitar anchors rhythmic 8ths. Bass locks to kick. Melody punches on strong beats.',
    synthwave:  'Bass and lead trade phrases. Arpeggios run 8th or 16th. Pads stay wide and held.',
    disco:      'Bass walks and grooves. Guitar comps on offbeats. Brass stabs on 2 and 4.',
    default:    'Balance density. Each track occupies a distinct register and rhythm.',
};

/**
 * Builds the enhancedPrompt injected as INTENT in generate.js PromptBuilder.
 * Same structure as variations.js: UNCHANGED_TRACKS + trackInstructions + rules.
 */
function buildEnhancedPrompt({ trackType, key, scale, bpm, bars, style, timeSignature = '4/4',
                                harmonyMap, pitchClassNames, companionTypes,
                                importedNotation, existingTracksContext }) {
    const meter = /^(\d{1,2})\/(2|4|8|16)$/.exec(String(timeSignature));
    const beatsPerBar = meter ? Number(meter[1]) * 4 / Number(meter[2]) : 4;
    const totalBeats  = beatsPerBar * bars;
    const barMapText = (harmonyMap || []).join('\n');
    const pcList      = pitchClassNames.join(', ');
    const behavior    = GENRE_BEHAVIOR_HINTS[style] || GENRE_BEHAVIOR_HINTS.default;

    // UNCHANGED_TRACKS — mirrors variations.js: first 12 notes as harmonic context
    const notationSample = importedNotation
        ? importedNotation.split('|').slice(0, 12).join('|')
        : '';
    const importedAbbr = TRACK_ABBR[trackType] || trackType;
    const unchangedBlock = notationSample
        ? ('UNCHANGED_TRACKS(keep harmony with these):\n' + importedAbbr + ':' + notationSample)
        : ('UNCHANGED_TRACKS: imported ' + trackType + ' in ' + key + ' ' + scale);

    // Per-companion track instructions — mirrors generate.js TRACKS line
    const companionTrackList = companionTypes
        .map(function(t) {
            const abbr  = TRACK_ABBR[t] || t;
            const instr = COMPANION_TRACK_INSTRUCTIONS[t] || 'MIDI:48-84,vel:4-8';
            return abbr + '(' + instr + ')';
        })
        .join(' ');

    const referenceBlock = existingTracksContext
        ? 'EXISTING_COMPANION_REFERENCES (preserve their notes; do not regenerate):\n' + existingTracksContext
        : '';
    const ruleLines = [
        'prefer diatonic pitch classes from: ' + pcList + '; use chromatic notes only as intentional passing or approach tones',
        'follow the bar-by-bar harmony map exactly by measure; do not shift, rotate, or reinterpret its bar positions',
        'chord labels are heuristic estimates; treat the listed pitch classes as direct note evidence',
        'when a bar is marked AMBIGUOUS or NOT ENOUGH NOTES, use the listed source notes and diatonic scale conservatively; do not invent a confident chord',
        'treat the imported part as the primary harmonic anchor; use companion references to refine, not override, it',
        'beat and dur are multiples of 0.25, beat range 0 to ' + totalBeats,
        'treat every unchanged reference track as musically fixed; do not copy its complete rhythm or melody',
        'make new tracks harmonize with ALL references, not only the imported part',
        'use chord tones on strong beats, passing tones on weak beats, and smooth voice-leading between bars',
        'keep complementary registers and rhythmic roles; avoid competing lead lines or unnecessary octave doubling',
        'stagger note onsets where appropriate while preserving the groove',
        'motif repetition with small variation',
        'final 0.25 beats must be empty for seamless looping',
    ];
    const rules = '- ' + ruleLines.join('\n- ');

    return (
        'IMPORT_CONTEXT: Imported ' + trackType + ' (' + key + ' ' + scale + ', ' + bpm + ' BPM, ' + bars + ' bars) is locked — DO NOT regenerate it.\n' +
        unchangedBlock + '\n' +
        (referenceBlock ? referenceBlock + '\n' : '') +
        'BAR_BY_BAR_HARMONY_MAP:\n' + (barMapText || '(unavailable)') + '\n' +
        'DIATONIC_PITCH_CLASSES: ' + pcList + '\n' +
        'GENERATE_ONLY: ' + companionTrackList + '\n' +
        'BEHAVIOR(' + style + '): ' + behavior + '\n' +
        'RULES:\n' + rules
    );
}
// ── MidiImportManager ─────────────────────────────────────────────────────────

export class MidiImportManager {
    constructor(app) {
        this.app = app;

        this.importedNotation  = null;
        this.importedTrackType = null;
        this.importedKey       = null;
        this.importedScale     = null;
        this.importedBpm       = null;
        this.importedTimeSignature = '4/4';
        this.importedBars      = null;
        this.importedNoteCount = 0;
        this.importedTrackConfidence = 0;
        this._primaryNotes = [];
        this._trackClassifications = [];
        // The actual Midi object kept in memory so it survives resets
        this._importedMidiObj  = null;

        this.selectedCompanions = [];
    }

    // ── Public API ────────────────────────────────────────────────────────────

    mount() {
        this._injectStyles();
        this._buildPanelContent();   // γεμίζει το #import-panel που υπάρχει στο index.html
        this._bindPanelEvents();
        this._bindGlobalDrop();
    }

    reset() {
        this.importedNotation  = null;
        this.importedTrackType = null;
        this.importedKey       = null;
        this.importedScale     = null;
        this.importedBpm       = null;
        this.importedTimeSignature = '4/4';
        this.importedBars      = null;
        this.importedNoteCount = 0;
        this.importedTrackConfidence = 0;
        this._primaryNotes = [];
        this._trackClassifications = [];
        this._importedMidiObj  = null;
        this.selectedCompanions = [];

        document.querySelectorAll('.companion-btn').forEach(btn => {
            btn.classList.remove('selected', 'disabled-imported');
            btn.disabled = false;
        });
        ['imp-info', 'imp-overrides', 'imp-companions', 'imp-model-wrap', 'imp-gen-wrap', 'imp-status']
            .forEach(id => this._show(id, false));
    }

    // ── Build panel HTML ──────────────────────────────────────────────────────

    _buildPanelContent() {
        const panel = document.getElementById('import-panel');
        if (!panel) {
            console.warn('[MidiImport] #import-panel not found in DOM');
            return;
        }

        const styleOpts = VALID_STYLES
            .map(s => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')}</option>`)
            .join('');

        const moodOpts = VALID_MOODS
            .map(m => `<option value="${m}">${m.charAt(0).toUpperCase() + m.slice(1)}</option>`)
            .join('');

        const structureOpts = VALID_STRUCTURES
            .map(s => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
            .join('');

        const companionBtns = AVAILABLE_TRACKS
            .map(t => `
                <button class="companion-btn" data-value="${t.value}" title="${t.label}">
                    <span class="companion-btn-icon">${t.icon}</span>
                    <span class="companion-btn-label">${t.label}</span>
                </button>`).join('');

        panel.innerHTML = `
<div class="imp-wrap">

    <div style="display:flex; justify-content:flex-end; margin: 0 0 12px;">
        <div class="tooltip-wrapper">
            <button type="button" id="reset-import-midi" class="btn btn-ghost-destructive" aria-label="Start Over from Import MIDI">Start Over</button>
            <span class="tooltip-text">Clears the current composition and resets all settings</span>
        </div>
    </div>

    <!-- Drop zone -->
    <div id="imp-drop" class="imp-drop" tabindex="0" role="button"
         aria-label="Drop a MIDI file here or click to browse">
        <div class="imp-drop-icon">🎹</div>
        <p class="imp-drop-title">Drop a <strong>.mid</strong> file here</p>
        <p class="imp-drop-sub">or <span class="imp-browse">click to browse</span></p>
        <input type="file" id="imp-file" accept=".mid,.midi" hidden>
    </div>

    <!-- Status bar -->
    <div id="imp-status" class="imp-status" hidden></div>

    <!-- Detected track info -->
    <div id="imp-info" class="imp-info" hidden>
        <div class="imp-badge">
            <span id="imp-icon">🎵</span>
            <span id="imp-name">Track</span>
            <span class="imp-locked-badge">🔒 locked</span>
        </div>
        <label class="imp-role-label">Detected role
            <select id="imp-track-role">${AVAILABLE_TRACKS.map(t => '<option value="' + t.value + '">' + t.label + '</option>').join('')}</select>
        </label>
        <p id="imp-role-confidence" class="imp-role-confidence"></p>
        <p id="imp-meta" class="imp-meta"></p>
    </div>

    <!-- Style / BPM / Bars overrides -->
    <div id="imp-overrides" class="imp-overrides" hidden>
        <label class="imp-override-label">Style
            <select id="imp-style">${styleOpts}</select>
        </label>
        <label class="imp-override-label">BPM
            <input id="imp-bpm" type="number" min="40" max="220" step="1" value="120">
        </label>
        <label class="imp-override-label">Bars
            <select id="imp-bars">
                <option value="4">4 bars</option>
                <option value="8" selected>8 bars</option>
            </select>
        </label>
        <label class="imp-override-label">Mood
            <select id="imp-mood">${moodOpts}</select>
        </label>
        <label class="imp-override-label">Structure
            <select id="imp-structure">${structureOpts}</select>
        </label>
    </div>

    <!-- Companion instrument selector -->
    <div id="imp-companions" class="imp-companions" hidden>
        <p class="imp-companions-title">
            Add companion tracks
            <span class="imp-companions-hint">(select 1–4)</span>
        </p>
        <div class="imp-grid">${companionBtns}</div>
    </div>

    <!-- AI model selection -->
    <div id="imp-model-wrap" class="imp-model-wrap" hidden>
        <label class="imp-override-label" for="imp-model-select">AI model
            <select id="imp-model-select" aria-label="Choose Standard AI model for Import MIDI">
                <option value="openai/gpt-6.1-terra">openai/gpt-6.1-terra</option>
                <option value="openai/gpt-6-luna">openai/gpt-6-luna</option>
                <option value="openai/gpt-6.1-sol">openai/gpt-6.1-sol</option>
            </select>
        </label>
        <p class="imp-gen-hint">Uses the same Standard model preference as Edit Tracks.</p>
    </div>

    <!-- Generate -->
    <div id="imp-gen-wrap" class="imp-gen-wrap" hidden>
        <button id="imp-gen-btn" class="imp-gen-btn" data-requires-byop disabled>
            ✦ Generate Companion Tracks
        </button>
        <p class="imp-gen-hint">
            The imported track stays <strong>untouched</strong>.<br>
            New AI tracks will be generated to fit it.
        </p>
    </div>

</div>`;
    }

    // ── Event binding ─────────────────────────────────────────────────────────

    _bindPanelEvents() {
        const drop   = document.getElementById('imp-drop');
        const input  = document.getElementById('imp-file');
        const browse = document.querySelector('#import-panel .imp-browse');
        if (!drop || !input) return;

        document.getElementById('reset-import-midi')
            ?.addEventListener('click', () => this.app.handleReset());

        drop.addEventListener('click',   () => input.click());
        drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
        browse?.addEventListener('click', e => { e.stopPropagation(); input.click(); });

        input.addEventListener('change', e => {
            const f = e.target.files?.[0];
            if (f) this._handleFile(f);
            input.value = '';
        });

        drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag-over'); });
        drop.addEventListener('dragleave', ()  => drop.classList.remove('drag-over'));
        drop.addEventListener('drop', e => {
            e.preventDefault();
            drop.classList.remove('drag-over');
            const f = e.dataTransfer?.files?.[0];
            if (f) this._handleFile(f);
        });

        // Companion toggle (event delegation on grid)
        document.querySelector('#import-panel .imp-grid')
            ?.addEventListener('click', e => {
                const btn = e.target.closest('.companion-btn');
                if (!btn || btn.disabled) return;
                btn.classList.toggle('selected');
                this._syncCompanions();
            });

        const modelSelect = document.getElementById('imp-model-select');
        if (modelSelect) {
            const savedModel = localStorage.getItem('edit_tracks_model_selection');
            modelSelect.value = IMPORT_STANDARD_MODELS.includes(savedModel) ? savedModel : IMPORT_STANDARD_MODELS[0];
            modelSelect.addEventListener('change', () => {
                if (!IMPORT_STANDARD_MODELS.includes(modelSelect.value)) return;
                localStorage.setItem('edit_tracks_model_selection', modelSelect.value);
                const editTracksSelect = document.getElementById('edit-tracks-model-select');
                if (editTracksSelect) editTracksSelect.value = modelSelect.value;
            });
        }

        document.getElementById('imp-gen-btn')
            ?.addEventListener('click', () => this._generate());
        document.getElementById('imp-track-role')
            ?.addEventListener('change', e => this._setImportedTrackType(e.target.value));
    }

    _getSelectedImportModel() {
        const selected = document.getElementById('imp-model-select')?.value;
        const saved = localStorage.getItem('edit_tracks_model_selection');
        return IMPORT_STANDARD_MODELS.includes(selected)
            ? selected
            : IMPORT_STANDARD_MODELS.includes(saved) ? saved : IMPORT_STANDARD_MODELS[0];
    }

    _bindGlobalDrop() {
        document.addEventListener('dragover', e => { if (this._isActive()) e.preventDefault(); });
        document.addEventListener('drop', e => {
            if (!this._isActive()) return;
            const f = e.dataTransfer?.files?.[0];
            if (f?.name.match(/\.(mid|midi)$/i)) {
                e.preventDefault();
                this._handleFile(f);
            }
        });
    }

    // ── File handling ─────────────────────────────────────────────────────────

    async _handleFile(file) {
        if (!file.name.match(/\.(mid|midi)$/i)) {
            this._status('error', '⚠️ Please select a valid .mid / .midi file.');
            return;
        }

        const dropZone = document.getElementById('imp-drop');
        if (dropZone?.classList.contains('is-loading')) return;
        dropZone?.classList.add('is-loading');
        dropZone?.setAttribute('aria-busy', 'true');
        this._status('loading', `⏳ Analyzing MIDI and detecting tracks: <strong>${file.name}</strong>…`);

        try {
            // Χρησιμοποιούμε @tonejs/midi — ίδια βιβλιοθήκη με το υπόλοιπο app
            const buffer = await file.arrayBuffer();
            const midi   = new Midi(buffer);

            if (!midi.tracks?.length) throw new Error('No tracks found in MIDI file.');
            const allNotes = midi.tracks.flatMap(t => t.notes);
            if (!allNotes.length) throw new Error('No notes found in MIDI file.');

            // BPM από MIDI header
            const detectedBpm = Math.round(midi.header?.tempos?.[0]?.bpm || 120);

            // Classify every non-empty MIDI track using musical behavior and optional GM/name metadata.
            const trackClassifications = midi.tracks
                .map((track, index) => {
                    const notes = track.notes || [];
                    const result = classifyTrack(notes, {
                        name: track.name,
                        instrumentName: track.instrument?.name,
                        program: track.instrument?.number,
                        channel: track.channel
                    }, detectedBpm);
                    return { track, index, notes, ...result };
                })
                .filter(item => item.notes.length)
                .sort((a, b) => {
                    const rank = item => Math.log2(item.notes.length + 1) *
                        (0.7 + item.confidence / 100) * (item.type === 'percs' ? 0.45 : 1);
                    return rank(b) - rank(a);
                });
            if (!trackClassifications.length) throw new Error('No playable notes found in MIDI tracks.');
            const primaryInfo = trackClassifications[0];
            const primaryTrack = primaryInfo.track;
            const primaryNotes = primaryInfo.notes;

            // Musical analysis
            const { key, scale } = detectKey(allNotes);
            const trackType = primaryInfo.type;
            const bars = estimateBars(primaryNotes, detectedBpm);

            // Keep the selected part as a single-track MIDI object. The visualizer reads
            // tracks[0] for each app track entry, so storing the original multitrack file
            // here would silently hide every imported part after the first one.
            const importedMidi = new Midi();
            importedMidi.header.setTempo(detectedBpm);
            (midi.header?.timeSignatures || []).forEach(signature => {
                importedMidi.header.timeSignatures.push({
                    ticks: signature.ticks,
                    timeSignature: [...signature.timeSignature]
                });
            });
            const importedTrack = importedMidi.addTrack();
            importedTrack.name = primaryTrack.name || trackMetaName(trackType);
            importedTrack.channel = Number.isInteger(primaryTrack.channel) ? primaryTrack.channel : 0;
            if (Number.isFinite(Number(primaryTrack.instrument?.number))) {
                importedTrack.instrument.number = Number(primaryTrack.instrument.number);
            }
            primaryNotes.forEach(note => importedTrack.addNote({
                midi: note.midi, time: note.time, duration: note.duration, velocity: note.velocity ?? 0.8
            }));

            // Pipe notation — same format as generate.js output
            const notation = notesToPipeNotation(primaryNotes, detectedBpm);

            // Save state
            this.importedNotation  = notation;
            this.importedTrackType = trackType;
            this.importedKey       = key;
            this.importedScale     = scale;
            this.importedBpm       = detectedBpm;
            const sourceMeter = midi.header?.timeSignatures?.[0]?.timeSignature;
            const detectedMeter = Array.isArray(sourceMeter) ? `${sourceMeter[0]}/${sourceMeter[1]}` : '4/4';
            const supportedMeters = new Set(['4/4', '3/4', '6/8', '5/4', '7/8']);
            this.importedTimeSignature = supportedMeters.has(detectedMeter) ? detectedMeter : '4/4';
            const meterSelect = document.getElementById('time-signature');
            if (meterSelect && [...meterSelect.options].some(option => option.value === this.importedTimeSignature)) {
                meterSelect.value = this.importedTimeSignature;
            }
            this.importedBars      = bars;
            this.importedNoteCount = primaryNotes.length;
            this.importedTrackConfidence = primaryInfo.confidence;
            this._primaryNotes = primaryNotes;
            this._trackClassifications = trackClassifications;
            this._importedMidiObj  = importedMidi;

            // Pre-fill overrides
            const bpmEl  = document.getElementById('imp-bpm');
            const barsEl = document.getElementById('imp-bars');
            if (bpmEl)  bpmEl.value  = detectedBpm;
            if (barsEl) barsEl.value = bars;

            // Show the primary detected part, confidence, and a compact multitrack overview.
            const trackMeta = AVAILABLE_TRACKS.find(t => t.value === trackType) || { label: trackType, icon: '🎵' };
            document.getElementById('imp-icon').textContent = trackMeta.icon;
            document.getElementById('imp-name').textContent = trackMeta.label + ' (imported)';
            const roleSelect = document.getElementById('imp-track-role');
            if (roleSelect) roleSelect.value = trackType;
            const confidenceLabel = primaryInfo.confidence >= 78 ? 'High' : primaryInfo.confidence >= 58 ? 'Medium' : 'Low — please verify';
            document.getElementById('imp-role-confidence').textContent =
                'Heuristic confidence: ' + primaryInfo.confidence + '% (' + confidenceLabel + ')';
            const roleSummary = trackClassifications.slice(0, 5).map(item => {
                const meta = AVAILABLE_TRACKS.find(t => t.value === item.type);
                const trackName = item.track.name || item.track.instrument?.name || ('Track ' + (item.index + 1));
                return trackName + ': ' + (meta?.label || item.type) + ' (' + item.confidence + '%)';
            }).join(' · ');
            document.getElementById('imp-meta').textContent =
                'Key: ' + key + '  ·  BPM: ' + detectedBpm + '  ·  Bars: ' + bars +
                '  ·  Notes: ' + primaryNotes.length + '  ·  MIDI tracks: ' + trackClassifications.length +
                '  ·  ' + roleSummary;

            // Φόρτωση στο visualizer ως locked track
            this._loadLockedTrack(trackType, importedMidi, detectedBpm);

            // Απενεργοποίηση ίδιου track type στον companion selector
            document.querySelectorAll('.companion-btn').forEach(btn => {
                const isImported = btn.dataset.value === trackType;
                btn.disabled = isImported;
                btn.classList.toggle('disabled-imported', isImported);
                if (isImported) btn.classList.remove('selected');
            });

            this._show('imp-info',       true);
            this._show('imp-overrides',  true);
            this._show('imp-companions', true);
            this._show('imp-model-wrap', true);
            this._show('imp-gen-wrap',   true);
            this._status('success',
                `✅ <strong>${file.name}</strong> loaded — ${primaryNotes.length} notes · key ${key}`);
            this._syncCompanions();

        } catch (err) {
            console.error('[MidiImport]', err);
            this._status('error', `❌ ${err.message}`);
        } finally {
            dropZone?.classList.remove('is-loading');
            dropZone?.removeAttribute('aria-busy');
        }
    }

    _setImportedTrackType(type) {
        if (!AVAILABLE_TRACKS.some(t => t.value === type) || !this._importedMidiObj) return;
        const previous = this.importedTrackType;
        if (previous === type) return;
        const previousEntry = this.app.generatedTracks.get(previous);
        if (previousEntry?.locked && previousEntry.midi === this._importedMidiObj) {
            this.app.generatedTracks.delete(previous);
        }
        this.importedTrackType = type;
        this.importedNotation = notesToPipeNotation(this._primaryNotes, this.importedBpm || 120);
        const meta = AVAILABLE_TRACKS.find(t => t.value === type) || { label: type, icon: '🎵' };
        document.getElementById('imp-icon').textContent = meta.icon;
        document.getElementById('imp-name').textContent = meta.label + ' (imported)';
        this._loadLockedTrack(type, this._importedMidiObj, this.importedBpm);
        document.querySelectorAll('.companion-btn').forEach(btn => {
            const isImported = btn.dataset.value === type;
            btn.disabled = isImported;
            btn.classList.toggle('disabled-imported', isImported);
            if (isImported) btn.classList.remove('selected');
        });
        this._syncCompanions();
    }

    // ── Load locked track into app ────────────────────────────────────────────
    // ΣΗΜΑΝΤΙΚΟ: δεν αντικαθιστούμε ολόκληρο το Map —
    // μόνο set() το συγκεκριμένο entry ώστε να επιβιώσει μετά το generation

    _loadLockedTrack(trackType, midiObj, bpm) {
        try {
            this.app.generatedTracks.set(trackType, {
                midi:        midiObj,
                title:       AVAILABLE_TRACKS.find(t => t.value === trackType)?.label || trackType,
                description: 'Imported from MIDI file',
                locked:      true
            });

            // Sync BPM input
            const bpmInput = document.getElementById('bpm');
            if (bpmInput) bpmInput.value = bpm;

            // Ίδια calls με handleGenerate
            this.app.visualizer.loadNotes(
                this.app.generatedTracks,
                'Imported Track',
                'Loaded from MIDI file',
                null,
                bpm || 120
            );
            this.app.visualizer.updateTrackSelectors();
            this.app.ui.updateButtonStates(true);

        } catch (err) {
            console.error('[MidiImport] _loadLockedTrack error:', err);
        }
    }

    /**
     * Add exactly one new layer to an existing Edit Tracks arrangement.
     * Existing tracks are passed as immutable harmonic/rhythmic references and
     * are never replaced or regenerated.
     */
    async generateComplementaryTrack({ trackType, key, scale, bpm, bars, style, mood, structure, timeSignature = '4/4', model = null }) {
        if (!getByopKey()) {
            this.app.ui.showMessage(
                'Connect Pollinations to generate an AI companion track. This action uses your Pollinations connection and Pollen.',
                'warning'
            );
            this.app.showByopModal?.('connect');
            return false;
        }
        const current = this.app.generatedTracks;
        if (!(current instanceof Map) || current.size < 1 || current.size > 4) {
            throw new Error('Complementary tracks can be added only to arrangements containing 1–4 existing tracks.');
        }
        if (!AVAILABLE_TRACKS.some(track => track.value === trackType) || trackType === 'percs') {
            throw new Error('Choose a supported melodic instrument track.');
        }
        if (current.has(trackType)) throw new Error('This track type already exists in the arrangement.');
        if (![4, 8].includes(Number(bars))) throw new Error('The arrangement must be 4 or 8 bars long.');

        const normalizedBpm = Math.max(40, Math.min(300, Math.round(Number(bpm) || 120)));
        const meterMatch = /^(\d{1,2})\/(2|4|8|16)$/.exec(String(timeSignature));
        if (!meterMatch) throw new Error('The arrangement has an unsupported time signature.');
        const beatsPerBar = Number(meterMatch[1]) * 4 / Number(meterMatch[2]);
        const notesFor = (entry) => (entry?.midi?.tracks || []).flatMap(track => track.notes || [])
            .filter(note => Number.isFinite(Number(note.midi)) && Number.isFinite(Number(note.time)) &&
                Number.isFinite(Number(note.duration)) && Number(note.duration) > 0)
            .map(note => ({ midi:Number(note.midi), time:Number(note.time), duration:Number(note.duration), velocity:Number(note.velocity) || 0.5 }));
        const allNotes = [...current.values()].flatMap(notesFor);
        if (!allNotes.length) throw new Error('No MIDI notes are available to analyze.');

        const preferredAnchors = ['bassline','chord','keys','pad-textures','strings','arpeggio','lead','melody','plucks','guitar','brass'];
        const anchorType = preferredAnchors.find(type => current.has(type) && notesFor(current.get(type)).length) ||
            [...current.keys()].find(type => notesFor(current.get(type)).length);
        const anchorNotes = notesFor(current.get(anchorType));
        const secPerBeat = 60 / normalizedBpm;
        const anchorNotation = anchorNotes.slice().sort((a,b) => a.time-b.time).map(note => {
            const beat = Math.round((note.time / secPerBeat) * 4) / 4;
            const dur = Math.max(0.25, Math.round((note.duration / secPerBeat) * 4) / 4);
            const velocity = Math.max(1, Math.min(9, Math.round(note.velocity * 9)));
            return note.midi + ':' + beat + ':' + dur + ':' + velocity;
        }).join('|');

        // collectReferenceTracks omits locked entries; make shallow, unlocked
        // snapshots so imported tracks also participate as immutable references.
        const referenceMap = new Map([...current.entries()].map(([type, entry]) => [type, { ...entry, locked:false }]));
        const references = collectReferenceTracks(referenceMap, new Set([anchorType, trackType]), normalizedBpm, Number(bars), beatsPerBar);
        const { harmonyMap } = analyzeHarmonyByBar(anchorNotes, references, normalizedBpm, Number(bars), beatsPerBar);
        const pitchClassNames = scalePitchClassNames(key, scale);
        const referenceLines = [];
        let referenceChars = 0;
        for (const track of references) {
            const line = track.summary;
            if (referenceChars + line.length + 1 > 400) break;
            referenceLines.push(line);
            referenceChars += line.length + 1;
        }
        const enhancedPrompt = buildEnhancedPrompt({
            trackType: anchorType, key, scale, bpm:normalizedBpm, bars:Number(bars), style, timeSignature,
            harmonyMap, pitchClassNames, companionTypes:[trackType],
            importedNotation:anchorNotation, existingTracksContext:referenceLines.join('\\n')
        });

        const promptParams = {
            key, scale, scaleType:scale, bpm:normalizedBpm, duration_bars:Number(bars), duration:Number(bars),
            style, mood:mood || 'neutral', trackTypes:[trackType], rhythmicComplexity:'moderate',
            timeSignature, structure:structure || 'verse', enhancedPrompt
        };
        const { tracks: generatedMap } = await generateMultiTrackMIDIFromAPI(promptParams, this.app.ui, [trackType], model);
        const generated = generatedMap?.get(trackType);
        const generatedNotes = generated?.midi?.tracks?.flatMap(track => track.notes || []) || [];
        const maxSeconds = Number(bars) * beatsPerBar * secPerBeat;
        if (!generated || !generatedNotes.length) throw new Error('The AI did not return a usable complementary track.');
        if (generatedNotes.some(note => !Number.isFinite(note.time) || !Number.isFinite(note.duration) ||
            note.time < 0 || note.duration <= 0 || note.time + note.duration > maxSeconds + 0.02)) {
            throw new Error('The generated track exceeded the original arrangement duration. Nothing was added.');
        }

        // Commit only after all checks pass. Existing Map entries are untouched.
        current.set(trackType, generated);
        this.app.compositionTitle = this.app.compositionTitle || 'MIDI Arrangement';
        this.app.compositionDescription = this.app.compositionDescription || 'Arrangement with an added complementary track';
        this.app.visualizer.compositionTitle = this.app.compositionTitle;
        this.app.visualizer.compositionDescription = this.app.compositionDescription;
        this.app.visualizer.loadNotes(current, this.app.compositionTitle, this.app.compositionDescription, null, normalizedBpm);
        this.app.visualizer.updateTrackSelectors();
        this.app.visualizer.stopVisualization();
        this.app.visualizer.renderStaticBackground();
        this.app.visualizer.drawFrame();
        this.app.ui.updateButtonStates(true);
        this.app.jsonVariations?.recordAddedComplementaryTrack?.(trackType);
        return true;
    }

    // ── Companion generation ──────────────────────────────────────────────────
    // Ακολουθεί ΑΚΡΙΒΩΣ την ίδια ροή με handleGenerate στο main.js.
    // Κρίσιμη διαφορά: αντί για this.generatedTracks = generatedMidisMap,
    // κάνουμε set() track-by-track ώστε το locked track να μείνει άθικτο.

    async _generate() {
        if (this._isGeneratingCompanions) return;
        if (!this.importedNotation || this.selectedCompanions.length === 0) return;
        if (!getByopKey()) {
            this.app.ui.showMessage(
                'Connect Pollinations to generate AI Companion Tracks. Importing and analyzing your MIDI file is free; creating new tracks requires your Pollinations connection and Pollen.',
                'warning'
            );
            this.app.showByopModal?.('connect');
            return;
        }

        const style = document.getElementById('imp-style')?.value  || 'house';
        const bpm   = Math.max(40, Math.min(300, Math.round(Number(document.getElementById('imp-bpm')?.value) || this.importedBpm || 120)));
        const bars  = parseInt(document.getElementById('imp-bars')?.value) || this.importedBars || 4;

        // If the user overrides the imported file's tempo, move the locked
        // source notes to the same beat grid before generating companion parts.
        // The compact notation is beat-based, so its values remain unchanged.
        const previousImportBpm = Number(this.importedBpm) || bpm;
        if (this._importedMidiObj && previousImportBpm !== bpm) {
            const timeScale = previousImportBpm / bpm;
            this._primaryNotes.forEach(note => {
                note.time *= timeScale;
                note.duration *= timeScale;
            });
            this._importedMidiObj.tracks.forEach(track => {
                track.notes.forEach(note => {
                    note.time *= timeScale;
                    note.duration *= timeScale;
                });
            });
            this._importedMidiObj.header.setTempo(bpm);
            this.importedBpm = bpm;
            const bpmInput = document.getElementById('bpm');
            if (bpmInput) bpmInput.value = bpm;
        }

        // Αποκλεισμός του ίδιου track type (extra safety)
        const companionTypes = this.selectedCompanions.filter(t => t !== this.importedTrackType);
        if (!companionTypes.length) {
            this.app.ui.showMessage(
                'Select at least one companion instrument different from the imported track.',
                'warning'
            );
            return;
        }

        // ── enhancedPrompt ────────────────────────────────────────────────────
        // Injected ως INTENT (highest priority) στο PromptBuilder του generate.js.
        // Δίνει στο LLM ακριβώς το notation του locked track ως αναφορά,
        // ώστε να γράψει companions που ταιριάζουν αρμονικά και ρυθμικά.
        // Αναλύουμε την αρμονία του imported track σε chord symbols & pitch classes
        // — αυτό καταλαβαίνει το LLM, όχι raw pipe notation.
        const importedNotes = this._primaryNotes.length
            ? this._primaryNotes
            : (this._importedMidiObj ? this._importedMidiObj.tracks.flatMap(t => t.notes) : []);

        // Existing companion tracks are fixed references, except selected types
        // that are being regenerated in this request.
        const existingReferences = collectReferenceTracks(
            this.app.generatedTracks,
            new Set(companionTypes),
            bpm,
            bars
        );
        const { harmonyMap } = analyzeHarmonyByBar(
            importedNotes,
            existingReferences,
            bpm,
            bars
        );
        const pitchClassNames = scalePitchClassNames(this.importedKey, this.importedScale);
        // The API validates enhancedPrompt at 3,000 characters.
        const referenceLines = [];
        let referenceChars = 0;
        for (const track of existingReferences) {
            const line = track.summary;
            if (referenceChars + line.length + 1 > 400) break;
            referenceLines.push(line);
            referenceChars += line.length + 1;
        }
        const existingTracksContext = referenceLines.join('\n');

        const enhancedPrompt = buildEnhancedPrompt({
            trackType:        this.importedTrackType,
            key:              this.importedKey,
            scale:            this.importedScale,
            bpm, bars, style,
            harmonyMap,
            pitchClassNames,
            companionTypes,
            importedNotation: this.importedNotation,  // for UNCHANGED_TRACKS block
            existingTracksContext
        });

        // ── promptParams — ίδιο shape με musicalContext στο handleGenerate ────
        const mood      = document.getElementById('imp-mood')?.value     || 'energetic';
        const structure = document.getElementById('imp-structure')?.value || 'verse';

        const promptParams = {
            key:               this.importedKey,
            scale:             this.importedScale,
            scaleType:         this.importedScale,
            bpm,
            duration_bars:     bars,
            duration:          bars,
            style,
            mood,
            trackTypes:        companionTypes,
            rhythmicComplexity:'moderate',
            timeSignature:     '4/4',
            structure,
            enhancedPrompt
        };

        // ── Inline loading on imp-gen-btn ────────────────────────────────────
        // app.ui.showLoading() στοχεύει το #generate button που είναι κρυφό
        // στο import tab, οπότε δείχνουμε loading state κατευθείαν εδώ.
        const genBtn = document.getElementById('imp-gen-btn');
        const originalBtnHtml = genBtn?.innerHTML || '✦ Generate Companion Tracks';
        const setLoading = (on) => {
            if (!genBtn) return;
            this.app.setByopAiButtonReady?.(genBtn, !on && this.selectedCompanions.length > 0);
            genBtn.disabled = on || this.selectedCompanions.length === 0;
            if (on) {
                genBtn.setAttribute('aria-busy', 'true');
                genBtn.innerHTML = '<span class="imp-spinner" aria-hidden="true"></span> Generating companion tracks…';
            } else {
                genBtn.removeAttribute('aria-busy');
                genBtn.innerHTML = originalBtnHtml;
            }
        };

        this._isGeneratingCompanions = true;
        try {
            setLoading(true);
            this._status('loading',
                `⏳ Composing ${companionTypes.length} companion track${companionTypes.length > 1 ? 's' : ''}… this takes ~15–30s`);

            // ── Ίδια κλήση με handleGenerate ──────────────────────────────────
            const selectedModel = this._getSelectedImportModel();
            const editTracksSelect = document.getElementById('edit-tracks-model-select');
            if (editTracksSelect) editTracksSelect.value = selectedModel;
            localStorage.setItem('edit_tracks_model_selection', selectedModel);
            const { tracks: generatedMap, compositionTitle, compositionDescription, rawJson }
                = await generateMultiTrackMIDIFromAPI(promptParams, this.app.ui, companionTypes, selectedModel);

            // ── ΚΡΙΣΙΜΟ: set() track-by-track, ΟΧΙ replace του Map ───────────
            // Το handleGenerate κάνει: this.generatedTracks = generatedMidisMap
            // Εμείς ΔΕΝ κάνουμε replace — έτσι το locked imported track επιβιώνει.
            for (const [type, data] of generatedMap.entries()) {
                if (!this.app.generatedTracks.get(type)?.locked) {
                    this.app.generatedTracks.set(type, data);
                }
            }

            // ── Ίδια με handleGenerate ─────────────────────────────────────────
            this.app.compositionTitle       = compositionTitle || 'Import + Generated';
            this.app.compositionDescription = compositionDescription || '';

            // Mirror the successful Import MIDI settings in Customize. Include
            // the locked imported part as well as every generated companion.
            this.app.updateUIFromTextPrompt?.({
                ...promptParams,
                trackTypes: [...new Set([this.importedTrackType, ...companionTypes].filter(Boolean))]
            });

            this.app.visualizer.compositionTitle       = this.app.compositionTitle;
            this.app.visualizer.compositionDescription = this.app.compositionDescription;

            // ── setSourceComposition — inject locked track notation στο rawJson ─
            if (rawJson) {
                let jsonWithAllTracks = rawJson;
                try {
                    const parsed = JSON.parse(rawJson);
                    const mergedTracks = {};
                    // Build the source snapshot from the actual merged Map so
                    // earlier companion tracks remain available to later edits.
                    for (const [type, entry] of this.app.generatedTracks.entries()) {
                        const notes = entry?.midi?.tracks?.flatMap(track => track.notes || []) || [];
                        const notation = type === this.importedTrackType
                            ? this.importedNotation
                            : notesToPipeNotation(notes, bpm);
                        if (notation) mergedTracks[TRACK_ABBR[type] || type] = notation;
                    }
                    parsed.tracks = mergedTracks;
                    parsed.title = this.app.compositionTitle;
                    jsonWithAllTracks = JSON.stringify(parsed, null, 2);
                } catch { /* keep rawJson as-is */ }

                this.app.jsonVariations.setSourceComposition(
                    jsonWithAllTracks,
                    { title: compositionTitle, explanation: compositionDescription },
                    promptParams
                );
            }

            // ── Visualizer + UI — ίδιο με handleGenerate ──────────────────────
            // The selected Import MIDI tempo is also the source tempo used by
            // the Visualizer and by the shared playback scheduler.
            const compositionBpm = Math.max(40, Math.min(300, Math.round(Number(bpm) || 120)));
            const bpmInput = document.getElementById('bpm');
            if (bpmInput) bpmInput.value = compositionBpm;
            this.app.visualizer.loadNotes(
                this.app.generatedTracks,
                this.app.compositionTitle,
                this.app.compositionDescription,
                null,
                compositionBpm
            );
            this.app.visualizer.updateTrackSelectors();
            this.app.ui.updateButtonStates(true);
            this.app.ui.showToast(
                `Companion tracks ready! Imported ${this.importedTrackType} preserved 🔒`,
                'success'
            );
            this.app.ui.showEditHint();

        } catch (error) {
            console.error('[MidiImport] generation error:', error);
            this.app.ui.updateButtonStates(false);
            this._status('error', `❌ Generation failed: ${error.message}`);

            if (error.requiresByop || error.requiresByopReauth) {
                this.app.ui.hideLoading();
                if (error.requiresByopReauth) {
                    localStorage.removeItem('byop_pollinations_key');
                    this.app.checkByopStatus();
                }
                this.app.showByopModal(error.resetAt);
                return;
            }

            this.app.ui.showMessage(`Generation failed: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
            setLoading(false);
            this._isGeneratingCompanions = false;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _syncCompanions() {
        this.selectedCompanions = Array.from(
            document.querySelectorAll('.companion-btn.selected:not(:disabled)')
        ).map(btn => btn.dataset.value);
        const btn = document.getElementById('imp-gen-btn');
        this.app.setByopAiButtonReady?.(btn, this.selectedCompanions.length > 0);
    }

    _isActive() {
        return document.getElementById('import-tab')?.classList.contains('active') ?? false;
    }

    _show(id, visible) {
        const el = document.getElementById(id);
        if (el) el.hidden = !visible;
    }

    _status(type, html) {
        const el = document.getElementById('imp-status');
        if (!el) return;
        el.hidden    = false;
        el.className = `imp-status imp-status--${type}`;
        el.innerHTML = html;
    }

    // ── Styles ────────────────────────────────────────────────────────────────

    _injectStyles() {
        if (document.getElementById('imp-styles')) return;
        const s = document.createElement('style');
        s.id = 'imp-styles';
        s.textContent = `
/* ── Import MIDI panel ── */
.imp-wrap {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.25rem 0;
}

/* Drop zone */
.imp-drop {
    border: 2px dashed var(--border-color, #444);
    border-radius: 12px;
    padding: 2.5rem 1.5rem;
    text-align: center;
    cursor: pointer;
    transition: background .2s, border-color .2s;
    user-select: none;
}
.imp-drop:hover,
.imp-drop.drag-over {
    background: var(--surface-hover, rgba(255,255,255,.05));
    border-color: var(--accent, #7c6af0);
}
.imp-drop.is-loading {
    cursor: progress;
    opacity: .72;
}
.imp-drop.is-loading .imp-browse {
    pointer-events: none;
}
.imp-drop-icon  { font-size: 2.25rem; pointer-events: none; }
.imp-drop-title { margin: .4rem 0 0; font-size: 1rem; pointer-events: none; }
.imp-drop-sub   {
    margin: .25rem 0 0;
    font-size: .82rem;
    color: var(--text-gray-400, #888);
    pointer-events: none;
}
.imp-browse {
    color: var(--accent, #7c6af0);
    text-decoration: underline;
    cursor: pointer;
    pointer-events: all;
}

/* Status */
.imp-status { padding: .55rem .9rem; border-radius: 8px; font-size: .88rem; }
.imp-status--loading { background: var(--dark-surface, #2a2a3a); color: var(--text-gray-400, #aaa); }
.imp-status--success { background: rgba(80,200,120,.12); color: #5fc87a; }
.imp-status--error   { background: rgba(220,60,60,.12);  color: #e06060; }

/* Info badge */
.imp-info  { display: flex; flex-direction: column; gap: .3rem; }
.imp-badge {
    display: flex;
    align-items: center;
    gap: .45rem;
    font-size: .95rem;
    font-weight: 600;
}
.imp-locked-badge {
    margin-left: auto;
    font-size: .7rem;
    font-weight: 400;
    background: rgba(255,210,50,.12);
    color: #f5c842;
    border-radius: 20px;
    padding: .1rem .5rem;
}
.imp-meta { margin: 0; font-size: .78rem; color: var(--text-gray-400, #888); letter-spacing: .01em; line-height: 1.55; }
.imp-role-label { display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; font-size:.78rem; color:var(--text-gray-400,#999); }
.imp-role-label select { min-width:150px; padding:.35rem .55rem; border:1px solid var(--border-color,#444); border-radius:7px; background:var(--dark-surface,#1e1e2e); color:var(--text-color,#fff); }
.imp-role-confidence { margin:0; font-size:.78rem; color:var(--text-gray-400,#999); }

/* Overrides */
.imp-overrides {
    display: flex;
    gap: .75rem;
    flex-wrap: wrap;
    background: var(--dark-surface, #1e1e2e);
    border-radius: 10px;
    padding: .8rem 1rem;
}
.imp-override-label {
    display: flex;
    flex-direction: column;
    gap: .3rem;
    font-size: .78rem;
    font-weight: 600;
    color: var(--text-gray-400, #999);
}
.imp-overrides select,
.imp-overrides input {
    padding: .32rem .55rem;
    border-radius: 6px;
    font-size: .88rem;
    border: 1px solid var(--border-color, #444);
    background: var(--glass-bg, #252535);
    color: var(--text-primary, #fff);
    min-width: 90px;
}

/* Companion selector */
.imp-companions { display: flex; flex-direction: column; gap: .55rem; }
.imp-model-wrap { display:flex; flex-direction:column; gap:.3rem; max-width:360px; }
.imp-model-wrap select { width:100%; padding:.4rem .6rem; border:1px solid var(--border-color,#444); border-radius:7px; background:var(--dark-surface,#1e1e2e); color:var(--text-color,#fff); }
.imp-companions-title { margin: 0; font-size: .9rem; font-weight: 600; }
.imp-companions-hint  { font-weight: 400; font-size: .78rem; color: var(--text-gray-400, #888); }
.imp-grid { display: flex; flex-wrap: wrap; gap: .35rem; }

.companion-btn {
    display: flex;
    align-items: center;
    gap: .3rem;
    padding: .38rem .7rem;
    border-radius: 20px;
    cursor: pointer;
    border: 1px solid var(--border-color, #444);
    background: var(--dark-surface, #1e1e2e);
    color: var(--text-primary, #eee);
    font-size: .8rem;
    white-space: nowrap;
    transition: background .15s, border-color .15s;
}
.companion-btn:hover:not(:disabled) {
    border-color: var(--accent, #7c6af0);
    background: rgba(124,106,240,.1);
}
.companion-btn.selected {
    background: var(--accent, #7c6af0);
    border-color: var(--accent, #7c6af0);
    color: #fff;
    font-weight: 600;
}
.companion-btn.disabled-imported,
.companion-btn:disabled {
    opacity: .35;
    cursor: not-allowed;
}
.companion-btn-icon  { font-size: 1rem; }
.companion-btn-label { font-size: .8rem; }

/* Generate */
.imp-gen-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .45rem;
}
.imp-gen-btn {
    width: 100%;
    padding: .72rem 0;
    border-radius: 30px;
    border: none;
    cursor: pointer;
    font-size: .97rem;
    font-weight: 700;
    background: var(--accent, #7c6af0);
    color: #fff;
    transition: opacity .15s, transform .1s;
}
.imp-gen-btn:hover:not(:disabled) { opacity: .88; transform: translateY(-1px); }
.imp-gen-btn:disabled { opacity: .38; cursor: not-allowed; }
.imp-gen-hint {
    margin: 0;
    font-size: .76rem;
    color: var(--text-gray-400, #888);
    text-align: center;
    line-height: 1.5;
}

/* Spinner inside the generate button */
@keyframes imp-spin {
    to { transform: rotate(360deg); }
}
.imp-spinner {
    display: inline-block;
    width: .9rem;
    height: .9rem;
    border: 2px solid rgba(255,255,255,.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: imp-spin .7s linear infinite;
    vertical-align: middle;
    margin-right: .35rem;
}
        `;
        document.head.appendChild(s);
    }
}
