export class PromptBuilder {
    async constructMultiTrackPrompt(context) {
        try {
            const response = await fetch('/api/build-prompt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    context: context
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            
            if (result.error) {
                throw new Error(result.error);
            }

            return result.prompt;

        } catch (error) {
            console.error('Error in prompt builder API call:', error);
            // Fallback σε τοπική κατασκευή αν αποτύχει το API
            return this.fallbackConstructPrompt(context);
        }
    }

    // Fallback method για περιπτώσεις αποτυχίας
    fallbackConstructPrompt(context) {
        const beatsPerBar = parseInt((context.timeSignature || '4/4').split('/')[0]);
        const totalBeats = context.duration * beatsPerBar;
        
        let prompt = `Act as a world-class Music Producer specializing in ${context.style || 'house'}.
Generate a professional multi-track MIDI composition in strict JSON format.

MUSICAL PARAMETERS:
- Key: ${context.key || 'C'} ${context.scale || 'major'}
- Tempo: ${context.tempo || 120} BPM
- Total Length: ${context.duration || 4} bars (${totalBeats} beats)
- Mood: ${context.mood || 'mysterious'}
- Structure: ${context.structure || 'A-B-A (Intro-Main-Outro)'}
- Chord Progression: ${(context.chordProgression || ['I', 'V', 'vi', 'IV']).join(' -> ')}

TRACK TYPES: ${(context.trackTypes || ['bassline', 'melody']).join(', ')}

Generate professional music with clear arrangement and strong musical coherence.`;

        return prompt;
    }
}
