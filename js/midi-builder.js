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

                    // 2. ✅ ΑΛΛΑΓΗ: Το Volume στο MIDI export είναι πάντα 127 (Max)
                    // Αγνοούμε το mixVolume εδώ, ώστε το αρχείο να είναι δυνατό.
                    track.addCC({
                        number: 7, // CC #7 = Master Volume
                        value: 127, // Πάντα τέρμα
                        time: 0 
                    });

                    // 3. Προσθήκη Νοτών
                    trackData.midi.tracks[0].notes.forEach(note => {
                        if (note?.name) {
                            track.addNote({
                                midi: note.midi,
                                time: note.time,
                                duration: note.duration,
                                // ✅ Χρήση του midi velocity (συνήθως 0-1) scaled σε 0-127
                                // Αν δεν υπάρχει, βάζουμε μια δυνατή τιμή (π.χ. 100)
                                velocity: note.velocity !== undefined ? note.velocity : 0.9
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
