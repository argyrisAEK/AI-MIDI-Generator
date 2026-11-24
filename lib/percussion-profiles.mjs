/**
 * Deterministic genre-aware percussion kits for WAV export.
 * MIDI note data is preserved; General MIDI note numbers select the drum role.
 */
const PROFILES = {
  techno: {
    id: 'techno-tight',
    outputGainDb: -13,
    kick: { pitchDecay: 0.055, octaves: 6, decay: 0.22, release: 0.07 },
    tom: { pitchDecay: 0.035, octaves: 2.2, decay: 0.28, release: 0.09 },
    snare: { noise: 'white', decay: 0.17 },
    clap: { noise: 'pink', decay: 0.13 },
    shaker: { noise: 'pink', decay: 0.05 },
    closedHat: { frequency: 360, harmonicity: 5.6, modulationIndex: 34, resonance: 7200, octaves: 1.7, decay: 0.045 },
    openHat: { frequency: 330, harmonicity: 5.4, modulationIndex: 30, resonance: 6500, octaves: 1.8, decay: 0.25 },
    ride: { frequency: 440, harmonicity: 5.8, modulationIndex: 26, resonance: 7600, octaves: 2.1, decay: 0.38 },
    crash: { frequency: 270, harmonicity: 5.4, modulationIndex: 36, resonance: 8800, octaves: 2.4, decay: 0.65 }
  },
  house: {
    id: 'house-groove',
    outputGainDb: -13,
    kick: { pitchDecay: 0.075, octaves: 5, decay: 0.25, release: 0.08 },
    tom: { pitchDecay: 0.05, octaves: 2.6, decay: 0.30, release: 0.10 },
    snare: { noise: 'white', decay: 0.16 },
    clap: { noise: 'pink', decay: 0.16 },
    shaker: { noise: 'pink', decay: 0.065 },
    closedHat: { frequency: 300, harmonicity: 5.0, modulationIndex: 30, resonance: 6200, octaves: 1.5, decay: 0.06 },
    openHat: { frequency: 285, harmonicity: 5.0, modulationIndex: 27, resonance: 5400, octaves: 1.7, decay: 0.30 },
    ride: { frequency: 400, harmonicity: 5.2, modulationIndex: 23, resonance: 6800, octaves: 2, decay: 0.40 },
    crash: { frequency: 250, harmonicity: 5.0, modulationIndex: 34, resonance: 8200, octaves: 2.3, decay: 0.68 }
  },
  trap: {
    id: 'trap-punch',
    outputGainDb: -12,
    kick: { pitchDecay: 0.10, octaves: 7, decay: 0.30, release: 0.10 },
    tom: { pitchDecay: 0.04, octaves: 3, decay: 0.27, release: 0.09 },
    snare: { noise: 'white', decay: 0.20 },
    clap: { noise: 'pink', decay: 0.15 },
    shaker: { noise: 'white', decay: 0.045 },
    closedHat: { frequency: 390, harmonicity: 6.0, modulationIndex: 36, resonance: 7800, octaves: 1.8, decay: 0.04 },
    openHat: { frequency: 340, harmonicity: 5.7, modulationIndex: 31, resonance: 6900, octaves: 1.9, decay: 0.22 },
    ride: { frequency: 450, harmonicity: 5.8, modulationIndex: 26, resonance: 8000, octaves: 2.1, decay: 0.36 },
    crash: { frequency: 280, harmonicity: 5.5, modulationIndex: 37, resonance: 9000, octaves: 2.5, decay: 0.60 }
  },
  rock: {
    id: 'rock-acoustic',
    outputGainDb: -12,
    kick: { pitchDecay: 0.11, octaves: 4.2, decay: 0.30, release: 0.12 },
    tom: { pitchDecay: 0.06, octaves: 2.8, decay: 0.38, release: 0.13 },
    snare: { noise: 'white', decay: 0.24 },
    clap: { noise: 'pink', decay: 0.18 },
    shaker: { noise: 'white', decay: 0.07 },
    closedHat: { frequency: 270, harmonicity: 4.8, modulationIndex: 28, resonance: 5800, octaves: 1.6, decay: 0.07 },
    openHat: { frequency: 250, harmonicity: 4.7, modulationIndex: 25, resonance: 5100, octaves: 1.8, decay: 0.34 },
    ride: { frequency: 380, harmonicity: 5.0, modulationIndex: 22, resonance: 6600, octaves: 2.1, decay: 0.52 },
    crash: { frequency: 230, harmonicity: 5.0, modulationIndex: 35, resonance: 9000, octaves: 2.5, decay: 0.90 }
  },
  ambient: {
    id: 'ambient-soft',
    outputGainDb: -16,
    kick: { pitchDecay: 0.07, octaves: 4.5, decay: 0.24, release: 0.09 },
    tom: { pitchDecay: 0.05, octaves: 2.4, decay: 0.30, release: 0.10 },
    snare: { noise: 'pink', decay: 0.13 },
    clap: { noise: 'pink', decay: 0.10 },
    shaker: { noise: 'pink', decay: 0.04 },
    closedHat: { frequency: 240, harmonicity: 4.5, modulationIndex: 22, resonance: 4800, octaves: 1.3, decay: 0.045 },
    openHat: { frequency: 230, harmonicity: 4.4, modulationIndex: 20, resonance: 4300, octaves: 1.5, decay: 0.20 },
    ride: { frequency: 330, harmonicity: 4.7, modulationIndex: 19, resonance: 5600, octaves: 1.8, decay: 0.32 },
    crash: { frequency: 210, harmonicity: 4.8, modulationIndex: 28, resonance: 7600, octaves: 2.1, decay: 0.55 }
  },
  default: {
    id: 'electronic-balanced',
    outputGainDb: -13,
    kick: { pitchDecay: 0.08, octaves: 5, decay: 0.24, release: 0.08 },
    tom: { pitchDecay: 0.045, octaves: 2.5, decay: 0.32, release: 0.10 },
    snare: { noise: 'white', decay: 0.16 },
    clap: { noise: 'pink', decay: 0.12 },
    shaker: { noise: 'pink', decay: 0.055 },
    closedHat: { frequency: 320, harmonicity: 5.1, modulationIndex: 32, resonance: 6500, octaves: 1.5, decay: 0.055 },
    openHat: { frequency: 300, harmonicity: 5.1, modulationIndex: 28, resonance: 5200, octaves: 1.8, decay: 0.30 },
    ride: { frequency: 420, harmonicity: 5.5, modulationIndex: 24, resonance: 7000, octaves: 2, decay: 0.40 },
    crash: { frequency: 260, harmonicity: 5.2, modulationIndex: 36, resonance: 8500, octaves: 2.5, decay: 0.70 }
  }
};

