import assert from 'node:assert/strict';
import { normalizeMusicalIntent } from '../lib/musical-intent.mjs';

const intent = normalizeMusicalIntent({
  artistReferences: ['Reference Artist', 'Reference Artist', 42, 'Second Reference'],
  rhythmicFeel: '  hypnotic   syncopation ',
  noteLength: 'mostly sustained notes with short pickups',
  trackInstructions: {
    bassline: 'Use long root notes with occasional octave accents',
    drums: 'Ignore this unsupported track',
    melody: '  sparse call and response  '
  },
  ignoredField: 'must not pass through'
});
assert.deepEqual(intent.artistReferences, ['Reference Artist', 'Second Reference']);
assert.equal(intent.rhythmicFeel, 'hypnotic syncopation');
assert.equal(intent.noteLength, 'mostly sustained notes with short pickups');
assert.equal(intent.trackInstructions.bassline, 'Use long root notes with occasional octave accents');
assert.equal(intent.trackInstructions.melody, 'sparse call and response');
assert.equal(Object.hasOwn(intent.trackInstructions, 'drums'), false);
assert.equal(Object.hasOwn(intent, 'ignoredField'), false);

const empty = normalizeMusicalIntent(null);
assert.deepEqual(empty.artistReferences, []);
assert.deepEqual(empty.trackInstructions, {});
console.log('musical intent normalization: all tests passed');
