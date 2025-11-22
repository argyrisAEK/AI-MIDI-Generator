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
                
                track.channel = currentChannel; 

                // Ανάκτηση ρυθμίσεων από το config
                const instrumentConfig = TRACK_INSTRUMENTS[type];

                if (instrumentConfig) {
                    // 1. Ρύθμιση Οργάνου (Program Change)
                    if (instrumentConfig.midiProgram !== undefined) {
                        track.instrument.number = instrumentConfig.midiProgram;
                    }

                    // 2. ✅ ΔΙΟΡΘΩΣΗ: Ρύθμιση έντασης ανά ΝΟΤΑ (velocity scaling)
                    // Αντί για CC#7 που επηρεάζει το κανάλι,
                    // πολλαπλασιάζουμε το velocity κάθε νότας
                    const mixVol = instrumentConfig.mixVolume !== undefined 
                        ? instrumentConfig.mixVolume 
                        : 0.7;

                    // 3. Προσθήκη Νοτών με κλιμακωμένο velocity
                    trackData.midi.tracks[0].notes.forEach(note => {
                        if (note?.name) {
                            // ✅ Πολλαπλασίασμα velocity με mixVolume
                            const scaledVelocity = Math.max(1, Math.min(127, 
                                Math.round((note.velocity || 100) * mixVol)
                            ));

                            track.addNote({
                                midi: note.midi,
                                time: note.time,
                                duration: note.duration,
                                velocity: scaledVelocity // ✅ Κλιμακωμένη ένταση
                            });
                        }
                    });
                }
                
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
