/**
 * Tone.Part accepts explicit transport-tick notation ("<integer>i").
 * Supplying ticks directly avoids converting quantized seconds back into ticks,
 * which can introduce floating-point boundary errors in Tone's event timeline.
 * Notes that resolve to the same transport tick are grouped into one event.
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
      event = { notes: [] };
      eventsByTick.set(tick, event);
    }
    event.notes.push({
      note: note.name,
      duration: note.duration,
      velocity: note.velocity
    });
  });

  return Array.from(eventsByTick.entries())
    .sort(([a], [b]) => a - b)
    .map(([tick, event]) => ({
      time: `${tick}i`,
      notes: event.notes
    }));
}
