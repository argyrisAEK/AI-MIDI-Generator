import assert from 'node:assert/strict';
import { groupNotesByStartTime, TONE_PART_PPQ } from '../lib/audio-events.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓', name);
}

const bpm = 120;
const tickSeconds = 60 / (bpm * TONE_PART_PPQ);

test('sorts out-of-order notes into strictly increasing Tone.Part ticks', () => {
  const events = groupNotesByStartTime([
    { time: 2, name: 'G4', duration: 0.2, velocity: 0.7 },
    { time: 0, name: 'C4', duration: 0.1, velocity: 0.8 },
    { time: 1, name: 'E4', duration: 0.3, velocity: 0.6 }
  ], bpm);
  assert.deepEqual(events.map(event => event.time), [0, 1, 2]);
  assert.ok(events.every((event, index) => index === 0 || event.time > events[index - 1].time));
});

test('groups percussion hits that resolve to the same Tone transport tick', () => {
  const events = groupNotesByStartTime([
    { time: 0.5, name: 'C2', duration: 0.08, velocity: 0.9 },
    { time: 0.5005, name: 'D#2', duration: 0.06, velocity: 0.6 },
    { time: 0.501, name: 'F#2', duration: 0.04, velocity: 0.4 },
    { time: 1, name: 'C2', duration: 0.08, velocity: 0.8 }
  ], bpm);
  assert.equal(events.length, 2);
  assert.equal(events[0].notes.length, 3);
  assert.deepEqual(events[0].notes.map(note => note.note), ['C2', 'D#2', 'F#2']);
  assert.equal(events.reduce((sum, event) => sum + event.notes.length, 0), 4);
  assert.ok(events[1].time > events[0].time);
});

test('canonicalizes event times to the Tone tick grid', () => {
  const events = groupNotesByStartTime([
    { time: 0.5001, name: 'C4', duration: 1, velocity: 0.7 },
    { time: 0.5002, name: 'E4', duration: 1, velocity: 0.65 },
    { time: 0.5003, name: 'G4', duration: 1, velocity: 0.6 }
  ], bpm);
  assert.equal(events.length, 1);
  assert.equal(events[0].time, 192 * tickSeconds);
  assert.deepEqual(events[0].notes.map(note => note.note), ['C4', 'E4', 'G4']);
});

test('preserves notes and does not mutate source MIDI data', () => {
  const source = [
    { time: 1.25, name: 'C4', duration: 1, velocity: 0.7 },
    { time: 1.25, name: 'E4', duration: 1, velocity: 0.65 },
    { time: 1.25, name: 'G4', duration: 1, velocity: 0.6 }
  ];
  const snapshot = structuredClone(source);
  const events = groupNotesByStartTime(source, bpm);
  assert.equal(events.length, 1);
  assert.equal(events[0].notes.length, source.length);
  assert.deepEqual(source, snapshot);
});

test('normalizes numeric-string times and handles empty input', () => {
  assert.equal(groupNotesByStartTime([{ time: '0.25', name: 'C3', duration: 0.1, velocity: 1 }], bpm).length, 1);
  assert.deepEqual(groupNotesByStartTime([], bpm), []);
});

test('rejects invalid times, BPM, and PPQ', () => {
  assert.throws(() => groupNotesByStartTime([{ time: NaN }], bpm), /index 0/);
  assert.throws(() => groupNotesByStartTime([{ time: -0.1 }], bpm), /index 0/);
  assert.throws(() => groupNotesByStartTime([{ time: 0 }], 0), /Invalid BPM/);
  assert.throws(() => groupNotesByStartTime([{ time: 0 }], bpm, 0), /Invalid PPQ/);
});

console.log(`\n${passed} audio event tests passed`);
