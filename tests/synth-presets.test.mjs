// Run with: node _synth-presets.test.mjs
import assert from 'node:assert/strict';
import { resolvePreset, listPresets, knobDefaults, sanitizeVariation, applyVariation, finalizePatch, buildVariationPrompt,
         normalizeGenre, normalizeTrack, TRACK_RULES, FAMILY_RULES, PRESET_PIPELINE_LEVELS } from '../lib/synth-presets.js';
import { buildSystemPrompt } from '../api/synthesize.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };
const OSC = ['sine','square','triangle','sawtooth','fatsine','fatsquare','fatsawtooth','pwm','fmsine','fmsquare','fmsawtooth'];
const FX = ['Distortion','Chebyshev','BitCrusher','AutoFilter','Chorus','Phaser','Tremolo','PingPongDelay','Delay','Reverb'];
const FILTERS = ['lowpass','highpass','bandpass','notch'];
function assertValidPatch(p, trackType, label) {
  const r = TRACK_RULES[trackType];
  assert.ok(['MonoSynth','PolySynth','FMSynth','AMSynth','MembraneSynth','MetalSynth'].includes(p.instrumentType), `${label}: instrumentType`);
  assert.ok(OSC.includes(p.oscillator.type), `${label}: osc ${p.oscillator.type}`);
  if (!p.oscillator.type.startsWith('fat')) assert.ok(!('count' in p.oscillator) && !('spread' in p.oscillator), `${label}: count/spread on non-fat`);
  else assert.ok(p.oscillator.count >= 2 && p.oscillator.spread >= 10, `${label}: fat needs count+spread`);
  if (p.oscillator.type === 'pwm') assert.ok(p.oscillator.modulationFrequency > 0, `${label}: pwm needs modulationFrequency`);
  const e = p.envelope;
  assert.ok(e.attack >= 0.001 && e.decay >= 0.01 && e.sustain >= 0 && e.sustain <= 1 && e.release >= 0.01, `${label}: envelope`);
  if (p.instrumentType !== 'MonoSynth') assert.ok(!p.filterEnvelope && !('portamento' in p), `${label}: mono-only keys`);
  assert.ok(FILTERS.includes(p.filter.type) && p.filter.frequency >= 100 && p.filter.frequency <= 18000 && p.filter.Q >= 0.1 && p.filter.Q <= 10, `${label}: filter`);
  if (['bassline','lead'].includes(trackType)) assert.ok(p.instrumentType === 'MonoSynth' && p.filterEnvelope && Number.isFinite(p.portamento), `${label}: required MonoSynth settings`);
  assert.ok(p.pan >= r.pan[0] && p.pan <= r.pan[1], `${label}: pan ${p.pan}`);
  assert.ok(p.volume >= r.vol[0] - 6 && p.volume <= r.vol[1], `${label}: volume ${p.volume}`);
  for (const fx of p.effects) { assert.ok(FX.includes(fx.type), `${label}: fx ${fx.type}`); assert.ok(Number.isFinite(fx.wet) && fx.wet >= 0.01 && fx.wet <= 0.7, `${label}: wet`); }
  const order = p.effects.map(f => FX.indexOf(f.type)); assert.deepEqual(order, [...order].sort((a,b)=>a-b), `${label}: fx order`);
  assert.ok(typeof p.designRationale === 'string' && p.designRationale.split(/\s+/).length <= 30, `${label}: rationale`);
}

