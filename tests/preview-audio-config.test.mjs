import assert from 'node:assert/strict';
import {
  resolvePreviewSoundProfile,
  resolvePreviewTrackSettings,
  createOfflinePreviewSynthSettings,
  isSupportedOfflineTrackType,
  getPreviewMasterEffectsSettings
} from '../lib/preview-audio-config.mjs';

const fullPowerMaster = getPreviewMasterEffectsSettings({ lowPower: false });
assert.equal(fullPowerMaster.limiterThresholdDb, -3);
assert.deepEqual(fullPowerMaster.compressor, {
  threshold: -14,
  ratio: 4,
  attack: 0.005,
  release: 0.15,
  knee: 6
});
assert.equal(fullPowerMaster.spatialEffectsEnabled, true);
assert.deepEqual(fullPowerMaster.delay, {
  delayTime: '8n',
  feedback: 0.2,
  wet: 0.15
});
assert.deepEqual(fullPowerMaster.reverb, {
  decay: 2.5,
  preDelay: 0.01,
  wet: 0.2
});

const lowPowerMaster = getPreviewMasterEffectsSettings({ lowPower: true });
assert.equal(lowPowerMaster.spatialEffectsEnabled, false);
// The compressor and limiter remain consistent in low-power Preview mode.
assert.deepEqual(lowPowerMaster.compressor, fullPowerMaster.compressor);
assert.equal(lowPowerMaster.limiterThresholdDb, fullPowerMaster.limiterThresholdDb);

const techno = resolvePreviewTrackSettings('bassline', {
  style: 'techno',
  soundProfileMode: 'genre',
  lowPower: false
});
assert.equal(techno.oscillator.type, 'fmsquare');
assert.equal(techno.filter.frequency, 600);
assert.equal(techno.envelope.attack, 0.008);

const defaultMelody = resolvePreviewTrackSettings('melody', {
  style: 'house',
  soundProfileMode: 'default',
  lowPower: false
});
assert.equal(defaultMelody.filter.type, 'lowpass');
assert.equal(defaultMelody.filter.frequency, 4600);
assert.equal(defaultMelody.filter.rolloff, -12);

const technoMelody = resolvePreviewTrackSettings('melody', {
  style: 'techno',
  subgenre: 'melodic-techno',
  soundProfileMode: 'genre',
  lowPower: false
});
assert.equal(technoMelody.filter.frequency, 4600);
assert.equal(technoMelody.filter.type, 'lowpass');

const lowPowerMelody = resolvePreviewTrackSettings('melody', {
  style: 'techno',
  subgenre: 'melodic-techno',
  soundProfileMode: 'genre',
  lowPower: true
});
assert.equal(lowPowerMelody.filter.frequency, 4600);
assert.equal(lowPowerMelody.oscillator.type, 'sawtooth');

const offlineMelodyWarmCut = createOfflinePreviewSynthSettings('melody', {
  style: 'techno',
  subgenre: 'melodic-techno',
  soundProfileMode: 'genre'
});
assert.equal(offlineMelodyWarmCut.filter.frequency, 4600);

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

const offlineLowPowerCaller = createOfflinePreviewSynthSettings('bassline', {
  style: 'techno',
  soundProfileMode: 'genre',
  lowPower: true
});
assert.equal(offlineLowPowerCaller.oscillator.type, 'fmsquare');
assert.equal(offlineLowPowerCaller.filter.frequency, 600);
assert.equal(offlineLowPowerCaller.envelope.attack, 0.008);

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

// Offline WAV rendering must remain full-power even if the caller's
// current Preview preference is Low Power.
const offlinePercussion = createOfflinePreviewSynthSettings('percs', {
  style: 'techno',
  soundProfileMode: 'genre',
  lowPower: true
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
