/**
 * track-rules.js
 * Style Compiler — deterministic post-processor that sits between
 * LLM output and the MIDI renderer.
 *
 * Architecture:
 *   LLM output (rough structure)
 *     → applyGenreRules()        — enforce density, timing, velocity
 *     → MIDI renderer / Tone.js
 *
 * Usage:
 *   import { applyGenreRules } from './track-rules.js';
 *   const processedTracks = applyGenreRules(rawTracks, genre, bpm);
 */

// ── Types (as JSDoc for IDE support) ──────────────────────────────────
/**
 * @typedef {'low'|'medium'|'high'} Density
 * @typedef {'tight'|'loose'|'humanized'} Timing
 * @typedef {'foreground'|'mid'|'background'} Role
 *
 * @typedef {Object} TrackRules
 * @property {Density} density
 * @property {Timing}  timing
 * @property {Role}    role
 * @property {number}  repetitionTolerance  0–1 (1=allow full repeat)
 * @property {boolean} allowSilence
 * @property {number}  maxNoteDensityPerBar max notes per 4-beat bar
 * @property {number}  velocityVariance     ±spread applied to vel (0–4)
 * @property {number}  microtiming          ±beats shift (0=rigid grid)
 * @property {number}  noteLengthVariance   ±beats spread on duration
 */

// ── Default fallback rules ─────────────────────────────────────────────
const DEFAULT_RULES = {
    density:              'medium',
    timing:               'tight',
    role:                 'mid',
    repetitionTolerance:  0.5,
    allowSilence:         false,
    maxNoteDensityPerBar: 6,
    velocityVariance:     0.5,
    microtiming:          0.0,
    noteLengthVariance:   0.1,
};

