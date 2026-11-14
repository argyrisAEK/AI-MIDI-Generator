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
    { value: 'percs',        label: 'Percs',     icon: '🥁' },
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

    if (channel === 9 || /drum|percussion|kit|beat|perc/i.test(label)) add('percs', 8);
    if (medianPitch <= 48) add('bassline', 2.4);
    if (q(pitches, 0.25) <= 40) add('bassline', 1.1);
    if (pitchRange <= 24 && polyphony < 0.25) add('bassline', 0.5);

    if (density >= 1.35) add('arpeggio', 1.1);
    if (density >= 2.1) add('arpeggio', 0.8);
    if (regularity >= 0.62 && density >= 1) add('arpeggio', 1.1);
    if (medianDuration <= 0.55 && density >= 1) add('arpeggio', 0.6);
    if (pitchRange <= 24 && uniquePitchRatio < 0.7) add('arpeggio', 0.5);

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
    if (medianPitch >= 70 && pitchRange >= 18 && polyphony < 0.2) add('lead', 1.7);
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
        ['brass', /brass|trumpet|trombone|horn/], ['percs', /drum|perc|kit/],
        ['guitar', /guitar/], ['melody', /melody|melodic/]
    ];
    for (const [role, re] of hints) if (re.test(label)) add(role, 3.2);

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [type, top] = ranked[0];
    const second = ranked[1]?.[1] || 0;
    const confidence = Math.max(35, Math.min(97, Math.round(42 + top * 3.5 + (top - second) * 4.5)));
    return { type, confidence, scores, features };
}

function detectTrackType(notes, metadata = {}, bpm = 120) {
    return classifyTrack(notes, metadata, bpm).type;
}

