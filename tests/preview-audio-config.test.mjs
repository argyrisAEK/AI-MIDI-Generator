import assert from 'node:assert/strict';
import {
  resolvePreviewSoundProfile,
  resolvePreviewTrackSettings,
  applyPreviewSettingsToSynthPatch
} from '../lib/preview-audio-config.mjs';

const techno = resolvePreviewTrackSettings('bassline', {
  style: 'techno',
  soundProfileMode: 'genre',
  lowPower: false
});
assert.equal(techno.oscillator.type, 'fmsquare');
assert.equal(techno.filter.frequency, 600);
assert.equal(techno.envelope.attack, 0.008);

const defaultBass = resolvePreviewTrackSettings('bassline', {
  style: 'techno',
  soundProfileMode: 'default',
  lowPower: false
});
assert.equal(defaultBass.filter.frequency, 800);
assert.equal(resolvePreviewSoundProfile({ style: 'techno', soundProfileMode: 'default' }), null);

const lowPowerBass = resolvePreviewTrackSettings('bassline', {
  style: 'techno',
  soundProfileMode: 'genre',
  lowPower: true
});
assert.equal(lowPowerBass.oscillator.type, 'square');
assert.equal('count' in lowPowerBass.oscillator, false);
assert.equal(lowPowerBass.envelope.release, 0.1);

const fullPowerPad = resolvePreviewTrackSettings('pad-textures', {
  style: 'techno',
  soundProfileMode: 'genre',
  lowPower: false
});
assert.equal(fullPowerPad.oscillator.type, 'fatsine');
assert.equal(fullPowerPad.envelope.attack, 1.2);

const ambientPad = resolvePreviewTrackSettings('pad-textures', {
  style: 'ambient',
  soundProfileMode: 'genre',
  lowPower: false
});
assert.equal(ambientPad.envelope.attack, 1.2);
assert.equal(ambientPad.envelope.release >= 0.05, true);

const aiPatch = {
  instrumentType: 'MonoSynth',
  oscillator: { type: 'sawtooth' },
  envelope: { attack: 0.3, decay: 0.4, sustain: 0.5, release: 0.6 },
  filter: { type: 'lowpass', frequency: 9000, Q: 1 },
  filterEnvelope: { attack: 0.1, decay: 0.2, sustain: 0.3, release: 0.4 },
  portamento: 0.12,
  volume: -8,
  pan: 0.2,
  effects: [{ type: 'Reverb', wet: 0.2 }]
};
const wavBass = applyPreviewSettingsToSynthPatch('bassline', aiPatch, {
  style: 'techno',
  soundProfileMode: 'genre'
});
assert.equal(wavBass.oscillator.type, 'fmsquare');
assert.equal(wavBass.filter.frequency, 600);
assert.equal(wavBass.envelope.attack, 0.008);
assert.equal(wavBass.instrumentType, 'MonoSynth');
assert.equal(wavBass.filterEnvelope, aiPatch.filterEnvelope);
assert.equal(wavBass.portamento, aiPatch.portamento);
assert.equal(wavBass.volume, aiPatch.volume);
assert.equal(wavBass.effects, aiPatch.effects);
assert.equal(aiPatch.oscillator.type, 'sawtooth', 'the original DAW patch must not be mutated');

const wavPercs = applyPreviewSettingsToSynthPatch('percs', aiPatch, { style: 'techno' });
assert.equal(wavPercs, aiPatch, 'the dedicated WAV drum patch must remain untouched');

console.log('Preview audio config tests passed.');
