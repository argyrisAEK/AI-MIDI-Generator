import assert from 'node:assert/strict';
import { measureStereoImage } from '../lib/stereo-metrics.mjs';

const mono = measureStereoImage([1, 0.5, -0.5, -1], [1, 0.5, -0.5, -1]);
assert.equal(mono.correlation, 1);
assert.equal(mono.widthPercent, 0);
assert.equal(mono.sideToMidDb, -Infinity);

const anti = measureStereoImage([1, 0.5, -0.5, -1], [-1, -0.5, 0.5, 1]);
assert.equal(anti.correlation, -1);
assert.equal(anti.widthPercent, 100);
assert.equal(anti.sideToMidDb, Infinity);

const wide = measureStereoImage([1, 0.5, -0.5, -1], [0, 0, 0, 0]);
assert.equal(wide.correlation, 0);
assert.ok(Math.abs(wide.sideToMidDb - 0) < 1e-10);
assert.ok(Math.abs(wide.widthPercent - 50) < 1e-10);

assert.equal(measureStereoImage([1], []).correlation, null);
assert.equal(measureStereoImage([], []).widthPercent, null);
console.log('8 stereo image tests passed');
