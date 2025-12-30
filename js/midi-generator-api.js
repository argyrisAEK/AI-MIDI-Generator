// Client-side wrapper: delegates generation to server-side /api/generate
import { Midi } from '@tonejs/midi';

// musicalContext: object produced by MusicalContext.generateContext(...) on client
// expectedTracks: array of track keys (['melody','bassline', ...])
export async function generateMultiTrackMIDIFromAPI(musicalContext, ui, expectedTracks) {
    const generatedMidis = new Map();
    let compositionTitle = '';
    let compositionDescription = '';
    let rawJsonResponse = '';

    try {
        if (!expectedTracks || expectedTracks.length === 0) {
            throw new Error('No tracks requested for generation.');
        }

        ui.showMessage(`Requesting server-side generation for ${expectedTracks.length} tracks...`, 'loading');

        const bpm = parseInt(musicalContext.tempo || musicalContext.bpm || document.getElementById('bpm')?.value || 120, 10) || 120;
        const bars = parseInt(musicalContext.duration || document.getElementById('duration')?.value || 4, 10) || 4;
        const timeSignature = musicalContext.timeSignature || document.getElementById('time-signature')?.value || '4/4';

        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                musicalContext,
                expectedTracks,
                bpm,
                bars,
                timeSignature
            })
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Server generation failed: ${res.status} ${txt}`);
        }

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        compositionTitle = data.title || 'Generated Composition';
        compositionDescription = data.description || '';

        function base64ToUint8Array(base64) {
            const binaryString = atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
        }

        for (const [trackType, info] of Object.entries(data.tracks || {})) {
            try {
                const u8 = base64ToUint8Array(info.base64);
                const midi = new Midi(u8.buffer);
                generatedMidis.set(trackType, {
                    midi,
                    title: info.filename || `${compositionTitle} - ${trackType}`,
                    description: `${trackType} track`
                });
            } catch (e) {
                console.warn(`Failed to parse MIDI for ${trackType}:`, e);
            }
        }

        if (data.combined?.base64) {
            try {
                const cu8 = base64ToUint8Array(data.combined.base64);
                const midiCombined = new Midi(cu8.buffer);
                generatedMidis.set('combined', {
                    midi: midiCombined,
                    title: data.combined.filename || `${compositionTitle}-combined`,
                    description: 'Combined multitrack file'
                });
            } catch (e) {
                console.warn('Failed to parse combined midi:', e);
            }
        }

        if (generatedMidis.size === 0) {
            throw new Error('Server returned no valid MIDI tracks.');
        }

        return { tracks: generatedMidis, compositionTitle, compositionDescription, rawJson: rawJsonResponse || null };
    } catch (error) {
        console.error('Generation failed:', error);
        ui.showMessage(`Generation failed: ${error.message}`, 'error');
        throw error;
    }
}
