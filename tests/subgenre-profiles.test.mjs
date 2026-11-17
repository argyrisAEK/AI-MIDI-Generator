import assert from 'node:assert/strict';
import {
  SUBGENRE_PROFILES, SUPPORTED_SUBGENRES, normalizeSubgenre,
  detectSubgenre, getSubgenreProfile
} from '../lib/subgenre-profiles.mjs';

assert.equal(SUPPORTED_SUBGENRES.length, 15);
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

const hipHopCases = [
  ['boom bap', 'boom-bap'],
  ['boombap', 'boom-bap'],
  ['trap', 'trap-hip-hop'],
  ['trap hip-hop', 'trap-hip-hop'],
  ['jazz rap', 'jazz-rap'],
  ['lo-fi hip-hop', 'lo-fi-hip-hop'],
  ['lofi hip hop', 'lo-fi-hip-hop'],
  ['drill', 'drill'],
  ['UK drill', 'drill'],
  ['west coast hip hop', 'west-coast-hip-hop'],
  ['west coast rap', 'west-coast-hip-hop']
];
for (const [prompt, expected] of hipHopCases) {
  assert.equal(detectSubgenre(prompt, 'hip-hop'), expected, prompt);
  assert.ok(getSubgenreProfile('hip-hop', expected).length <= 100);
}
assert.equal(normalizeSubgenre('Trap'), 'trap-hip-hop');
assert.equal(normalizeSubgenre('West Coast Rap'), 'west-coast-hip-hop');
assert.equal(detectSubgenre('Make a drill beat', 'house'), '');
assert.equal(getSubgenreProfile('hip-hop', 'deep-house'), '');
assert.equal(getSubgenreProfile('house', 'boom-bap'), '');

for (const [id, entry] of Object.entries(SUBGENRE_PROFILES)) {
  assert.ok(['house', 'techno', 'hip-hop'].includes(entry.genre), id);
  assert.ok(entry.profile.length > 0 && entry.profile.length <= 100, id);
  assert.equal(normalizeSubgenre(id), id);
}
console.log('subgenre registry: all tests passed');
