// Compact, shared subgenre vocabulary for prompt analysis and MIDI generation.
// Keep profiles short: they are appended to the existing STYLE line, not a new prompt section.
export const SUBGENRE_PROFILES = Object.freeze({
  'melodic-techno': {
    genre: 'techno',
    aliases: ['melodic techno'],
    profile: 'motif-led; minor/modal harmony; evolving arpeggios and pads'
  },
  'industrial-techno': {
    genre: 'techno',
    aliases: ['industrial techno'],
    profile: 'mechanical syncopation; chromatic tension; repetitive low-register motifs'
  },
  'driving-techno': {
    genre: 'techno',
    aliases: ['driving techno'],
    profile: 'relentless pulse; persistent bass ostinato; forward-moving rhythmic motifs'
  },
  'deep-house': {
    genre: 'house',
    aliases: ['deep house'],
    profile: 'warm soulful chords; laid-back syncopated bass; restrained melodic hooks'
  },
  'progressive-house': {
    genre: 'house',
    aliases: ['progressive house', 'prog house'],
    profile: 'gradual harmonic development; evolving layered motifs; long-form builds'
  },
  'tech-house': {
    genre: 'house',
    aliases: ['tech house'],
    profile: 'tight percussive groove; syncopated bass; sparse repetitive hooks'
  },
  'soulful-house': {
    genre: 'house',
    aliases: ['soulful house'],
    profile: 'rich extended chords; gospel/jazz inflections; expressive melodic phrasing'
  },
  'afro-house': {
    genre: 'house',
    aliases: ['afro house'],
    profile: 'polyrhythmic percussion; organic syncopation; cyclical bass and modal motifs'
  },
  'melodic-house': {
    genre: 'house',
    aliases: ['melodic house'],
    profile: 'emotive minor-key motifs; flowing arpeggios; atmospheric pads'
  },
  'boom-bap': {
    genre: 'hip-hop',
    aliases: ['boom bap', 'boombap'],
    profile: 'sampled soul/jazz feel; swung kick-snare pocket; punchy bass'
  },
  'trap-hip-hop': {
    genre: 'hip-hop',
    aliases: ['trap', 'trap hip hop', 'hip-hop trap'],
    profile: 'rolling hi-hat subdivisions; syncopated 808 bass; sparse minor-key motifs'
  },
  'jazz-rap': {
    genre: 'hip-hop',
    aliases: ['jazz rap', 'jazz-rap'],
    profile: 'jazz-derived extended chords; laid-back swing; conversational melodic phrasing'
  },
  'lo-fi-hip-hop': {
    genre: 'hip-hop',
    aliases: ['lofi hip hop', 'lo-fi hip hop', 'lofi'],
    profile: 'mellow jazzy harmony; dusty relaxed groove; sparse melodic motifs'
  },
  'drill': {
    genre: 'hip-hop',
    aliases: ['drill rap', 'uk drill'],
    profile: 'dark minor motifs; syncopated sliding bass; tense sparse hooks'
  },
  'west-coast-hip-hop': {
    genre: 'hip-hop',
    aliases: ['west coast hip hop', 'west coast rap'],
    profile: 'funky basslines; bright synth and keys hooks; laid-back bounce'
  }
});

export const SUPPORTED_SUBGENRES = Object.keys(SUBGENRE_PROFILES);

function normalizeLabel(value) {
  return typeof value === 'string'
    ? value.toLowerCase().trim().replace(/[_\s]+/g, '-')
    : '';
}

export function normalizeSubgenre(value) {
  const label = normalizeLabel(value);
  if (!label) return '';
  for (const [id, entry] of Object.entries(SUBGENRE_PROFILES)) {
    if (label === id || entry.aliases.some(alias => normalizeLabel(alias) === label)) return id;
  }
  return '';
}

export function detectSubgenre(prompt, parentGenre) {
  if (typeof prompt !== 'string' || !prompt.trim()) return '';
  const genre = normalizeLabel(parentGenre);
  for (const [id, entry] of Object.entries(SUBGENRE_PROFILES)) {
    if (genre && entry.genre !== genre) continue;
    const labels = [id, ...entry.aliases];
    if (labels.some(label => {
      const pattern = label.split(/[-\s]+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]+');
      return new RegExp('\\b' + pattern + '\\b', 'i').test(prompt);
    })) return id;
  }
  return '';
}

export function getSubgenreProfile(parentGenre, subgenre) {
  const id = normalizeSubgenre(subgenre);
  const entry = id ? SUBGENRE_PROFILES[id] : null;
  return entry && entry.genre === normalizeLabel(parentGenre) ? entry.profile : '';
}
