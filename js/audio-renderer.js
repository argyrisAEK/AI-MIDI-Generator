import * as Tone from 'tone';

/**
 * AudioRenderer — Offline Tone.js render → MP3 via lamejs
 * Renders the active track from a JSON composition to MP3.
 */
export class AudioRenderer {

    /**
     * @param {object} params
     * @param {string} params.trackType   - e.g. 'bassline'
     * @param {Array}  params.notes       - Tone.js note objects [{name, time, duration, velocity}]
     * @param {object} params.synthSettings - Settings from /api/synthesize
     * @param {number} params.bpm
     * @param {number} params.durationSeconds - Total duration of the loop
     * @param {function} params.onProgress   - Progress callback (0-1)
     */
    async render({ trackType, notes, synthSettings, bpm, durationSeconds, onProgress }) {
        if (!notes || notes.length === 0) throw new Error('No notes to render');

        onProgress?.(0.05);

        // Load lamejs dynamically
        await this._loadLamejs();
        onProgress?.(0.1);

        // Add 1s tail for reverb/delay to decay
        const renderDuration = durationSeconds + 1.5;

        let audioBuffer;
        try {
            audioBuffer = await Tone.Offline(async ({ transport }) => {
                transport.bpm.value = bpm;

                // Build synth from LLM settings
                const synth = this._buildSynth(synthSettings);

                // Schedule notes
                const part = new Tone.Part((time, event) => {
                    try {
                        synth.triggerAttackRelease(
                            event.note,
                            event.duration,
                            time,
                            event.velocity
                        );
                    } catch (e) {
                        // voice overflow — skip
                    }
                }, notes.map(n => ({
                    time: n.time,
                    note: n.name,
                    duration: n.duration,
                    velocity: n.velocity
                }))).start(0);

                transport.start(0);
            }, renderDuration, 2); // stereo

        } catch (err) {
            throw new Error(`Offline render failed: ${err.message}`);
        }

        onProgress?.(0.6);

        // Convert AudioBuffer → MP3
        const mp3Blob = await this._encodeMP3(audioBuffer, onProgress);

        onProgress?.(1.0);
        return mp3Blob;
    }

    _buildSynth(settings) {
        const { oscillator, envelope, filter, effects, volume } = settings || {};

        // Clean oscillator type for low-power or unsupported
        let oscType = oscillator?.type || 'fatsawtooth';
        const validTypes = ['sine','square','triangle','sawtooth','fatsine','fatsquare','fatsawtooth','pwm','fmsine','fmsquare'];
        if (!validTypes.includes(oscType)) oscType = 'fatsawtooth';

        const synthSettings = {
            oscillator: { type: oscType },
            envelope: {
                attack:  Math.max(0.001, envelope?.attack  || 0.05),
                decay:   Math.max(0.01,  envelope?.decay   || 0.2),
                sustain: Math.min(1, Math.max(0, envelope?.sustain || 0.5)),
                release: Math.max(0.05,  envelope?.release || 0.8),
            },
            filter: filter ? {
                type:      filter.type      || 'lowpass',
                frequency: filter.frequency || 3000,
                Q:         filter.Q         || 1,
            } : undefined,
        };

        // Remove undefined keys
        if (!synthSettings.filter) delete synthSettings.filter;

        let instrument = new Tone.PolySynth(Tone.Synth, {
            ...synthSettings,
            maxPolyphony: 8
        });

        // Effects chain
        const chain = [];

        if (effects?.distortion?.wet > 0.05) {
            chain.push(new Tone.Distortion({
                distortion: Math.min(0.8, effects.distortion.distortion || 0.2),
                wet: effects.distortion.wet || 0.1
            }));
        }

        if (effects?.delay?.wet > 0.05) {
            chain.push(new Tone.PingPongDelay({
                delayTime: effects.delay.delayTime || '8n',
                feedback:  Math.min(0.6, effects.delay.feedback || 0.2),
                wet:       effects.delay.wet || 0.15
            }));
        }

        if (effects?.reverb?.wet > 0.05) {
            chain.push(new Tone.Reverb({
                decay:    Math.max(0.5, effects.reverb.decay || 2),
                preDelay: 0.01,
                wet:      Math.min(0.8, effects.reverb.wet || 0.2)
            }));
        }

        // Compressor + limiter always at the end
        chain.push(new Tone.Compressor({ threshold: -14, ratio: 4, attack: 0.005, release: 0.15 }));
        chain.push(new Tone.Limiter(-3));

        // Connect chain
        if (chain.length > 0) {
            instrument.chain(...chain, Tone.getDestination());
        } else {
            instrument.toDestination();
        }

        // Volume
        if (typeof volume === 'number') {
            instrument.volume.value = Math.max(-30, Math.min(0, volume));
        }

        return instrument;
    }

    async _encodeMP3(audioBuffer, onProgress) {
        const Mp3Encoder = window.lamejs?.Mp3Encoder;
        if (!Mp3Encoder) throw new Error('lamejs not loaded');

        const sampleRate = audioBuffer.sampleRate;
        const channels   = audioBuffer.numberOfChannels;
        const encoder    = new Mp3Encoder(channels, sampleRate, 128); // 128kbps

        const leftData  = audioBuffer.getChannelData(0);
        const rightData = channels > 1 ? audioBuffer.getChannelData(1) : leftData;

        // Convert Float32 → Int16
        const toInt16 = (float32) => {
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            return int16;
        };

        const leftInt16  = toInt16(leftData);
        const rightInt16 = toInt16(rightData);

        const mp3Data = [];
        const CHUNK   = 1152; // lamejs chunk size
        const total   = leftInt16.length;

        for (let i = 0; i < total; i += CHUNK) {
            const left  = leftInt16.subarray(i, i + CHUNK);
            const right = rightInt16.subarray(i, i + CHUNK);
            const chunk = encoder.encodeBuffer(left, right);
            if (chunk.length > 0) mp3Data.push(chunk);

            // Progress: 60-95%
            if (i % (CHUNK * 50) === 0) {
                onProgress?.(0.6 + 0.35 * (i / total));
                await new Promise(r => setTimeout(r, 0)); // yield to UI
            }
        }

        const final = encoder.flush();
        if (final.length > 0) mp3Data.push(final);

        return new Blob(mp3Data, { type: 'audio/mp3' });
    }

    async _loadLamejs() {
        if (window.lamejs) return;
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load lamejs'));
            document.head.appendChild(script);
        });
    }
}