function estimateBars(notes, bpm) {
    if (!notes.length) return 4;
    const maxTime = Math.max(...notes.map(n => n.time + (n.duration || 0)));
    const beats   = maxTime / (60 / bpm);
    const bars    = Math.ceil(beats / 4);
    if (bars <= 4) return 4;
    if (bars <= 8) return 8;
    return 16;
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
 * Groups notes by bar and returns:
 *   { chordProgression: ['Am','F','C','G'], pitchClassNames: ['A','C','E','F','G'] }
 */
function analyzeHarmony(notes, bpm, bars) {
    const spb        = 60 / bpm;
    const secPerBar  = spb * 4;

    // Group pitch classes by bar
    const barMap = {};
    for (const n of notes) {
        const bar = Math.floor(n.time / secPerBar);
        if (bar < 0 || bar >= bars) continue;
        if (!barMap[bar]) barMap[bar] = new Set();
        barMap[bar].add(n.midi % 12);
    }

    // Detect chord for each bar
    const chords = [];
    for (let b = 0; b < bars; b++) {
        const pcs   = barMap[b] || new Set();
        const chord = detectChordForPitchClasses(pcs);
        chords.push(chord || '?');
    }

    // Deduplicate consecutive identical chords for readability
    const compressedChords = [];
    for (const c of chords) {
        if (compressedChords[compressedChords.length - 1] !== c) {
            compressedChords.push(c);
        }
    }

    // All unique pitch classes across the entire phrase
    const allPCs = new Set(notes.map(n => n.midi % 12));
    const pitchClassNames = [...allPCs].sort((a, b) => a - b).map(pc => NOTE_NAMES[pc]);

    return { chordProgression: compressedChords, pitchClassNames };
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
    percs:          'MIDI:60-72,non-tonal,rhythmic-fills,vel:1-9',
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
function buildEnhancedPrompt({ trackType, key, scale, bpm, bars, style,
                                chordProgression, pitchClassNames, companionTypes,
                                importedNotation }) {
    const beatsPerBar = 4;
    const totalBeats  = beatsPerBar * bars;
    const progression = chordProgression.length ? chordProgression.join(' | ') : '(see pitch classes)';
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

    // Rules — mirrors variations.js RULES block
    const ruleLines = [
        'use ONLY pitch classes from: ' + pcList,
        'follow chord progression bar-by-bar: ' + progression,
        'beat and dur are multiples of 0.25, beat range 0 to ' + totalBeats,
        'complement ' + importedAbbr + ' register — do NOT double its rhythm or octave',
        'stagger note onsets so tracks do not all hit the same beat',
        'no clashing pitches with the unchanged ' + trackType,
        'motif repetition with small variation',
        'final 0.25 beats must be empty for seamless looping',
    ];
    const rules = '- ' + ruleLines.join('\n- ');

    return (
        'IMPORT_CONTEXT: Imported ' + trackType + ' (' + key + ' ' + scale + ', ' + bpm + ' BPM, ' + bars + ' bars) is locked — DO NOT regenerate it.\n' +
        unchangedBlock + '\n' +
        'CHORD_PROGRESSION: ' + progression + '\n' +
        'ACTIVE_PITCH_CLASSES: ' + pcList + '\n' +
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
        this.importedBars      = null;
        this.importedNoteCount = 0;
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
        this.importedBars      = null;
        this.importedNoteCount = 0;
        this._importedMidiObj  = null;
        this.selectedCompanions = [];

        document.querySelectorAll('.companion-btn').forEach(btn => {
            btn.classList.remove('selected', 'disabled-imported');
            btn.disabled = false;
        });
        ['imp-info', 'imp-overrides', 'imp-companions', 'imp-gen-wrap', 'imp-status']
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
                <option value="8">8 bars</option>
                <option value="16">16 bars</option>
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

    <!-- Generate -->
    <div id="imp-gen-wrap" class="imp-gen-wrap" hidden>
        <button id="imp-gen-btn" class="imp-gen-btn" disabled>
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

        document.getElementById('imp-gen-btn')
            ?.addEventListener('click', () => this._generate());
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

        this._status('loading', `⏳ Parsing <strong>${file.name}</strong>…`);

        try {
            // Χρησιμοποιούμε @tonejs/midi — ίδια βιβλιοθήκη με το υπόλοιπο app
            const buffer = await file.arrayBuffer();
            const midi   = new Midi(buffer);

            if (!midi.tracks?.length) throw new Error('No tracks found in MIDI file.');
            const allNotes = midi.tracks.flatMap(t => t.notes);
            if (!allNotes.length) throw new Error('No notes found in MIDI file.');

            // BPM από MIDI header
            const detectedBpm = Math.round(midi.header?.tempos?.[0]?.bpm || 120);

            // Track με τα περισσότερα notes
            const primaryTrack = midi.tracks.reduce(
                (best, t) => t.notes.length > best.notes.length ? t : best,
                midi.tracks[0]
            );
            const primaryNotes = primaryTrack.notes;

            // Μουσική ανάλυση
            const { key, scale } = detectKey(allNotes);
            const trackType      = detectTrackType(primaryNotes);
            const bars           = estimateBars(primaryNotes, detectedBpm);

            // Pipe notation — ίδια μορφή με generate.js output
            const notation = notesToPipeNotation(primaryNotes, detectedBpm);

            // Αποθήκευση state
            this.importedNotation  = notation;
            this.importedTrackType = trackType;
            this.importedKey       = key;
            this.importedScale     = scale;
            this.importedBpm       = detectedBpm;
            this.importedBars      = bars;
            this.importedNoteCount = primaryNotes.length;
            this._importedMidiObj  = midi;

            // Pre-fill overrides
            const bpmEl  = document.getElementById('imp-bpm');
            const barsEl = document.getElementById('imp-bars');
            if (bpmEl)  bpmEl.value  = detectedBpm;
            if (barsEl) barsEl.value = bars;

            // Info badge
            const trackMeta = AVAILABLE_TRACKS.find(t => t.value === trackType) || { label: trackType, icon: '🎵' };
            document.getElementById('imp-icon').textContent = trackMeta.icon;
            document.getElementById('imp-name').textContent = `${trackMeta.label} (imported)`;
            document.getElementById('imp-meta').textContent =
                `Key: ${key}  ·  BPM: ${detectedBpm}  ·  Bars: ${bars}  ·  Notes: ${primaryNotes.length}`;

            // Φόρτωση στο visualizer ως locked track
            this._loadLockedTrack(trackType, midi, detectedBpm);

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
            this._show('imp-gen-wrap',   true);
            this._status('success',
                `✅ <strong>${file.name}</strong> loaded — ${primaryNotes.length} notes · key ${key}`);
            this._syncCompanions();

        } catch (err) {
            console.error('[MidiImport]', err);
            this._status('error', `❌ ${err.message}`);
        }
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
                'Loaded from MIDI file'
            );
            this.app.visualizer.updateTrackSelectors();
            this.app.ui.updateButtonStates(true);

        } catch (err) {
            console.error('[MidiImport] _loadLockedTrack error:', err);
        }
    }

    // ── Companion generation ──────────────────────────────────────────────────
    // Ακολουθεί ΑΚΡΙΒΩΣ την ίδια ροή με handleGenerate στο main.js.
    // Κρίσιμη διαφορά: αντί για this.generatedTracks = generatedMidisMap,
    // κάνουμε set() track-by-track ώστε το locked track να μείνει άθικτο.

    async _generate() {
        if (!this.importedNotation || this.selectedCompanions.length === 0) return;

        const style = document.getElementById('imp-style')?.value  || 'house';
        const bpm   = parseInt(document.getElementById('imp-bpm')?.value)  || this.importedBpm  || 120;
        const bars  = parseInt(document.getElementById('imp-bars')?.value) || this.importedBars || 4;

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
        const importedAbbr  = TRACK_ABBR[this.importedTrackType] || this.importedTrackType;
        const importedNotes = this._importedMidiObj
            ? this._importedMidiObj.tracks.flatMap(t => t.notes)
            : [];

        const { chordProgression, pitchClassNames } = analyzeHarmony(
            importedNotes, bpm, bars
        );

        const enhancedPrompt = buildEnhancedPrompt({
            trackType:        this.importedTrackType,
            key:              this.importedKey,
            scale:            this.importedScale,
            bpm, bars, style,
            chordProgression,
            pitchClassNames,
            companionTypes,
            importedNotation: this.importedNotation   // for UNCHANGED_TRACKS block
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
        const originalBtnText = '✦ Generate Companion Tracks';
        const setLoading = (on) => {
            if (!genBtn) return;
            genBtn.disabled = on;
            genBtn.innerHTML = on
                ? '<span class="imp-spinner"></span> Generating…'
                : originalBtnText;
        };

        try {
            setLoading(true);
            this._status('loading',
                `⏳ Composing ${companionTypes.length} companion track${companionTypes.length > 1 ? 's' : ''}… this takes ~15–30s`);

            // ── Ίδια κλήση με handleGenerate ──────────────────────────────────
            const { tracks: generatedMap, compositionTitle, compositionDescription, rawJson }
                = await generateMultiTrackMIDIFromAPI(promptParams, this.app.ui, companionTypes);

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

            this.app.visualizer.compositionTitle       = this.app.compositionTitle;
            this.app.visualizer.compositionDescription = this.app.compositionDescription;

            // ── setSourceComposition — inject locked track notation στο rawJson ─
            if (rawJson) {
                let jsonWithLocked = rawJson;
                try {
                    const parsed = JSON.parse(rawJson);
                    parsed.tracks = parsed.tracks || {};
                    parsed.tracks[importedAbbr] = this.importedNotation;
                    parsed.title = this.app.compositionTitle;
                    jsonWithLocked = JSON.stringify(parsed, null, 2);
                } catch { /* keep rawJson as-is */ }

                this.app.jsonVariations.setSourceComposition(
                    jsonWithLocked,
                    { title: compositionTitle, explanation: compositionDescription },
                    promptParams
                );
            }

            // ── Visualizer + UI — ίδιο με handleGenerate ──────────────────────
            this.app.visualizer.loadNotes(
                this.app.generatedTracks,
                this.app.compositionTitle,
                this.app.compositionDescription
            );
            this.app.visualizer.updateTrackSelectors();
            this.app.ui.updateButtonStates(true);
            this.app.ui.showToast(
                `Companion tracks ready! Imported ${this.importedTrackType} preserved 🔒`,
                'success'
            );
            this.app.ui.showEditHint();

            // ── Optimistic decrement — ίδιο με handleGenerate ─────────────────
            try {
                const dataStr = localStorage.getItem('free_generations_data');
                if (dataStr) {
                    const data = JSON.parse(dataStr);
                    if (data.remaining > 0) {
                        data.remaining--;
                        data.timestamp = Date.now();
                        localStorage.setItem('free_generations_data', JSON.stringify(data));
                        this.app.updateFreeGenerationsDisplay(data.remaining);
                    }
                }
            } catch { /* ignore storage errors */ }

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
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _syncCompanions() {
        this.selectedCompanions = Array.from(
            document.querySelectorAll('.companion-btn.selected:not(:disabled)')
        ).map(btn => btn.dataset.value);
        const btn = document.getElementById('imp-gen-btn');
        if (btn) btn.disabled = this.selectedCompanions.length === 0;
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
.imp-meta { margin: 0; font-size: .78rem; color: var(--text-gray-400, #888); letter-spacing: .01em; }

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
