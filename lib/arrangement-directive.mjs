// Compact, deterministic arrangement cues derived from the already-extracted structure.
// These replace generic arrangement wording rather than expanding the generation prompt.
export function buildArrangementDirective(structure, bars, tracks = []) {
  const selected = new Set(Array.isArray(tracks) ? tracks : []);
  const has = (...names) => names.some(name => selected.has(name));
  const foundation = has('pad-textures', 'strings', 'chord', 'keys')
    ? 'start with sustained/harmonic layers' : 'start sparse';
  const rhythmic = has('plucks', 'arpeggio', 'keys')
    ? 'introduce rhythmic layers during the build' : 'increase activity during the build';
  const peak = [
    has('bassline') ? 'bass' : '',
    has('lead', 'melody') ? 'lead' : ''
  ].filter(Boolean).join(' and ') || 'selected tracks';

  switch (structure) {
    case 'drop':
      return bars === 4
        ? 'DROP: bar 1 ' + foundation + '; bar 2 ' + rhythmic + '; bars 3-4 bring in full ' + peak + ' and vary the peak phrase.'
        : 'DROP: bars 1-2 ' + foundation + '; bars 3-4 ' + rhythmic + '; bars 5-8 bring in full ' + peak + ', reach peak density and vary the final phrase.';
    case 'build':
      return 'BUILD: begin sparse, add selected layers and rhythmic density progressively, and reserve the fullest phrase for the final bars.';
    case 'intro':
      return 'INTRO: use few layers at first, add selected elements gradually, and avoid an early full-density peak.';
    case 'bridge':
      return 'BRIDGE: contrast the motif through register, rhythm or texture while preserving harmonic continuity and preparing the return.';
    case 'chorus':
      return 'CHORUS: establish a clear hook with supporting layers; keep space around it and vary the phrase.';
    default:
      return '';
  }
}
