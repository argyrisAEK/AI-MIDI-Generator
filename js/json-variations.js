import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { trackAbbreviations } from './track-config.js';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';
import { MIDIGenerator } from './midi-generator-api.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.setupEventListeners();

        // Reverse map 纬喂伪 normalization
        this.reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
        );
    }

    setupEventListeners() {
        const downloadBtn = document.getElementById('download-all-zip');
        const rawInput = document.getElementById('raw-json-input');
        const editTypeSelect = document.getElementById('edit-type');
        const intensitySlider = document.getElementById('intensity-slider');
        const applyEditBtn = document.getElementById('apply-track-edit');
        const loadJsonBtn = document.getElementById('load-json-btn');
        const mp3Btn = document.getElementById('export-mp3-btn');

        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadAllAsZip());
        if (rawInput) rawInput.addEventListener('input', (e) => this.handleJsonInputChange(e));
        if (loadJsonBtn) loadJsonBtn.addEventListener('click', () => this.loadJsonIntoPreview());
        if (mp3Btn) mp3Btn.addEventListener('click', () => this.exportActiveTrackAsMP3());

        if (editTypeSelect) {
            editTypeSelect.addEventListener('change', (e) => this.handleEditTypeChange(e));
        }
        if (intensitySlider) {
            intensitySlider.addEventListener('input', (e) => this.handleIntensityChange(e));
        }
        if (applyEditBtn) {
            applyEditBtn.addEventListener('click', () => this.applyTrackEdit());
        }
    }

    async exportActiveTrackAsMP3() {
        const mp3Btn = document.getElementById('export-mp3-btn');
        const progressContainer = document.getElementById('mp3-progress-container');
        const progressBar = document.getElementById('mp3-progress-bar');
        const progressLabel = document.getElementById('mp3-progress-label');

        // Get active track from visualizer
        const activeTrack = this.app.visualizer?.activeTrackType || 'all';
        if (activeTrack === 'all') {
            this.app.ui.showMessage('Select a specific track in the visualizer first.', 'warning');
            return;
        }

        // Get notes for active track
        const trackData = this.app.generatedTracks?.get(activeTrack);
        if (!trackData?.midi?.tracks?.[0]?.notes?.length) {
            this.app.ui.showMessage('No notes found for the active track.', 'warning');
            return;
        }

        const notes = trackData.midi.tracks[0].notes;
        const bpm = this.app.musicalContextManager?.getContext()?.tempo || 120;
        const lastNote = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);
        const durationSeconds = lastNote;

        // Get composition context
        const parsed = this.sourceJson ? JSON.parse(this.sourceJson) : {};
        const genre = document.getElementById('style')?.value || 'house';
        const mood  = document.getElementById('mood')?.value  || 'neutral';
        const scale = document.getElementById('scale-type')?.value || 'minor';
        const key   = document.getElementById('key')?.value || 'C';

        // Show progress UI
        mp3Btn.disabled = true;
        progressContainer.style.display = 'block';
        progressLabel.textContent = 'Asking AI for synthesis settings...';
        progressBar.style.width = '5%';

        try {
            // 1. Get LLM synthesis settings
            const userApiKey = localStorage.getItem('byop_pollinations_key') || null;
            const synthRes = await fetch('/api/synthesize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackType: activeTrack, genre, mood, scale, key, notes, userApiKey })
            });

            if (!synthRes.ok) throw new Error(`Synthesis API error: ${synthRes.status}`);
            const synthSettings = await synthRes.json();

            progressLabel.textContent = 'Rendering audio offline...';
            progressBar.style.width = '15%';

            // 2. Render offline
            const { AudioRenderer } = await import('./audio-renderer.js');
            const renderer = new AudioRenderer();

            const mp3Blob = await renderer.render({
                trackType: activeTrack,
                notes,
                synthSettings,
                bpm,
                durationSeconds,
                onProgress: (p) => {
                    progressBar.style.width = `${Math.round(p * 100)}%`;
                    if (p < 0.15)      progressLabel.textContent = 'Rendering audio offline...';
                    else if (p < 0.6)  progressLabel.textContent = 'Processing audio...';
                    else if (p < 0.95) progressLabel.textContent = 'Encoding MP3...';
                    else               progressLabel.textContent = 'Done!';
                }
            });

            // 3. Download
            const title = parsed.title || 'composition';
            const filename = `${title}-${activeTrack}.wav`.replace(/[^a-z0-9\-_.]/gi, '_');

            if ('showSaveFilePicker' in window) {
                try {
                    const fh = await window.showSaveFilePicker({
                        suggestedName: filename,
                        types: [{ description: 'WAV Audio', accept: { 'audio/wav': ['.wav'] } }]
                    });
                    const w = await fh.createWritable();
                    await w.write(mp3Blob);
                    await w.close();
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    throw e;
                }
            } else {
                const url = URL.createObjectURL(mp3Blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; a.click();
                URL.revokeObjectURL(url);
            }

            this.app.ui.showToast(`${activeTrack} exported as WAV!`, 'success');

        } catch (err) {
            console.error('[MP3 Export]', err);
            this.app.ui.showMessage(`MP3 export failed: ${err.message}`, 'error');
        } finally {
            mp3Btn.disabled = false;
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressBar.style.width = '0%';
            }, 2000);
        }
    }

    handleEditTypeChange(e) {
        const value = e.target.value;
        const intensitySection = document.getElementById('intensity-slider-section');
        const customSection = document.getElementById('custom-edit-section');

        if (intensitySection) {
            const isIntensity = value === 'intensity_up' || value === 'intensity_down';
            intensitySection.style.display = isIntensity ? 'block' : 'none';
            if (isIntensity) this.configureSliderForDirection(value);
        }
        if (customSection) {
            customSection.style.display = value === 'custom' ? 'block' : 'none';
        }
    }

    configureSliderForDirection(direction) {
        const slider = document.getElementById('intensity-slider');
        const minLabel = document.getElementById('intensity-min-label');
        const maxLabel = document.getElementById('intensity-max-label');
        if (!slider) return;

        if (direction === 'intensity_up') {
            slider.min = 10; slider.max = 100; slider.value = 30;
            if (minLabel) minLabel.textContent = 'Subtle';
            if (maxLabel) maxLabel.textContent = 'Max 馃敟';
        } else {
            slider.min = 10; slider.max = 80; slider.value = 30;
            if (minLabel) minLabel.textContent = 'Subtle';
            if (maxLabel) maxLabel.textContent = 'Minimal 鉂勶笍';
        }
        this.updateIntensityDisplay(direction, parseInt(slider.value));
    }

    handleIntensityChange(e) {
        const value = parseInt(e.target.value);
        const direction = document.getElementById('edit-type')?.value;
        this.updateIntensityDisplay(direction, value);
    }

    updateIntensityDisplay(direction, value) {
        const display = document.getElementById('intensity-value');
        const preview = document.getElementById('intensity-preview');
        if (!display) return;

        if (direction === 'intensity_up') {
            let label, previewText, color;
            if (value <= 20)      { label = 'Subtle';   color = '#a78bfa'; previewText = '馃幍 Light fills 路 馃攰 Vel 6 路 鈴憋笍 Slightly shorter notes'; }
            else if (value <= 40) { label = 'Moderate'; color = '#60a5fa'; previewText = '馃幍 More fills 路 馃攰 Vel 6-7 路 鈴憋笍 Shorter notes'; }
            else if (value <= 60) { label = 'Strong';   color = '#34d399'; previewText = '馃幍 Dense notes 路 馃攰 Vel 7-8 路 鈴憋笍 Fast bursts'; }
            else if (value <= 80) { label = 'Dramatic'; color = '#f59e0b'; previewText = '馃幍 Very dense 路 馃攰 Vel 8 路 鈴憋笍 16th notes dominant'; }
            else                  { label = 'Max 馃敟';   color = '#ef4444'; previewText = '馃幍 Maximum notes 路 馃攰 Vel 8-9 路 鈴憋笍 Fastest possible'; }
            display.textContent = `鈫?${label}: +${value}%`;
            display.style.color = color;
            if (preview) { preview.textContent = previewText; preview.style.display = 'block'; }

        } else if (direction === 'intensity_down') {
            let label, previewText, color;
            if (value <= 20)      { label = 'Subtle';     color = '#a78bfa'; previewText = '馃幍 Few fewer notes 路 馃攰 Vel 5 路 鈴憋笍 Slightly longer notes'; }
            else if (value <= 40) { label = 'Moderate';   color = '#60a5fa'; previewText = '馃幍 Remove fills 路 馃攰 Vel 4-5 路 鈴憋笍 Longer notes'; }
            else if (value <= 60) { label = 'Strong';     color = '#f59e0b'; previewText = '馃幍 Sparse texture 路 馃攰 Vel 3-4 路 鈴憋笍 Half notes'; }
            else                  { label = 'Minimal 鉂勶笍'; color = '#94a3b8'; previewText = '馃幍 Skeleton only 路 馃攰 Vel 3 路 鈴憋笍 Long sustained notes'; }
            display.textContent = `鈫?${label}: -${value}%`;
            display.style.color = color;
            if (preview) { preview.textContent = previewText; preview.style.display = 'block'; }
        }
    }

    updateEditTrackCheckboxes(availableTracks) {
        const container = document.getElementById('edit-track-checkboxes');
        if (!container) return;

        if (!availableTracks || availableTracks.length === 0) {
            container.innerHTML = '<span class="sub-text" style="font-size: 0.75rem;">Load a composition to see available tracks...</span>';
            return;
        }

        container.innerHTML = '';

        const priorityOrder = ['bassline', 'chord', 'melody', 'lead', 'arpeggio', 'plucks', 'keys', 'strings', 'pad-textures', 'guitar', 'brass', 'percs'];
        const sortedTracks = [...availableTracks].sort((a, b) => {
            const idxA = priorityOrder.indexOf(a);
            const idxB = priorityOrder.indexOf(b);
            if (idxA === -1 && idxB === -1) return a.localeCompare(b);
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });

        const colors = {
            'bassline': '#E74C3C',
            'chord': '#E67E22',
            'keys': '#F1C40F',
            'plucks': '#F39C12',
            'arpeggio': '#2ECC71',
            'melody': '#1ABC9C',
            'strings': '#3498DB',
            'pad-textures': '#9B59B6',
            'lead': '#E91E63',
            'guitar': '#8E44AD',
            'brass': '#F1C40F',
            'percs': '#BDC3C7'
        };

        sortedTracks.forEach(track => {
            const label = document.createElement('label');
            label.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 10px;
                background: #0f0f1a;
                border: 2px solid ${colors[track] || '#4c4c6d'};
                border-radius: 16px;
                cursor: pointer;
                font-size: 0.75rem;
                color: #e2e8f0;
                transition: all 0.2s;
            `;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = track;
            checkbox.className = 'edit-track-checkbox';
            checkbox.style.cssText = 'accent-color: #7c3aed; cursor: pointer;';

            const icon = document.createElement('span');
            icon.textContent = this.getTrackIcon(track);
            icon.style.fontSize = '0.9rem';

            const text = document.createElement('span');
            text.textContent = track.charAt(0).toUpperCase() + track.slice(1);

            label.appendChild(checkbox);
            label.appendChild(icon);
            label.appendChild(text);
            container.appendChild(label);

            label.addEventListener('mouseenter', () => {
                label.style.background = colors[track] ? `${colors[track]}20` : '#1a1a2e';
            });
            label.addEventListener('mouseleave', () => {
                label.style.background = '#0f0f1a';
            });
        });
    }

    getTrackIcon(track) {
        const icons = {
            'bassline': '馃幐',
            'chord': '馃幑',
            'keys': '馃幑',
            'plucks': '馃幐',
            'arpeggio': '馃幍',
            'melody': '馃帳',
            'strings': '馃幓',
            'pad-textures': '馃寠',
            'lead': '\u2B50',
            'guitar': '馃幐',
            'brass': '馃幒',
            'percs': '馃'
        };
        return icons[track] || '馃幍';
    }

    getSelectedEditTracks() {
        const checkboxes = document.querySelectorAll('.edit-track-checkbox:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?    // QUICK TRACK EDIT - 螘谓畏渭蔚蟻蠅渭苇谓慰 纬喂伪 谓苇慰 API format
    // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
    async applyTrackEdit() {
        const targetTracks = this.getSelectedEditTracks();
        const editType = document.getElementById('edit-type')?.value;
        const customInstructions = document.getElementById('custom-edit-instructions')?.value;
        const intensityValue = parseInt(document.getElementById('intensity-slider')?.value || 0) / 100;

        if (targetTracks.length === 0) {
            this.app.ui.showMessage('Please select at least one track to edit.', 'warning');
            return;
        }
        if (!editType) {
            this.app.ui.showMessage('Please select an edit type.', 'warning');
            return;
        }
        if (!this.sourceJson) {
            this.app.ui.showMessage('No composition loaded. Please generate or paste JSON first.', 'warning');
            return;
        }

        // 螡螘螣: Build editParams 伪谓蟿委 纬喂伪 prompt
        const originalJson = JSON.parse(this.sourceJson);
        const availableTracks = Object.keys(originalJson.tracks || {});

        const editParams = {
            originalJson,
            targetTracks,
            unchangedTracks: availableTracks.filter(t => !targetTracks.includes(t)),
            editType,
            customInstructions: editType === 'custom' ? customInstructions : null,
            intensityChange: Math.abs(intensityValue),  // always positive; direction is in editType
            genre: document.getElementById('style')?.value || 'house',
            bpm: parseInt(document.getElementById('bpm')?.value, 10) || 120,
            key: document.getElementById('key')?.value || 'C',
            scale: document.getElementById('scale-type')?.value || 'major',
            duration: parseInt(document.getElementById('duration')?.value, 10) || 4,
            timeSignature: document.getElementById('time-signature')?.value || '4/4'
        };

        await this.editTrackSelectively(editParams);
    }

    async editTrackSelectively(editParams) {
        const { targetTracks } = editParams;
        const MAX_RETRIES = 2;
        let lastError;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                this.app.ui.showLoading(`Editing ${targetTracks.join(', ')}${attempt > 1 ? ` (retry ${attempt-1})` : ''}...`);

                // BYOP: key 蠅蟼 X-Byop-Key header 渭苇蟽蠅 fetchWithModelFallbacks
                const userApiKey = localStorage.getItem('byop_pollinations_key');

                // 螡螘螣: 螝位萎蟽畏 渭蔚 editParams (蠈蟺蠅蟼 蟿慰 main generation)
                const response = await fetchWithModelFallbacks('/api/variations', 
                    ['midijourney', 'claude-fast', 'openai'],
                    this.app.ui, 
                    { 
                        editParams,
                        seed: Math.floor(Math.random() * 100000) + attempt,
                    },
                    userApiKey || null  // byopKey 鈫?X-Byop-Key header
                );

                // 螡螘螣: 围蟻萎蟽畏 蟿慰蠀 委未喂慰蠀 parser 渭蔚 蟿慰 main generation
                const responseText = await response.text();

                // 馃敟 围蟻萎蟽畏 MIDIGenerator parser (蟿蠋蟻伪 渭蔚 魏伪谓慰谓喂魏蠈 import)
                const generator = new MIDIGenerator();
                const bpm = editParams.bpm;

                // Parse 渭蔚 expected tracks (full names)
                const { tracks: editedTracksMap, title, description } = 
                    generator.parseApiResponse(responseText, targetTracks, bpm);

                // 螆位蔚纬蠂慰蟼 蠈蟿喂 蠈位伪 蟿伪 target tracks 蠀蟺维蟻蠂慰蠀谓
                if (editedTracksMap.size === 0) {
                    throw new Error('No tracks returned from AI');
                }

                const missingTracks = targetTracks.filter(t => !editedTracksMap.has(t));
                if (missingTracks.length > 0) {
                    throw new Error(`Missing tracks: ${missingTracks.join(', ')}`);
                }

                // Merge 渭蔚 unchanged tracks
                const mergedResult = this.mergeWithUnchanged({
                    originalJson: editParams.originalJson,
                    editedTracks: editedTracksMap,
                    targetTracks,
                    title,
                    description
                });

                // 螘谓畏渭苇蟻蠅蟽畏 main app
                await this.updateMainAppAfterEdit(mergedResult);

                // 螤蟻慰蟽胃萎魏畏 蟽蟿喂蟼 versions
                const newVersion = {
                    apiResponse: mergedResult,
                    context: this.versions[0]?.context || {},
                    isOriginal: false,
                    structure: `Edit: ${targetTracks.join(', ')}`,
                    editDetails: editParams
                };

                this.versions.push(newVersion);
                this.renderVersionsList();

                // Update source JSON
                this.sourceJson = JSON.stringify({
                    title: mergedResult.title,
                    desc: mergedResult.desc,
                    tracks: mergedResult.tracks
                });

                const rawInput = document.getElementById('raw-json-input');
                if (rawInput) {
                    rawInput.value = JSON.stringify({
                        title: mergedResult.title,
                        desc: mergedResult.desc,
                        tracks: mergedResult.tracks
                    }, null, 2);
                }

                this.app.ui.showMessage(`Successfully edited ${targetTracks.join(', ')}.`, 'success');
                return;

            } catch (error) {
                lastError = error;
                console.error(`Edit attempt ${attempt} failed:`, error);

                if (error.requiresByop || error.message?.includes('daily_limit_reached')) {
                    this.app.ui.hideLoading();
                    this.app.showByopModal?.(error.resetAt);
                    return;
                }

                if (error.requiresByopReauth) {
                    this.app.ui.hideLoading();
                    localStorage.removeItem('byop_pollinations_key');
                    this.app.checkByopStatus?.();
                    this.app.showByopModal?.(null);
                    return;
                }

                if (attempt < MAX_RETRIES) {
                    this.app.ui.showMessage(`${error.message}. Retrying...`, 'warning');
                    await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
                }
            }
        }

        this.app.ui.hideLoading();
        let userMessage = `Edit failed after ${MAX_RETRIES} attempts: ${lastError.message}`;
        if (lastError.message?.includes('timeout')) {
            userMessage = 'Edit timed out. Try a simpler edit or fewer tracks.';
        }
        this.app.ui.showMessage(userMessage, 'error');
    }

    /**
     * 螡螘螣: 螒蟺位慰蟺慰喂畏渭苇谓慰 merge 渭蔚 蠂蟻萎蟽畏 MIDIGenerator notes
     */
    mergeWithUnchanged({ originalJson, editedTracks, targetTracks, title, description }) {
        console.log('[MERGE] Starting merge...');
        console.log('[MERGE] Edited tracks:', Array.from(editedTracks.keys()));
        console.log('[MERGE] Target tracks:', targetTracks);

        const mergedTracks = { ...originalJson.tracks };

        // Replace edited tracks
        for (const [trackName, trackData] of editedTracks.entries()) {
            // 螠蔚蟿伪蟿蟻慰蟺萎 notes 蟺委蟽蠅 蟽蔚 compact string format
            mergedTracks[trackName] = this.notesToCompactFormat(trackData.notes);
            console.log(`[MERGE] 鉁?Replaced ${trackName} with ${trackData.notes.length} notes`);
        }

        // Log unchanged
        const unchangedTracks = Object.keys(originalJson.tracks).filter(t => !targetTracks.includes(t));
        unchangedTracks.forEach(t => console.log(`[MERGE] 鈫?Kept unchanged: ${t}`));

        return {
            title: title || `${originalJson.title || 'Untitled'} [${targetTracks.join(', ')} edit]`,
            desc: description || `Edited ${targetTracks.join(', ')}`,
            tracks: mergedTracks
        };
    }

    /**
     * 螡螘螣: Helper 纬喂伪 渭蔚蟿伪蟿蟻慰蟺萎 notes 鈫?compact string
     */
    notesToCompactFormat(notes) {
        if (!notes || notes.length === 0) return '';

        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const secondsPerBeat = 60 / bpm;

        return notes.map(n => {
            const vel = Math.max(1, Math.min(9, Math.round(n.velocity * 10)));  // 0.7 鈫?7
            const beat = (n.time / secondsPerBeat).toFixed(2);  // seconds 鈫?beats
            const dur = (n.duration / secondsPerBeat).toFixed(2);
            return `${n.midi}:${beat}:${dur}:${vel}`;
        }).join('|');
    }

    async updateMainAppAfterEdit(mergedResult) {
        try {
            console.log('[UPDATE-MAIN] Starting update...');

            // 围蟻萎蟽畏 MIDIGenerator 纬喂伪 未畏渭喂慰蠀蟻纬委伪 MIDI objects
            const tracks = this.mergedTracksToTrackMap(mergedResult.tracks);

            // 螘谓畏渭苇蟻蠅蟽畏 app state
            this.app.generatedTracks = tracks;
            this.app.compositionTitle = mergedResult.title;
            this.app.compositionDescription = mergedResult.desc;

            // 螘谓畏渭苇蟻蠅蟽畏 visualizer
            this.app.visualizer.compositionTitle = mergedResult.title;
            this.app.visualizer.compositionDescription = mergedResult.desc;

            this.app.visualizer.loadNotes(
                tracks,
                mergedResult.title,
                mergedResult.desc
            );

            this.app.visualizer.updateTrackSelectors();
            this.app.visualizer.stopVisualization();
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();

            // 螘谓蔚蟻纬慰蟺慰委畏蟽畏 魏慰蠀渭蟺喂蠋谓
            this.app.ui.updateButtonStates(true);
            this.setVisualizerToAllTracks();

            console.log('[UPDATE-MAIN] Successfully updated');

        } catch (error) {
            console.error('[UPDATE-MAIN] Failed:', error);
            throw error;
        }
    }

    mergedTracksToTrackMap(mergedTracks) {
        const tracks = new Map();
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        console.log('[MERGED-TO-MAP] Converting tracks:', Object.keys(mergedTracks));

        for (const [trackName, notesStr] of Object.entries(mergedTracks)) {
            if (!notesStr || typeof notesStr !== 'string') continue;

            const notes = [];
            const separator = notesStr.includes('|') ? '|' : '\n';
            const lines = notesStr.split(separator).map(l => l.trim()).filter(l => l);

            for (const line of lines) {
                if (line.match(/^(pitch|note|midi|#)/i)) continue;

                const note = this.parseCompactNoteLine(line, bpm);
                if (note) notes.push(note);
            }

            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                tracks.set(trackName, {
                    midi,
                    title: trackName.charAt(0).toUpperCase() + trackName.slice(1),
                    description: `Generated ${trackName}`
                });
                console.log(`[MERGED-TO-MAP] Created track "${trackName}" with ${notes.length} notes`);
            }
        }

        return tracks;
    }

    parseCompactNoteLine(line, bpm) {
        try {
            const parts = line.split(':').map(p => p.trim());
            if (parts.length < 4) return null;

            const secondsPerBeat = 60 / bpm;
            const pitchStr = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocityRaw = parseInt(parts[3]);

            if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocityRaw)) return null;

            const normalizedVelocity = Math.max(0.1, Math.min(0.9, velocityRaw / 10));

            let midiNote;
            if (!isNaN(parseInt(pitchStr))) {
                midiNote = parseInt(pitchStr);
            } else {
                midiNote = Tone.Frequency(pitchStr).toMidi();
            }

            if (isNaN(midiNote)) return null;

            return {
                midi: midiNote,
                name: Tone.Frequency(midiNote, "midi").toNote(),
                time: startBeat * secondsPerBeat,
                duration: durationBeats * secondsPerBeat,
                velocity: normalizedVelocity
            };
        } catch (e) {
            return null;
        }
    }

    createMidiFromNotes(notes, bpm) {
        const midi = new Midi();
        const track = midi.addTrack();
        midi.header.setTempo(bpm);

        notes.sort((a, b) => a.time - b.time).forEach(note => {
            track.addNote({
                name: note.name,
                midi: note.midi,
                time: note.time,
                duration: note.duration,
                velocity: note.velocity
            });
        });

        return midi;
    }

    setVisualizerToAllTracks() {
        try {
            document.querySelectorAll('.track-selector').forEach(btn => {
                btn.classList.remove('active');
            });

            const allTracksBtn = document.querySelector('.track-selector[data-track-type="all"]');
            if (allTracksBtn) {
                allTracksBtn.classList.add('active');
            }

            this.app.visualizer.activeTrackType = 'all';
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();

        } catch (error) {
            console.error('[SET-ALL-TRACKS] Error:', error);
            this.app.visualizer.activeTrackType = 'all';
        }
    }

    // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?    // EXISTING METHODS (unchanged)
    // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
    handleJsonInputChange(e) {
        const newJsonString = e.target.value;
        const rawJsonInput = document.getElementById('raw-json-input');

        try {
            const parsedJson = JSON.parse(newJsonString);
            this.sourceJson = JSON.stringify(parsedJson);

            if (parsedJson.tracks) {
                this.updateEditTrackCheckboxes(Object.keys(parsedJson.tracks));
            }

            const originalVersion = this.versions.find(v => v.isOriginal);
            if (originalVersion) {
                originalVersion.apiResponse = parsedJson;
                const sourceTitle = document.getElementById('source-composition-title');
                const sourceExplanation = document.getElementById('source-composition-explanation');
                if (sourceTitle) sourceTitle.textContent = parsedJson.title || 'Custom Composition';
                if (sourceExplanation) sourceExplanation.textContent = parsedJson.explanation || parsedJson.desc || '';
            }

            this.app.ui.showMessage('JSON is valid. Ready to edit.', 'success');
            const applyEditBtn = document.getElementById('apply-track-edit');
            if (applyEditBtn) applyEditBtn.disabled = false;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            console.error('Invalid JSON input:', error);
            this.app.ui.showMessage('Invalid JSON format.', 'error');
            const applyEditBtn = document.getElementById('apply-track-edit');
            if (applyEditBtn) applyEditBtn.disabled = true;
            if (rawJsonInput) rawJsonInput.style.borderColor = '#ef4444';
        }
    }

    reset() {
        // Clear internal state
        this.sourceJson = null;
        this.versions = [];

        // Get UI elements
        const rawJsonInput = document.getElementById('raw-json-input');
        const sourceDetails = document.getElementById('source-composition-details');
        const downloadBtn = document.getElementById('download-all-zip');
        const applyEditBtn = document.getElementById('apply-track-edit');
        
        // 鉁?NEW: Get elements that weren't being cleared
        const versionsList = document.getElementById('versions-list');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');
        const editType = document.getElementById('edit-type');
        const intensitySlider = document.getElementById('intensity-slider');
        const intensityValue = document.getElementById('intensity-value');
        const intensityPreview = document.getElementById('intensity-preview');
        const intensitySection = document.getElementById('intensity-slider-section');
        const customSection = document.getElementById('custom-edit-section');
        const customPrompt = document.getElementById('custom-edit-prompt');

        // Clear text inputs
        if (rawJsonInput) rawJsonInput.value = '';
        
        // 鉁?Clear source composition display
        if (sourceTitle) sourceTitle.textContent = '';
        if (sourceExplanation) sourceExplanation.textContent = '';
        
        // Show placeholder message in source details
        if (sourceDetails && sourceDetails.querySelector('p')) {
            sourceDetails.querySelector('p').style.display = 'block';
        }

        // 鉁?Clear versions list UI
        if (versionsList) {
            versionsList.innerHTML = '<p>Your edited versions will appear here.</p>';
        }

        // Disable buttons
        if (applyEditBtn) applyEditBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = true;

        // 鉁?Reset edit controls
        if (editType) editType.value = 'intensity_up';
        if (intensitySlider) {
            intensitySlider.value = 30;
            intensitySlider.min = 10;
            intensitySlider.max = 100;
        }
        if (intensityValue) intensityValue.textContent = '鈫?Subtle: +30%';
        if (intensityPreview) {
            intensityPreview.textContent = '';
            intensityPreview.style.display = 'none';
        }
        if (intensitySection) intensitySection.style.display = 'none';
        if (customSection) customSection.style.display = 'none';
        if (customPrompt) customPrompt.value = '';

        // Clear track checkboxes
        this.updateEditTrackCheckboxes([]);
    }

    setSourceComposition(rawJson, metadata, context) {
        this.reset();
        this.sourceJson = rawJson;
        this.versions = [];

        const rawJsonInput = document.getElementById('raw-json-input');
        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');

        try {
            const parsedSource = JSON.parse(rawJson);
            if (rawJsonInput) rawJsonInput.value = JSON.stringify(parsedSource, null, 2);

            if (parsedSource.tracks) {
                this.updateEditTrackCheckboxes(Object.keys(parsedSource.tracks));
            }

            const originalVersion = {
                apiResponse: {
                    title: metadata.title,
                    desc: metadata.explanation || metadata.desc,
                    tracks: parsedSource.tracks || {},
                },
                context: context,
                isOriginal: true,
                structure: 'Original'
            };
            this.versions.push(originalVersion);
            this.renderVersionsList();

            if (sourceTitle) sourceTitle.textContent = metadata.title;
            if (sourceExplanation) sourceExplanation.textContent = metadata.explanation || metadata.desc;
            if (sourceDetails && sourceDetails.querySelector('p')) {
                sourceDetails.querySelector('p').style.display = 'none';
            }

            const applyEditBtn = document.getElementById('apply-track-edit');
            if (applyEditBtn) applyEditBtn.disabled = false;

            const mp3Btn = document.getElementById('export-mp3-btn');
            if (mp3Btn) mp3Btn.disabled = false;

            this.app.ui.showMessage('Composition loaded. Select tracks to edit!', 'info');

        } catch (error) {
            console.error('Failed to parse source composition:', error);
            this.app.ui.showMessage('Error loading source composition.', 'error');
            this.reset();
        }
    }

    renderVersionsList() {
        const listEl = document.getElementById('versions-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        if (this.versions.length === 0) {
            listEl.innerHTML = '<p>Your edited versions will appear here.</p>';
            const downloadBtn = document.getElementById('download-all-zip');
            if (downloadBtn) downloadBtn.disabled = true;
            return;
        }

        this.versions.forEach((version, index) => {
            const card = document.createElement('div');
            card.className = 'variation-card';

            const editBadge = version.editDetails ? `<span class="edit-badge">EDIT</span>` : '';

            const deleteBtn = !version.isOriginal ? `<button class="btn btn-delete" data-index="${index}">鉁?/button>` : '';

            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${version.apiResponse.title} ${version.isOriginal ? '(Original)' : ''}${editBadge}</h4>
                    <p>${version.apiResponse.desc || version.apiResponse.explanation}</p>
                </div>
                <div class="variation-card-actions">
                    <button class="btn btn-accent btn-load" data-index="${index}">Load</button>
                    ${deleteBtn}
                </div>
            `;
            listEl.appendChild(card);
        });

        const downloadBtn = document.getElementById('download-all-zip');
        if (downloadBtn) downloadBtn.disabled = this.versions.length < 1;

        listEl.querySelectorAll('.btn-load').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = e.target.dataset.index;
                this.loadVersion(index);
            });
        });

        listEl.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                this.deleteVersion(index);
            });
        });
    }

    deleteVersion(index) {
        const version = this.versions[index];
        if (!version || version.isOriginal) return;

        this.versions.splice(index, 1);
        this.renderVersionsList();
        this.app.ui.showMessage(`Deleted "${version.apiResponse.title}".`, 'success');
    }

    loadVersion(index) {
        try {
            const version = this.versions[index];
            if (!version) {
                this.app.ui.showMessage('Version not found.', 'error');
                return;
            }

            const versionJson = JSON.stringify({
                title: version.apiResponse.title,
                desc: version.apiResponse.desc || version.apiResponse.explanation || '',
                tracks: version.apiResponse.tracks || {}
            }, null, 2);

            this.sourceJson = JSON.stringify({
                title: version.apiResponse.title,
                desc: version.apiResponse.desc || version.apiResponse.explanation || '',
                tracks: version.apiResponse.tracks || {}
            });

            const rawJsonInput = document.getElementById('raw-json-input');
            if (rawJsonInput) rawJsonInput.value = versionJson;

            if (version.apiResponse.tracks) {
                this.updateEditTrackCheckboxes(Object.keys(version.apiResponse.tracks));
            }

            this.updateMainAppAfterEdit(version.apiResponse);

            this.app.ui.showMessage(`Loaded "${version.apiResponse.title}" into the main player.`, 'success');

        } catch (error) {
            console.error('Error loading version:', error);
            this.app.ui.showMessage(`Failed to load version: ${error.message}`, 'error');
        }
    }

    async downloadAllAsZip() {
        if (this.versions.length === 0) {
            this.app.ui.showMessage('No versions to download.', 'warning');
            return;
        }

        this.app.ui.showLoading('Preparing ZIP...');
        try {
            const zip = new JSZip();
            const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
            const sourceTitle = this.versions[0]?.apiResponse?.title.replace(/ \(.+\)/, '') || 'composition';

            for (const version of this.versions) {
                const tracks = this.mergedTracksToTrackMap(version.apiResponse.tracks);
                if (tracks.size > 0) {
                    const combinedMidi = MidiBuilder.createCombinedMidi(tracks, bpm);
                    if (combinedMidi) {
                        const midiBytes = combinedMidi.toArray();
                        const sanitizedTitle = version.apiResponse.title.replace(/[\/\\?%*:|"<>]/g, '-').trim();
                        zip.file(`${sanitizedTitle}.mid`, midiBytes);
                    }
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const sanitizedSourceTitle = sourceTitle.replace(/[\/\\?%*:|"<>]/g, '-').trim();
            const zipFilename = `${sanitizedSourceTitle}-edits.zip`;

            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = zipFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            this.app.ui.showMessage('All versions downloaded as ZIP.', 'success');

        } catch (error) {
            console.error('ZIP failed:', error);
            this.app.ui.showMessage(`Error creating ZIP: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }
}
