import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENRE_TRACK_RECOMMENDATIONS,
  getGenreTrackRecommendations
} from '../lib/genre-track-recommendations.mjs';

const VALID_TRACKS = new Set([
  'bassline', 'chord', 'melody', 'arpeggio', 'lead', 'plucks',
  'strings', 'keys', 'guitar', 'pad-textures', 'brass', 'percs'
]);

test('House recommends a complete four-track starting arrangement', () => {
  assert.deepEqual(
    getGenreTrackRecommendations('house'),
    ['bassline', 'chord', 'melody', 'percs']
  );
});

test('Reggae has a five-track recommendation profile', () => {
  assert.deepEqual(
    getGenreTrackRecommendations('reggae'),
    ['bassline', 'guitar', 'keys', 'melody', 'percs']
  );
});

test('all genre recommendations contain only supported tracks and respect the five-track limit', () => {
  for (const [genre, tracks] of Object.entries(GENRE_TRACK_RECOMMENDATIONS)) {
    assert.ok(tracks.length > 0, `${genre} should have recommendations`);
    assert.ok(tracks.length <= 5, `${genre} exceeds the five-track UI limit`);
    assert.equal(new Set(tracks).size, tracks.length, `${genre} contains duplicate tracks`);
    for (const track of tracks) {
      assert.ok(VALID_TRACKS.has(track), `${genre} contains unsupported track ${track}`);
    }
  }
});

test('genre lookup is case-insensitive and returns a fresh array', () => {
  const first = getGenreTrackRecommendations('HOUSE');
  first.pop();
  assert.equal(getGenreTrackRecommendations('house').length, 4);
});

test('unknown genres do not silently receive unrelated recommendations', () => {
  assert.deepEqual(getGenreTrackRecommendations('unknown-genre'), []);
});
