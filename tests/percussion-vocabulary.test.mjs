import test from 'node:test';
import assert from 'node:assert/strict';
import { isPercussionRequested, GM_PERCUSSION_NOTES } from '../lib/percussion-vocabulary.mjs';

test('recognizes common drum kit voices and percussion families', () => {
  for (const phrase of [
    'drums', 'drum kit', 'percussion', 'kick', 'bass drum', 'snare', 'side stick',
    'rimshot', 'hand clap', 'closed hi-hat', 'open hihat', 'pedal hi-hat',
    'toms', 'floor tom', 'crash cymbal', 'ride cymbal', 'splash', 'china cymbal',
    'ride bell', 'congas', 'bongos', 'timbales', 'agogo', 'cowbell',
    'tambourines', 'maracas', 'cabasa', 'claves', 'guiro', 'woodblocks',
    'triangle', 'cuica', 'whistles', 'shakers', 'brushes', 'vibraslap'
  ]) assert.equal(isPercussionRequested('Add ' + phrase + ' to the groove'), true, phrase);
});

test('does not classify unrelated melodic track requests as percussion', () => {
  for (const phrase of ['bassline', 'melody', 'arpeggio', 'lead synth', 'warm pad textures', 'electric piano']) {
    assert.equal(isPercussionRequested(phrase), false, phrase);
  }
});

test('documents the complete General MIDI percussion key range', () => {
  const keys = Object.keys(GM_PERCUSSION_NOTES).map(Number).sort((a, b) => a - b);
  assert.equal(keys[0], 35);
  assert.equal(keys.at(-1), 81);
  assert.equal(keys.length, 47);
  assert.equal(GM_PERCUSSION_NOTES[36], 'Bass Drum 1');
  assert.equal(GM_PERCUSSION_NOTES[38], 'Acoustic Snare');
  assert.equal(GM_PERCUSSION_NOTES[42], 'Closed Hi-Hat');
  assert.equal(GM_PERCUSSION_NOTES[46], 'Open Hi-Hat');
  assert.equal(GM_PERCUSSION_NOTES[64], 'Low Conga');
});
