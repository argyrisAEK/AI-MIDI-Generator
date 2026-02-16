import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';
import { trackAbbreviations } from './prompt-builder.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.setupEventListeners();
    }

    setupEventListeners() {
        const generateBtn = document.getElementById('generate-variations');
        const downloadBtn = document.getElementById('download-all-zip');
        const rawInput = document.getElementById('raw-json-input');

        if (generateBtn) generateBtn.addEventListener('click', () => this.generateVariation());
        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadAllAsZip());
        if (rawInput) rawInput.addEventListener('input', (e) => this.handleJsonInputChange(e));
    }

    handleJsonInputChange(e) {
        const rawJsonInput = document.getElementById('raw-json-input');
        try {
            const parsed = JSON.parse(e.target.value);
            this.sourceJson = JSON.stringify(parsed);
            
            const original = this.versions.find(v => v.isOriginal);
            if (original) {
                original.apiResponse = parsed;
                document.getElementById('source-composition-title').textContent = parsed.title || 'Custom';
                document.getElementById('source-composition-explanation').textContent = parsed.explanation || parsed.description || '';
            }

            this.app.ui.showMessage('Valid JSON', 'success');
            document.getElementById('generate-variations').disabled = false;
            rawJsonInput.style.borderColor = 'var(--accent)';
        } catch {
            this.app.ui.showMessage('Invalid JSON', 'warning');
            document.getElementById('generate-variations').disabled = true;
            rawJsonInput.style.borderColor = 'var(--error)';
        }
    }

    reset() {
        this.sourceJson = null;
        this.versions = [];
        
        const els = {
            raw: document.getElementById('raw-json-input'),
            list: document.getElementById('versions-list'),
            title: document.getElementById('source-composition-title'),
            expl: document.getElementById('source-composition-explanation'),
            details: document.getElementById('source-composition-details'),
            gen: document.getElementById('generate-variations'),
            dl: document.getElementById('download-all-zip')
        };

        if (els.raw) els.raw.value = '';
        if (els.list) els.list.innerHTML = '<p>Your generated versions will appear here.</p>';
        if (els.title) els.title.textContent = '';
        if (els.expl) els.expl.textContent = '';
        if (els.details?.querySelector('p')) els.details.querySelector('p').style.display = 'block';
        if (els.gen) els.gen.disabled = true;
        if (els.dl) els.dl.disabled = true;
    }

    setSourceComposition(rawJson, metadata, context) {
        this.reset();
        this.sourceJson = rawJson;

        const els = {
            raw: document.getElementById('raw-json-input'),
            title: document.getElementById('source-composition-title'),
            expl: document.getElementById('source-composition-explanation'),
            details: document.getElementById('source-composition-details'),
            gen: document.getElementById('generate-variations')
        };

        try {
            const parsed = JSON.parse(rawJson);
            if (els.raw) els.raw.value = JSON.stringify(parsed, null, 2);

            this.versions.push({
                apiResponse: { ...parsed, title: metadata.title, explanation: metadata.explanation },
                context,
                isOriginal: true,
                structure: 'Original'
            });
            this.renderVersionsList();

            if (els.title) els.title.textContent = metadata.title;
            if (els.expl) els.expl.textContent = metadata.explanation;
            if (els.details?.querySelector('p')) els.details.querySelector('p').style.display = 'none';
            if (els.gen) els.gen.disabled = false;
            
            this.app.ui.showMessage('Composition loaded!', 'info');
        } catch (err) {
            console.error('Failed to load:', err);
            this.app.ui.showMessage('Error loading composition', 'error');
            this.reset();
        }
    }

    renderVersionsList() {
        const listEl = document.getElementById('versions-list');
        if (!listEl) return;

        listEl.innerHTML = this.versions.length ? '' : '<p>Your generated versions will appear here.</p>';
        
        this.versions.forEach((v, i) => {
            const card = document.createElement('div');
            card.className = 'variation-card';
            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${v.apiResponse.title} ${v.isOriginal ? '(Original)' : ''}</h4>
                    <p>${v.apiResponse.explanation}</p>
                </div>
                <button class="btn btn-accent btn-load" data-index="${i}">Load</button>
            `;
            listEl.appendChild(card);
        });

        const dlBtn = document.getElementById('download-all-zip');
        if (dlBtn) dlBtn.disabled = this.versions.length < 1;
        
        listEl.querySelectorAll('.btn-load').forEach(btn => {
            btn.addEventListener('click', (e) => this.loadVersion(e.target.dataset.index));
        });
    }

    loadVersion(index) {
        const version = this.versions[index];
        if (!version) return this.app.ui.showMessage('Version not found', 'error');

        const tracks = this.parseNotationToTracks(version.apiResponse.notation);
        if (!tracks.size) return this.app.ui.showMessage('Empty version', 'error');

        this.app.generatedTracks = tracks;
        this.app.compositionTitle = version.apiResponse.title;
        this.app.compositionDescription = version.apiResponse.explanation;
        
        this.updateVisualizer(tracks, version.apiResponse.title, version.apiResponse.explanation);
        this.app.ui.updateButtonStates(true);
        this.app.ui.showMessage(`Loaded "${version.apiResponse.title}"`, 'success');
    }

    updateVisualizer(tracks, title, desc) {
        this.app.visualizer.compositionTitle = title;
        this.app.visualizer.compositionDescription = desc;
        this.app.visualizer.loadNotes(tracks, title, desc);
        this.app.visualizer.updateTrackSelectors();
        this.app.visualizer.stopVisualization();
        this.app.visualizer.renderStaticBackground();
        this.app.visualizer.drawFrame();
    }

    // ═════════════════════════════════════════════════════════════════
    // TOKEN-EFFICIENT VARIATION GENERATION
    // ═════════════════════════════════════════════════════════════════

    async generateVariation() {
        if (!this.sourceJson) {
            return this.app.ui.showMessage('Provide source JSON first', 'warning');
        }

        const structure = document.getElementById('structure-select')?.value;
        const duration = parseInt(document.getElementById('variation-duration')?.value, 10) || 4;
        
        if (!structure) {
            return this.app.ui.showMessage('Select structure type', 'warning');
        }

        try {
            this.app.ui.showLoading(`Generating ${structure}...`);
            
            const source = JSON.parse(this.sourceJson);
            const trackTypes = this.extractTrackTypes(source);
            
            if (!trackTypes.length) {
                throw new Error('No tracks found in source');
            }

            const prompt = this.buildCompactPrompt(source, structure, trackTypes, duration);
            
            const response = await fetchWithModelFallbacks(
                '/api/variations',
                ['openai-large', 'openai'],
                this.app.ui,
                {
                    prompt,
                    seed: Date.now() % 100000,
                    max_tokens: 4000,
                    temperature: 0.6
                }
            );

            const variation = this.parseCompactResponse(await response.text(), structure);
            
            this.versions.push({
                apiResponse: variation,
                isOriginal: false,
                structure
            });
            
            this.renderVersionsList();
            this.app.ui.showMessage(`${structure} generated!`, 'success');

        } catch (err) {
            console.error('Generation failed:', err);
            this.app.ui.showMessage(`Error: ${err.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    extractTrackTypes(source) {
        // Extract from notation first
        if (source.notation) {
            const types = new Set();
            source.notation.split('\n').forEach(line => {
                const match = line.match(/#\s*(\w+)/);
                if (match) types.add(match[1]);
            });
            if (types.size) return Array.from(types);
        }
        // Fallback to tracks object
        return Object.keys(source.tracks || {});
    }

    buildCompactPrompt(source, structure, trackTypes, duration) {
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const key = document.getElementById('key')?.value || 'C';
        const beats = duration * 4;
        
        // Limit tracks based on structure
        const maxTracks = { intro: 2, build: 3, verse: 3, chorus: 4, bridge: 3 }[structure] || 3;
        const selectedTracks = trackTypes.slice(0, maxTracks);
        
        // Compact pattern summary (first 4 notes per track)
        const pattern = this.summarizePattern(source, selectedTracks);

        return `Generate ${structure.toUpperCase()}|${key}|${bpm}bpm|${duration}bars|${beats}beats
Pattern:${pattern}
Tracks:[${selectedTracks.join(',')}]
Rules:pitch,beat,dur,vel\\n|beat+dur≤${beats}|vel0.1-1|no spaces
Example:${this.getExample(structure)}
Output:{"t":"${source.title}-${structure}","d":"${structure} section","tracks":{${selectedTracks.map(t => `"${t}":"60,0,2,0.5"`).join(',')}}}`;
    }

    summarizePattern(source, trackTypes) {
        const notes = [];
        
        if (source.notation) {
            source.notation.split('\n').slice(0, 6).forEach(line => {
                const [note, track] = line.split('#');
                if (note && track && trackTypes.some(t => track.includes(t))) {
                    const [p, b, d, v] = note.trim().split(',');
                    notes.push(`${b},${d}`); // Only rhythm pattern
                }
            });
        } else if (source.tracks) {
            Object.entries(source.tracks).slice(0, 2).forEach(([name, data]) => {
                const sample = data.split('|').slice(0, 3);
                notes.push(`${name}:${sample.map(n => n.split(':').slice(1,3).join(',')).join(';')}`);
            });
        }
        
        return notes.join('|') || '4/4 rhythmic';
    }

    getExample(structure) {
        const ex = {
            intro: '{"t":"X-Intro","d":"sparse open","tracks":{"pad":"55,0,8,0.3\\n59,0,8,0.3","bass":"43,0,4,0.4"}}',
            build: '{"t":"X-Build","d":"rising tension","tracks":{"pad":"55,0,4,0.5\\n57,2,2,0.6","bass":"43,0,2,0.5\\n45,2,2,0.6","lead":"67,0,1,0.7"}}',
            verse: '{"t":"X-Verse","d":"steady groove","tracks":{"bass":"43,0,1,0.6\\n43,1,1,0.6","keys":"55,0,2,0.5\\n62,0,2,0.5","pad":"55,0,4,0.4"}}',
            chorus: '{"t":"X-Chorus","d":"peak energy","tracks":{"bass":"43,0,0.5,0.9\\n43,0.5,0.5,0.9","keys":"67,0,2,0.8\\n71,0,2,0.8","pad":"67,0,4,0.7","lead":"79,0,0.5,1.0"}}',
            bridge: '{"t":"X-Bridge","d":"contrast section","tracks":{"pad":"50,0,4,0.5\\n57,0,4,0.5","keys":"62,0,2,0.6\\n66,2,2,0.6"}}'
        };
        return ex[structure] || ex.verse;
    }

    parseCompactResponse(text, structure) {
        // Extract JSON aggressively
        const match = text.match(/\{[\s\S]*?\}(?=\s*$|\s*\n)/);
        if (!match) throw new Error('No JSON in response');
        
        let parsed;
        try {
            parsed = JSON.parse(match[0].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
        } catch {
            // Try fixing common issues
            const fixed = match[0]
                .replace(/,\s*}/g, '}') // trailing commas
                .replace(/,\s*]/g, ']')
                .replace(/"\s*:\s*"/g, '":"')
                .replace(/"\s*,\s*"/g, '","');
            parsed = JSON.parse(fixed);
        }

        if (!parsed.t && !parsed.title) throw new Error('Missing title');
        if (!parsed.tracks) throw new Error('Missing tracks');

        // Normalize field names
        const title = parsed.t || parsed.title;
        const desc = parsed.d || parsed.description || parsed.explanation || `${structure} variation`;
        const tracks = parsed.tracks;

        // Convert to notation format
        const notation = Object.entries(tracks)
            .flatMap(([track, notes]) => 
                notes.split('\n')
                    .map(n => n.trim())
                    .filter(n => n && !n.startsWith('pitch'))
                    .map(n => `${n} # ${track}`)
            )
            .join('\n');

        return { title, explanation: desc, notation };
    }

    parseNotationToTracks(notation) {
        const tracks = new Map();
        if (!notation) return tracks;

        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const spb = 60 / bpm;

        // Single-pass parse
        for (const line of notation.split('\n')) {
            if (!line.includes('#')) continue;
            
            const [content, trackPart] = line.split('#');
            const track = trackPart?.trim().split(/\s/)[0];
            if (!track) continue;

            const parts = content.trim().split(',');
            if (parts.length < 4) continue;

            const [pitch, beat, dur, vel] = parts;
            const start = parseFloat(beat) * spb;
            const duration = parseFloat(dur) * spb;
            
            if (isNaN(start) || isNaN(duration)) continue;

            if (!tracks.has(track)) tracks.set(track, []);
            
            const midi = isNaN(pitch) ? Tone.Frequency(pitch).toMidi() : parseInt(pitch);
            
            tracks.get(track).push({
                name: Tone.Frequency(midi, 'midi').toNote(),
                midi,
                time: Math.max(0, start),
                duration: Math.max(0.01, duration),
                velocity: Math.max(0.1, Math.min(1, parseFloat(vel) || 0.5))
            });
        }

        // Build MIDI objects
        const result = new Map();
        tracks.forEach((notes, name) => {
            if (!notes.length) return;
            
            const midi = new Midi();
            midi.header.setTempo(bpm);
            const track = midi.addTrack();
            
            notes.sort((a, b) => a.time - b.time)
                 .forEach(n => track.addNote(n));
            
            result.set(name, {
                midi,
                title: name.charAt(0).toUpperCase() + name.slice(1),
                description: `Generated ${name}`
            });
        });

        return result;
    }

    // ═════════════════════════════════════════════════════════════════
    // DOWNLOAD
    // ═════════════════════════════════════════════════════════════════

    async downloadAllAsZip() {
        if (this.versions.length < 1) {
            return this.app.ui.showMessage('No versions to download', 'warning');
        }

        this.app.ui.showLoading('Creating ZIP...');
        
        try {
            const zip = new JSZip();
            const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
            const baseTitle = this.versions[0]?.apiResponse?.title?.replace(/ \(.+\)/, '') || 'composition';

            for (const v of this.versions) {
                const tracks = this.parseNotationToTracks(v.apiResponse.notation);
                if (!tracks.size) continue;

                const combined = MidiBuilder.createCombinedMidi(tracks, bpm);
                if (combined) {
                    const filename = v.apiResponse.title.replace(/[\/\\?%*:|"<>]/g, '-') + '.mid';
                    zip.file(filename, combined.toArray());
                }
            }

            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `${baseTitle.replace(/[\/\\?%*:|"<>]/g, '-')}-variations.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.app.ui.showMessage('ZIP downloaded!', 'success');
        } catch (err) {
            console.error('ZIP failed:', err);
            this.app.ui.showMessage(`ZIP error: ${err.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }
}
