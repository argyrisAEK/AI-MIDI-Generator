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
                const track = midi.addTrack();
                track.name = type;
                
                // Διαχείριση καναλιών (Channel 10 is reserved for drums in GM, usually skipped in melodics)
                // Εδώ κάνουμε απλή αρίθμηση, αλλά αν έχεις drums, καλό είναι να πάνε στο ch 9 (που είναι το 10 σε 1-based)
                track.channel = currentChannel; 

                // Ανάκτηση ρυθμίσεων από το config
                const instrumentConfig = TRACK_INSTRUMENTS[type];

                if (instrumentConfig) {
                    // 1. Ρύθμιση Οργάνου (Program Change)
                    if (instrumentConfig.midiProgram !== undefined) {
                        track.instrument.number = instrumentConfig.midiProgram;
                    }

                    // 2. Ρύθμιση Έντασης (Volume - CC 7)
                    // Default στο 0.7 αν δεν έχει οριστεί mixVolume
                    const volRatio = instrumentConfig.mixVolume !== undefined ? instrumentConfig.mixVolume : 0.7;
                    const midiVol = Math.floor(volRatio * 127);

                    track.addCC({
                        number: 7, // CC #7 = Volume
                        value: midiVol,
                        time: 0
                    });
                }
                
                // 3. Προσθήκη Νοτών
                trackData.midi.tracks[0].notes.forEach(note => {
                    if (note?.name) {
                        track.addNote({
                            midi: note.midi,
                            time: note.time,
                            duration: note.duration,
                            velocity: note.velocity
                        });
                    }
                });
                
                // Αύξηση καναλιού για το επόμενο track
                currentChannel++;
                if (currentChannel > 15) {
                    console.warn("Too many tracks, exceeding standard MIDI channels (0-15).");
                    currentChannel = 0; 
                }
            }
        });
        
        return midi;
    }
}
