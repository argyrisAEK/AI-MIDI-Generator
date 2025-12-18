import * as Tone from 'tone';

export const ScaleStrictness = {
  SOFT: 'soft',
  MEDIUM: 'medium',
  STRICT: 'strict'
};

export class ScaleValidator {
  constructor() {
    this.scaleNotes = [];
    this.rootKey = 'C';
    this.scaleType = 'major';
  }

  /**
   * Set the scale based on key and scale type
   */
  setScale(key, scaleType) {
    this.rootKey = key;
    this.scaleType = scaleType;
    this.scaleNotes = this.buildScaleNotes(key, scaleType);
  }

  /**
   * Build MIDI note numbers for a given key and scale type
   */
  buildScaleNotes(key, scaleType) {
    const noteToMidi = {
      'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
      'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
    };

    const scales = {
      'major': [0, 2, 4, 5, 7, 9, 11],
      'minor': [0, 2, 3, 5, 7, 8, 10],
      'pentatonic': [0, 2, 4, 7, 9],
      'blues': [0, 3, 5, 6, 7, 10]
    };

    const rootOffset = noteToMidi[key] || 0;
    const scaleIntervals = scales[scaleType] || scales['major'];
    const scaleNotes = [];

    // Generate scale notes across multiple octaves (C1 to C7)
    for (let octave = 1; octave <= 7; octave++) {
      for (const interval of scaleIntervals) {
        const midi = rootOffset + (octave * 12) + interval;
        if (midi >= 12 && midi <= 108) {
          scaleNotes.push(midi);
        }
      }
    }

    return scaleNotes.sort((a, b) => a - b);
  }

  /**
   * Check if a MIDI note is in the scale
   */
  isNoteInScale(midiNote) {
    const noteClass = midiNote % 12;
    const baseScaleClasses = this.scaleNotes.map(n => n % 12);
    return baseScaleClasses.includes(noteClass);
  }

  /**
   * Find the nearest scale note to a given MIDI note
   */
  findNearestScaleNote(midiNote) {
    const scaleNotes = this.scaleNotes;
    let nearest = scaleNotes[0];
    let minDistance = Math.abs(midiNote - nearest);

    for (const note of scaleNotes) {
      const distance = Math.abs(midiNote - note);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = note;
      }
    }

