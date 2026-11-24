import assert from 'node:assert/strict';
import { getPercussionProfile, buildDeterministicPercussionPatch } from '../lib/percussion-profiles.mjs';

const techno = getPercussionProfile('Melodic Techno');
const house = getPercussionProfile('Progressive House');
const trap = getPercussionProfile('Trap');
const rock = getPercussionProfile('Progressive Rock');
const ambient = getPercussionProfile('Ambient');

assert.equal(techno.id, 'techno-tight');
assert.equal(house.id, 'house-groove');
assert.equal(trap.id, 'trap-punch');
assert.equal(rock.id, 'rock-acoustic');
assert.equal(ambient.id, 'ambient-soft');
assert.notEqual(techno.voices.kick.octaves, rock.voices.kick.octaves);
assert.notEqual(techno.voices.closedHat.resonance, house.voices.closedHat.resonance);
assert.notEqual(trap.voices.snare.noise, ambient.voices.snare.noise);
assert.equal(buildDeterministicPercussionPatch('Techno').instrumentType, 'MembraneSynth');
assert.equal(buildDeterministicPercussionPatch('Techno').pan, 0);
assert.deepEqual(buildDeterministicPercussionPatch('Techno').effects, []);
assert.equal(getPercussionProfile('unknown').id, 'electronic-balanced');
console.log('Percussion profile tests passed');
