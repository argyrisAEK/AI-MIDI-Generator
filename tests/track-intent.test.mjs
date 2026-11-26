import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getExplicitTrackTypes,
  isWholePercussionExcluded,
  extractExplicitPercussionAvoids
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
