import assert from 'node:assert/strict';
import { getPercussionVoice, midiNoteNumber } from '../lib/percussion-mapping.mjs';

const cases = [
  ['C1', 'kick'],
  ['E2', 'kick'],
  ['F2', 'tom'],
  ['B2', 'tom'],
  ['C3', 'snare'],
  ['D#3', 'snare'],
  ['E3', 'clap'],
  ['G3', 'clap'],
  ['A#3', 'shaker'],
  ['D4', 'closedHat'],
  ['E4', 'openHat'],
  ['B4', 'openHat'],
  ['C5', 'ride'],
  ['G5', 'ride'],
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

console.log(`${cases.length + 5} percussion mapping tests passed`);
