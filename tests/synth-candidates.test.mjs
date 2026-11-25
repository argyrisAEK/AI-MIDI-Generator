import assert from 'node:assert/strict';
import { analyzeMidiForSynthesis, analyzeArrangementForSynthesis, buildSynthCandidates } from '../lib/synth-candidates.mjs';
import { TRACK_RULES, FAMILY_RULES, GENRE_FAMILY, resolvePreset } from '../lib/synth-presets.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (error) { console.error('  ✗', name, error); process.exitCode = 1; }
};
const notes = [
  { midi: 36, time: 0, duration: 0.25, velocity: 0.8 },
  { midi: 48, time: 0.25, duration: 0.25, velocity: 0.7 },
  { midi: 60, time: 0.5, duration: 0.75, velocity: 0.9 },
  { midi: 64, time: 0.5, duration: 0.5, velocity: 0.6 }
];

test('MIDI analysis reports register, pitch classes, articulation and polyphony', () => {
  const result = analyzeMidiForSynthesis(notes, { bpm: 120 });
  assert.equal(result.noteCount, 4);
  assert.equal(result.pitchMin, 36);
  assert.equal(result.pitchMax, 64);
  assert.equal(result.pitchSpan, 28);
  assert.equal(result.maxPolyphony, 2);
  assert.equal(result.register, 'wide');
  assert.equal(result.pitchClassHistogram[0], 3);
  assert.ok(result.avgVelocity > 0.7 && result.avgVelocity < 0.8);
});

test('touching notes do not count as overlapping voices', () => {
  const result = analyzeMidiForSynthesis([
    { midi: 48, time: 0, duration: 0.5, velocity: 0.8 },
    { midi: 50, time: 0.5, duration: 0.5, velocity: 0.8 }
  ], { bpm: 120 });
  assert.equal(result.maxPolyphony, 1);
  assert.equal(result.overlapRatio, 0);
});

test('invalid MIDI events are ignored and empty input has safe defaults', () => {
  const result = analyzeMidiForSynthesis([
    { midi: 200, time: 0, duration: 1 },
    { midi: 60, time: -1, duration: 1 },
    { midi: 62, time: 1, duration: 0 }
  ]);
  assert.equal(result.noteCount, 0);
  assert.equal(result.density, 'unknown');
  assert.equal(result.maxPolyphony, 0);
});

test('arrangement analysis detects meaningful pitched-register overlap and ignores percussion triggers', () => {
  const arrangement = analyzeArrangementForSynthesis([
    { trackType: 'lead', notes: [{ midi: 64, time: 0, duration: 1 }, { midi: 67, time: 1, duration: 1 }] },
    { trackType: 'arpeggio', notes: [{ midi: 65, time: 0, duration: 0.2 }, { midi: 72, time: 0.5, duration: 0.2 }] },
    { trackType: 'bassline', notes: [{ midi: 32, time: 0, duration: 0.5 }, { midi: 36, time: 1, duration: 0.5 }] },
    { trackType: 'percs', notes: [{ midi: 36, time: 0, duration: 0.2 }] }
  ]);
  assert.ok(arrangement.overlaps.some(pair => pair.tracks.includes('lead') && pair.tracks.includes('arpeggio')));
  assert.ok(!arrangement.tracks.some(track => track.trackType === 'percs'));
  assert.ok(!arrangement.overlaps.some(pair => pair.tracks.includes('bassline') && pair.tracks.includes('lead')));
});

test('overlapping roles receive a complementary separated candidate', () => {
  const arrangement = analyzeArrangementForSynthesis([
    { trackType: 'lead', notes: [{ midi: 64, time: 0, duration: 1 }, { midi: 67, time: 1, duration: 1 }] },
    { trackType: 'arpeggio', notes: [{ midi: 65, time: 0, duration: 0.2 }, { midi: 72, time: 0.5, duration: 0.2 }] }
  ]);
  const bassCandidates = buildSynthCandidates({
    genre: 'techno',
    trackType: 'bassline',
    notes: [{ midi: 36, time: 0, duration: 0.5 }],
    arrangement
  });
  assert.ok(!bassCandidates.some(candidate => candidate.variant === 'separated'));
  const candidates = buildSynthCandidates({
    genre: 'techno',
    trackType: 'arpeggio',
    notes: [{ midi: 65, time: 0, duration: 0.2 }, { midi: 72, time: 0.5, duration: 0.2 }],
    arrangement
  });
  const separated = candidates.find(candidate => candidate.variant === 'separated');
  assert.ok(separated);
  assert.ok(separated.overlappingRoles.includes('lead'));
  assert.ok(separated.patch.filter.frequency < candidates.find(candidate => candidate.variant === 'core').patch.filter.frequency);
});

