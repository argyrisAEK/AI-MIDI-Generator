// Compact, deterministic arrangement cues derived from the already-extracted structure.
// Phrase guidance is folded into these cues (or the no-structure fallback) to keep prompt size stable.
export function buildPhraseDevelopmentDirective(tracks = []) {
  const selected = new Set(Array.isArray(tracks) ? tracks : []);
  const has = (...names) => names.some(name => selected.has(name));

  if (has('bassline') && has('guitar') && has('brass')) {
    return 'Interlock bass/guitar; use brass call-response and selective fills.';
  }
  if (has('bassline') && has('guitar')) {
    return 'Interlock bass/guitar; vary fills selectively.';
  }
  if (has('brass') && has('guitar')) {
    return 'Use brass call-response with guitar; vary fills.';
  }
  if (has('lead', 'melody') && has('pad-textures', 'strings')) {
    return 'Develop lead motifs over sustained layers; stagger supporting fills.';
  }
  if (has('bassline') && has('arpeggio')) {
    return 'Keep bass and arpeggio complementary; vary accents.';
  }
  return 'Repeat core motifs with small changes; stagger fills.';
}

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

  let directive = '';
  switch (structure) {
    case 'drop':
      directive = bars === 4
        ? 'DROP: bar 1 ' + foundation + '; bar 2 ' + rhythmic + '; bars 3-4 bring in full ' + peak + ' and vary the peak phrase.'
        : 'DROP: bars 1-2 ' + foundation + '; bars 3-4 ' + rhythmic + '; bars 5-8 bring in full ' + peak + ', reach peak density and vary the final phrase.';
      break;
    case 'build':
      directive = 'BUILD: begin sparse, add selected layers and rhythmic density progressively, and reserve the fullest phrase for the final bars.';
      break;
    case 'intro':
      directive = 'INTRO: use few layers at first, add selected elements gradually, and avoid an early full-density peak.';
      break;
    case 'bridge':
      directive = 'BRIDGE: contrast the motif through register, rhythm or texture while preserving harmonic continuity and preparing the return.';
      break;
    case 'chorus':
      directive = 'CHORUS: establish a clear hook with supporting layers; keep space around it and vary the phrase.';
      break;
    default:
      return '';
  }
  return directive + ' ' + buildPhraseDevelopmentDirective(tracks);
}
