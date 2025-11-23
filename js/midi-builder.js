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
                // Αυτό αποτρέπει τα μελωδικά όργανα να ακούγονται σαν drums
                if (currentChannel === 9) {
                    currentChannel++;
                }

                const track = midi.addTrack();
                track.name = type;
                track.channel = currentChannel; 

                const instrumentConfig = TRACK_INSTRUMENTS[type];

                if (instrumentConfig) {
                    // Ρύθμιση Οργάνου (Program Change)
                    if (instrumentConfig.midiProgram !== undefined) {
                        track.instrument.number = instrumentConfig.midiProgram;
                    }

                    // ⚠️ ΑΦΑΙΡΕΣΗ ΤΟΥ VOLUME CC:
                    // Δεν στέλνουμε καμία εντολή έντασης (CC#7). 
                    // Αφήνουμε το DAW/Player να παίξει στην default ένταση (συνήθως 100 ή 127).
                    // Αυτό λύνει το πρόβλημα που μηδένιζε το fader.

                    // 2. Προσθήκη Νοτών με Ασφαλές Velocity
                    trackData.midi.tracks[0].notes.forEach(note => {
                        if (note?.name) {
                            
                            // Υπολογισμός Velocity (Ένταση Νότας)
                            let finalVelocity = 100; // Default τιμή (αρκετά δυνατή)

                            if (note.velocity !== undefined && note.velocity !== null) {
                                // Περίπτωση 1: Το velocity είναι δεκαδικό (0.0 - 1.0) από το Tone.js
                                if (note.velocity <= 1.5) {
                                    finalVelocity = Math.floor(note.velocity * 127);
                                } 
                                // Περίπτωση 2: Το velocity είναι ήδη MIDI (0 - 127)
                                else {
                                    finalVelocity = Math.floor(note.velocity);
                                }
                            }
                            
                            // Ασφάλεια: Clamp τιμών για να μην έχουμε σιωπή (0) ή errors (>127)
                            // Βάζουμε ελάχιστο 64 για να ακούγεται καθαρά
                            if (finalVelocity < 64) finalVelocity = 80;
                            if (finalVelocity > 127) finalVelocity = 127;

                            track.addNote({
                                midi: note.midi,
                                time: note.time,
                                duration: note.duration,
                                velocity: finalVelocity // Στέλνουμε καθαρό ακέραιο
                            });
                        }
                    });
                }
                
                // Αύξηση καναλιού για το επόμενο track
                currentChannel++;
                
                // Wrap around αν ξεπεράσουμε τα κανάλια (0-15)
                if (currentChannel > 15) {
                    currentChannel = 0; 
                }
            }
        });
        
        return midi;
    }
}
