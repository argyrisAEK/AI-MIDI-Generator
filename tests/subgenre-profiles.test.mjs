import assert from 'node:assert/strict';
import {
  SUBGENRE_PROFILES, SUPPORTED_SUBGENRES, normalizeSubgenre,
  detectSubgenre, getSubgenreProfile
} from '../lib/subgenre-profiles.mjs';

const addedSubgenres = [
  'cyberpunk-industrial', 'uplifting-trance', 'progressive-trance',
  'melodic-trap', 'funk-groove', 'smooth-jazz', 'jazz-fusion',
  'nu-disco', 'liquid-dnb', 'neurofunk', 'chillhop',
  'cinematic-ambient', 'epic-cinematic', 'orchestral'
];
for (const id of addedSubgenres) {
  assert.ok(SUPPORTED_SUBGENRES.includes(id), `missing subgenre profile: ${id}`);
}
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

const ambientCases = [
  ['dark ambient', 'dark-ambient'],
  ['drone ambient', 'drone-ambient'],
  ['ambient drone', 'drone-ambient'],
  ['space ambient', 'space-ambient'],
  ['cosmic ambient', 'space-ambient'],
  ['atmospheric ambient', 'atmospheric-ambient'],
  ['new age', 'new-age'],
  ['organic ambient', 'organic-ambient']
];
for (const [prompt, expected] of ambientCases) {
  assert.equal(detectSubgenre(prompt, 'ambient'), expected, prompt);
  assert.ok(getSubgenreProfile('ambient', expected).length <= 100);
}
assert.equal(normalizeSubgenre('New Age'), 'new-age');
assert.equal(normalizeSubgenre('Space Ambient'), 'space-ambient');
assert.equal(detectSubgenre('Make a dark ambient texture', 'house'), '');
assert.equal(getSubgenreProfile('ambient', 'deep-house'), '');
assert.equal(getSubgenreProfile('house', 'dark-ambient'), '');

const rockCases = [
  ['alternative rock', 'alternative-rock'],
  ['alt rock', 'alternative-rock'],
  ['indie rock', 'indie-rock'],
  ['hard rock', 'hard-rock'],
  ['punk rock', 'punk-rock'],
  ['post-rock', 'post-rock']
];
for (const [prompt, expected] of rockCases) {
  assert.equal(detectSubgenre(prompt, 'rock'), expected, prompt);
  assert.ok(getSubgenreProfile('rock', expected).length <= 100);
}
assert.equal(detectSubgenre('Make post-rock textures', 'pop'), '');
assert.equal(getSubgenreProfile('rock', 'indie-pop'), '');

const downtempoCases = [
  ['trip hop', 'trip-hop'],
  ['trip-hop', 'trip-hop'],
  ['chillout', 'chillout'],
  ['chill out', 'chillout'],
  ['downtempo lounge', 'downtempo-lounge'],
  ['lounge', 'downtempo-lounge'],
  ['IDM', 'idm'],
  ['intelligent dance music', 'idm'],
  ['illbient', 'illbient']
];
for (const [prompt, expected] of downtempoCases) {
  assert.equal(detectSubgenre(prompt, 'downtempo'), expected, prompt);
  assert.ok(getSubgenreProfile('downtempo', expected).length <= 100);
}
assert.equal(detectSubgenre('Make a trip-hop beat', 'rock'), '');
assert.equal(getSubgenreProfile('rock', 'trip-hop'), '');

const popCases = [
  ['synthpop', 'synthpop'],
  ['synth pop', 'synthpop'],
  ['electropop', 'electropop'],
  ['electro-pop', 'electropop'],
  ['dance pop', 'dance-pop'],
  ['indie pop', 'indie-pop'],
  ['dream pop', 'dream-pop']
];
for (const [prompt, expected] of popCases) {
  assert.equal(detectSubgenre(prompt, 'pop'), expected, prompt);
  assert.ok(getSubgenreProfile('pop', expected).length <= 100);
}
assert.equal(detectSubgenre('Make synthpop melodies', 'synthwave'), '');
assert.equal(getSubgenreProfile('pop', 'synthwave'), '');

const synthwaveCases = [
  ['outrun', 'outrun'],
  ['outrun synthwave', 'outrun'],
  ['darksynth', 'darksynth'],
  ['dark synthwave', 'darksynth'],
  ['dreamwave', 'dreamwave'],
  ['retrowave', 'retrowave'],
  ['retro wave', 'retrowave'],
  ['cyberpunk synthwave', 'cyberpunk-synthwave'],
  ['cyberpunk', 'cyberpunk-synthwave']
];
for (const [prompt, expected] of synthwaveCases) {
  assert.equal(detectSubgenre(prompt, 'synthwave'), expected, prompt);
  assert.ok(getSubgenreProfile('synthwave', expected).length <= 100);
}
assert.equal(detectSubgenre('Make a darksynth track', 'pop'), '');
assert.equal(getSubgenreProfile('synthwave', 'dream-pop'), '');

for (const [id, entry] of Object.entries(SUBGENRE_PROFILES)) {
  assert.ok(['house', 'techno', 'hip-hop', 'ambient', 'rock', 'downtempo', 'pop', 'synthwave', 'trance', 'trap', 'funk', 'jazz', 'disco', 'drum-and-bass', 'cinematic', 'classical'].includes(entry.genre), id);
  assert.ok(entry.profile.length > 0 && entry.profile.length <= 100, id);
  assert.equal(normalizeSubgenre(id), id);
}
console.log('subgenre registry: all tests passed');
