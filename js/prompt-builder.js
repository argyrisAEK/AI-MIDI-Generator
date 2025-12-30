export class PromptBuilder {
    async constructMultiTrackPrompt(context) {
        try {
            // Απλά καλεί το edge function
            const response = await fetch('/api/build-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            return result.prompt;

        } catch (error) {
            console.error('Prompt builder API error:', error);
            // Fallback: Πολύ απλό prompt αν αποτύχει το API
            return this.createBasicPrompt(context);
        }
    }

    createBasicPrompt(context) {
        // ΑΠΛΟΥΣΤΑΤΟ prompt για fallback (100-200 tokens)
        return `Create ${context.trackTypes?.join(', ')} for ${context.style} in ${context.key} ${context.scale}, ${context.tempo} BPM, ${context.duration} bars.`;
    }
}
