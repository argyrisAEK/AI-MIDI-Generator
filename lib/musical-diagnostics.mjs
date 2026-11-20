// Read-only musical diagnostics for generated MIDI. Never mutates or filters notes.
export function analyzeMusicalDiagnostics({
  tracks,
  trackCodes,
  keyPitchClass,
  scaleIntervals,
  percussionCode = 'perc'
}) {
  const allowed = new Set(scaleIntervals.map(interval => (keyPitchClass + interval) % 12));
  const perTrack = {};
  let totalNotes = 0;
  let totalOutOfScale = 0;

  for (const [name, code] of Object.entries(trackCodes)) {
    if (code === percussionCode || typeof tracks?.[code] !== 'string') continue;
    const parts = tracks[code].trim() ? tracks[code].split('|') : [];
    let notes = 0;
    let outOfScale = 0;
    for (const part of parts) {
      const pitch = Number(part.trim().split(':')[0]);
      if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) continue;
      notes++;
      if (!allowed.has(pitch % 12)) outOfScale++;
    }
    if (notes || Object.hasOwn(tracks, code)) {
      perTrack[name] = {
        notes,
        outOfScale,
        scaleConformityPercent: notes ? Math.round((notes - outOfScale) / notes * 1000) / 10 : 100
      };
    }
    totalNotes += notes;
    totalOutOfScale += outOfScale;
  }

  return {
    totalNotes,
    outOfScale: totalOutOfScale,
    scaleConformityPercent: totalNotes
      ? Math.round((totalNotes - totalOutOfScale) / totalNotes * 1000) / 10
      : 100,
    perTrack
  };
}