// ── Genre × Track Rule Matrix ─────────────────────────────────────────
// Each entry overrides only the fields that differ from DEFAULT_RULES.
// Tracks not listed use the default.
const GENRE_RULES = {

    house: {
        bassline:       { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.6, microtiming:0.02, noteLengthVariance:0.1, repetitionTolerance:0.7, allowSilence:false },
        chord:          { density:'medium', timing:'tight',     role:'mid',        maxNoteDensityPerBar:4,  velocityVariance:0.5, microtiming:0.02, noteLengthVariance:0.2, repetitionTolerance:0.6, allowSilence:false },
        melody:         { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:6,  velocityVariance:0.8, microtiming:0.06, noteLengthVariance:0.3, repetitionTolerance:0.5, allowSilence:true  },
        arpeggio:       { density:'high',   timing:'tight',     role:'mid',        maxNoteDensityPerBar:12, velocityVariance:0.4, microtiming:0.01, noteLengthVariance:0.1, repetitionTolerance:0.7, allowSilence:false },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.2, microtiming:0.1,  noteLengthVariance:0.3, repetitionTolerance:0.8, allowSilence:true  },
        percs:          { density:'high',   timing:'tight',     role:'mid',        maxNoteDensityPerBar:8,  velocityVariance:0.7, microtiming:0.01, noteLengthVariance:0.1, repetitionTolerance:0.6, allowSilence:false },
        keys:           { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:5,  velocityVariance:0.6, microtiming:0.05, noteLengthVariance:0.2, repetitionTolerance:0.5, allowSilence:true  },
    },

    techno: {
        bassline:       { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.3, microtiming:0.01, noteLengthVariance:0.1, repetitionTolerance:0.85,allowSilence:false },
        arpeggio:       { density:'high',   timing:'tight',     role:'mid',        maxNoteDensityPerBar:16, velocityVariance:0.2, microtiming:0.01, noteLengthVariance:0.1, repetitionTolerance:0.8, allowSilence:false },
        lead:           { density:'medium', timing:'tight',     role:'foreground', maxNoteDensityPerBar:4,  velocityVariance:0.4, microtiming:0.02, noteLengthVariance:0.2, repetitionTolerance:0.5, allowSilence:true  },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.1, microtiming:0.15, noteLengthVariance:0.4, repetitionTolerance:0.9, allowSilence:true  },
        percs:          { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:16, velocityVariance:0.4, microtiming:0.01, noteLengthVariance:0.1, repetitionTolerance:0.7, allowSilence:false },
        plucks:         { density:'medium', timing:'tight',     role:'mid',        maxNoteDensityPerBar:6,  velocityVariance:0.4, microtiming:0.02, noteLengthVariance:0.1, repetitionTolerance:0.6, allowSilence:false },
    },

    trance: {
        bassline:       { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.3, microtiming:0.01, noteLengthVariance:0.1, repetitionTolerance:0.8, allowSilence:false },
        arpeggio:       { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:16, velocityVariance:0.3, microtiming:0.01, noteLengthVariance:0.1, repetitionTolerance:0.75,allowSilence:false },
        melody:         { density:'low',    timing:'humanized', role:'foreground', maxNoteDensityPerBar:4,  velocityVariance:0.8, microtiming:0.08, noteLengthVariance:0.5, repetitionTolerance:0.4, allowSilence:true  },
        chord:          { density:'medium', timing:'tight',     role:'mid',        maxNoteDensityPerBar:4,  velocityVariance:0.3, microtiming:0.02, noteLengthVariance:0.2, repetitionTolerance:0.7, allowSilence:false },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.2, microtiming:0.2,  noteLengthVariance:0.5, repetitionTolerance:0.9, allowSilence:true  },
        lead:           { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.6, microtiming:0.06, noteLengthVariance:0.3, repetitionTolerance:0.4, allowSilence:true  },
    },

    trap: {
        bassline:       { density:'medium', timing:'loose',     role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.6, microtiming:0.08, noteLengthVariance:0.3, repetitionTolerance:0.6, allowSilence:true  },
        lead:           { density:'low',    timing:'humanized', role:'foreground', maxNoteDensityPerBar:4,  velocityVariance:0.9, microtiming:0.12, noteLengthVariance:0.5, repetitionTolerance:0.3, allowSilence:true  },
        plucks:         { density:'medium', timing:'loose',     role:'mid',        maxNoteDensityPerBar:6,  velocityVariance:0.7, microtiming:0.1,  noteLengthVariance:0.3, repetitionTolerance:0.4, allowSilence:true  },
        percs:          { density:'high',   timing:'loose',     role:'foreground', maxNoteDensityPerBar:10, velocityVariance:0.8, microtiming:0.06, noteLengthVariance:0.2, repetitionTolerance:0.5, allowSilence:true  },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.2,  noteLengthVariance:0.6, repetitionTolerance:0.8, allowSilence:true  },
        keys:           { density:'low',    timing:'loose',     role:'mid',        maxNoteDensityPerBar:3,  velocityVariance:0.7, microtiming:0.1,  noteLengthVariance:0.4, repetitionTolerance:0.4, allowSilence:true  },
    },

    'hip-hop': {
        bassline:       { density:'medium', timing:'loose',     role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.7, microtiming:0.1,  noteLengthVariance:0.3, repetitionTolerance:0.6, allowSilence:true  },
        keys:           { density:'low',    timing:'humanized', role:'mid',        maxNoteDensityPerBar:4,  velocityVariance:0.8, microtiming:0.12, noteLengthVariance:0.4, repetitionTolerance:0.4, allowSilence:true  },
        melody:         { density:'low',    timing:'humanized', role:'foreground', maxNoteDensityPerBar:4,  velocityVariance:0.9, microtiming:0.12, noteLengthVariance:0.5, repetitionTolerance:0.3, allowSilence:true  },
        percs:          { density:'medium', timing:'loose',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.9, microtiming:0.08, noteLengthVariance:0.2, repetitionTolerance:0.4, allowSilence:true  },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.2,  noteLengthVariance:0.5, repetitionTolerance:0.7, allowSilence:true  },
        plucks:         { density:'medium', timing:'loose',     role:'mid',        maxNoteDensityPerBar:5,  velocityVariance:0.7, microtiming:0.1,  noteLengthVariance:0.3, repetitionTolerance:0.4, allowSilence:true  },
    },

    rock: {
        bassline:       { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.4, microtiming:0.02, noteLengthVariance:0.1, repetitionTolerance:0.7, allowSilence:false },
        guitar:         { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.5, microtiming:0.03, noteLengthVariance:0.1, repetitionTolerance:0.6, allowSilence:false },
        melody:         { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.7, microtiming:0.06, noteLengthVariance:0.3, repetitionTolerance:0.4, allowSilence:true  },
        keys:           { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:5,  velocityVariance:0.6, microtiming:0.06, noteLengthVariance:0.2, repetitionTolerance:0.5, allowSilence:true  },
        percs:          { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.5, microtiming:0.02, noteLengthVariance:0.1, repetitionTolerance:0.6, allowSilence:false },
        lead:           { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.7, microtiming:0.07, noteLengthVariance:0.3, repetitionTolerance:0.3, allowSilence:true  },
    },

    pop: {
        bassline:       { density:'medium', timing:'tight',     role:'foreground', maxNoteDensityPerBar:6,  velocityVariance:0.4, microtiming:0.03, noteLengthVariance:0.2, repetitionTolerance:0.7, allowSilence:false },
        melody:         { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:6,  velocityVariance:0.8, microtiming:0.07, noteLengthVariance:0.4, repetitionTolerance:0.4, allowSilence:true  },
        chord:          { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:4,  velocityVariance:0.5, microtiming:0.05, noteLengthVariance:0.2, repetitionTolerance:0.6, allowSilence:false },
        keys:           { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:5,  velocityVariance:0.6, microtiming:0.06, noteLengthVariance:0.3, repetitionTolerance:0.5, allowSilence:true  },
        percs:          { density:'high',   timing:'tight',     role:'mid',        maxNoteDensityPerBar:8,  velocityVariance:0.5, microtiming:0.02, noteLengthVariance:0.1, repetitionTolerance:0.6, allowSilence:false },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.1,  noteLengthVariance:0.4, repetitionTolerance:0.8, allowSilence:true  },
    },

    funk: {
        bassline:       { density:'high',   timing:'loose',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.7, microtiming:0.07, noteLengthVariance:0.3, repetitionTolerance:0.5, allowSilence:true  },
        guitar:         { density:'high',   timing:'loose',     role:'foreground', maxNoteDensityPerBar:10, velocityVariance:0.7, microtiming:0.08, noteLengthVariance:0.2, repetitionTolerance:0.4, allowSilence:true  },
        keys:           { density:'medium', timing:'loose',     role:'mid',        maxNoteDensityPerBar:6,  velocityVariance:0.7, microtiming:0.08, noteLengthVariance:0.3, repetitionTolerance:0.4, allowSilence:true  },
        brass:          { density:'medium', timing:'loose',     role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.6, microtiming:0.06, noteLengthVariance:0.2, repetitionTolerance:0.4, allowSilence:true  },
        percs:          { density:'high',   timing:'loose',     role:'foreground', maxNoteDensityPerBar:10, velocityVariance:0.9, microtiming:0.07, noteLengthVariance:0.2, repetitionTolerance:0.4, allowSilence:true  },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.15, noteLengthVariance:0.4, repetitionTolerance:0.7, allowSilence:true  },
    },

    jazz: {
        bassline:       { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:6,  velocityVariance:0.8, microtiming:0.1,  noteLengthVariance:0.4, repetitionTolerance:0.3, allowSilence:true  },
        keys:           { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:6,  velocityVariance:0.9, microtiming:0.12, noteLengthVariance:0.5, repetitionTolerance:0.2, allowSilence:true  },
        brass:          { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.8, microtiming:0.1,  noteLengthVariance:0.4, repetitionTolerance:0.2, allowSilence:true  },
        melody:         { density:'low',    timing:'humanized', role:'foreground', maxNoteDensityPerBar:4,  velocityVariance:0.9, microtiming:0.14, noteLengthVariance:0.6, repetitionTolerance:0.2, allowSilence:true  },
        percs:          { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:7,  velocityVariance:0.9, microtiming:0.12, noteLengthVariance:0.3, repetitionTolerance:0.2, allowSilence:true  },
        chord:          { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:5,  velocityVariance:0.8, microtiming:0.1,  noteLengthVariance:0.4, repetitionTolerance:0.3, allowSilence:true  },
    },

    disco: {
        bassline:       { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.5, microtiming:0.03, noteLengthVariance:0.2, repetitionTolerance:0.6, allowSilence:false },
        guitar:         { density:'high',   timing:'tight',     role:'mid',        maxNoteDensityPerBar:8,  velocityVariance:0.5, microtiming:0.03, noteLengthVariance:0.1, repetitionTolerance:0.5, allowSilence:false },
        strings:        { density:'medium', timing:'tight',     role:'mid',        maxNoteDensityPerBar:4,  velocityVariance:0.4, microtiming:0.04, noteLengthVariance:0.2, repetitionTolerance:0.6, allowSilence:false },
        brass:          { density:'medium', timing:'tight',     role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.5, microtiming:0.04, noteLengthVariance:0.2, repetitionTolerance:0.4, allowSilence:true  },
        keys:           { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:5,  velocityVariance:0.5, microtiming:0.06, noteLengthVariance:0.2, repetitionTolerance:0.5, allowSilence:true  },
        percs:          { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.5, microtiming:0.02, noteLengthVariance:0.1, repetitionTolerance:0.5, allowSilence:false },
    },

    classical: {
        strings:        { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:6,  velocityVariance:0.8, microtiming:0.1,  noteLengthVariance:0.5, repetitionTolerance:0.3, allowSilence:true  },
        melody:         { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:6,  velocityVariance:0.9, microtiming:0.1,  noteLengthVariance:0.5, repetitionTolerance:0.2, allowSilence:true  },
        brass:          { density:'low',    timing:'humanized', role:'mid',        maxNoteDensityPerBar:3,  velocityVariance:0.7, microtiming:0.08, noteLengthVariance:0.4, repetitionTolerance:0.3, allowSilence:true  },
        bassline:       { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:5,  velocityVariance:0.7, microtiming:0.1,  noteLengthVariance:0.5, repetitionTolerance:0.3, allowSilence:true  },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.2,  noteLengthVariance:0.6, repetitionTolerance:0.7, allowSilence:true  },
    },

    cinematic: {
        strings:        { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:4,  velocityVariance:0.7, microtiming:0.12, noteLengthVariance:0.5, repetitionTolerance:0.4, allowSilence:true  },
        brass:          { density:'low',    timing:'humanized', role:'foreground', maxNoteDensityPerBar:3,  velocityVariance:0.7, microtiming:0.1,  noteLengthVariance:0.4, repetitionTolerance:0.3, allowSilence:true  },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.2, microtiming:0.2,  noteLengthVariance:0.6, repetitionTolerance:0.8, allowSilence:true  },
        bassline:       { density:'low',    timing:'humanized', role:'mid',        maxNoteDensityPerBar:3,  velocityVariance:0.6, microtiming:0.1,  noteLengthVariance:0.6, repetitionTolerance:0.5, allowSilence:true  },
        percs:          { density:'low',    timing:'humanized', role:'mid',        maxNoteDensityPerBar:3,  velocityVariance:0.8, microtiming:0.12, noteLengthVariance:0.4, repetitionTolerance:0.3, allowSilence:true  },
        melody:         { density:'low',    timing:'humanized', role:'foreground', maxNoteDensityPerBar:3,  velocityVariance:0.8, microtiming:0.12, noteLengthVariance:0.6, repetitionTolerance:0.2, allowSilence:true  },
    },

    ambient: {
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.2, microtiming:0.2,  noteLengthVariance:0.6, repetitionTolerance:0.8, allowSilence:true  },
        strings:        { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.2,  noteLengthVariance:0.6, repetitionTolerance:0.7, allowSilence:true  },
        arpeggio:       { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:4,  velocityVariance:0.4, microtiming:0.15, noteLengthVariance:0.5, repetitionTolerance:0.5, allowSilence:true  },
        plucks:         { density:'low',    timing:'humanized', role:'mid',        maxNoteDensityPerBar:3,  velocityVariance:0.5, microtiming:0.18, noteLengthVariance:0.5, repetitionTolerance:0.4, allowSilence:true  },
        bassline:       { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.15, noteLengthVariance:0.6, repetitionTolerance:0.8, allowSilence:true  },
        lead:           { density:'low',    timing:'humanized', role:'foreground', maxNoteDensityPerBar:3,  velocityVariance:0.5, microtiming:0.12, noteLengthVariance:0.4, repetitionTolerance:0.4, allowSilence:true  },
    },

    'drum-and-bass': {
        bassline:       { density:'high',   timing:'tight',     role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.4, microtiming:0.02, noteLengthVariance:0.1, repetitionTolerance:0.6, allowSilence:false },
        percs:          { density:'high',   timing:'humanized', role:'foreground', maxNoteDensityPerBar:12, velocityVariance:0.8, microtiming:0.04, noteLengthVariance:0.2, repetitionTolerance:0.3, allowSilence:false },
        lead:           { density:'medium', timing:'tight',     role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.5, microtiming:0.03, noteLengthVariance:0.2, repetitionTolerance:0.4, allowSilence:true  },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.2, microtiming:0.2,  noteLengthVariance:0.5, repetitionTolerance:0.9, allowSilence:true  },
        arpeggio:       { density:'high',   timing:'tight',     role:'mid',        maxNoteDensityPerBar:12, velocityVariance:0.4, microtiming:0.02, noteLengthVariance:0.1, repetitionTolerance:0.6, allowSilence:false },
        strings:        { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.15, noteLengthVariance:0.5, repetitionTolerance:0.8, allowSilence:true  },
    },

    synthwave: {
        bassline:       { density:'medium', timing:'tight',     role:'foreground', maxNoteDensityPerBar:6,  velocityVariance:0.3, microtiming:0.02, noteLengthVariance:0.2, repetitionTolerance:0.8, allowSilence:false },
        lead:           { density:'medium', timing:'tight',     role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.4, microtiming:0.04, noteLengthVariance:0.2, repetitionTolerance:0.6, allowSilence:false },
        arpeggio:       { density:'high',   timing:'tight',     role:'mid',        maxNoteDensityPerBar:12, velocityVariance:0.3, microtiming:0.01, noteLengthVariance:0.1, repetitionTolerance:0.8, allowSilence:false },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.2, microtiming:0.1,  noteLengthVariance:0.4, repetitionTolerance:0.9, allowSilence:true  },
        strings:        { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.1,  noteLengthVariance:0.4, repetitionTolerance:0.8, allowSilence:true  },
        percs:          { density:'high',   timing:'tight',     role:'mid',        maxNoteDensityPerBar:8,  velocityVariance:0.4, microtiming:0.02, noteLengthVariance:0.1, repetitionTolerance:0.6, allowSilence:false },
    },

    downtempo: {
        bassline:       { density:'medium', timing:'loose',     role:'foreground', maxNoteDensityPerBar:4,  velocityVariance:0.6, microtiming:0.1,  noteLengthVariance:0.4, repetitionTolerance:0.6, allowSilence:true  },
        'pad-textures': { density:'low',    timing:'loose',     role:'background', maxNoteDensityPerBar:2,  velocityVariance:0.3, microtiming:0.2,  noteLengthVariance:0.6, repetitionTolerance:0.8, allowSilence:true  },
        plucks:         { density:'low',    timing:'humanized', role:'mid',        maxNoteDensityPerBar:4,  velocityVariance:0.6, microtiming:0.12, noteLengthVariance:0.4, repetitionTolerance:0.4, allowSilence:true  },
        keys:           { density:'low',    timing:'humanized', role:'mid',        maxNoteDensityPerBar:4,  velocityVariance:0.7, microtiming:0.12, noteLengthVariance:0.4, repetitionTolerance:0.4, allowSilence:true  },
        percs:          { density:'medium', timing:'loose',     role:'mid',        maxNoteDensityPerBar:6,  velocityVariance:0.8, microtiming:0.1,  noteLengthVariance:0.3, repetitionTolerance:0.4, allowSilence:true  },
        melody:         { density:'low',    timing:'humanized', role:'foreground', maxNoteDensityPerBar:3,  velocityVariance:0.8, microtiming:0.14, noteLengthVariance:0.5, repetitionTolerance:0.3, allowSilence:true  },
    },

    'progressive-rock': {
        bassline:       { density:'high',   timing:'humanized', role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.5, microtiming:0.05, noteLengthVariance:0.3, repetitionTolerance:0.4, allowSilence:false },
        guitar:         { density:'high',   timing:'humanized', role:'foreground', maxNoteDensityPerBar:8,  velocityVariance:0.6, microtiming:0.06, noteLengthVariance:0.3, repetitionTolerance:0.3, allowSilence:false },
        keys:           { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:6,  velocityVariance:0.7, microtiming:0.08, noteLengthVariance:0.4, repetitionTolerance:0.2, allowSilence:true  },
        lead:           { density:'medium', timing:'humanized', role:'foreground', maxNoteDensityPerBar:5,  velocityVariance:0.7, microtiming:0.08, noteLengthVariance:0.4, repetitionTolerance:0.2, allowSilence:true  },
        percs:          { density:'high',   timing:'humanized', role:'mid',        maxNoteDensityPerBar:8,  velocityVariance:0.7, microtiming:0.05, noteLengthVariance:0.2, repetitionTolerance:0.3, allowSilence:false },
        strings:        { density:'medium', timing:'humanized', role:'mid',        maxNoteDensityPerBar:4,  velocityVariance:0.6, microtiming:0.1,  noteLengthVariance:0.5, repetitionTolerance:0.4, allowSilence:true  },
    },
};

