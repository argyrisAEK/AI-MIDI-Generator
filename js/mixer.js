import { Midi } from '@tonejs/midi';
import { TRACK_INSTRUMENTS, OSCILLATOR_TYPES } from './config.js';

export class Mixer {
    constructor(app) {
        this.app = app;
        this.settings = new Map(); // Stores { volume, pan, muted, solo, etc. } for each track
        this.isVisible = false;
        this.volumeMeterUpdater = null;

        this.mixerPanel = document.getElementById('mixer-panel');
        this.toggleButton = document.getElementById('toggle-mixer');
        this.mixerTracksContainer = document.getElementById('mixer-tracks');

        this.toggleButton.addEventListener('click', () => this.toggleVisibility());
    }

    toggleVisibility() {
        this.isVisible = !this.isVisible;
        if (this.isVisible) {
            this.mixerPanel.style.display = 'block';
            this.toggleButton.textContent = 'Hide Mixer';
            this.render(); // Re-render to ensure it's up to date
            this.startVolumeMeter();
        } else {
            this.mixerPanel.style.display = 'none';
            this.toggleButton.textContent = 'Show Mixer';
            this.stopVolumeMeter();
        }
    }

    setTracks(generatedTracks) {
        this.settings.clear();
        generatedTracks.forEach((_, trackType) => {
            const initialSettings = this.getDefaultSettings();
            const instrumentConfig = TRACK_INSTRUMENTS[trackType];
            if (instrumentConfig?.settings?.oscillator?.type) {
                initialSettings.oscillator = instrumentConfig.settings.oscillator.type;
            }
            this.settings.set(trackType, initialSettings);
        });

        if (this.isVisible) {
            this.render();
        }
    }

    getDefaultSettings() {
        return {
            volume: 0.8,
            pan: 0,
            muted: false,
            solo: false,
            reverb: 0.2,
            delay: 0,
            highpass: 0, // 0 to 1 range
            lowpass: 1,  // 0 to 1 range
            oscillator: null, // Set dynamically in setTracks
        };
    }

    render() {
        this.mixerTracksContainer.innerHTML = '';
        if (this.app.generatedTracks.size === 0) {
            this.mixerTracksContainer.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.5);">Generate a track to see mixer controls.</p>';
            return;
        }
        
        this.app.generatedTracks.forEach((_, trackType) => {
            const trackDiv = this.createMixerTrackElement(trackType);
            this.mixerTracksContainer.appendChild(trackDiv);
        });
        
