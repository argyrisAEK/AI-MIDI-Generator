import assert from 'node:assert/strict';
import {
  resolvePreviewSoundProfile,
  resolvePreviewTrackSettings,
  createOfflinePreviewSynthSettings,
  isSupportedOfflineTrackType
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

const offlineBass = createOfflinePreviewSynthSettings('bassline', {
  style: 'techno',
  soundProfileMode: 'genre'
});
assert.equal(offlineBass.instrumentType, 'MonoSynth');
assert.equal(offlineBass.oscillator.type, 'fmsquare');
assert.equal(offlineBass.filter.frequency, 600);
assert.equal(offlineBass.envelope.attack, 0.008);
assert.ok(Math.abs(offlineBass.volume - (20 * Math.log10(0.72))) < 1e-10);

const offlineLead = createOfflinePreviewSynthSettings('lead', {
  style: 'techno',
  soundProfileMode: 'genre'
});
assert.equal(offlineLead.instrumentType, 'MonoSynth');

const offlineMelody = createOfflinePreviewSynthSettings('melody', {
  style: 'techno',
  soundProfileMode: 'genre'
});
assert.equal(offlineMelody.instrumentType, 'PolySynth');
assert.equal(offlineMelody.oscillator.type, 'fmsquare');

const offlinePercussion = createOfflinePreviewSynthSettings('percs', {
  style: 'techno',
  soundProfileMode: 'genre'
});
assert.equal(offlinePercussion.instrumentType, 'PolySynth');
assert.equal(offlinePercussion.volume, 20 * Math.log10(0.58));

assert.equal(isSupportedOfflineTrackType('bassline'), true);
assert.equal(isSupportedOfflineTrackType('percs'), true);
assert.equal(isSupportedOfflineTrackType('unknown-track'), false);

assert.throws(
  () => createOfflinePreviewSynthSettings('unknown-track'),
  /Unsupported track type/
);

console.log('Preview audio config tests passed.');
