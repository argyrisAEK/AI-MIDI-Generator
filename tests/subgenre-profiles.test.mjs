import assert from 'node:assert/strict';
import {
  SUBGENRE_PROFILES, SUPPORTED_SUBGENRES, normalizeSubgenre,
  detectSubgenre, getSubgenreProfile
} from '../lib/subgenre-profiles.mjs';

assert.equal(SUPPORTED_SUBGENRES.length, 9);
assert.equal(normalizeSubgenre('Deep House'), 'deep-house');
assert.equal(normalizeSubgenre('prog_house'), 'progressive-house');
assert.equal(normalizeSubgenre('Melodic Techno'), 'melodic-techno');
assert.equal(normalizeSubgenre('unknown genre'), '');

const houseCases = [
  ['deep house', 'deep-house'],
  ['progressive-house', 'progressive-house'],
  ['prog house', 'progressive-house'],
  ['tech house', 'tech-house'],
  ['soulful house', 'soulful-house'],
  ['afro house', 'afro-house'],
  ['melodic house', 'melodic-house']
];
for (const [prompt, expected] of houseCases) {
  assert.equal(detectSubgenre(prompt, 'house'), expected, prompt);
  assert.ok(getSubgenreProfile('house', expected).length <= 100);
}
assert.equal(detectSubgenre('I want industrial techno', 'techno'), 'industrial-techno');
assert.equal(detectSubgenre('Make a deep house groove', 'techno'), '');
assert.equal(detectSubgenre('Make a deep house groove', 'house'), 'deep-house');
assert.equal(getSubgenreProfile('techno', 'deep-house'), '');
assert.equal(getSubgenreProfile('house', 'melodic-techno'), '');

for (const [id, entry] of Object.entries(SUBGENRE_PROFILES)) {
  assert.ok(['house', 'techno'].includes(entry.genre), id);
  assert.ok(entry.profile.length > 0 && entry.profile.length <= 100, id);
  assert.equal(normalizeSubgenre(id), id);
}
console.log('subgenre registry: all tests passed');