    return nearest;
  }

  /**
   * Calculate percentage of notes out of scale
   */
  calculateOutOfScalePercentage(notes) {
    if (notes.length === 0) return 0;
    const outOfScale = notes.filter(note => !this.isNoteInScale(note.midi)).length;
    return (outOfScale / notes.length) * 100;
  }

  /**
   * Validate and adjust notes based on strictness level
   */
  validateNotes(notes, strictness = ScaleStrictness.MEDIUM) {
    if (!notes || notes.length === 0) return { notes, stats: { outOfScale: 0, adjusted: 0 } };

    const outOfScalePercentage = this.calculateOutOfScalePercentage(notes);

    switch (strictness) {
      case ScaleStrictness.SOFT:
        return this.validateSoft(notes, outOfScalePercentage);

      case ScaleStrictness.MEDIUM:
        return this.validateMedium(notes);

      case ScaleStrictness.STRICT:
        return this.validateStrict(notes);

      default:
        return { notes, stats: { outOfScale: outOfScalePercentage, adjusted: 0 } };
    }
  }

  /**
   * SOFT mode: Only adjust if >30% out of scale
   */
  validateSoft(notes, outOfScalePercentage) {
    const THRESHOLD = 30;

    if (outOfScalePercentage > THRESHOLD) {
      const adjustedNotes = notes.map(note => {
        if (!this.isNoteInScale(note.midi)) {
          const nearestNote = this.findNearestScaleNote(note.midi);
          const distance = Math.abs(note.midi - nearestNote);
          if (distance > 2) {
            return { ...note, midi: nearestNote, name: this.midiToNoteName(nearestNote), adjusted: true };
          }
        }
        return note;
      });

      const adjustedCount = adjustedNotes.filter(n => n.adjusted).length;
      return {
        notes: adjustedNotes,
        stats: {
          outOfScale: outOfScalePercentage,
          adjusted: adjustedCount,
          message: `Soft mode: Adjusted ${adjustedCount} notes out of ${notes.length}`
        }
      };
    }

    return {
      notes,
      stats: {
        outOfScale: outOfScalePercentage,
        adjusted: 0,
        message: `Soft mode: Only ${outOfScalePercentage.toFixed(1)}% out of scale, no adjustments needed`
      }
    };
  }

  /**
   * MEDIUM mode: Snap to scale EXCEPT for chromatic passing notes
   * A passing note is defined as an out-of-scale note that sits between two in-scale notes.
   */
  validateMedium(notes) {
    let adjustedCount = 0;
    let passingNotesCount = 0;

    const adjustedNotes = notes.map((note, index) => {
      // Αν η νότα είναι ήδη στην κλίμακα, την αφήνουμε
      if (this.isNoteInScale(note.midi)) {
        return note;
      }

      // Έλεγχος για Chromatic Passing Note
      const prevNote = notes[index - 1];
      const nextNote = notes[index + 1];

      if (prevNote && nextNote) {
        const isPrevInScale = this.isNoteInScale(prevNote.midi);
        const isNextInScale = this.isNoteInScale(nextNote.midi);

        // Συνθήκη: Η προηγούμενη και η επόμενη είναι εντός κλίμακας
        // ΚΑΙ η τρέχουσα νότα είναι ανάμεσα τους (ανοδικά ή καθοδικά)
        const isBetween = (prevNote.midi < note.midi && note.midi < nextNote.midi) ||
                          (prevNote.midi > note.midi && note.midi > nextNote.midi);

        if (isPrevInScale && isNextInScale && isBetween) {
          passingNotesCount++;
          return { ...note, isPassingNote: true }; // Την κρατάμε ως έχει
        }
      }

      // Αν δεν είναι passing note, την διορθώνουμε στην πλησιέστερη της κλίμακας
      const nearestNote = this.findNearestScaleNote(note.midi);
      adjustedCount++;
      return { ...note, midi: nearestNote, name: this.midiToNoteName(nearestNote), adjusted: true };
    });

    const outOfScalePercentage = ( (adjustedCount + passingNotesCount) / notes.length) * 100;
    
    return {
      notes: adjustedNotes,
      stats: {
        outOfScale: outOfScalePercentage,
        adjusted: adjustedCount,
        passingNotes: passingNotesCount,
        message: `Medium mode: Adjusted ${adjustedCount} notes. Preserved ${passingNotesCount} chromatic passing notes.`
      }
    };
  }

  /**
   * STRICT mode: Force ALL notes to the scale
   */
  validateStrict(notes) {
    let adjustedCount = 0;
    const adjustedNotes = notes.map(note => {
      if (!this.isNoteInScale(note.midi)) {
        const nearestNote = this.findNearestScaleNote(note.midi);
        adjustedCount++;
        return { ...note, midi: nearestNote, name: this.midiToNoteName(nearestNote), adjusted: true };
      }
      return note;
    });

    const outOfScalePercentage = (adjustedCount / notes.length) * 100;
    return {
      notes: adjustedNotes,
      stats: {
        outOfScale: outOfScalePercentage,
        adjusted: adjustedCount,
        message: `Strict mode: Forced all ${adjustedCount} out-of-scale notes to scale`
      }
    };
  }

  /**
   * Convert MIDI number to note name
   */
  midiToNoteName(midi) {
    try {
      return Tone.Frequency(midi, 'midi').toNote();
    } catch (e) {
      console.warn('Could not convert MIDI to note name:', midi);
      return 'C4';
    }
  }
}
