/**
 * Opt-in browser audio diagnostics.
 *
 * Enable with ?audioDebug=1, then use
 * window.__MIDI_AUDIO_DIAGNOSTICS__.snapshot()
 * in the browser console while playback is running.
 *
 * This module only observes playback state. It does not alter audio settings,
 * scheduling, synthesis, or transport timing.
 */
export class AudioDiagnostics {
    static isEnabled() {
        try {
            return typeof window !== 'undefined' &&
                new URLSearchParams(window.location.search).get('audioDebug') === '1';
        } catch {
            return false;
        }
    }

    constructor(Tone) {
        this.Tone = Tone;
        this.enabled = true;
        this.engine = null;
        this.playback = null;
        this.noteEvents = new Map();

        if (typeof window !== 'undefined') {
            window.__MIDI_AUDIO_DIAGNOSTICS__ = {
                snapshot: () => this.snapshot('manual'),
                reset: () => this.resetCounters()
            };
        }

        console.info(
            '[Audio diagnostics] Enabled. Run ' +
            'window.__MIDI_AUDIO_DIAGNOSTICS__.snapshot() in the console.'
        );
    }

    beginPlayback({ engine, trackTypes, bpm, totalDuration, loop }) {
        this.engine = engine;
        this.playback = {
            trackTypes: [...trackTypes],
            bpm,
            loopDurationSeconds: totalDuration,
            loop
        };
        this.resetCounters();
        this.snapshot('play-start');
    }

    recordNoteEvent(trackType) {
        this.noteEvents.set(trackType, (this.noteEvents.get(trackType) || 0) + 1);
    }

    resetCounters() {
        this.noteEvents.clear();
        console.info('[Audio diagnostics] Note-event counters reset.');
    }

    snapshot(label = 'manual') {
        try {
            const toneContext = this.Tone.getContext?.();
            const context = toneContext?.rawContext || toneContext;
            const transport = this.Tone.Transport;
            const memory = performance?.memory;
            const engine = this.engine;

            const report = {
                label,
                timestamp: new Date().toISOString(),
                playback: this.playback,
                audioContext: context ? {
                    state: context.state,
                    sampleRate: context.sampleRate,
                    baseLatency: Number.isFinite(context.baseLatency) ? context.baseLatency : null,
                    outputLatency: Number.isFinite(context.outputLatency) ? context.outputLatency : null,
                    maxChannelCount: context.destination?.maxChannelCount ?? null
                } : null,
                transport: {
                    state: transport?.state ?? null,
                    bpm: transport?.bpm?.value ?? null,
                    seconds: Number.isFinite(transport?.seconds) ? transport.seconds : null,
                    position: transport?.position ?? null,
                    loop: transport?.loop ?? null
                },
                engine: engine ? {
                    lowPower: engine.lowPower,
                    isPlaying: engine.isPlaying,
                    activePartCount: engine.parts?.length ?? null,
                    instrumentCount: engine.instruments?.size ?? null,
                    instruments: engine.instruments
                        ? [...engine.instruments.entries()].map(([trackType, instrument]) => ({
                            trackType,
                            type: instrument?.constructor?.name || 'unknown'
                        }))
                        : []
                } : null,
                noteEventCallbacks: Object.fromEntries(this.noteEvents),
                browser: {
                    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
                    deviceMemoryGB: navigator.deviceMemory ?? null,
                    userAgent: navigator.userAgent
                },
                memory: memory ? {
                    usedJSHeapSize: memory.usedJSHeapSize,
                    totalJSHeapSize: memory.totalJSHeapSize,
                    jsHeapSizeLimit: memory.jsHeapSizeLimit
                } : null
            };

            console.info('[Audio diagnostics]', report);
            return report;
        } catch (error) {
            console.warn('[Audio diagnostics] Snapshot failed:', error);
            return null;
        }
    }
}