console.log('resolver');
test('genre/track aliases', () => {
  assert.equal(normalizeGenre('Progressive Rock'), 'progressive-rock'); assert.equal(normalizeGenre('prog rock'), 'progressive-rock');
  assert.equal(normalizeTrack('Pad'), 'pad-textures'); assert.equal(normalizeTrack('pluck'), 'plucks');
});
test('covered genre/track → level genre', () => {
  for (const [g, t] of [['techno','plucks'],['techno','pad-textures'],['techno','bassline'],['techno','strings'],['progressive-rock','arpeggio'],['progressive rock','lead'],['progressive-rock','strings']]) {
    const r = resolvePreset({ genre: g, trackType: t }); assert.ok(r, `${g}/${t}`); assert.equal(r.level, 'genre'); assert.ok(PRESET_PIPELINE_LEVELS.has(r.level));
  }
});
test('family-level presets are active for every mapped genre; unknown genre/track → null', () => {
  assert.ok(PRESET_PIPELINE_LEVELS.has('family'));
  for (const genre of ['house', 'trance', 'drum-and-bass', 'synthwave', 'rock', 'ambient', 'cinematic', 'electronic', 'trap', 'hip-hop', 'funk', 'disco', 'reggae', 'jazz', 'classical', 'pop', 'downtempo']) {
    for (const trackType of ['bassline', 'lead', 'arpeggio', 'plucks', 'pad-textures', 'strings']) {
      const preset = resolvePreset({ genre, trackType });
      assert.ok(preset, `${genre}/${trackType} should resolve`);
      assert.equal(preset.level, 'family');
      assert.ok(PRESET_PIPELINE_LEVELS.has(preset.level));
    }
  }
  assert.equal(resolvePreset({ genre: 'unmapped-style', trackType: 'plucks' }), null);
  assert.equal(resolvePreset({ genre: 'unknown-style', trackType: 'strings' }), null);
});
test('strings presets are sustained PolySynth layers with family-specific reverb caps', () => {
  const techno = resolvePreset({ genre: 'techno', trackType: 'strings' });
  const prog = resolvePreset({ genre: 'progressive-rock', trackType: 'strings' });
  const house = resolvePreset({ genre: 'house', trackType: 'strings' });
  const rock = resolvePreset({ genre: 'rock', trackType: 'strings' });
  for (const p of [techno, prog, house, rock]) {
    assert.equal(p.patch.instrumentType, 'PolySynth');
    assert.ok(!p.patch.filterEnvelope && !('portamento' in p.patch));
    assert.deepEqual(p.patch.envelope, { attack: 0.75, decay: 1.4, sustain: 0.78, release: 2.6 });
    assert.equal(p.patch.oscillator.type, 'fatsawtooth');
    assert.equal(p.patch.oscillator.count, 3);
    const { patch } = finalizePatch({ preset: p });
    assertValidPatch(patch, 'strings', p.id);
    const reverb = findFx(patch, 'Reverb');
    assert.ok(reverb.wet <= (p.family === 'band' ? 0.3 : 0.5));
  }
  assert.equal(techno.level, 'genre');
  assert.equal(prog.level, 'genre');
  assert.equal(house.level, 'family');
  assert.equal(rock.level, 'family');
});
test('ambient, cinematic and electronic families retain distinct synthesis constraints', () => {
  const ambientPad = resolvePreset({ genre: 'ambient', trackType: 'pad-textures' });
  const cinematicStrings = resolvePreset({ genre: 'cinematic', trackType: 'strings' });
  const electronicLead = resolvePreset({ genre: 'electronic', trackType: 'lead' });
  assert.equal(ambientPad.family, 'ambient');
  assert.equal(ambientPad.patch.instrumentType, 'PolySynth');
  assert.ok(ambientPad.patch.envelope.attack >= 0.8 && ambientPad.patch.envelope.release >= 4);
  assert.ok(!ambientPad.patch.effects.some(e => ['Distortion', 'Chebyshev', 'BitCrusher', 'AutoFilter'].includes(e.type)));
  assert.ok(findFx(finalizePatch({ preset: ambientPad }).patch, 'Reverb').wet <= 0.7);
  assert.equal(cinematicStrings.family, 'cinematic');
  assert.equal(cinematicStrings.patch.instrumentType, 'PolySynth');
  assert.ok(cinematicStrings.patch.envelope.release >= 4);
  assert.ok(findFx(finalizePatch({ preset: cinematicStrings }).patch, 'Reverb').wet <= 0.65);
  assert.equal(electronicLead.family, 'electronic');
  assert.equal(electronicLead.patch.instrumentType, 'MonoSynth');
  assert.ok(electronicLead.patch.filterEnvelope && Number.isFinite(electronicLead.patch.portamento));
  assert.equal(ambientPad.level, 'family');
  assert.equal(cinematicStrings.level, 'family');
  assert.equal(electronicLead.level, 'family');
});
test('urban, groove, roots, jazz, orchestral, pop and downtempo families cover six tracks with distinct rules', () => {
  const familyGenres = {
    urban: ['trap', 'hip-hop'],
    groove: ['funk', 'disco'],
    roots: ['reggae'],
    jazz: ['jazz'],
    orchestral: ['classical'],
    pop: ['pop'],
    downtempo: ['downtempo']
  };
  for (const [family, genres] of Object.entries(familyGenres)) {
    assert.ok(FAMILY_RULES[family], `${family} must declare deterministic FX rules`);
    for (const genre of genres) for (const trackType of ['bassline', 'lead', 'arpeggio', 'plucks', 'pad-textures', 'strings']) {
      const preset = resolvePreset({ genre, trackType });
      assert.ok(preset, `${genre}/${trackType} resolves`);
      assert.equal(preset.family, family);
      assert.equal(preset.level, 'family');
      const { patch } = finalizePatch({ preset });
      assertValidPatch(patch, trackType, preset.id);
      assert.ok(!patch.effects.some(fx => FAMILY_RULES[family].forbidFx.includes(fx.type)), `${preset.id} forbidden FX`);
      const room = findFx(patch, 'Reverb');
      if (room) assert.ok(room.wet <= FAMILY_RULES[family].maxReverbWet, `${preset.id} reverb ceiling`);
    }
  }
});
test('genre overrides take precedence over active family bases', () => {
  const house = resolvePreset({ genre: 'house', trackType: 'bassline' }), techno = resolvePreset({ genre: 'techno', trackType: 'bassline' });
  assert.equal(house.level, 'family');
  assert.equal(techno.level, 'genre');
  assert.ok(PRESET_PIPELINE_LEVELS.has(house.level));
  assert.ok(PRESET_PIPELINE_LEVELS.has(techno.level));
  assert.notEqual(house.patch.filter.frequency, techno.patch.filter.frequency);
  assert.equal(techno.patch.oscillator.type, 'sawtooth');              // inherited
  const prog = resolvePreset({ genre: 'progressive-rock', trackType: 'bassline' });
  assert.notDeepEqual(prog.patch.effects, techno.patch.effects);
});

