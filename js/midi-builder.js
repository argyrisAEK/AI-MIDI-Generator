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
                
                // 1. Skip Channel 10 (Index 9) - Drums
                // Αυτό είναι το ΜΟΝΟ που κρατάμε για να μην χαλάσει η δομή του MIDI standard
                if (currentChannel === 9) {
                    currentChannel++;
                }

                const track = midi.addTrack();
                track.name = type;
                track.channel = currentChannel; 

                const instrumentConfig = TRACK_INSTRUMENTS[type];

                // 2. Ορισμός Οργάνου (Program Change) - ΜΟΝΟ ΤΟ ΕΙΔΟΣ
                // Αυτό βοηθάει το DAW να ξέρει ότι είναι "Bass" ή "Piano", αλλά δεν πειράζει τον ήχο.
                if (instrumentConfig && instrumentConfig.midiProgram !== undefined) {
                    track.instrument.number = instrumentConfig.midiProgram;
                }

                // ❌ ΑΦΑΙΡΕΣΗ ΟΛΩΝ ΤΩΝ AUTOMATIONS
                // Καμία εντολή CC#7 (Volume), CC#10 (Pan), κλπ.
                // Το κανάλι είναι "παρθένο".

                // 3. Προσθήκη Νοτών (Flat / Raw Velocity)
                trackData.midi.tracks[0].notes.forEach(note => {
                    if (note?.name) {
                        track.addNote({
                            midi: note.midi,
                            time: note.time,
                            duration: note.duration,
                            
                            // ✅ RAW VELOCITY:
                            // Αγνοούμε τελείως το velocity της εφαρμογής (που μπορεί να έχει δυναμικές).
                            // Βάζουμε σταθερό 110 (από 127). 
                            // Είναι πολύ δυνατό για να ακούγεται καθαρά παντού, 
                            // αλλά αφήνει λίγο περιθώριο αν ο χρήστης θέλει να το δυναμώσει κι άλλο στο DAW.
                            velocity: 110 
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
