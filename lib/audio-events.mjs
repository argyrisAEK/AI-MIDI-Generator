/**
 * Tone.Part's timeline requires strictly increasing event times.
 * Group simultaneous notes into one event so chords and layered percussion hits
 * are scheduled at the same audio time without duplicate timeline timestamps.
 */

export function groupNotesByStartTime(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return [];
  const eventsByTime = new Map();
  notes.forEach((note, index) => {
    const time = Number(note?.time);
    if (!Number.isFinite(time) || time < 0) {
      throw new Error(`Invalid note start time at index ${index}`);
    }
    let event = eventsByTime.get(time);
    if (!event) {
      event = { time, notes: [] };
      eventsByTime.set(time, event);
    }
    event.notes.push({ note: note.name, duration: note.duration, velocity: note.velocity });
  });
  return Array.from(eventsByTime.values()).sort((a, b) => a.time - b.time);
}
