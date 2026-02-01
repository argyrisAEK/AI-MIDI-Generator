// Track-specific instructions
const trackInstructions = {
    bassline: "31-55,root,1.0",
    chord: "48-72,3notes",
    melody: "60-84,motif",
    arpeggio: "48-84,rolling",
    lead: "60-96,highvel",
    plucks: "60-84,staccato",
    strings: "48-84,legato",
    keys: "48-72,harmonic",
    guitar: "40-76,strum",
    'pad-textures': "36-72,drone",
    brass: "40-80,punchy",
    percs: "36-60,rhythm"
};

export const trackAbbreviations = {
    bassline: 'bass',
    chord: 'chd',
    melody: 'mel',
    arpeggio: 'arp',
    lead: 'lead',
    plucks: 'plk',
    strings: 'str',
    keys: 'key',
    guitar: 'gtr',
    'pad-textures': 'pad',
    brass: 'brss',
    percs: 'perc'
};

export class PromptBuilder {
    /**
     * Ultra-compact prompt with token optimization.
     * Fixed encoding symbols (∈, →) and original logic preserved.
     */
    constructMultiTrackPrompt(params = {}) {
        try {
            const key = params.key || 'C';
            const bpm = params.bpm || 120;
            const style = params.style || 'electronic';
            const mood = params.mood || 'neutral';
            const timeSignature = params.timeSignature || '4/4';
            const bars = params.bars || 4;
            const complexity = params.complexity || 'M';
            const tracks = params.tracks || ['bassline', 'melody'];
            const enhancedPrompt = params.enhancedPrompt || '';

            const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
            const totalBeats = bars * beatsPerBar;

            const trackList = tracks
                .map(t => `${trackAbbreviations[t] || t}(${trackInstructions[t] || 'range auto'})`)
                .join(' ');

            const trackAbbrList = tracks
                .map(t => trackAbbreviations[t] || t)
                .join('","');

            // -------- Original Rules with Fixed Symbols --------
            const rules = `TIME:u=beat,bar=${beatsPerBar},start∈[0,${totalBeats})|REP:m12>rv34,bass@1-2,!rnd|INT:mel→chd=simple,mel→bass=fill`;

            // -------- Final Prompt Format --------
            const prompt = 
`CFG:key=${key},bpm=${bpm},style=${style},mood=${mood},time=${timeSignature},bars=${bars},cmp=${complexity}
RULES:${rules}
TRACKS:${trackList}
FORMAT:pitch:beat:dur:vel|... (vel:1-9, .5 for 0.5)
OUT:{"t":"${params.title || 'Composition'}","tracks":{"${trackAbbrList}":"p:b:d:v|..."}}
${enhancedPrompt ? `CONTEXT:${enhancedPrompt}` : ''}`;

            console.log('[PromptBuilder] Generated ultra-compact prompt with encoding fixes');
            return prompt;

        } catch (error) {
            console.error('PromptBuilder error:', error);
            return `CFG:key=C,bpm=120,style=house,bars=4\nTRACKS:bass mel\nFORMAT:p:b:d:v|\nOUT:{"t":"Fallback","tracks":{"bass":"","mel":""}}`;
        }
    }
}
