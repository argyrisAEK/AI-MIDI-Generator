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

export function getPercussionVoice(note) {
  const midi = midiNoteNumber(note);
  if (midi === null) return 'snare';
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
