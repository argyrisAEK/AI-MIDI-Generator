/**
 * Export-only MIDI intelligence and curated synth candidate generation.
 *
 * This module is deliberately side-effect free. It does not change Preview Audio
 * or the browser playback engine. The export API can consume these results in a
 * later integration step after the candidate catalogue is validated.
 */
import { resolvePreset, finalizePatch } from './synth-presets.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Summarize musical properties used for export sound design.
 * Tone.js MIDI note times/durations are seconds; bpm converts them to beats.
 */
export function analyzeMidiForSynthesis(notes, { bpm = 120 } = {}) {
  const safeBpm = Number.isFinite(Number(bpm)) ? clamp(Number(bpm), 30, 300) : 120;
  const beatSeconds = 60 / safeBpm;
  const valid = (Array.isArray(notes) ? notes : [])
    .map((note) => ({
      midi: Number(note?.midi),
      time: Number(note?.time),
      duration: Number(note?.duration),
      velocity: Number(note?.velocity)
    }))
    .filter((note) =>
      Number.isFinite(note.midi) && note.midi >= 0 && note.midi <= 127 &&
      Number.isFinite(note.time) && note.time >= 0 &&
      Number.isFinite(note.duration) && note.duration > 0
    )
    .map((note) => ({
      ...note,
      midi: Math.round(note.midi),
      velocity: clamp(Number.isFinite(note.velocity) ? note.velocity : 0.7, 0, 1)
    }))
    .sort((a, b) => a.time - b.time);

  if (!valid.length) {
    return {
      noteCount: 0, bpm: safeBpm, pitchMin: null, pitchMax: null,
      pitchMean: null, pitchMedian: null, pitchSpan: 0, pitchClassHistogram: Array(12).fill(0),
      avgDurationSeconds: 0, medianDurationSeconds: 0, avgDurationBeats: 0,
      avgVelocity: 0, velocityRange: [0, 0], durationSeconds: 0,
      notesPerBeat: 0, density: 'unknown', maxPolyphony: 0,
      overlapRatio: 0, articulation: 'unknown', register: 'unknown'
    };
  }

  const pitches = valid.map((note) => note.midi);
  const durations = valid.map((note) => note.duration);
  const velocities = valid.map((note) => note.velocity);
  let pitchMin = 127;
  let pitchMax = 0;
  for (const pitch of pitches) {
    if (pitch < pitchMin) pitchMin = pitch;
    if (pitch > pitchMax) pitchMax = pitch;
  }
  let durationSeconds = 0;
  for (const note of valid) durationSeconds = Math.max(durationSeconds, note.time + note.duration);
  const durationBeats = durationSeconds / beatSeconds;
  const notesPerBeat = valid.length / Math.max(1, durationBeats);
  const avgDurationSeconds = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  const avgVelocity = velocities.reduce((sum, value) => sum + value, 0) / velocities.length;

  // Sweep-line polyphony measurement. Note-off events sort before note-ons at
  // the same timestamp so touching notes are not incorrectly counted as overlap.
  const events = [];
  for (const note of valid) {
    events.push({ time: note.time, delta: 1 });
    events.push({ time: note.time + note.duration, delta: -1 });
  }
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0;
  let maxPolyphony = 0;
  for (const event of events) {
    active += event.delta;
    maxPolyphony = Math.max(maxPolyphony, active);
  }

  const overlappingNotes = valid.filter((note, index) =>
    index < valid.length - 1 && valid[index + 1].time < note.time + note.duration - 1e-6
  ).length;
  const durationRatio = avgDurationSeconds / beatSeconds;
  const density = notesPerBeat > 1.5 ? 'high'
    : notesPerBeat > 0.5 ? 'moderate' : 'sparse';
  const articulation = durationRatio < 0.2 ? 'short'
    : durationRatio > 1.1 ? 'sustained' : 'medium';
  const register = pitchMax < 48 ? 'low'
    : pitchMin >= 72 ? 'high'
    : pitchMin >= 48 && pitchMax < 72 ? 'mid'
    : 'wide';

  const pitchClassHistogram = Array(12).fill(0);
  for (const pitch of pitches) pitchClassHistogram[pitch % 12]++;

  return {
    noteCount: valid.length,
    bpm: safeBpm,
    pitchMin,
    pitchMax,
    pitchMean: round(pitches.reduce((sum, value) => sum + value, 0) / pitches.length, 2),
    pitchMedian: median(pitches),
    pitchSpan: pitchMax - pitchMin,
    pitchClassHistogram,
    avgDurationSeconds: round(avgDurationSeconds, 4),
    medianDurationSeconds: round(median(durations), 4),
    avgDurationBeats: round(avgDurationSeconds / beatSeconds, 3),
    avgVelocity: round(avgVelocity, 3),
    velocityRange: [round(velocities.reduce((min, value) => Math.min(min, value), 1), 3), round(velocities.reduce((max, value) => Math.max(max, value), 0), 3)],
    durationSeconds: round(durationSeconds, 4),
    notesPerBeat: round(notesPerBeat, 3),
    density,
    maxPolyphony,
    overlapRatio: round(overlappingNotes / valid.length, 3),
    articulation,
    register
  };
}

