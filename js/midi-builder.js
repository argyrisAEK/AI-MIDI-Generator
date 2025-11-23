import { Midi } from '@tonejs/midi';
import { TRACK_INSTRUMENTS } from './config.js';

export class MidiBuilder {

    static createCombinedMidi(tracks, bpm) {
        const midi = new Midi();
        midi.header.setTempo(bpm);

        let currentChannel = 0;

        tracks.forEach((trackData, type) => {
            // Έλεγχος αν υπάρχουν νότες
            if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                
                // 1. Skip Channel 10 (Drums)
                if (currentChannel === 9) {
                    currentChannel++;
                }

                const track = midi.addTrack();
                track.name = type;
                track.channel = currentChannel; 

                const instrumentConfig = TRACK_INSTRUMENTS[type];

                if (instrumentConfig) {
                    // 2. Ορισμός Οργάνου (Program Change)
                    if (instrumentConfig.midiProgram !== undefined) {
                        track.instrument.number = instrumentConfig.midiProgram;
                    }
                }
                
                // ❌ ΔΕΝ ΠΡΟΣΘΕΤΟΥΜΕ CC#7 (Volume) - Αφήνουμε το DAW να κάνει τη μίξη.

                // 3. Προσθήκη Νοτών - Μετατροπή Velocity LLM (0.0-1.0) σε MIDI (0-127)
                trackData.midi.tracks[0].notes.forEach(note => {
                    if (note?.name) {
                        
                        let rawVelocity = 0.8; // Fallback αν δεν υπάρχει velocity

                        // Χρησιμοποιούμε το velocity που έρχεται από το LLM (π.χ. 0.85)
                        if (note.velocity !== undefined && note.velocity !== null) {
                            rawVelocity = note.velocity;
                        }

                        // Μετατροπή normalized (0.0 - 1.0) σε MIDI (0 - 127)
                        let finalVelocity = Math.floor(rawVelocity * 127);
                        
                        // Ασφάλεια 1: Ελάχιστο Όριο (για να μην υπάρχει σιωπή στους players)
                        // Σημείωση: 64 είναι το 'mezzo piano' - αρκετά ακουστό
                        const MIN_VELOCITY = 64; 
                        if (finalVelocity < MIN_VELOCITY) {
                            finalVelocity = MIN_VELOCITY;
                        }

                        // Ασφάλεια 2: Μέγιστο Όριο
                        if (finalVelocity > 127) {
                            finalVelocity = 127;
                        }

                        track.addNote({
                            midi: note.midi,
                            time: note.time,
                            duration: note.duration,
                            velocity: finalVelocity // Πλέον είναι ο σωστός ακέραιος (64-127)
                        });
                    }
                });
                
                // Αύξηση καναλιού
                currentChannel++;
                if (currentChannel > 15) currentChannel = 0; 
            }
        });
        
        return midi;
    }
}
