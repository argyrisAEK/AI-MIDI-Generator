import assert from 'node:assert/strict';
import { getPercussionVoice, midiNoteNumber } from '../lib/percussion-mapping.mjs';

const cases = [
  // Common General MIDI percussion note numbers.
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
  [72, 'shaker'],
  // Equivalent pitch names are used by Tone.js Preview (note.name).
  ['C2', 'kick'],       // 36
  ['D2', 'snare'],      // 38
  ['D#2', 'clap'],      // 39
  ['F#2', 'closedHat'], // 42
  ['A#2', 'openHat'],   // 46
  ['C5', 'shaker'],     // 72
  ['A5', 'ride'],       // 81
];

for (const [note, expected] of cases) {
  assert.equal(getPercussionVoice(note), expected, `${note} should map to ${expected}`);
}
assert.equal(midiNoteNumber('C4'), 60);
assert.equal(midiNoteNumber('C#4'), 61);
assert.equal(midiNoteNumber('Db4'), 61);
assert.equal(midiNoteNumber(36), 36);
// Unsupported, missing and out-of-range pitches must never invent a drum voice.
assert.equal(getPercussionVoice('not-a-note'), null);
assert.equal(getPercussionVoice(null), null);
assert.equal(getPercussionVoice(0), null);
assert.equal(getPercussionVoice(34), null);
assert.equal(getPercussionVoice(82), null);
assert.equal(getPercussionVoice('C1'), null);
assert.equal(getPercussionVoice(127), null);

console.log(`${cases.length + 5} percussion mapping tests passed`);