const all = listPresets();
console.log(`presets (${all.length} resolved incl. family level)`);
test('every preset: baseline patch is valid after finalize', () => {
  for (const p of all) { const { patch } = finalizePatch({ preset: p }); assertValidPatch(patch, p.trackType, p.id); }
});
test('every preset: preset values sit inside their own knob ranges', () => {
  for (const p of all) for (const [n, d] of Object.entries(knobDefaults(p))) if ('inRange' in d) assert.ok(d.inRange, `${p.id}.${n} default ${d.value} outside range`);
});
test('every knob at 0 and 1 (all together) still yields a valid patch', () => {
  for (const p of all) for (const pos of [0, 1]) {
    const raw = Object.fromEntries(Object.entries(p.vary).filter(([, s]) => !s.choice).map(([n]) => [n, pos]));
    const v = sanitizeVariation(p, raw); const { patch } = finalizePatch({ preset: p, variation: v }); assertValidPatch(patch, p.trackType, `${p.id}@${pos}`);
  }
});
test('oscillator choices keep patches consistent (fat ↔ non-fat, pwm)', () => {
  for (const p of all) { const spec = p.vary.osc; if (!spec) continue;
    for (const opt of spec.options) { const { patch } = finalizePatch({ preset: p, variation: sanitizeVariation(p, { osc: opt }) }); assertValidPatch(patch, p.trackType, `${p.id}:${opt}`); assert.equal(patch.oscillator.type, opt); } }
});

