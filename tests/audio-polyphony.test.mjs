import assert from 'node:assert/strict';
import { getMaxNotePolyphony, getMonoSynthVoiceCount } from '../lib/audio-polyphony.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓', name);
}

test('detects overlapping notes and simultaneous chords', () => {
  const notes = [
    { time: 0, duration: 1 },
    { time: 0.25, duration: 1 },
    { time: 0.5, duration: 0.5 },
    { time: 2, duration: 0.25 },
    { time: 2, duration: 0.25 }
  ];
  assert.equal(getMaxNotePolyphony(notes), 3);
  assert.equal(getMonoSynthVoiceCount(notes), 3);
});

test('treats touching note intervals as monophonic', () => {
  const notes = [
    { time: 0, duration: 0.5 },
    { time: 0.5, duration: 0.5 },
    { time: 1, duration: 0.25 }
  ];
  assert.equal(getMaxNotePolyphony(notes), 1);
  assert.equal(getMonoSynthVoiceCount(notes), 1);
});

test('returns a minimum of one voice for empty or invalid note data', () => {
  assert.equal(getMaxNotePolyphony([]), 0);
  assert.equal(getMaxNotePolyphony([{ time: -1, duration: 1 }, { time: 0, duration: 0 }]), 0);
  assert.equal(getMonoSynthVoiceCount([]), 1);
  assert.equal(getMonoSynthVoiceCount(null), 1);
});

test('ignores malformed notes without losing valid overlap measurements', () => {
  const notes = [
    { time: 0, duration: 0.8 },
    { time: 'invalid', duration: 2 },
    { time: 0.2, duration: 0.8 },
    { time: 0.4, duration: Infinity }
  ];
  assert.equal(getMaxNotePolyphony(notes), 2);
});

test('caps voice allocation to the renderer safety limit', () => {
  const notes = Array.from({ length: 24 }, (_, index) => ({ time: 0, duration: 2 }));
  assert.equal(getMaxNotePolyphony(notes), 24);
  assert.equal(getMonoSynthVoiceCount(notes), 16);
  assert.equal(getMonoSynthVoiceCount(notes, 4), 4);
});

console.log(`\n${passed} export polyphony tests passed`);
