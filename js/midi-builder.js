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

                    // 2. ✅ Ρύθμιση έντασης με CC#7 (Volume) στο τέλος
                    const mixVol = instrumentConfig.mixVolume !== undefined 
                        ? instrumentConfig.mixVolume 
                        : 0.7;
                    
                    // Υπολογισμός του μέγιστου χρόνου των νοτών
                    const maxNoteTime = Math.max(
                        ...trackData.midi.tracks[0].notes.map(n => (n.time || 0) + (n.duration || 0))
                    );

                    // CC#7 στο τέλος του track για σταθερή ένταση
                    const midiVol = Math.floor(mixVol * 127);
                    track.addCC({
                        number: 7, // CC #7 = Master Volume
                        value: midiVol,
                        time: maxNoteTime + 0.1 // Μετά όλες τις νότες
                    });

                    // 3. Προσθήκη Νοτών (χωρίς velocity scaling)
                    trackData.midi.tracks[0].notes.forEach(note => {
                        if (note?.name) {
                            track.addNote({
                                midi: note.midi,
                                time: note.time,
                                duration: note.duration,
                                velocity: note.velocity || 100
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
