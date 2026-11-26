export const GENRE_TRACK_RECOMMENDATIONS = Object.freeze({
  house: ['bassline', 'chord', 'melody', 'percs'],
  techno: ['bassline', 'arpeggio', 'percs', 'pad-textures'],
  trance: ['bassline', 'melody', 'chord', 'percs', 'arpeggio'],
  trap: ['bassline', 'lead', 'plucks', 'percs'],
  'hip-hop': ['bassline', 'keys', 'percs', 'melody'],
  rock: ['bassline', 'guitar', 'melody', 'percs'],
  'progressive-rock': ['bassline', 'guitar', 'keys', 'lead', 'percs'],
  pop: ['bassline', 'melody', 'keys', 'chord', 'percs'],
  funk: ['bassline', 'guitar', 'brass', 'keys', 'percs'],
  jazz: ['bassline', 'keys', 'brass', 'percs'],
  disco: ['bassline', 'strings', 'brass', 'guitar', 'percs'],
  cinematic: ['strings', 'brass', 'pad-textures', 'bassline', 'percs'],
  classical: ['strings', 'brass', 'bassline', 'melody'],
  ambient: ['pad-textures', 'strings', 'arpeggio', 'plucks'],
  downtempo: ['bassline', 'pad-textures', 'plucks', 'keys'],
  'drum-and-bass': ['bassline', 'lead', 'percs', 'pad-textures'],
  synthwave: ['bassline', 'arpeggio', 'lead', 'pad-textures', 'percs'],
  reggae: ['bassline', 'guitar', 'keys', 'melody', 'percs']
});

export function getGenreTrackRecommendations(genre) {
  const tracks = GENRE_TRACK_RECOMMENDATIONS[String(genre || '').toLowerCase()];
  return tracks ? [...tracks] : [];
}
