import { Midi } from '@tonejs/midi';
import { TRACK_INSTRUMENTS } from './config.js';

export class MidiBuilder {
  
  
    static createCombinedMidi(tracks, bpm) {
        const midi = new Midi();
        midi.header.setTempo(bpm);

        const instrumentMap = Object.fromEntries(
            Object.entries(TRACK_INSTRUMENTS).map(([key, val]) => [key, val.midiProgram || 0])
        );

        let currentChannel = 0;
        tracks.forEach((trackData, type) => {
          
            
            if (trackData?.midi?.tracks?.[0]?.notes?.length > 0) {
                const track = midi.addTrack();
                track.name = type;
                track.channel = currentChannel; // 0-indexed channels

                if (instrumentMap[type] !== undefined) {
                    track.instrument.number = instrumentMap[type];
                }
                
                trackData.midi.tracks[0].notes.forEach(note => {
                    if (note?.name) track.addNote(note);
                });
                
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
