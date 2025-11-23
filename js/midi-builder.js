import { Midi } from '@tonejs/midi';
import { TRACK_INSTRUMENTS } from './config.js';

export class MidiBuilder {

    static createCombinedMidi(tracks, bpm) {
        const midi = new Midi();
        midi.header.setTempo(bpm);

        let currentChannel = 0;

        tracks.forEach((trackData, type) => {
            // Έλεγχος αν υπάρχουν νότες στο track
            if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                
                // 1. Skip Channel 10 (Index 9) - Reserved for Percussion
                if (currentChannel === 9) {
                    currentChannel++;
                }

                const track = midi.addTrack();
                track.name = type;
                track.channel = currentChannel; 

                // Ανάκτηση ρυθμίσεων από το config
                const instrumentConfig = TRACK_INSTRUMENTS[type];

                if (instrumentConfig) {
                    // Ρύθμιση Οργάνου (Program Change)
                    if (instrumentConfig.midiProgram !== undefined) {
                        track.instrument.number = instrumentConfig.midiProgram;
                    }

                    // 2. Ρύθμιση Master Volume (CC#7) στο MAX (127)
                    track.addCC({
                        number: 7, 
                        value: 127, 
                        time: 0 
                    });

                    // 3. Προσθήκη Νοτών με Σωστό Velocity (0-127)
                    trackData.midi.tracks[0].notes.forEach(note => {
                        if (note?.name) {
                            // Έλεγχος και μετατροπή velocity
                            let finalVelocity = 100; // Default δυνατό velocity

                            if (note.velocity !== undefined) {
                                // Αν το velocity είναι μικρό (π.χ. 0.8), είναι normalized (0-1)
                                if (note.velocity <= 1.0) {
                                    finalVelocity = Math.floor(note.velocity * 127);
                                } else {
                                    // Αν είναι ήδη μεγάλο (π.χ. 100), το κρατάμε ως έχει
                                    finalVelocity = Math.floor(note.velocity);
                                }
                            }
                            
                            // Ασφάλεια: Να μην είναι κάτω από 60 για να ακούγεται καθαρά
                            if (finalVelocity < 60) finalVelocity = 80;
                            // Ασφάλεια: Να μην ξεπερνά το 127
                            if (finalVelocity > 127) finalVelocity = 127;

                            track.addNote({
                                midi: note.midi,
                                time: note.time,
                                duration: note.duration,
                                velocity: finalVelocity // Πλέον στέλνουμε ακέραιο 0-127
                            });
                        }
                    });
                }
                
                // Αύξηση καναλιού για το επόμενο track
                currentChannel++;
                
                if (currentChannel > 15) {
                    console.warn("Too many tracks, exceeding standard MIDI channels (0-15). Wrapping around.");
                    currentChannel = 0; 
                }
            }
        });
        
        return midi;
    }
}
