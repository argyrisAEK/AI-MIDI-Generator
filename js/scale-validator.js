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
        return this.validateStrict(notes); // Updated to remove notes

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
      // Apply gentle pull toward nearby scale notes
      const adjustedNotes = notes.map(note => {
        if (!this.isNoteInScale(note.midi)) {
          const nearestNote = this.findNearestScaleNote(note.midi);
          // Apply a "soft" adjustment - only if far from scale
          const distance = Math.abs(note.midi - nearestNote);
          if (distance > 2) { // Original logic: adjust if distance is > 2 semitones
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
          message: `Soft mode: Adjusted ${adjustedCount} notes out of ${notes.length} (${outOfScalePercentage.toFixed(1)}% were out of scale)`
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
   * MEDIUM mode: Replace only out-of-scale notes that are far from the scale.
   * Allows chromatic notes (1 semitone away) as passing tones. (MODIFIED)
   */
  validateMedium(notes) {
    // Define the maximum distance (in semitones) an out-of-scale note can be
    // from the nearest scale note to be ALLOWED (kept as is).
    const CHROMATIC_TOLERANCE_DISTANCE = 1; 

    let adjustedCount = 0;
    const adjustedNotes = notes.map(note => {
      // 1. Check if the note is OUT of scale
      if (!this.isNoteInScale(note.midi)) {
        
        // 2. Find the nearest scale note and distance
        const nearestNote = this.findNearestScaleNote(note.midi);
        const distance = Math.abs(note.midi - nearestNote);

        // 3. Check if the distance is within the allowed chromatic tolerance (1 semitone)
        if (distance <= CHROMATIC_TOLERANCE_DISTANCE) {
          // If it's only 1 semitone away, keep the chromatic note
          return note; 
        } else {
          // If it's further than 1 semitone away, adjust it to the nearest scale note
          adjustedCount++;
          return { ...note, midi: nearestNote, name: this.midiToNoteName(nearestNote), adjusted: true };
        }
      }
      // If the note is already IN scale, keep it
      return note;
    });

    const originalOutOfScale = this.calculateOutOfScalePercentage(notes);
    
    return {
      notes: adjustedNotes,
      stats: {
        outOfScale: originalOutOfScale, 
        adjusted: adjustedCount,
        message: `Medium mode: Allowed chromatic notes (1 semitone away). Adjusted ${adjustedCount} out-of-scale notes that exceeded tolerance.`
      }
    };
  }

  /**
   * STRICT mode: Remove all out-of-scale notes (MODIFIED)
   */
  validateStrict(notes) {
    let removedCount = 0;
    
    // Filter out all notes that are not in the scale
    const adjustedNotes = notes.filter(note => {
      if (!this.isNoteInScale(note.midi)) {
        removedCount++;
        return false; // Remove the note
      }
      return true; // Keep the in-scale note
    });

    // Calculate the percentage of notes that were originally out of scale
    const outOfScalePercentage = this.calculateOutOfScalePercentage(notes);

    return {
      notes: adjustedNotes,
      stats: {
        outOfScale: outOfScalePercentage,
        adjusted: removedCount, // 'adjusted' now means 'removed'
        message: `Strict mode: Removed ${removedCount} out-of-scale notes. Resulting sequence is purely diatonic.`
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
