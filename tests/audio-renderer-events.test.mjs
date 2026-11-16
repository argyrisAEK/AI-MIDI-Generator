import assert from 'node:assert/strict';
import { groupNotesByStartTime } from '../lib/audio-events.mjs';
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓', name); }
test('sorts out-of-order notes into strictly increasing Tone.Part events', () => {
  const events = groupNotesByStartTime([{time:2,name:'G4',duration:.2,velocity:.7},{time:0,name:'C4',duration:.1,velocity:.8},{time:1,name:'E4',duration:.3,velocity:.6}]);
  assert.deepEqual(events.map(e=>e.time),[0,1,2]);
  assert.ok(events.every((e,i)=>i===0||e.time>events[i-1].time));
});
test('groups simultaneous percussion hits without dropping notes', () => {
  const events = groupNotesByStartTime([{time:.5,name:'C2',duration:.08,velocity:.9},{time:.5,name:'D#2',duration:.06,velocity:.6},{time:.5,name:'F#2',duration:.04,velocity:.4},{time:1,name:'C2',duration:.08,velocity:.8}]);
  assert.equal(events.length,2); assert.equal(events[0].notes.length,3);
  assert.deepEqual(events[0].notes.map(n=>n.note),['C2','D#2','F#2']);
  assert.equal(events.reduce((sum,e)=>sum+e.notes.length,0),4);
});
test('preserves simultaneous chord notes and does not mutate input', () => {
  const source=[{time:1.25,name:'C4',duration:1,velocity:.7},{time:1.25,name:'E4',duration:1,velocity:.65},{time:1.25,name:'G4',duration:1,velocity:.6}];
  const events=groupNotesByStartTime(source); assert.equal(events.length,1);
  assert.deepEqual(events[0].notes,source.map(n=>({note:n.name,duration:n.duration,velocity:n.velocity})));
  assert.equal(source.length,3);
});
test('normalizes numeric-string times and handles empty input', () => {
  assert.deepEqual(groupNotesByStartTime([{time:'0.25',name:'C3',duration:.1,velocity:1}]).map(e=>e.time),[.25]);
  assert.deepEqual(groupNotesByStartTime([]),[]);
});
test('rejects invalid and negative start times with note index', () => {
  assert.throws(()=>groupNotesByStartTime([{time:0},{time:NaN}]),/index 1/);
  assert.throws(()=>groupNotesByStartTime([{time:-.1}]),/index 0/);
});
console.log(`\n${passed} audio event tests passed`);
