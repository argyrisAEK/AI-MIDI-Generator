/**
 * Export-render polyphony helpers.
 * Uses MIDI note-on/note-off intervals in seconds; touching notes do not overlap.
 */

export function getMaxNotePolyphony(notes) {
  const events = [];
  for (const note of Array.isArray(notes) ? notes : []) {
    const start = Number(note?.time);
    const duration = Number(note?.duration);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) continue;
    events.push({ time: start, delta: 1 });
    events.push({ time: start + duration, delta: -1 });
  }

  // Note-offs precede note-ons at identical timestamps: touching notes are
  // sequential, while notes beginning together correctly count as concurrent.
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0;
  let maximum = 0;
  for (const event of events) {
    active += event.delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

export function getMonoSynthVoiceCount(notes, maxVoices = 16) {
  const safeLimit = Number.isFinite(maxVoices)
    ? Math.max(1, Math.min(16, Math.floor(maxVoices)))
    : 16;
  return Math.max(1, Math.min(safeLimit, getMaxNotePolyphony(notes)));
}
