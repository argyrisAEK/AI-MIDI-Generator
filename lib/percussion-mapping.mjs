/**
 * Deterministic pitch-to-voice mapping for the audio-only percussion renderer.
 * The source MIDI notes are never rewritten.
 */
export function midiNoteNumber(note) {
  if (typeof note === 'number' && Number.isFinite(note)) return Math.round(note);
  if (typeof note !== 'string') return null;
  const match = note.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) return null;
  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pitch = semitones[match[1].toUpperCase()];
  if (match[2] === '#') pitch += 1;
  if (match[2] === 'b') pitch -= 1;
  return (Number(match[3]) + 1) * 12 + pitch;
}

// General MIDI percussion note numbers (channel 10) take precedence over
// broad pitch-range heuristics. This keeps common drum-map notes distinct.
const GM_PERCUSSION_VOICES = new Map([
  [35, 'kick'], [36, 'kick'],
  [37, 'snare'], [38, 'snare'], [40, 'snare'],
  [39, 'clap'],
  [41, 'tom'], [43, 'tom'], [45, 'tom'], [47, 'tom'], [48, 'tom'], [50, 'tom'],
  [42, 'closedHat'], [44, 'closedHat'],
  [46, 'openHat'],
  [49, 'crash'], [52, 'crash'], [55, 'crash'], [57, 'crash'],
  [51, 'ride'], [53, 'ride'], [56, 'ride'], [59, 'ride'],
  [54, 'shaker'], [58, 'shaker']
]);

export function getPercussionVoice(note) {
  const midi = midiNoteNumber(note);
  if (midi === null) return 'snare';

  const gmVoice = GM_PERCUSSION_VOICES.get(midi);
  if (gmVoice) return gmVoice;

  // Preserve the previous fallback for non-GM/custom percussion note ranges.
  if (midi <= 40) return 'kick';
  if (midi <= 47) return 'tom';
  if (midi <= 51) return 'snare';
  if (midi <= 55) return 'clap';
  if (midi <= 59) return 'shaker';
  if (midi <= 64) return 'closedHat';
  if (midi <= 71) return 'openHat';
  if (midi <= 79) return 'ride';
  return 'crash';
}
