// Shared, bounded representation of the user's musical intent.
// Creative preferences never override the MIDI schema or explicit technical constraints.
const FIELDS = {
  artistReferences: 3, rhythmicFeel: 140, noteLength: 120, density: 100,
  repetition: 120, phraseDevelopment: 140, pitchMovement: 120,
  harmonicCharacter: 120, register: 100, articulation: 100
};
const TRACKS = new Set(['bassline','chord','melody','arpeggio','lead','plucks','strings','keys','guitar','pad-textures','brass']);
function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}
export function normalizeMusicalIntent(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [field, maxLength] of Object.entries(FIELDS)) {
    if (field === 'artistReferences') {
      result.artistReferences = Array.isArray(source.artistReferences)
        ? [...new Set(source.artistReferences.map(item => cleanText(item, maxLength)).filter(Boolean))].slice(0, 3)
        : [];
    } else {
      const text = cleanText(source[field], maxLength);
      if (text) result[field] = text;
    }
  }
  const instructions = source.trackInstructions && typeof source.trackInstructions === 'object' && !Array.isArray(source.trackInstructions) ? source.trackInstructions : {};
  result.trackInstructions = {};
  for (const [track, instruction] of Object.entries(instructions)) {
    if (!TRACKS.has(track)) continue;
    const text = cleanText(instruction, 180);
    if (text) result.trackInstructions[track] = text;
  }
  return result;
}