/**
 * Summarize the pitched-track arrangement before patch selection.
 * Percussion MIDI note numbers are kit triggers, not musical pitches, so they
 * are intentionally excluded from register-overlap calculations.
 */
export function analyzeArrangementForSynthesis(tracks, { bpm = 120 } = {}) {
  const summaries = (Array.isArray(tracks) ? tracks : [])
    .filter(track => track?.trackType && track.trackType !== 'percs')
    .map(track => {
      const midi = analyzeMidiForSynthesis(track.notes || [], { bpm });
      return {
        trackType: track.trackType,
        midi: {
          noteCount: midi.noteCount,
          pitchMin: midi.pitchMin,
          pitchMax: midi.pitchMax,
          pitchSpan: midi.pitchSpan,
          register: midi.register,
          density: midi.density,
          articulation: midi.articulation,
          maxPolyphony: midi.maxPolyphony,
          notesPerBeat: midi.notesPerBeat
        }
      };
    });

  const overlaps = [];
  for (let i = 0; i < summaries.length; i++) {
    const a = summaries[i];
    if (!Number.isFinite(a.midi.pitchMin) || !Number.isFinite(a.midi.pitchMax)) continue;
    for (let j = i + 1; j < summaries.length; j++) {
      const b = summaries[j];
      if (!Number.isFinite(b.midi.pitchMin) || !Number.isFinite(b.midi.pitchMax)) continue;
      const shared = Math.max(0, Math.min(a.midi.pitchMax, b.midi.pitchMax) - Math.max(a.midi.pitchMin, b.midi.pitchMin) + 1);
      const narrowerRange = Math.max(1, Math.min(a.midi.pitchSpan + 1, b.midi.pitchSpan + 1));
      const ratio = round(shared / narrowerRange, 3);
      if (ratio >= 0.25) {
        overlaps.push({
          tracks: [a.trackType, b.trackType],
          sharedSemitones: shared,
          overlapRatio: ratio
        });
      }
    }
  }
  return { tracks: summaries, overlaps };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function candidatePreset(base, variant, analysis) {
  const preset = clone(base);
  const patch = preset.patch;
  const role = preset.trackType;
  const currentFilter = patch.filter?.frequency || 2400;

  if (variant === 'warm') {
    if (patch.oscillator) {
      const warmOscillator = role === 'bassline' || role === 'arpeggio' ? 'triangle'
        : role === 'plucks' ? 'square' : 'fatsine';
      patch.oscillator = { type: warmOscillator };
    }
    if (patch.filter) patch.filter.frequency = Math.round(currentFilter * 0.72);
    if (patch.envelope && ['pad-textures', 'strings'].includes(role)) {
      patch.envelope.attack = Math.max(patch.envelope.attack, 0.25);
      patch.envelope.release = Math.max(patch.envelope.release, 1.2);
    }
    preset.rationale = `Warm, rounded ${role} identity with softened upper harmonics and a gentler transient.`;
  } else if (variant === 'bright') {
    if (patch.oscillator) {
      const brightOscillator = ['bassline', 'lead', 'melody'].includes(role) ? 'sawtooth'
        : ['pad-textures', 'strings'].includes(role) ? 'fatsawtooth' : 'square';
      patch.oscillator = brightOscillator.startsWith('fat')
        ? { type: brightOscillator, count: 3, spread: 18 }
        : { type: brightOscillator };
    }
    if (patch.filter) patch.filter.frequency = Math.round(currentFilter * 1.28);
    if (patch.envelope && ['plucks', 'arpeggio'].includes(role)) {
      patch.envelope.attack = Math.min(patch.envelope.attack, 0.008);
      patch.envelope.decay = Math.max(0.08, Math.min(patch.envelope.decay, 0.24));
      patch.envelope.sustain = Math.min(patch.envelope.sustain, 0.12);
    }
    preset.rationale = `Bright, articulate ${role} identity with stronger upper harmonics and a clearer attack.`;
  } else if (variant === 'separated') {
    const adjustWet = (type, factor) => {
      for (const effect of patch.effects || []) {
        if (effect.type === type && Number.isFinite(effect.wet)) {
          effect.wet = round(clamp(effect.wet * factor, 0.01, 0.7));
        }
      }
    };
    if (['pad-textures', 'strings'].includes(role)) {
      if (patch.filter) patch.filter.frequency = Math.round(currentFilter * 0.82);
      adjustWet('Reverb', 0.72);
      adjustWet('Chorus', 0.9);
      patch.volume = (Number.isFinite(patch.volume) ? patch.volume : -16) - 1;
    } else if (['arpeggio', 'plucks', 'guitar'].includes(role)) {
      if (patch.filter) patch.filter.frequency = Math.round(currentFilter * 0.82);
      adjustWet('PingPongDelay', 0.82);
      adjustWet('Delay', 0.82);
      adjustWet('Reverb', 0.82);
      if (patch.envelope) patch.envelope.release = Math.min(patch.envelope.release, 0.22);
    } else if (['lead', 'melody', 'brass'].includes(role)) {
      if (patch.filter) patch.filter.frequency = Math.round(currentFilter * 1.1);
      adjustWet('PingPongDelay', 0.82);
      adjustWet('Delay', 0.82);
      adjustWet('Reverb', 0.82);
    } else if (['chord', 'keys'].includes(role)) {
      if (patch.filter) patch.filter.frequency = Math.round(currentFilter * 0.9);
      adjustWet('Reverb', 0.78);
    }
    preset.rationale = `Focused ${role} alternative with a more deliberate spectral and effects footprint to reduce register masking.`;
  } else {
    preset.rationale = base.rationale;
  }

  // MIDI-informed envelope adaptation is intentionally conservative and only
  // applies to candidate construction, not to the original preset catalogue.
  if (patch.envelope && analysis?.articulation === 'short' && ['lead', 'melody', 'plucks', 'arpeggio'].includes(role)) {
    patch.envelope.release = Math.min(patch.envelope.release, 0.25);
  }
  return preset;
}

/**
 * Return three complete, renderer-ready alternatives for a curated genre/role.
 * The candidates have distinct identities, stable IDs and deterministic output.
 * Unknown genre/role combinations return an empty list (caller keeps legacy path).
 */
export function buildSynthCandidates({ genre, trackType, notes = [], bpm = 120, arrangement = null } = {}) {
  const base = resolvePreset({ genre, trackType });
  if (!base) return [];
  const analysis = Array.isArray(notes) ? analyzeMidiForSynthesis(notes, { bpm }) : notes;
  const overlappingRoles = (arrangement?.overlaps || [])
    .filter(pair => pair.tracks?.includes(trackType))
    .flatMap(pair => pair.tracks.filter(role => role !== trackType));
  const variants = ['core', 'warm', 'bright'];
  if (overlappingRoles.length && trackType !== 'bassline') variants.push('separated');
  return variants.map((variant) => {
    const preset = candidatePreset(base, variant, analysis, overlappingRoles);
    const result = finalizePatch({ preset, midi: { density: analysis?.density === 'high'
      ? 'high (16ths/8ths)' : analysis?.density === 'sparse'
        ? 'sparse (quarters/halves)' : 'moderate (8ths/quarters)' } });
    return {
      id: `${base.id}:${variant}`,
      variant,
      genre: base.genre,
      family: base.family,
      trackType: base.trackType,
      level: base.level,
      overlappingRoles,
      rationale: preset.rationale,
      patch: result.patch,
      warnings: result.warnings
    };
  });
}
