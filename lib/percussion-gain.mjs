/**
 * Arrangement gain policy for the dedicated MIDI drum kit.
 * Drum hits are short transients, so their RMS under-represents perceived level.
 * A higher target and density allowance are safe only because the independent
 * peak-safety cap below remains authoritative.
 */
export function getPercussionGainPolicy() {
  return {
    roleOffsetDb: -2,
    densityBoostLimitDb: 9,
    maxGainDb: 9
  };
}
