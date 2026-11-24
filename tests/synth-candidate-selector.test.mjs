import assert from 'node:assert/strict';
import { buildSynthCandidates } from '../lib/synth-candidates.mjs';
import { buildCandidateSelectionRequest, resolveCandidateSelections } from '../lib/synth-candidate-selector.mjs';

const notes = [
  { midi: 36, time: 0, duration: 0.4, velocity: 0.8 },
  { midi: 48, time: 0.5, duration: 0.3, velocity: 0.7 },
  { midi: 60, time: 1, duration: 0.8, velocity: 0.65 }
];
const tracks = ['bassline', 'lead', 'pad-textures'].map(trackType => ({
  trackType,
  notes,
  candidates: buildSynthCandidates({ genre: 'techno', trackType, notes, bpm: 124 })
}));

const request = buildCandidateSelectionRequest({
  genre: 'techno',
  subgenre: 'hypnotic techno',
  mood: 'dark',
  key: 'A',
  scale: 'minor',
  bpm: 124,
  brief: { userPrompt: 'A restrained, evolving late-night arrangement.' },
  direction: 'Hypnotic and restrained.',
  tracks
});

assert.equal(request.trackOptions.length, 3);
assert.match(request.system, /whole arrangement together/i);
assert.match(request.user, /hypnotic techno/);
assert.match(request.user, /A restrained, evolving late-night arrangement/);
assert.match(request.user, /bassline/);
assert.match(request.user, /pad-textures/);
assert.match(request.system, /modify synth parameters/i);

const validRaw = {
  selections: {
    bassline: tracks[0].candidates[1].id,
    lead: tracks[1].candidates[2].id,
    'pad-textures': 'made-up-id'
  },
  rationale: 'Keep the bass warm and the lead bright.'
};
const resolved = resolveCandidateSelections(validRaw, tracks);
assert.equal(resolved.bassline.candidate.variant, 'warm');
assert.equal(resolved.bassline.selectedBy, 'llm');
assert.equal(resolved.lead.candidate.variant, 'bright');
assert.equal(resolved.lead.selectedBy, 'llm');
assert.equal(resolved['pad-textures'].candidate.variant, 'core');
assert.equal(resolved['pad-textures'].selectedBy, 'fallback');

const empty = resolveCandidateSelections({}, tracks);
for (const track of tracks) {
  assert.equal(empty[track.trackType].candidate.variant, 'core');
  assert.equal(empty[track.trackType].selectedBy, 'fallback');
}

console.log('✓ arrangement-aware candidate selection and fallback tests passed');
