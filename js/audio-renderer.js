import * as Tone from 'tone';

/**
 * AudioRenderer — Offline Tone.js render → WAV (native, no external library)
 */
export class AudioRenderer {

    async render({ trackType, notes, synthSettings, bpm, durationSeconds, onProgress }) {
        if (!notes || notes.length === 0) throw new Error('No notes to render');

        onProgress?.(0.05);

        const renderDuration = durationSeconds + 1.5;

        let audioBuffer;
        try {
            audioBuffer = await Tone.Offline(async ({ transport }) => {
                transport.bpm.value = bpm;

                const synth = this._buildSynth(synthSettings);

                const part = new Tone.Part((time, event) => {
                    try {
                        synth.triggerAttackRelease(
                            event.note,
                            event.duration,
                            time,
                            event.velocity
                        );
                    } catch (e) { /* voice overflow */ }
                }, notes.map(n => ({
                    time:     n.time,
                    note:     n.name,
                    duration: n.duration,
                    velocity: n.velocity
                }))).start(0);

                transport.start(0);
            }, renderDuration, 2);

        } catch (err) {
            throw new Error(`Offline render failed: ${err.message}`);
        }

        onProgress?.(0.75);

        const wavBlob = this._audioBufferToWav(audioBuffer);

        onProgress?.(1.0);
        return wavBlob;
    }

    _audioBufferToWav(audioBuffer) {
        const numChannels   = audioBuffer.numberOfChannels;
        const sampleRate    = audioBuffer.sampleRate;
        const numSamples    = audioBuffer.length;
        const bitsPerSample = 16;
        const blockAlign    = numChannels * (bitsPerSample / 8);
        const byteRate      = sampleRate * blockAlign;
        const dataSize      = numSamples * blockAlign;
        const buffer        = new ArrayBuffer(44 + dataSize);
        const view          = new DataView(buffer);

        const writeStr = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };

        writeStr(0,  'RIFF');
        view.setUint32(4,  36 + dataSize, true);
        writeStr(8,  'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1,           true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate,  true);
        view.setUint32(28, byteRate,    true);
        view.setUint16(32, blockAlign,  true);
        view.setUint16(34, bitsPerSample, true);
        writeStr(36, 'data');
        view.setUint32(40, dataSize, true);

        const channels = [];
        for (let c = 0; c < numChannels; c++) channels.push(audioBuffer.getChannelData(c));

        let offset = 44;
        for (let i = 0; i < numSamples; i++) {
            for (let c = 0; c < numChannels; c++) {
                const s = Math.max(-1, Math.min(1, channels[c][i]));
                view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                offset += 2;
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }


    _buildSynth(settings) {
        const { instrumentType, oscillator, envelope, filter, effects, volume } = settings || {};

        const validOscTypes = ['sine','square','triangle','sawtooth','fatsine','fatsquare','fatsawtooth','pwm','fmsine','fmsquare'];
        let oscType = oscillator?.type || 'fatsawtooth';
        if (!validOscTypes.includes(oscType)) oscType = 'fatsawtooth';

        const env = {
            attack:  Math.max(0.001, envelope?.attack  || 0.05),
            decay:   Math.max(0.01,  envelope?.decay   || 0.2),
            sustain: Math.min(1, Math.max(0, envelope?.sustain || 0.5)),
            release: Math.max(0.05,  envelope?.release || 0.8),
        };

        const filterSettings = filter ? {
            type:      filter.type      || 'lowpass',
            frequency: Math.min(18000, Math.max(100, filter.frequency || 3000)),
            Q:         Math.min(20, Math.max(0.1, filter.Q || 1)),
            rolloff:   [-12,-24,-48].includes(filter.rolloff) ? filter.rolloff : -24,
        } : null;

        const synthConfig = {
            oscillator: { type: oscType, ...(oscillator?.count ? { count: oscillator.count } : {}), ...(oscillator?.spread ? { spread: oscillator.spread } : {}) },
            envelope: env,
            ...(filterSettings ? { filter: filterSettings } : {})
        };

        // Choose instrument type
        let instrument;
        const itype = instrumentType || 'PolySynth';
        try {
            if (itype === 'MonoSynth') {
                instrument = new Tone.MonoSynth(synthConfig);
            } else if (itype === 'FMSynth') {
                instrument = new Tone.FMSynth({ ...synthConfig, modulationIndex: 5 });
            } else if (itype === 'AMSynth') {
                instrument = new Tone.AMSynth(synthConfig);
            } else {
                instrument = new Tone.PolySynth(Tone.Synth, { ...synthConfig, maxPolyphony: 8 });
            }
        } catch (e) {
            console.warn('[AudioRenderer] Instrument creation failed, falling back to PolySynth:', e.message);
            instrument = new Tone.PolySynth(Tone.Synth, { envelope: env, maxPolyphony: 8 });
        }

        // Build effects chain from array format
        const chain = [];
        const effectsList = Array.isArray(effects) ? effects : [];

        for (const fx of effectsList) {
            try {
                if (!fx?.type || fx?.wet <= 0.02) continue;
                switch (fx.type) {
                    case 'Reverb':
                        chain.push(new Tone.Reverb({ decay: Math.max(0.5, fx.decay || 2), preDelay: 0.01, wet: Math.min(0.8, fx.wet) }));
                        break;
                    case 'Delay':
                        chain.push(new Tone.PingPongDelay({ delayTime: fx.delayTime || '8n', feedback: Math.min(0.6, fx.feedback || 0.2), wet: Math.min(0.5, fx.wet) }));
                        break;
                    case 'Distortion':
                        chain.push(new Tone.Distortion({ distortion: Math.min(0.8, fx.distortion || 0.2), wet: Math.min(0.5, fx.wet) }));
                        break;
                    case 'Chorus':
                        chain.push(new Tone.Chorus({ frequency: fx.frequency || 3, depth: fx.depth || 0.5, wet: Math.min(0.5, fx.wet) }));
                        break;
                }
            } catch (e) {
                console.warn(`[AudioRenderer] Effect ${fx.type} failed:`, e.message);
            }
        }

        // Always end with compressor + limiter
        chain.push(new Tone.Compressor({ threshold: -14, ratio: 4, attack: 0.005, release: 0.15 }));
        chain.push(new Tone.Limiter(-3));

        if (chain.length > 0) {
            instrument.chain(...chain, Tone.getDestination());
        } else {
            instrument.toDestination();
        }

        if (typeof volume === 'number') {
            instrument.volume.value = Math.max(-30, Math.min(0, volume));
        }

        return instrument;
    }
}
