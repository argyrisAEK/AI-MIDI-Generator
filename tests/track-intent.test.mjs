import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getExplicitTrackTypes,
  isWholePercussionExcluded,
  extractExplicitPercussionAvoids,
  resolveTrackTypes
} from '../lib/track-intent.mjs';

test('genre adjectives do not become track requests', () => {
  assert.deepEqual(getExplicitTrackTypes('Melodic techno, dark and atmospheric'), []);
  assert.deepEqual(
    getExplicitTrackTypes('Deep kick, tight snare, closed hi-hats, open hi-hats and sparse claps. Melodic techno.'),
    ['percs']
  );
});

test('explicit arrangement tracks take precedence as an exact list', () => {
  assert.deepEqual(
    getExplicitTrackTypes('Complete arrangement with bassline, melody and a separate percussion track.'),
    ['bassline', 'melody', 'percs']
  );
});

test('bass drum is percussion, not a bassline request', () => {
  assert.deepEqual(getExplicitTrackTypes('Bass drum, snare and hi-hats'), ['percs']);
  assert.deepEqual(getExplicitTrackTypes('Bassline with bass drum and snare'), ['bassline', 'percs']);
});

test('a kick exclusion preserves the percussion track and identifies only the excluded voice', () => {
  const prompt = 'Create bassline, melody and a separate percussion track. No kick drum.';
  assert.deepEqual(getExplicitTrackTypes(prompt), ['bassline', 'melody', 'percs']);
  assert.deepEqual(extractExplicitPercussionAvoids(prompt), ['kick drum']);
  assert.equal(isWholePercussionExcluded(prompt), false);
});

test('explicit exclusion of the entire percussion section is distinguished from one voice', () => {
  assert.equal(isWholePercussionExcluded('Create a bassline without drums'), true);
  assert.equal(isWholePercussionExcluded('Create a percussion track without a kick'), false);
});

test('negative-only instrument mentions are not interpreted as requested tracks', () => {
  assert.deepEqual(getExplicitTrackTypes('No kick drum'), []);
  assert.deepEqual(getExplicitTrackTypes('No bassline; create melody and percussion'), ['melody', 'percs']);
});

test('explicit Describe tracks override Customize and model-inferred tracks', () => {
  const result = resolveTrackTypes({
    prompt: 'Deep kick, snare and hats. Melodic techno.',
    selectedTrackTypes: ['bassline', 'melody'],
    inferredTrackTypes: ['bassline', 'melody', 'pad-textures']
  });
  assert.deepEqual(result.trackTypes, ['percs']);
  assert.equal(result.hasExplicitTrackIntent, true);
});

test('Customize selections are used when Describe does not name tracks', () => {
  const result = resolveTrackTypes({
    prompt: 'Melodic techno, dark and atmospheric.',
    selectedTrackTypes: ['bassline', 'percs'],
    inferredTrackTypes: ['melody', 'pad-textures']
  });
  assert.deepEqual(result.trackTypes, ['bassline', 'percs']);
  assert.equal(result.hasExplicitTrackIntent, false);
  assert.equal(result.hasCustomizeSelection, true);
});

test('model inference is used only when neither Describe nor Customize specifies tracks', () => {
  const result = resolveTrackTypes({
    prompt: 'Melodic techno, dark and atmospheric.',
    selectedTrackTypes: [],
    inferredTrackTypes: ['bassline', 'pad-textures']
  });
  assert.deepEqual(result.trackTypes, ['bassline', 'pad-textures']);
});

test('excluding one drum voice keeps percs while excluding all drums removes percs', () => {
  const oneVoice = resolveTrackTypes({
    prompt: 'Separate percussion track with snare and hats. No kick drum.',
    selectedTrackTypes: ['bassline'],
    inferredTrackTypes: ['melody']
  });
  assert.deepEqual(oneVoice.trackTypes, ['percs']);

  const allDrums = resolveTrackTypes({
    prompt: 'Create bassline without drums.',
    selectedTrackTypes: ['bassline', 'percs'],
    inferredTrackTypes: ['melody']
  });
  assert.deepEqual(allDrums.trackTypes, ['bassline']);
});

test('a negative-only drum voice does not cause inferred percussion, but Customize can still request it', () => {
  const inferred = resolveTrackTypes({
    prompt: 'No kick drum',
    selectedTrackTypes: [],
    inferredTrackTypes: ['bassline', 'percs']
  });
  assert.deepEqual(inferred.trackTypes, ['bassline']);

  const customized = resolveTrackTypes({
    prompt: 'No kick drum',
    selectedTrackTypes: ['percs'],
    inferredTrackTypes: ['bassline']
  });
  assert.deepEqual(customized.trackTypes, ['percs']);
});