export function getPercussionProfile(genre = '') {
  const value = String(genre || '').toLowerCase();
  const key = /ambient|cinematic|classical|downtempo/.test(value) ? 'ambient'
    : /trap|hip.?hop|drill/.test(value) ? 'trap'
    : /rock|metal|punk|grunge/.test(value) ? 'rock'
    : /house|disco|funk/.test(value) ? 'house'
    : /techno|trance|industrial|drum.?and.?bass|\bdnb\b/.test(value) ? 'techno'
    : 'default';
  const selected = PROFILES[key];
  return {
    id: selected.id,
    outputGainDb: selected.outputGainDb,
    voices: {
      kick: { ...selected.kick },
      tom: { ...selected.tom },
      snare: { ...selected.snare },
      clap: { ...selected.clap },
      shaker: { ...selected.shaker },
      closedHat: { ...selected.closedHat },
      openHat: { ...selected.openHat },
      ride: { ...selected.ride },
      crash: { ...selected.crash }
    }
  };
}

export function buildDeterministicPercussionPatch(genre = '') {
  const profile = getPercussionProfile(genre);
  return {
    instrumentType: 'MembraneSynth',
    envelope: { attack: 0.001, decay: 0.24, sustain: 0, release: 0.1 },
    volume: profile.outputGainDb,
    pan: 0,
    effects: [],
    designRationale: 'Deterministic genre-specific percussion kit; MIDI drum notes select kick, snare, hats, toms and cymbals.'
  };
}
