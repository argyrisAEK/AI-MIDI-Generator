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
  },
  'dark-ambient': {
    genre: 'ambient',
    aliases: ['dark ambient'],
    profile: 'slow minor/modal evolution; restrained dissonance; deep atmospheric layers'
  },
  'drone-ambient': {
    genre: 'ambient',
    aliases: ['drone ambient', 'ambient drone'],
    profile: 'sustained tones; gradual spectral movement; minimal harmonic rhythm'
  },
  'space-ambient': {
    genre: 'ambient',
    aliases: ['space ambient', 'cosmic ambient'],
    profile: 'expansive pads; sparse motifs; slow celestial harmonic shifts'
  },
  'atmospheric-ambient': {
    genre: 'ambient',
    aliases: ['atmospheric ambient'],
    profile: 'airy textures; subtle melodic fragments; spacious evolving harmony'
  },
  'new-age': {
    genre: 'ambient',
    aliases: ['new age', 'new-age ambient'],
    profile: 'consonant modal harmony; gentle arpeggios; serene melodic phrasing'
  },
  'organic-ambient': {
    genre: 'ambient',
    aliases: ['organic ambient'],
    profile: 'acoustic timbres; naturalistic textures; slow evolving tonal layers'
  },
  'alternative-rock': {
    genre: 'rock',
    aliases: ['alternative rock', 'alt rock'],
    profile: 'dynamic guitar-driven riffs; contrasting quiet-loud sections; expressive melodic hooks'
  },
  'indie-rock': {
    genre: 'rock',
    aliases: ['indie rock'],
    profile: 'jangly or textured guitars; understated groove; melodic independent-minded phrasing'
  },
  'hard-rock': {
    genre: 'rock',
    aliases: ['hard rock'],
    profile: 'powerful distorted guitar riffs; driving rhythm section; strong melodic hooks'
  },
  'punk-rock': {
    genre: 'rock',
    aliases: ['punk rock', 'punk'],
    profile: 'fast direct power-chord patterns; tight driving rhythm; raw repetitive hooks'
  },
  'post-rock': {
    genre: 'rock',
    aliases: ['post rock'],
    profile: 'long-form instrumental build; layered guitar textures; gradual dynamic crescendos'
  },
  'trip-hop': {
    genre: 'downtempo',
    aliases: ['trip hop'],
    profile: 'slow breakbeat groove; deep bass; moody sampled textures and sparse motifs'
  },
  'chillout': {
    genre: 'downtempo',
    aliases: ['chill out', 'chill-out'],
    profile: 'relaxed pulse; warm harmony; soft textures and gentle melodic movement'
  },
  'downtempo-lounge': {
    genre: 'downtempo',
    aliases: ['downtempo lounge', 'lounge'],
    profile: 'unhurried elegant groove; jazzy extended chords; restrained bass and melodic detail'
  },
  'idm': {
    genre: 'downtempo',
    aliases: ['intelligent dance music'],
    profile: 'intricate syncopation; unconventional rhythmic subdivisions; abstract evolving motifs'
  },
  'illbient': {
    genre: 'downtempo',
    aliases: ['illbient'],
    profile: 'dub-influenced low-end; fractured beats; dark ambient samples and experimental space'
  },
  'synthpop': {
    genre: 'pop',
    aliases: ['synth pop'],
    profile: 'prominent synthesizer hooks; polished electronic rhythm; concise verse-chorus melodies'
  },
  'electropop': {
    genre: 'pop',
    aliases: ['electro pop', 'electro-pop'],
    profile: 'bright electronic timbres; punchy programmed groove; catchy streamlined vocal-style hooks'
  },
  'dance-pop': {
    genre: 'pop',
    aliases: ['dance pop'],
    profile: 'four-on-the-floor dance pulse; buoyant bass; high-impact repetitive melodic chorus'
  },
  'indie-pop': {
    genre: 'pop',
    aliases: ['indie pop'],
    profile: 'quirky melodic phrasing; bright guitars or keys; light organic rhythmic feel'
  },
  'dream-pop': {
    genre: 'pop',
    aliases: ['dream pop'],
    profile: 'hazy layered textures; shimmering guitar and synth tones; soft floating melodies'
  },
  'outrun': {
    genre: 'synthwave',
    aliases: ['outrun synthwave'],
    profile: 'driving retro-electronic pulse; gated drums; arpeggiated bass and neon lead hooks'
  },
  'darksynth': {
    genre: 'synthwave',
    aliases: ['dark synthwave', 'dark synth'],
    profile: 'ominous minor-key sequences; aggressive analog bass; saturated cinematic synth leads'
  },
  'dreamwave': {
    genre: 'synthwave',
    aliases: ['dream wave'],
    profile: 'soft nostalgic pads; slow pulsing bass; wistful melodies and spacious reverb'
  },
  'retrowave': {
    genre: 'synthwave',
    aliases: ['retro wave', 'retro-wave'],
    profile: '1980s-inspired analog timbres; steady electronic drums; memorable nostalgic synth themes'
  },
  'cyberpunk-synthwave': {
    genre: 'synthwave',
    aliases: ['cyberpunk synthwave', 'cyberpunk'],
    profile: 'mechanical electronic pulse; dystopian minor motifs; gritty bass and futuristic textures'
  },
  'cyberpunk-industrial': {
    genre: 'techno',
    aliases: ['cyberpunk industrial'],
    profile: 'rigid industrial pulse; abrasive syncopation; dark chromatic motifs and heavy low-register repetition'
  },
  'uplifting-trance': {
    genre: 'trance',
    aliases: ['uplifting trance'],
    profile: 'driving four-on-the-floor pulse; rising arpeggios; expansive minor-to-major harmonic lifts and soaring lead phrases'
  },
  'progressive-trance': {
    genre: 'trance',
    aliases: ['progressive trance'],
    profile: 'steady hypnotic groove; gradual layered development; evolving arpeggios and long harmonic transitions'
  },
  'melodic-trap': {
    genre: 'trap',
    aliases: ['melodic trap'],
    profile: 'half-time trap groove; syncopated sub-bass; rolling subdivisions and sparse emotive minor-key motifs'
  },
  'funk-groove': {
    genre: 'funk',
    aliases: ['funk groove', 'funky groove'],
    profile: 'syncopated bass-led pocket; clipped rhythmic chord stabs; tight interlocking riffs and offbeat accents'
  },
  'smooth-jazz': {
    genre: 'jazz',
    aliases: ['smooth jazz'],
    profile: 'relaxed swung or straight groove; extended seventh and ninth chords; lyrical melodic phrasing'
  },
  'jazz-fusion': {
    genre: 'jazz',
    aliases: ['jazz fusion'],
    profile: 'syncopated fusion groove; extended and altered harmony; nimble bass lines and virtuosic melodic runs'
  },
  'nu-disco': {
    genre: 'disco',
    aliases: ['nu disco', 'nu-disco'],
    profile: 'four-on-the-floor dance pulse; octave-driven bass; clipped funk guitar or keyboard rhythms and bright repeating hooks'
  },
  'liquid-dnb': {
    genre: 'drum-and-bass',
    aliases: ['liquid dnb', 'liquid drum and bass', 'liquid drum-and-bass'],
    profile: 'fast broken-beat drum-and-bass feel; flowing sub-bass; smooth atmospheric chords and fluid melodic phrases'
  },
  'neurofunk': {
    genre: 'drum-and-bass',
    aliases: ['neuro funk'],
    profile: 'precise syncopated drum-and-bass rhythm; tightly articulated bass motifs; dark tension and restrained harmonic movement'
  },
  'chillhop': {
    genre: 'downtempo',
    aliases: ['chill hop'],
    profile: 'laid-back hip-hop swing; mellow jazzy chords; warm bass and understated looping motifs'
  },
  'cinematic-ambient': {
    genre: 'ambient',
    aliases: ['cinematic ambient'],
    profile: 'slow evolving harmonic beds; spacious sustained layers; restrained motifs with gradual cinematic tension'
  },
  'epic-cinematic': {
    genre: 'cinematic',
    aliases: ['epic cinematic'],
    profile: 'broad orchestral harmonic movement; ostinato-driven momentum; layered rising motifs and emphatic cadential gestures'
  },
  'orchestral': {
    genre: 'classical',
    aliases: ['orchestral classical'],
    profile: 'voice-led orchestral writing; coherent counterpoint; idiomatic string, woodwind and brass phrasing with balanced register'
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
      const pattern = label.split(/[-\s]+/).map(part => part.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')).join('[\\s-]+');
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
