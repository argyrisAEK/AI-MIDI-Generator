import assert from 'node:assert/strict';
import { analyzeMusicalDiagnostics } from '../lib/musical-diagnostics.mjs';

const diagnostics = analyzeMusicalDiagnostics({
  tracks: {
    bass: '38:0:1:8|39:1:1:8|40:2:1:8',
    arp: '50:0:0.5:6|53:0.5:0.5:6|55:1:0.5:6|59:1.5:0.5:6',
    pad: '62:0:4:3|63:4:4:3',
    perc: '36:0:0.5:9|38:1:0.5:8'
  },
  trackCodes: {
    bassline: 'bass',
    arpeggio: 'arp',
    'pad-textures': 'pad',
    percs: 'perc'
  },
  keyPitchClass: 2,
  scaleIntervals: [0, 1, 3, 5, 7, 8, 10]
});

// D Phrygian pitch classes: D, Eb, F, G, A, Bb, C.
assert.deepEqual(diagnostics.perTrack.bassline, {
  notes: 3, outOfScale: 1, scaleConformityPercent: 66.7
});
assert.deepEqual(diagnostics.perTrack.arpeggio, {
  notes: 4, outOfScale: 0, scaleConformityPercent: 100
});
assert.deepEqual(diagnostics.perTrack['pad-textures'], {
  notes: 2, outOfScale: 1, scaleConformityPercent: 50
});
assert.equal(Object.hasOwn(diagnostics.perTrack, 'percs'), false);
assert.equal(diagnostics.totalNotes, 9);
assert.equal(diagnostics.outOfScale, 2);
assert.equal(diagnostics.scaleConformityPercent, 77.8);

// Empty pitched tracks are represented as 100% by convention, without affecting totals.
const empty = analyzeMusicalDiagnostics({
  tracks: { bass: '' },
  trackCodes: { bassline: 'bass' },
  keyPitchClass: 0,
  scaleIntervals: [0, 2, 4, 5, 7, 9, 11]
});
assert.equal(empty.totalNotes, 0);
assert.equal(empty.scaleConformityPercent, 100);
assert.equal(empty.perTrack.bassline.notes, 0);

console.log('musical diagnostics: all tests passed');