console.log('variation + rules');
test('sanitizeVariation drops unknown keys, clamps, restricts choices', () => {
  const p = resolvePreset({ genre: 'techno', trackType: 'plucks' });
  const v = sanitizeVariation(p, { brightness: 9, punch: '0.4', hack: 1, osc: 'fmsawtooth', echo: 'x', rationale: 'a '.repeat(60) });
  assert.equal(v.knobs.brightness, 1); assert.equal(v.knobs.punch, 0.4); assert.ok(!('hack' in v.knobs) && !('echo' in v.knobs));
  assert.deepEqual(v.choices, {}); assert.ok(v.rationale.split(' ').length <= 30);
  assert.deepEqual(sanitizeVariation(p, null), { knobs: {}, choices: {}, rationale: '' });
  assert.deepEqual(sanitizeVariation(p, 'garbage').knobs, {});
});
test('variation is limited to four knobs', () => {
  const p = resolvePreset({ genre: 'techno', trackType: 'plucks' });
  const v = sanitizeVariation(p, { brightness: 1, punch: 1, echo: 1, space: 1, osc: 'square', level: 1 });
  assert.equal(Object.keys(v.knobs).length + Object.keys(v.choices).length, 4);
  assert.ok(!('level' in v.knobs));
});
test('brightness knob moves the filter within its range', () => {
  const p = resolvePreset({ genre: 'techno', trackType: 'plucks' });
  const lo = applyVariation(p, { knobs: { brightness: 0 } }).filter.frequency, hi = applyVariation(p, { knobs: { brightness: 1 } }).filter.frequency;
  assert.ok(Math.abs(lo - 3500) < 5 && Math.abs(hi - 8000) < 5, `${lo} ${hi}`);
});
test('techno pluck keeps the transient/body contract the prompt asked for', () => {
  const p = resolvePreset({ genre: 'techno', trackType: 'plucks' });
  for (const pos of [0, 0.5, 1]) { const e = finalizePatch({ preset: p, variation: { knobs: { punch: pos } } }).patch.envelope;
    assert.ok(e.attack >= 0.005 && e.attack <= 0.015 && e.decay >= 0.18 && e.decay <= 0.30 && e.sustain <= 0.05 && e.release >= 0.08 && e.release <= 0.18, JSON.stringify(e)); }
});
test('pad-textures keeps sustained envelope limits in every genre', () => {
  for (const g of ['techno','progressive-rock']) { const p = resolvePreset({ genre: g, trackType: 'pad-textures' });
    for (const pos of [0, 1]) { const e = finalizePatch({ preset: p, variation: sanitizeVariation(p, { swell: pos, release: pos }) }).patch.envelope;
      assert.ok(e.attack >= 0.12 && e.attack <= 0.35 && e.release >= 0.6 && e.release <= 1.5 && e.sustain >= 0.35 && e.sustain <= 0.6 && e.decay >= 0.5 && e.decay <= 1.2, `${g} ${JSON.stringify(e)}`); } }
});
test('bass rules: mono, no chorus/phaser, reverb capped at 0.1', () => {
  const p = resolvePreset({ genre: 'techno', trackType: 'bassline' });
  p.patch.pan = 0.4; p.patch.effects.push({ type: 'Chorus', frequency: 2, depth: 0.5, wet: 0.4 }, { type: 'Reverb', decay: 4, wet: 0.5 });
  const { patch, warnings } = finalizePatch({ preset: p });
  assert.equal(patch.pan, 0); assert.ok(!patch.effects.some(e => e.type === 'Chorus')); assert.ok(patch.effects.find(e => e.type === 'Reverb').wet <= 0.1); assert.ok(warnings.length >= 1);
});
test('band family forbids EDM FX; reverb capped', () => {
  const p = resolvePreset({ genre: 'progressive-rock', trackType: 'lead' });
  p.patch.effects.push({ type: 'AutoFilter', frequency: 0.2, baseFrequency: 300, octaves: 3, wet: 0.5 }, { type: 'BitCrusher', bits: 8, wet: 0.3 });
  const r = findFx(finalizePatch({ preset: p }).patch, 'Reverb'); assert.ok(r.wet <= 0.3);
  const fx = finalizePatch({ preset: p }).patch.effects.map(e => e.type); assert.ok(!fx.includes('AutoFilter') && !fx.includes('BitCrusher'));
});
function findFx(patch, t) { return patch.effects.find(e => e.type === t); }
test('density compensation and zero-wet FX removal', () => {
  const p = resolvePreset({ genre: 'techno', trackType: 'arpeggio' });
  const base = finalizePatch({ preset: p }).patch.volume;
  assert.equal(finalizePatch({ preset: p, midi: { density: 'high (16ths/8ths)' } }).patch.volume, base - 3);
  assert.equal(finalizePatch({ preset: p, midi: { density: 'sparse (quarters/halves)' } }).patch.volume, base + 2);
  const noEcho = finalizePatch({ preset: p, variation: sanitizeVariation(p, { echo: 0 }) }).patch; assert.ok(!noEcho.effects.some(e => e.type === 'PingPongDelay'));
});
test('fallback: finalize with no variation == usable preset (LLM-free path)', () => {
  const p = resolvePreset({ genre: 'progressive-rock', trackType: 'arpeggio' }); const { patch } = finalizePatch({ preset: p, variation: {} });
  assertValidPatch(patch, 'arpeggio', 'fallback'); assert.ok(patch.designRationale.length > 10);
});
test('preset data is never mutated by variations', () => {
  const p = resolvePreset({ genre: 'techno', trackType: 'lead' }); const before = JSON.stringify(p.patch);
  finalizePatch({ preset: p, variation: sanitizeVariation(p, { brightness: 1, osc: 'pwm', space: 1 }) }); assert.equal(JSON.stringify(p.patch), before);
});
test('resolved genre stays authoritative over incidental genre words in the brief', () => {
  const techno = buildSystemPrompt('techno', { title: 'Night Drive', description: 'Techno with ambient pads and spacious textures' });
  assert.match(techno, /hypnotic saws and square plucks/);
  assert.doesNotMatch(techno, /very long attacks and releases, big Reverb/);
  const prog = buildSystemPrompt('progressive rock', { description: 'Progressive rock with atmospheric pads' });
  assert.match(prog, /warm analog character/);
  assert.doesNotMatch(prog, /gritty sawtooth\/square/);
});
test('prompt lists real units and defaults, and forbids extra keys', () => {
  const { system, user } = buildVariationPrompt(resolvePreset({ genre: 'techno', trackType: 'plucks' }), { briefText: 'CREATIVE BRIEF\n', direction: 'dark', mood: 'mysterious', key: 'D', scale: 'dorian' });
  assert.match(system, /brightness: filter cutoff 3500–8000 Hz \(default 0\.\d+\)/); assert.match(system, /osc: one of "sawtooth", "square", "pwm"/);
  assert.match(system, /Never output other keys/); assert.match(user, /Preset: techno\/plucks/);
});
console.log(`\n${passed} tests passed`);
