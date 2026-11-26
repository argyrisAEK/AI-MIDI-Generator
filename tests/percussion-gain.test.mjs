import assert from 'node:assert/strict';
import { getPercussionGainPolicy } from '../lib/percussion-gain.mjs';

const policy = getPercussionGainPolicy();
assert.equal(policy.roleOffsetDb, -2);
assert.equal(policy.densityBoostLimitDb, 9);
assert.equal(policy.maxGainDb, 9);
assert.ok(policy.maxGainDb >= policy.densityBoostLimitDb);

console.log('Percussion gain policy tests passed.');
