import { Midi } from '@tonejs/midi';
import { TRACK_INSTRUMENTS } from './config.js';

export class MidiBuilder {
    /**
     * Creates a combined MIDI file from multiple tracks
     * FIXED: Better error handling, channel management, and validation
     */
    static createCombinedMidi(tracks, bpm) {
        // Validate inputs
        if (!tracks || !(tracks instanceof Map) || tracks.size === 0) {
            console.warn('createCombinedMidi: Invalid or empty tracks map');
            return null;
        }

        if (!bpm || bpm <= 0 || bpm > 300) {
            console.warn(`createCombinedMidi: Invalid BPM ${bpm}, using default 120`);
            bpm = 120;
        }

        try {
            const midi = new Midi();
            midi.header.setTempo(bpm);

            // Build instrument map with fallback
            const instrumentMap = {};
            try {
                if (TRACK_INSTRUMENTS && typeof TRACK_INSTRUMENTS === 'object') {
                    Object.entries(TRACK_INSTRUMENTS).forEach(([key, val]) => {
                        instrumentMap[key] = (val && typeof val === 'object') ? (val.midiProgram || 0) : 0;
                    });
                }
            } catch (e) {
                console.warn('Could not load instrument map from config:', e);
            }

            let currentChannel = 0;
            let tracksAdded = 0;

            // Iterate through tracks and add them to MIDI
            tracks.forEach((trackData, type) => {
                try {
                    // Validate track data structure
                    if (!trackData || typeof trackData !== 'object') {
                        console.warn(`Track '${type}' has invalid data structure, skipping`);
                        return;
                    }

                    // Get notes from either trackData.midi or direct notes array
                    let notes = [];
                    if (trackData.midi && trackData.midi.tracks && trackData.midi.tracks[0]) {
                        notes = trackData.midi.tracks[0].notes || [];
                    } else if (Array.isArray(trackData.notes)) {
                        notes = trackData.notes;
                    }

                    // Only add track if it has notes
                    if (!notes || notes.length === 0) {
                        console.warn(`Track '${type}' has no notes, skipping`);
                        return;
                    }

                    // Create track and set properties
                    const midiTrack = midi.addTrack();
                    midiTrack.name = String(type);
                    midiTrack.channel = currentChannel;

                    // Set instrument if available
                    if (instrumentMap[type] !== undefined) {
                        try {
                            midiTrack.instrument.number = instrumentMap[type];
                        } catch (e) {
                            console.warn(`Could not set instrument for track '${type}':`, e);
                        }
                    }

                    // Add notes to track
                    notes.forEach((note, index) => {
                        try {
                            if (note && note.name && note.time !== undefined && note.duration !== undefined) {
                                midiTrack.addNote({
                                    name: note.name,
                                    time: note.time,
                                    duration: note.duration,
                                    velocity: note.velocity || 0.8
                                });
                            } else {
                                console.warn(`Note ${index} in track '${type}' has invalid structure:`, note);
                            }
                        } catch (noteError) {
                            console.warn(`Error adding note ${index} to track '${type}':`, noteError);
                        }
                    });

                    currentChannel++;
                    tracksAdded++;

                    // Reset channel if exceeds MIDI limit (0-15)
                    if (currentChannel > 15) {
                        console.warn(`Exceeded standard MIDI channels (0-15), resetting to 0`);
                        currentChannel = 0;
                    }

                } catch (trackError) {
                    console.error(`Error processing track '${type}':`, trackError);
                    // Continue with next track on error
                }
            });

            if (tracksAdded === 0) {
                console.warn('No tracks were successfully added to MIDI');
                return null;
            }

            console.log(`Successfully created MIDI with ${tracksAdded} track(s)`);
            return midi;

        } catch (error) {
            console.error('Failed to create combined MIDI:', error);
            return null;
        }
    }
}
