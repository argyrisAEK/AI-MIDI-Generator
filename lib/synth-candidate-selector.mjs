import { analyzeMidiForSynthesis } from './synth-candidates.mjs';

const cleanText = (value, max = 180) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

function summarizePatch(patch) {
  return {
    instrument: patch.instrumentType,
    oscillator: patch.oscillator?.type || null,
    filter: patch.filter ? { type: patch.filter.type, cutoffHz: patch.filter.frequency } : null,
    envelope: patch.envelope ? {
      attack: patch.envelope.attack,
      decay: patch.envelope.decay,
      sustain: patch.envelope.sustain,
      release: patch.envelope.release
    } : null,
    effects: (patch.effects || []).map(effect => ({
      type: effect.type,
      wet: effect.wet,
      decay: effect.decay,
      feedback: effect.feedback
    })),
    volumeDb: patch.volume,
    pan: patch.pan
  };
}

/**
 * Build one compact, arrangement-aware selection request for all curated tracks.
 * The model chooses IDs only; it cannot author DSP parameters.
 */
export function buildCandidateSelectionRequest({
  genre, subgenre, mood, key, scale, brief, direction, artist, bpm = 120, tracks = []
} = {}) {
  const trackOptions = tracks.map(track => ({
    trackType: track.trackType,
    midi: analyzeMidiForSynthesis(track.notes || [], { bpm }),
    candidates: (track.candidates || []).map(candidate => ({
      id: candidate.id,
      variant: candidate.variant,
      rationale: cleanText(candidate.rationale, 220),
      sound: summarizePatch(candidate.patch)
    }))
  })).filter(track => track.trackType && track.candidates.length);

  const system = `You are a musical sound designer selecting complete synth patches for a multitrack arrangement.
Return RAW JSON only, exactly this shape: {"selections":{"trackType":"candidate-id"},"rationale":"brief explanation"}.

SELECTION RULES
- Select exactly one candidate ID for every supplied track.
- Use only IDs listed for that track. Never invent IDs or modify synth parameters.
- Judge the whole arrangement together, not each instrument in isolation.
- Preserve role separation: bass owns the low end; lead/melody remain intelligible; chords/keys provide harmonic body; pads/strings add sustained depth; plucks/arpeggios add rhythmic detail.
- Avoid unnecessary spectral masking, excessive overlapping brightness, and competing long reverb/delay tails.
- Match the requested genre, optional subgenre, mood and creative brief. Do not substitute a different genre.
- MIDI analysis describes the notes, not permission to change them.
- Prefer a coherent, complementary palette over choosing the brightest or widest patch for every track.
- Do not output patch parameters, prose outside JSON, markdown, or additional keys.`;

  const user = [
    `STYLE: genre=${cleanText(genre, 60) || 'unspecified'}; subgenre=${cleanText(subgenre, 80) || 'not explicitly specified'}; mood=${cleanText(mood, 60) || 'neutral'}; key=${cleanText(key, 12) || 'unknown'}; scale=${cleanText(scale, 30) || 'unknown'}; tempo=${Math.round(Number(bpm) || 120)} BPM.`,
    `CREATIVE BRIEF: ${cleanText([brief?.title, brief?.description, brief?.userPrompt].filter(Boolean).join(' | '), 700) || 'None'}`,
    `GENRE DIRECTION: ${cleanText(direction, 500) || 'Follow the named genre and role.'}`,
    `ARTIST SIGNATURE: ${cleanText(artist, 220) || 'None; do not infer one.'}`,
    'TRACKS AND AVAILABLE CANDIDATES:',
    JSON.stringify(trackOptions),
    'Return one valid candidate ID per track in the selections object.'
  ].join('\n');

  return { system, user, trackOptions };
}

/**
 * Strictly map model output to supplied candidate objects.
 * Invalid/missing choices deterministically fall back to the core candidate.
 */
export function resolveCandidateSelections(raw, tracks = []) {
  const source = raw?.selections && typeof raw.selections === 'object' && !Array.isArray(raw.selections)
    ? raw.selections : {};
  const resolved = {};
  for (const track of tracks) {
    const candidates = Array.isArray(track.candidates) ? track.candidates : [];
    if (!track.trackType || !candidates.length) continue;
    const requested = typeof source[track.trackType] === 'string' ? source[track.trackType] : '';
    const selected = candidates.find(candidate => candidate.id === requested)
      || candidates.find(candidate => candidate.variant === 'core')
      || candidates[0];
    resolved[track.trackType] = {
      candidate: selected,
      selectedBy: selected.id === requested ? 'llm' : 'fallback'
    };
  }
  return resolved;
}
