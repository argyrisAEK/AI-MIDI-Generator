import assert from 'node:assert/strict';
import { getPercussionVoice, midiNoteNumber } from '../lib/percussion-mapping.mjs';

const cases = [
  // Common General MIDI percussion notes used by generated drum patterns.
  [36, 'kick'],
  [38, 'snare'],
  [39, 'clap'],
  [42, 'closedHat'],
  [46, 'openHat'],
  [35, 'kick'],
  [37, 'snare'],
  [40, 'snare'],
  [41, 'tom'],
  [44, 'closedHat'],
  [49, 'crash'],
  [51, 'ride'],
  [54, 'shaker'],
  [56, 'ride'],
  [59, 'ride'],
  // Legacy/custom pitch ranges remain supported outside mapped GM notes.
  ['C1', 'kick'],
  ['F2', 'tom'],
  ['C5', 'ride'],
  ['A5', 'crash']
];

for (const [note, expected] of cases) {
  assert.equal(getPercussionVoice(note), expected, `${note} should map to ${expected}`);
}
assert.equal(midiNoteNumber('C4'), 60);
assert.equal(midiNoteNumber('C#4'), 61);
assert.equal(midiNoteNumber('Db4'), 61);
assert.equal(midiNoteNumber(36), 36);
assert.equal(getPercussionVoice(36), 'kick');
assert.equal(getPercussionVoice('not-a-note'), 'snare');
assert.equal(getPercussionVoice(36), 'kick');
assert.equal(getPercussionVoice(38), 'snare');
assert.equal(getPercussionVoice(39), 'clap');
assert.equal(getPercussionVoice(42), 'closedHat');
assert.equal(getPercussionVoice(46), 'openHat');

console.log(`${cases.length + 5} percussion mapping tests passed`);