test('candidate catalogue returns stable, distinct complete patches', () => {
  const candidates = buildSynthCandidates({ genre: 'techno', trackType: 'lead', notes, bpm: 120 });
  assert.deepEqual(candidates.map((candidate) => candidate.variant), ['core', 'warm', 'bright']);
  assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 3);
  assert.equal(new Set(candidates.map((candidate) => candidate.patch.oscillator.type)).size, 3);
  for (const candidate of candidates) {
    const patch = candidate.patch;
    assert.equal(patch.instrumentType, 'MonoSynth');
    assert.ok(patch.filterEnvelope);
    assert.ok(patch.volume >= TRACK_RULES.lead.vol[0] - 6 && patch.volume <= TRACK_RULES.lead.vol[1]);
    assert.ok(patch.pan >= TRACK_RULES.lead.pan[0] && patch.pan <= TRACK_RULES.lead.pan[1]);
    assert.ok(patch.designRationale.length > 0);
    for (const effect of patch.effects) {
      assert.ok(!FAMILY_RULES[candidate.family].forbidFx.includes(effect.type));
    }
  }
});

test('every supported genre has a curated polyphonic melody preset and candidates', () => {
  for (const genre of Object.keys(GENRE_FAMILY)) {
    const preset = resolvePreset({ genre, trackType: 'melody' });
    assert.ok(preset, `missing melody preset for ${genre}`);
    assert.equal(preset.trackType, 'melody');
    assert.equal(preset.patch.instrumentType, 'PolySynth');
    assert.equal(preset.patch.filterEnvelope, undefined);
    assert.equal(preset.patch.portamento, undefined);
    assert.equal(preset.patch.pan, 0);
    assert.ok(preset.patch.volume >= TRACK_RULES.melody.vol[0] - 6);
    assert.ok(preset.patch.volume <= TRACK_RULES.melody.vol[1]);

    const candidates = buildSynthCandidates({ genre, trackType: 'melody', notes });
    assert.equal(candidates.length, 3, `unexpected candidate count for ${genre}`);
    for (const candidate of candidates) {
      assert.equal(candidate.patch.instrumentType, 'PolySynth');
      assert.equal(candidate.patch.filterEnvelope, undefined);
      assert.equal(candidate.patch.portamento, undefined);
      if (candidate.patch.oscillator.type.startsWith('fat')) {
        assert.equal(candidate.patch.oscillator.count, 2);
        assert.ok(candidate.patch.oscillator.spread <= 22);
      }
      for (const effect of candidate.patch.effects) {
        assert.ok(!FAMILY_RULES[candidate.family].forbidFx.includes(effect.type));
      }
    }
  }
});


test('every supported genre has safe, family-aware keys and chord presets', () => {
  for (const genre of Object.keys(GENRE_FAMILY)) {
    for (const trackType of ['keys', 'chord']) {
      const preset = resolvePreset({ genre, trackType });
      assert.ok(preset, `missing ${trackType} preset for ${genre}`);
      assert.equal(preset.trackType, trackType);
      assert.equal(preset.patch.instrumentType, 'PolySynth');
      assert.equal(preset.patch.filterEnvelope, undefined);
      assert.equal(preset.patch.portamento, undefined);
      assert.equal(preset.patch.pan, 0);
      assert.ok(preset.patch.volume >= TRACK_RULES[trackType].vol[0] - 6);
      assert.ok(preset.patch.volume <= TRACK_RULES[trackType].vol[1]);

      const candidates = buildSynthCandidates({ genre, trackType, notes });
      assert.equal(candidates.length, 3, `unexpected candidate count for ${genre}/${trackType}`);
      for (const candidate of candidates) {
        assert.equal(candidate.patch.instrumentType, 'PolySynth');
        assert.equal(candidate.patch.filterEnvelope, undefined);
        assert.equal(candidate.patch.portamento, undefined);
        assert.ok(candidate.patch.pan >= TRACK_RULES[trackType].pan[0]);
        assert.ok(candidate.patch.pan <= TRACK_RULES[trackType].pan[1]);
        if (candidate.patch.oscillator.type.startsWith('fat')) {
          assert.ok(candidate.patch.oscillator.count <= 2);
          assert.ok(candidate.patch.oscillator.spread <= 20);
        }
        for (const effect of candidate.patch.effects) {
          assert.ok(!FAMILY_RULES[candidate.family].forbidFx.includes(effect.type));
          if (effect.type === 'Reverb') {
            assert.ok(effect.wet <= FAMILY_RULES[candidate.family].maxReverbWet);
          }
        }
      }
    }
  }
});

test('pad candidates preserve sustained articulation and valid oscillator stacks', () => {
  const candidates = buildSynthCandidates({
    genre: 'ambient',
    trackType: 'pad-textures',
    notes: [{ midi: 60, time: 0, duration: 3, velocity: 0.6 }]
  });
  assert.equal(candidates.length, 3);
  for (const candidate of candidates) {
    assert.equal(candidate.patch.instrumentType, 'PolySynth');
    assert.ok(candidate.patch.envelope.attack >= 0.12);
    assert.ok(candidate.patch.envelope.release >= 0.6);
    if (candidate.patch.oscillator.type.startsWith('fat')) {
      assert.ok(candidate.patch.oscillator.count >= 2);
      assert.ok(candidate.patch.oscillator.spread >= 10);
    }
  }
});

test('unsupported genre/track pairs retain the legacy fallback signal', () => {
  assert.deepEqual(buildSynthCandidates({ genre: 'unmapped-style', trackType: 'plucks' }), []);
});

console.log(`\n${passed} MIDI intelligence / candidate tests passed`);