// ── Rule Resolver ──────────────────────────────────────────────────────
/**
 * Returns merged rules for a genre+track combination.
 * @param {string} genre
 * @param {string} trackType
 * @returns {TrackRules}
 */
export function getTrackRules(genre, trackType) {
    const genreRules = GENRE_RULES[genre] || {};
    return { ...DEFAULT_RULES, ...(genreRules[trackType] || {}) };
}

// ── Deterministic Post-Processor ──────────────────────────────────────
/**
 * Applies track rules to a raw note string.
 * Modifies: velocity, timing (microtiming), note length, density.
 *
 * @param {string}     notesStr  pipe-separated "pitch:beat:dur:vel|..."
 * @param {TrackRules} rules
 * @param {number}     bpm       used to guard beat boundaries
 * @param {number}     totalBeats total beats in the loop
 * @returns {string}   processed note string
 */
export function applyTrackRules(notesStr, rules, bpm = 120, totalBeats = 16) {
    if (!notesStr || typeof notesStr !== 'string') return notesStr;

    const raw = notesStr.split('|').map(n => n.trim()).filter(Boolean);
    if (raw.length === 0) return notesStr;

    // Parse
    let parsed = raw.map(n => {
        const parts = n.split(':').map(Number);
        if (parts.length < 4 || parts.some(isNaN)) return null;
        return { pitch: parts[0], beat: parts[1], dur: parts[2], vel: parts[3] };
    }).filter(Boolean);

    // 1. Apply microtiming (only for 'loose' or 'humanized')
    if (rules.timing !== 'tight' && rules.microtiming > 0) {
        parsed = parsed.map(n => {
            const shift = (Math.random() - 0.5) * 2 * rules.microtiming;
            // Quantize to nearest 0.25 grid AFTER shift for tight, free for loose
            const newBeat = rules.timing === 'humanized'
                ? Math.max(0, n.beat + shift)
                : Math.max(0, Math.round((n.beat + shift) * 4) / 4);
            return { ...n, beat: newBeat };
        });
    }

    // 2. Apply velocity variance
    if (rules.velocityVariance > 0) {
        parsed = parsed.map(n => {
            const spread = (Math.random() - 0.5) * 2 * rules.velocityVariance;
            const newVel = Math.round(Math.min(9, Math.max(1, n.vel + spread)));
            return { ...n, vel: newVel };
        });
    }

    // 3. Apply note length variance
    if (rules.noteLengthVariance > 0) {
        parsed = parsed.map(n => {
            const spread = (Math.random() - 0.5) * 2 * rules.noteLengthVariance;
            const newDur = Math.max(0.0625, n.dur + spread);
            // Ensure note doesn't extend past loop boundary
            const clampedDur = Math.min(newDur, totalBeats - n.beat - 0.0625);
            return { ...n, dur: Math.max(0.0625, clampedDur) };
        });
    }

    // 4. Density limiter — cap notes per 4-beat bar
    parsed = limitDensity(parsed, rules.maxNoteDensityPerBar);

    // 5. Re-sort by beat after microtiming shifts
    parsed.sort((a, b) => a.beat - b.beat);

    // 6. Format back to string
    return parsed
        .map(n => [
            n.pitch,
            parseFloat(n.beat.toFixed(3)),
            parseFloat(n.dur.toFixed(3)),
            n.vel
        ].join(':'))
        .join('|');
}

