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
                
                // 1. Skip Channel 10 (Index 9) - Drums
                if (currentChannel === 9) {
                    currentChannel++;
                }

                const track = midi.addTrack();
                track.name = type;
                track.channel = currentChannel; 

                const instrumentConfig = TRACK_INSTRUMENTS[type];

                if (instrumentConfig) {
                    // Ρύθμιση Οργάνου
                    if (instrumentConfig.midiProgram !== undefined) {
                        track.instrument.number = instrumentConfig.midiProgram;
                    }

                    // --- INTELLIGENT MIXING FOR GENERAL MIDI PLAYERS ---
                    // Επειδή οι απλοί players έχουν πολύ δυνατά μπάσα και αδύναμα πρίμα,
                    // ορίζουμε διαφορετικά επίπεδα έντασης (Volume CC#7) ανάλογα με τον τύπο.
                    
                    let mixVolume = 100; // Default

                    // Ιεραρχία Έντασης:
                    if (['melody', 'lead', 'brass'].includes(type)) {
                        mixVolume = 127; // Τέρμα δυνατά για να ξεχωρίζει
                    } else if (['strings', 'pad-textures', 'chord', 'keys'].includes(type)) {
                        mixVolume = 110; // Αρκετά δυνατά γιατί αυτοί οι ήχοι είναι συνήθως "λεπτοί"
                    } else if (['bass', 'bassline'].includes(type)) {
                        mixVolume = 85;  // ΧΑΜΗΛΩΜΑ: Το General MIDI μπάσο είναι πολύ δυνατό, το κόβουμε.
                    } else if (['plucks', 'arpeggio', 'guitar'].includes(type)) {
                        mixVolume = 105;
                    }

                    // Εφαρμογή Volume (CC#7) στην αρχή (Time 0)
                    track.addCC({
                        number: 7, 
                        value: mixVolume, 
                        time: 0 
                    });


                    // 3. Προσθήκη Νοτών
                    trackData.midi.tracks[0].notes.forEach(note => {
                        if (note?.name) {
                            
                            // Υπολογισμός Velocity (Δύναμη χτυπήματος)
                            // Κρατάμε το velocity ψηλά για να ενεργοποιούνται τα "λαμπερά" samples
                            let finalVelocity = 100; 

                            if (note.velocity !== undefined && note.velocity !== null) {
                                if (note.velocity <= 1.5) {
                                    finalVelocity = Math.floor(note.velocity * 127);
                                } else {
                                    finalVelocity = Math.floor(note.velocity);
                                }
                            }
                            
                            // Boost velocities for quiet instruments specifically
                            if (['strings', 'pad-textures'].includes(type)) {
                                finalVelocity = Math.min(finalVelocity + 15, 127);
                            }

                            // Clamp values
                            if (finalVelocity < 70) finalVelocity = 70; // Ποτέ πολύ σιγά
                            if (finalVelocity > 127) finalVelocity = 127;

                            track.addNote({
                                midi: note.midi,
                                time: note.time,
                                duration: note.duration,
                                velocity: finalVelocity
                            });
                        }
                    });
                }
                
                // Αύξηση καναλιού
                currentChannel++;
                if (currentChannel > 15) currentChannel = 0; 
            }
        });
        
        return midi;
    }
}
