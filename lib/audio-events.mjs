/**
 * Tone.Part stores event positions on Tone.Transport's tick timeline.
 * At the default 192 PPQ, distinct second values can resolve to the same tick.
 * Group by the resolved tick (not raw floating-point seconds) and use the
 * canonical tick time so Tone.Part receives strictly increasing positions.
 */
export const TONE_PART_PPQ = 192;

export function groupNotesByStartTime(notes, bpm, ppq = TONE_PART_PPQ) {
  if (!Array.isArray(notes) || notes.length === 0) return [];
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new Error('Invalid BPM for Tone.Part event grouping');
  }
  if (!Number.isInteger(ppq) || ppq <= 0) {
    throw new Error('Invalid PPQ for Tone.Part event grouping');
  }

  const eventsByTick = new Map();
  notes.forEach((note, index) => {
    const time = Number(note?.time);
    if (!Number.isFinite(time) || time < 0) {
      throw new Error(`Invalid note start time at index ${index}`);
    }

    const tick = Math.round((time * bpm * ppq) / 60);
    let event = eventsByTick.get(tick);
    if (!event) {
      event = {
        time: (tick * 60) / (bpm * ppq),
        notes: []
      };
      eventsByTick.set(tick, event);
    }
    event.notes.push({
      note: note.name,
      duration: note.duration,
      velocity: note.velocity
    });
  });

  return Array.from(eventsByTick.values()).sort((a, b) => a.time - b.time);
}