// ── Density limiter ────────────────────────────────────────────────────
/**
 * Keeps at most maxPerBar notes per 4-beat bar.
 * Retains the highest-velocity notes (most musically important).
 * @param {Array} notes
 * @param {number} maxPerBar
 * @returns {Array}
 */
function limitDensity(notes, maxPerBar) {
    const bars = new Map();
    notes.forEach(n => {
        const bar = Math.floor(n.beat / 4);
        if (!bars.has(bar)) bars.set(bar, []);
        bars.get(bar).push(n);
    });

    const result = [];
    bars.forEach(barNotes => {
        if (barNotes.length <= maxPerBar) {
            result.push(...barNotes);
        } else {
            // Keep highest-velocity notes (most musically important)
            const sorted = [...barNotes].sort((a, b) => b.vel - a.vel);
            result.push(...sorted.slice(0, maxPerBar));
        }
    });

    return result;
}

// ── Main entry point ───────────────────────────────────────────────────
/**
 * Process all tracks from LLM output through the style compiler.
 *
 * @param {Record<string, string>} rawTracks  { trackType: "pitch:beat:dur:vel|..." }
 * @param {string} genre
 * @param {number} bpm
 * @param {number} totalBeats
 * @returns {Record<string, string>}
 */
export function applyGenreRules(rawTracks, genre, bpm = 120, totalBeats = 16) {
    if (!rawTracks || typeof rawTracks !== 'object') return rawTracks;

    const result = {};
    for (const [trackType, notesStr] of Object.entries(rawTracks)) {
        const rules = getTrackRules(genre, trackType);
        result[trackType] = applyTrackRules(notesStr, rules, bpm, totalBeats);
    }
    return result;
}
