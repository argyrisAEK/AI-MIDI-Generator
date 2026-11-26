import { PERCUSSION_REQUEST_PATTERN } from './percussion-vocabulary.mjs';

const TRACK_RULES = [
  ['bassline', /\b(?:bassline|bass(?!\s+drum))\b/i],
  ['pad-textures', /\bpad[\s-]*textures?\b|\bpads?\b/i],
  ['arpeggio', /\b(?:arpeggios?|arp)\b/i],
  ['lead', /\blead(?:\s+synth)?\b/i],
  ['percs', PERCUSSION_REQUEST_PATTERN],
  ['chord', /\b(?:chords?|harmony)\b/i],
  // "Melodic Techno" is a genre description, not a request for a melody track.
  ['melody', /\bmelody\b/i],
  ['plucks', /\bplucks?\b/i],
  ['strings', /\bstrings?\b/i],
  ['keys', /\b(?:keys?|piano)\b/i],
  ['guitar', /\bguitars?\b/i],
  ['brass', /\bbrass\b/i]
];

const WHOLE_PERCUSSION_EXCLUSION_PATTERN =
  /\b(?:no|without|exclude|excluding|avoid|avoiding|don't\s+use|do\s+not\s+use|must\s+not\s+include)\s+(?:any\s+)?(?:drums?|percussion|percs?|drum\s+kit)\b/i;

const PERCUSSION_VOICE_EXCLUSION_PATTERN =
  /\b(?:no|without|exclude|excluding|avoid|avoiding|don't\s+use|do\s+not\s+use|must\s+not\s+include)\s+(?:any\s+)?(?:the\s+)?(kick(?:\s+drum)?|bass\s+drum|snare(?:\s+drum)?|side\s+stick|rim\s*shot|clap|closed\s+hi[\s-]?hat|open\s+hi[\s-]?hat|pedal\s+hi[\s-]?hat|hi[\s-]?hats?|toms?|floor\s+tom|crash(?:\s+cymbal)?|ride(?:\s+cymbal)?|splash(?:\s+cymbal)?|china(?:\s+cymbal)?|ride\s+bell|congas?|bongos?|timbales?|agogo|cowbells?|tambourines?|maracas?|cabasa|claves|guiro|woodblocks?|triangles?|cuicas?|whistles?|shakers?|brushes?|vibraslap)\b/gi;

export function getExplicitTrackTypes(prompt) {
  const source = typeof prompt === 'string' ? prompt : '';
  return TRACK_RULES
    .filter(([, pattern]) => pattern.test(source))
    .map(([track]) => track);
}

export function isWholePercussionExcluded(value) {
  return typeof value === 'string' && WHOLE_PERCUSSION_EXCLUSION_PATTERN.test(value);
}

export function extractExplicitPercussionAvoids(prompt) {
  if (typeof prompt !== 'string') return [];
  const matches = [];
  for (const match of prompt.matchAll(PERCUSSION_VOICE_EXCLUSION_PATTERN)) {
    const label = match[1].toLowerCase().replace(/\s+/g, ' ').trim();
    if (label && !matches.includes(label)) matches.push(label);
  }
  return matches.slice(0, 8);
}
