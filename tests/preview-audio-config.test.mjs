import assert from 'node:assert/strict';
import {
  resolvePreviewSoundProfile,
  resolvePreviewTrackSettings
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
assert.equal(lowPowerBass.envelope.release, 0.25);

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

console.log('Preview audio config tests passed.');