        if (this.isVisible) {
            this.startVolumeMeter();
        }
    }

    createMixerTrackElement(trackType) {
        const settings = this.settings.get(trackType) || this.getDefaultSettings();
        if (!this.settings.has(trackType)) {
            this.settings.set(trackType, settings);
        }

        const instrumentConfig = TRACK_INSTRUMENTS[trackType];
        const isSynth = instrumentConfig && ['synth', 'bass', 'lead'].includes(instrumentConfig.type);

        let oscillatorSelectHTML = '';
        if (isSynth && settings.oscillator) {
            const options = OSCILLATOR_TYPES.map(osc => 
                `<option value="${osc}" ${osc === settings.oscillator ? 'selected' : ''}>${osc}</option>`
            ).join('');

            oscillatorSelectHTML = `
                <div class="mixer-control oscillator-control">
                    <label>Oscillator</label>
                    <select class="oscillator-select form-control" data-track="${trackType}">
                        ${options}
                    </select>
                </div>
            `;
        }

        const trackDiv = document.createElement('div');
        trackDiv.className = 'mixer-track';
        trackDiv.innerHTML = `
            <div class="mixer-track-name">${trackType.charAt(0).toUpperCase() + trackType.slice(1)}</div>
            
            <div class="mixer-fader-group">
                 <div class="mixer-control volume-control">
                    <input type="range" class="volume-slider" min="0" max="1" step="0.01" value="${settings.volume}" data-track="${trackType}" orient="vertical">
                </div>
                <div class="volume-meter" data-track="${trackType}">
                    <div class="volume-meter-level"></div>
                </div>
            </div>

            <div class="mixer-value volume-display">${Math.round(settings.volume * 100)}%</div>

            <div class="mixer-control">
                <label>Pan</label>
                <input type="range" class="pan-slider" min="-1" max="1" step="0.01" value="${settings.pan}" data-track="${trackType}">
                <div class="mixer-value">${settings.pan > 0 ? 'R' : settings.pan < 0 ? 'L' : 'C'}${Math.abs(Math.round(settings.pan * 100))}</div>
            </div>
            
            ${oscillatorSelectHTML}

            <div class="mixer-control">
                <label>Reverb</label>
                <input type="range" class="reverb-slider" min="0" max="1" step="0.01" value="${settings.reverb}" data-track="${trackType}">
                <div class="mixer-value">${Math.round(settings.reverb * 100)}%</div>
            </div>
            
            <div class="mixer-control">
                <label>Delay</label>
                <input type="range" class="delay-slider" min="0" max="1" step="0.01" value="${settings.delay}" data-track="${trackType}">
                <div class="mixer-value">${Math.round(settings.delay * 100)}%</div>
            </div>
            
            <div class="mixer-control">
                <label>High Pass</label>
                <input type="range" class="highpass-slider" min="0" max="1" step="0.01" value="${settings.highpass}" data-track="${trackType}">
                <div class="mixer-value">${Math.round(settings.highpass * 100)}%</div>
            </div>
            
            <div class="mixer-control">
                <label>Low Pass</label>
                <input type="range" class="lowpass-slider" min="0" max="1" step="0.01" value="${settings.lowpass}" data-track="${trackType}">
                <div class="mixer-value">${Math.round(settings.lowpass * 100)}%</div>
            </div>
            
            <div class="mixer-buttons">
                <button class="mixer-btn mute-btn ${settings.muted ? 'active' : ''}" data-track="${trackType}">MUTE</button>
                <button class="mixer-btn solo-btn ${settings.solo ? 'active' : ''}" data-track="${trackType}">SOLO</button>
            </div>
        `;

        this.addEventListenersToTrack(trackDiv, trackType);
        return trackDiv;
    }

    addEventListenersToTrack(trackDiv, trackType) {
        const setSliderValue = (sliderClass, valueUpdater) => {
            const slider = trackDiv.querySelector(sliderClass);
            const valueDisplay = slider.nextElementSibling;
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                valueUpdater(value, valueDisplay);
            });
        };

        const volumeSlider = trackDiv.querySelector('.volume-slider');
        const volumeDisplay = trackDiv.querySelector('.volume-display');
        volumeSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.settings.get(trackType).volume = value;
            volumeDisplay.textContent = `${Math.round(value * 100)}%`;
            if (this.app.audioEngine) this.app.audioEngine.setTrackVolume(trackType, value);
        });

        setSliderValue('.pan-slider', (value, display) => {
            this.settings.get(trackType).pan = value;
            display.textContent = `${value > 0 ? 'R' : value < 0 ? 'L' : 'C'}${Math.abs(Math.round(value * 100))}`;
            if (this.app.audioEngine) this.app.audioEngine.setTrackPan(trackType, value);
        });

        setSliderValue('.reverb-slider', (value, display) => {
            this.settings.get(trackType).reverb = value;
            display.textContent = `${Math.round(value * 100)}%`;
            if (this.app.audioEngine) this.app.audioEngine.setTrackReverb(trackType, value);
        });

        setSliderValue('.delay-slider', (value, display) => {
            this.settings.get(trackType).delay = value;
            display.textContent = `${Math.round(value * 100)}%`;
            if (this.app.audioEngine) this.app.audioEngine.setTrackDelay(trackType, value);
        });
        
        setSliderValue('.highpass-slider', (value, display) => {
            this.settings.get(trackType).highpass = value;
            display.textContent = `${Math.round(value * 100)}%`;
            if (this.app.audioEngine) this.app.audioEngine.setTrackHighpass(trackType, value);
        });
        
        setSliderValue('.lowpass-slider', (value, display) => {
            this.settings.get(trackType).lowpass = value;
            display.textContent = `${Math.round(value * 100)}%`;
            if (this.app.audioEngine) this.app.audioEngine.setTrackLowpass(trackType, value);
        });

        const oscillatorSelect = trackDiv.querySelector('.oscillator-select');
        if (oscillatorSelect) {
            oscillatorSelect.addEventListener('change', (e) => {
                const newOscillator = e.target.value;
                this.settings.get(trackType).oscillator = newOscillator;
                if (this.app.audioEngine) {
                    this.app.audioEngine.setTrackOscillator(trackType, newOscillator);
                }
            });
        }

        const muteBtn = trackDiv.querySelector('.mute-btn');
        muteBtn.addEventListener('click', () => {
            const settings = this.settings.get(trackType);
            settings.muted = !settings.muted;
            muteBtn.classList.toggle('active', settings.muted);
            this.updateAudioEngineMuteState();
        });

        const soloBtn = trackDiv.querySelector('.solo-btn');
        soloBtn.addEventListener('click', () => {
            const settings = this.settings.get(trackType);
            const newSoloState = !settings.solo;

            // Unsolo all other tracks if this one is becoming solo
            this.settings.forEach((s, t) => {
                s.solo = (t === trackType) ? newSoloState : false;
            });
            
            this.render(); // Re-render all buttons to reflect state change
            this.updateAudioEngineMuteState();
        });
    }

    updateAudioEngineMuteState() {
        if (!this.app.audioEngine) return;

        const isAnyTrackSoloed = Array.from(this.settings.values()).some(s => s.solo);

        this.settings.forEach((settings, trackType) => {
            let isMuted;
            if (isAnyTrackSoloed) {
                isMuted = !settings.solo;
            } else {
                isMuted = settings.muted;
            }
            this.app.audioEngine.setTrackMute(trackType, isMuted);
        });
    }

    startVolumeMeter() {
        if (this.volumeMeterUpdater) {
            cancelAnimationFrame(this.volumeMeterUpdater);
        }

        const updateMeters = () => {
            if (!this.isVisible) return;

            this.settings.forEach((_, trackType) => {
                const meterElement = this.mixerTracksContainer.querySelector(`.volume-meter-level[data-track="${trackType}"]`);
                if (meterElement && this.app.audioEngine) {
                    const level = this.app.audioEngine.getMeterLevel(trackType);
                    // Convert dB to a percentage (0-100). -60dB is approx 0, 0dB is 100.
                    const percentage = Math.max(0, Math.min(100, (1 + level / 60) * 100));
                    meterElement.style.setProperty('--level', `${percentage}%`);
                }
            });

            this.volumeMeterUpdater = requestAnimationFrame(updateMeters);
        };

        this.volumeMeterUpdater = requestAnimationFrame(updateMeters);
    }
    
    stopVolumeMeter() {
        if (this.volumeMeterUpdater) {
            cancelAnimationFrame(this.volumeMeterUpdater);
            this.volumeMeterUpdater = null;
        }
        // Reset meters to 0
        this.mixerTracksContainer.querySelectorAll('.volume-meter-level').forEach(el => {
            el.style.setProperty('--level', '0%');
        });
    }

    reset() {
        this.settings.clear();
        this.stopVolumeMeter();
        if (this.isVisible) {
            this.toggleVisibility();
        }
        this.render();
    }
    
    getSettings() {
        return this.settings;
    }

    shouldIncludeTrackInDownload(trackType) {
        const settings = this.settings.get(trackType);
        if (!settings) return true; // Default to include if no settings
        if (settings.muted) return false;

        const isAnyTrackSoloed = Array.from(this.settings.values()).some(s => s.solo);
        if (isAnyTrackSoloed) {
            return settings.solo;
        }

        return true;
    }
    
    applySettingsToNote(note, trackType) {
        const mixerSettings = this.settings.get(trackType);
        if (!mixerSettings) return note;
        
        const modifiedNote = { ...note };
        
        if (mixerSettings.volume !== undefined) {
            modifiedNote.velocity = Math.max(0, Math.min(1, note.velocity * mixerSettings.volume));
        }
        
        return modifiedNote;
    }

    applySettingsToMidi(midi, trackType) {
        const mixerSettings = this.settings.get(trackType);
        if (!mixerSettings) return midi;
        
        const modifiedMidi = new Midi();
        modifiedMidi.header.setTempo(midi.header.tempos[0]?.bpm || 120);
        
        midi.tracks.forEach(track => {
            const newTrack = modifiedMidi.addTrack();
            newTrack.name = track.name;
            newTrack.channel = track.channel;
            newTrack.instrument.number = track.instrument.number;
            
            track.notes.forEach(note => {
                const modifiedNote = this.applySettingsToNote(note, trackType);
                newTrack.addNote(modifiedNote);
            });
        });
        
        return modifiedMidi;
    }
}