import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { trackAbbreviations } from './prompt-builder.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.sourceNotes = new Map();
        this.sourceAnalysis = null;
     
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
        const newJsonString = e.target.value;
        const rawJsonInput = document.getElementById('raw-json-input');

        try {
            const parsedJson = JSON.parse(newJsonString);
            this.sourceJson = JSON.stringify(parsedJson);

            const originalVersion = this.versions.find(v => v.isOriginal);
            if (originalVersion) {
                originalVersion.apiResponse = parsedJson;
                const sourceTitle = document.getElementById('source-composition-title');
                const sourceExplanation = document.getElementById('source-composition-explanation');
                if (sourceTitle) sourceTitle.textContent = parsedJson.title || 'Custom Composition';
                if (sourceExplanation) sourceExplanation.textContent = parsedJson.explanation || parsedJson.description || '';
            }

            this.parseSourceNotes(parsedJson);
            this.analyzeSourceMusic();

            this.app.ui.showMessage('JSON is valid. Ready to generate.', 'success');
            const generateBtn = document.getElementById('generate-variations');
            if (generateBtn) generateBtn.disabled = false;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            this.app.ui.showMessage('Invalid JSON format. Please correct it to generate variations.', 'warning');
            const generateBtn = document.getElementById('generate-variations');
            if (generateBtn) generateBtn.disabled = true;
            if (rawJsonInput) rawJsonInput.style.borderColor = 'var(--error)';
        }
    }

    reset() {
        this.sourceJson = null;
        this.versions = [];
        this.sourceAnalysis = null;

        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');
        const versionsList = document.getElementById('versions-list');
        const rawJsonInput = document.getElementById('raw-json-input');
        const generateBtn = document.getElementById('generate-variations');
        const downloadBtn = document.getElementById('download-all-zip');

        if (rawJsonInput) rawJsonInput.value = '';
        if (versionsList) versionsList.innerHTML = '<p>Your generated versions will appear here.</p>';
        
        if (sourceTitle) sourceTitle.textContent = '';
        if (sourceExplanation) sourceExplanation.textContent = '';
        if (sourceDetails && sourceDetails.querySelector('p')) {
            sourceDetails.querySelector('p').style.display = 'block';
        }
        
        if (generateBtn) generateBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = true;
    }

    fullReset() {
        this.sourceJson = null;
        this.versions = [];
        this.sourceNotes.clear();
        this.sourceAnalysis = null;
        this.resetUI();
    }

    resetUI() {
        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');
        const versionsList = document.getElementById('versions-list');
        const rawJsonInput = document.getElementById('raw-json-input');
        const generateBtn = document.getElementById('generate-variations');
        const downloadBtn = document.getElementById('download-all-zip');

        if (rawJsonInput) rawJsonInput.value = '';
        if (versionsList) versionsList.innerHTML = '<p>Your generated versions will appear here.</p>';
        
        if (sourceTitle) sourceTitle.textContent = '';
        if (sourceExplanation) sourceExplanation.textContent = '';
        if (sourceDetails && sourceDetails.querySelector('p')) {
            sourceDetails.querySelector('p').style.display = 'block';
        }
        
        if (generateBtn) generateBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = true;
    }

    setSourceComposition(rawJson, metadata, context) {
        this.versions = [];
        this.sourceJson = null;
        this.sourceAnalysis = null;

        const rawJsonInput = document.getElementById('raw-json-input');
        const sourceDetails = document.getElementById('source-composition-details');
        const sourceTitle = document.getElementById('source-composition-title');
        const sourceExplanation = document.getElementById('source-composition-explanation');

        try {
            const parsedSource = JSON.parse(rawJson);
            this.sourceJson = JSON.stringify(parsedSource);
            
            if (rawJsonInput) rawJsonInput.value = JSON.stringify(parsedSource, null, 2);

            this.parseSourceNotes(parsedSource);
            this.analyzeSourceMusic();

            const originalVersion = {
                apiResponse: {
                    title: metadata.title,
                    explanation: metadata.explanation,
                    notation: parsedSource.notation || this.buildNotationFromTracks(parsedSource.tracks) || '',
                },
                context: context,
                isOriginal: true,
                structure: 'Original'
            };
            this.versions.push(originalVersion);
            this.renderVersionsList();

            if (sourceTitle) sourceTitle.textContent = metadata.title;
            if (sourceExplanation) sourceExplanation.textContent = metadata.explanation;
            if (sourceDetails && sourceDetails.querySelector('p')) {
                sourceDetails.querySelector('p').style.display = 'none';
            }

            const generateBtn = document.getElementById('generate-variations');
            if (generateBtn) generateBtn.disabled = false;
            this.app.ui.showMessage('Composition loaded. You can now generate variations!', 'info');

        } catch (error) {
            console.error('Failed to parse and set source composition:', error);
            this.app.ui.showMessage('Error loading source composition for variations.', 'error');
            this.fullReset();
        }
    }

    /**
     * Analyze source music for intelligent variation generation
     */
    analyzeSourceMusic() {
        if (this.sourceNotes.size === 0) return;

        const analysis = {
            key: this.detectKey(),
            scale: 'minor',
            bpm: parseInt(document.getElementById('bpm')?.value) || 120,
            timeSignature: document.getElementById('time-signature')?.value || '4/4',
            totalBeats: 0,
            tracks: {},
            harmonicRhythm: 4, // Default: chord every 4 beats
            melodicRange: { min: 60, max: 72 }
        };

        const allPitches = [];

        this.sourceNotes.forEach((notes, trackType) => {
            if (notes.length === 0) return;

            const pitches = notes.map(n => n.midi);
            const uniquePitches = [...new Set(pitches)].sort((a, b) => a - b);
            const pitchRange = Math.max(...pitches) - Math.min(...pitches);
            
            allPitches.push(...pitches);

            // Detect rhythm patterns
            const rhythmPattern = this.detectRhythmPattern(notes, analysis.bpm);
            
            // Detect melodic contour
            const contour = this.detectMelodicContour(notes);

            const totalDuration = Math.max(...notes.map(n => n.time + n.duration));
            if (totalDuration > analysis.totalBeats) {
                analysis.totalBeats = totalDuration;
            }

            analysis.tracks[trackType] = {
                noteCount: notes.length,
                pitchRange: pitchRange,
                lowestPitch: Math.min(...pitches),
                highestPitch: Math.max(...pitches),
                uniquePitches: uniquePitches,
                avgVelocity: pitches.reduce((a, b) => a + b, 0) / pitches.length / 127,
                density: notes.length / totalDuration,
                rhythmPattern: rhythmPattern,
                contour: contour,
                register: this.classifyRegister(Math.min(...pitches), Math.max(...pitches))
            };
        });

        // Global analysis
        if (allPitches.length > 0) {
            analysis.melodicRange = {
                min: Math.min(...allPitches),
                max: Math.max(...allPitches)
            };
        }

        this.sourceAnalysis = analysis;
        console.log('[Source Analysis]', analysis);
    }

    detectKey() {
        // Simple key detection based on most common pitch classes
        const pitchClasses = {};
        this.sourceNotes.forEach(notes => {
            notes.forEach(n => {
                const pc = n.midi % 12;
                pitchClasses[pc] = (pitchClasses[pc] || 0) + 1;
            });
        });
        
        // C minor/C major heuristic (simplified)
        const c = pitchClasses[0] || 0;
        const eb = pitchClasses[3] || 0;
        const ab = pitchClasses[8] || 0;
        
        return (eb > c * 0.3 || ab > c * 0.3) ? 'C minor' : 'C major';
    }

    detectRhythmPattern(notes, bpm) {
        if (notes.length < 4) return 'simple';
        
        const intervals = [];
        for (let i = 1; i < notes.length; i++) {
            const interval = notes[i].time - notes[i-1].time;
            intervals.push(Math.round(interval * 100) / 100);
        }
        
        const uniqueIntervals = [...new Set(intervals)];
        if (uniqueIntervals.length <= 2) return 'repetitive';
        if (uniqueIntervals.length <= 4) return 'patterned';
        return 'complex';
    }

    detectMelodicContour(notes) {
        if (notes.length < 3) return 'static';
        
        let ascending = 0;
        let descending = 0;
        
        for (let i = 1; i < notes.length; i++) {
            const diff = notes[i].midi - notes[i-1].midi;
            if (diff > 0) ascending++;
            else if (diff < 0) descending++;
        }
        
        if (ascending > descending * 2) return 'ascending';
        if (descending > ascending * 2) return 'descending';
        if (ascending === descending) return 'arch';
        return 'undulating';
    }

    classifyRegister(minPitch, maxPitch) {
        if (maxPitch < 40) return 'sub';
        if (maxPitch < 55) return 'bass';
        if (maxPitch < 65) return 'tenor';
        if (maxPitch < 75) return 'alto';
        if (maxPitch < 85) return 'soprano';
        return 'high';
    }

    parseSourceNotes(parsedJson) {
        this.sourceNotes.clear();
        
        const notation = parsedJson.notation || '';
        const lines = notation.replace(/\\n/g, '\n').split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.includes('#')) continue;
            
            const [content, comment] = trimmed.split('#', 2);
            const note = this.parseNoteLine(content.trim());
            const trackType = comment?.trim().split(/\s/)[0];
            
            if (note && trackType) {
                if (!this.sourceNotes.has(trackType)) {
                    this.sourceNotes.set(trackType, []);
                }
                this.sourceNotes.get(trackType).push(note);
            }
        }

        console.log(`[JSONVariations] Parsed source notes:`, 
            Array.from(this.sourceNotes.entries()).map(([k, v]) => `${k}: ${v.length} notes`).join(', '));
    }

    buildNotationFromTracks(tracks) {
        if (!tracks || typeof tracks !== 'object') return '';
        const lines = [];
        for (const [trackName, notesStr] of Object.entries(tracks)) {
            const noteLine = notesStr.split('\n').filter(l => l.trim());
            for (const note of noteLine) {
                if (note.trim()) {
                    lines.push(`${note.trim()} # ${trackName}`);
                }
            }
        }
        return lines.join('\n');
    }

    renderVersionsList() {
        const listEl = document.getElementById('versions-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        if (this.versions.length === 0) {
            listEl.innerHTML = '<p>Your generated versions will appear here.</p>';
            const downloadBtn = document.getElementById('download-all-zip');
            if (downloadBtn) downloadBtn.disabled = true;
            return;
        }

        this.versions.forEach((version, index) => {
            const card = document.createElement('div');
            card.className = 'variation-card';
            card.innerHTML = `
                <div class="variation-card-info">
                    <h4>${version.apiResponse.title} ${version.isOriginal ? '(Original)' : ''}</h4>
                    <p>${version.apiResponse.explanation}</p>
                    ${version.directives ? `<small class="directive-tag">${version.directives}</small>` : ''}
                </div>
                <div class="variation-card-actions">
                    <button class="btn btn-accent btn-load" data-index="${index}">Load</button>
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
    }
    
    loadVersion(index) {
        try {
            const version = this.versions[index];
            if (!version) {
                this.app.ui.showMessage('Version not found.', 'error');
                return;
            }

            let tracks;
            
            if (version.directives && this.sourceNotes.size > 0) {
                tracks = this.applyAdvancedDirectives(version.directives, version.structure);
            } else {
                tracks = this.parseNotationToTracks(version.apiResponse.notation);
            }
            
            if (tracks.size === 0) {
                this.app.ui.showMessage('Cannot load an empty version.', 'error');
                return;
            }

            this.app.generatedTracks = tracks;
            this.app.compositionTitle = version.apiResponse.title;
            this.app.compositionDescription = version.apiResponse.explanation;
            
            this.updateVisualizer(
                tracks,
                version.apiResponse.title,
                version.apiResponse.explanation
            );
            
            this.app.ui.updateButtonStates(true);
            this.app.ui.showMessage(`Loaded "${version.apiResponse.title}" into the main player.`, 'success');

        } catch (error) {
            console.error('Error loading version:', error);
            this.app.ui.showMessage(`Failed to load version: ${error.message}`, 'error');
        }
    }

    updateVisualizer(tracks, title, description) {
        try {
            this.app.visualizer.compositionTitle = title;
            this.app.visualizer.compositionDescription = description;
            this.app.visualizer.loadNotes(tracks, title, description);
            this.app.visualizer.updateTrackSelectors();
            this.app.visualizer.stopVisualization();
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();
            
            console.log(`✓ Visualizer updated with ${tracks.size} tracks`);
        } catch (error) {
            console.error('Visualizer update failed:', error);
            throw error;
        }
    }

    /**
     * ============================================
     * ADVANCED STRUCTURE-SPECIFIC DIRECTIVES
     * ============================================
     * 
     * NEW DIRECTIVES:
     * - arpeggiate:1       → Break chords into arpeggios
     * - double:1           → Double melody at octave
     * - harmonize:3        → Add parallel harmony (3rd, 5th, etc)
     * - syncopate:1        → Shift notes to off-beats
     * - pedal:1            → Add bass pedal tone
     * - tremolo:1          → Rapid note repetition
     * - callresponse:1     → Alternating phrases
     * - cluster:1          → Tight note clusters
     * - spread:1           → Wide interval spacing
     * - quantize:1         → Snap to grid
     * - randomize:1        → Random pitch variations
     * - invert:1           → Invert melodic contour
     * - retrograde:1       → Reverse note order
     * - truncate:0.5       → Cut note durations
     * - sustain:2          → Extend note durations
     * - accent:1           → Emphasize downbeats
     * - ghost:1            → Add ghost notes
     * - rolls:1            → Drum rolls/flams
     * - break:1            → Add rhythmic breaks
     * - drop:1             → Drop bass notes
     * - rise:1             → Rising pitch sequence
     * - fall:1             → Falling pitch sequence
     */

    buildAdvancedDirectivePrompt(structure, trackTypes, duration) {
        const bpm = this.sourceAnalysis?.bpm || parseInt(document.getElementById('bpm')?.value) || 120;
        const analysis = this.sourceAnalysis;
        const trackInfo = trackTypes.map(t => {
            const ta = analysis?.tracks[t];
            return ta ? `${t}(${ta.register},${ta.rhythmPattern})` : t;
        }).join(', ');

        const structureDirectives = {
            intro: `Create an INTRO - the mysterious entry point that draws the listener in.

MUSICAL OBJECTIVE: Establish atmosphere, key, and mood with minimal material. Create anticipation.
AVAILABLE TRACKS: ${trackInfo}

DIRECTIVE OPTIONS (choose 3-5 that best achieve the intro feel):
- density:0.15-0.30          ← Essential: Extreme sparsity
- velocity:0.25-0.45         ← Essential: Intimate, whispered dynamics
- stretch:1.5-3.0            ← Essential: Slow, floating time
- sustain:2-4                ← Long, evolving notes
- pedal:1                    ← Drone/pedal tone for foundation
- arpeggiate:1               ← Gentle arpeggios instead of chords
- sparse:1                   ← Keep only structural notes
- gate:0.3-0.5               ← Short, breathing notes
- reverb:1                   ← Space between sounds (simulated via timing)
- fadein:1                   ← Gradual volume build
- cluster:1                  ← Tight, mysterious harmonies
- drop:1                     ← Omit bass initially, bring it in later

EXAMPLE: "density:0.2,velocity:0.35,stretch:2,pedal:1,sparse:1,gate:0.4"

Return ONLY the directive string:`,

            build: `Create a BUILD-UP - rising tension that demands attention.

MUSICAL OBJECTIVE: Increase energy exponentially. Make the listener feel the lift-off coming.
AVAILABLE TRACKS: ${trackInfo}

DIRECTIVE OPTIONS (choose 4-6 for maximum impact):
- density:0.8→1.8            ← Start sparse, end dense
- velocity:0.5→0.95          ← Crescendo dynamics
- stretch:0.6→0.9            ← Accelerating feel
- transpose:3-7              ← Rising pitch = tension
- octave:1                   ← Higher register shift
- fill:1                     ← Add ghost notes
- rise:1                     ← Ascending melodic lines
- accent:1                   ← Emphasize beats increasingly
- double:1                   ← Octave doubling for power
- tremolo:1                  ← Intensity via repetition
- syncopate:1                ← Rhythmic complexity
- break:0→1                  ← Start continuous, add breaks for drama
- filteropen:1               ← Simulated via velocity/density increase

EXAMPLE: "density:1.4,velocity:0.8,transpose:5,stretch:0.7,fill:1,rise:1,accent:1"

Return ONLY the directive string:`,

            verse: `Create a VERSE - the storytelling groove that carries the narrative.

MUSICAL OBJECTIVE: Grounded, consistent, hypnotic. Support without overwhelming.
AVAILABLE TRACKS: ${trackInfo}

DIRECTIVE OPTIONS (choose 3-5 for groove):
- density:0.7-0.85           ← Solid but not crowded
- velocity:0.6-0.75          ← Conversational level
- swing:25-45                ← Human, groovy feel
- humanize:15-30             ← Natural timing variation
- staccato:1                 ← Punchy, articulate
- ghost:1                    ← Subtle ghost notes
- syncopate:0.5              ← Light off-beat emphasis
- pedal:1                    ← Anchoring bass pedal
- callresponse:1             ← Question-answer phrasing
- quantize:0.8               ← Tight but not robotic
- accent:0.5                 ← Occasional emphasis
- groove:1                   ← Lock in the pocket

EXAMPLE: "density:0.75,velocity:0.65,swing:35,humanize:20,staccato:1,pedal:1"

Return ONLY the directive string:`,

            chorus: `Create a CHORUS - the anthemic peak that everyone remembers.

MUSICAL OBJECTIVE: Maximum emotional impact. Full, rich, soaring, unforgettable.
AVAILABLE TRACKS: ${trackInfo}

DIRECTIVE OPTIONS (choose 5-7 for anthem power):
- density:1.3-1.6            ← Fill every space
- velocity:0.9-1.1           ← Bold, confident
- transpose:12               ← Octave up for brightness
- double:1                   ← Octave doubling
- harmonize:3                ← Add parallel thirds
- legato:1                   ← Smooth, connected
- fill:1                     ← Maximum ornamentation
- spread:1                   ← Wide stereo spread (via register)
- sustain:1.5                ← Long, soaring notes
- accent:1                   ← Strong downbeats
- cluster:0.5                ← Rich harmonies
- rise:1                     ← Upward lift
- tremolo:0.5                ← Subtle intensity
- allin:1                    ← All tracks active

EXAMPLE: "density:1.5,velocity:1.0,transpose:12,double:1,harmonize:3,legato:1,fill:1,accent:1"

Return ONLY the directive string:`,

            bridge: `Create a BRIDGE - the surprising departure that refreshes the ear.

MUSICAL OBJECTIVE: Contrast, surprise, modulation, prepare for return.
AVAILABLE TRACKS: ${trackInfo}

DIRECTIVE OPTIONS (choose 4-6 for maximum contrast):
- transpose:4-7              ← Modulation (new key center)
- invert:1                   ← Flip melodic contour upside down
- retrograde:1               ← Reverse the melody
- reverse:1                  ← Play backwards
- density:0.4→1.2            ← Contrast in texture
- staccato:1                 ← Opposite of legato verse/chorus
- cluster:1                  ← Dissonant harmonies
- spread:1                   ← Extreme register separation
- break:1                    ← Rhythmic holes/silence
- randomize:0.3              ← Controlled chaos
- fall:1                     ← Descending lines (opposite of rise)
- pedal:1                    ← New pedal tone
- syncopate:1                ← Shifted rhythmic emphasis
- truncate:0.5               ← Chopped, fragmented

EXAMPLE: "transpose:5,invert:1,density:0.6,staccato:1,cluster:1,fall:1,break:1"

Return ONLY the directive string:`,

            outro: `Create an OUTRO - the satisfying conclusion or fade into infinity.

MUSICAL OBJECTIVE: Resolution, release, or eternal fade. Peaceful or dramatic ending.
AVAILABLE TRACKS: ${trackInfo}

DIRECTIVE OPTIONS (choose 3-5 for closure):
- density:0.3→0.05           ← Dissolve into nothing
- velocity:0.6→0.2           ← Fading away
- stretch:2→4                ← Time expanding
- sustain:3                  ← Final long notes
- pedal:1                    ← Last drone
- sparse:1                   ← Only essential notes
- fadeout:1                  ← Diminuendo
- cluster:1                  ← Final chord cluster
- fall:1                     ← Descending to rest
- truncate:0.3               ← Short final notes
- reverb:1                   ← Space takes over
- break:1                    ← Silence between sounds

EXAMPLE: "density:0.2,velocity:0.4,stretch:3,sustain:3,sparse:1,fadeout:1,fall:1"

Return ONLY the directive string:`,

            breakdown: `Create a BREAKDOWN - the stripped-back moment of tension.

MUSICAL OBJECTIVE: Remove elements, create anticipation, rebuild from minimal.
AVAILABLE TRACKS: ${trackInfo}

DIRECTIVE OPTIONS (choose 3-5 for maximum contrast):
- density:0.1-0.25           ← Almost nothing
- velocity:0.3-0.5           ← Quiet, intimate
- sparse:1                   ← Only skeleton
- break:1                    ← Rhythmic silence
- pedal:1                    ← Single sustaining note
- filterclose:1              ← Muffled, distant
- staccato:1                 ← Isolated points of sound
- ghost:1                    ← Barely audible
- space:1                    ← Emphasize the silence

EXAMPLE: "density:0.15,velocity:0.35,sparse:1,break:1,pedal:1,staccato:1"

Return ONLY the directive string:`,

            drop: `Create a DROP - the explosive release of built tension.

MUSICAL OBJECTIVE: Maximum impact, sudden fullness, rhythmic precision.
AVAILABLE TRACKS: ${trackInfo}

DIRECTIVE OPTIONS (choose 4-6 for impact):
- density:1.5-2.0            ← Wall of sound
- velocity:1.0-1.2           ← Hit hard
- accent:1                   ← Every beat emphasized
- double:1                   ← Octave reinforcement
- quantize:1                 ← Tight, precise
- staccato:0.5               ← Punchy but sustained
- syncopate:0.5              ← Off-beat hits
- rolls:1                    ← Drum roll effects
- allin:1                    ← Everything at once
- sustain:0.8                ← Controlled release

EXAMPLE: "density:1.8,velocity:1.1,accent:1,double:1,quantize:1,rolls:1,allin:1"

Return ONLY the directive string:`
        };

        return structureDirectives[structure] || structureDirectives.verse;
    }

    async generateVariation() {
        console.log('[generateVariation] Checking sourceNotes:', {
            size: this.sourceNotes.size,
            keys: Array.from(this.sourceNotes.keys())
        });

        if (this.sourceNotes.size === 0) {
            if (this.app.generatedTracks && this.app.generatedTracks.size > 0) {
                console.log('[generateVariation] Attempting to recover from app.generatedTracks');
                this.recoverSourceNotesFromApp();
                this.analyzeSourceMusic();
            }
            
            if (this.sourceNotes.size === 0) {
                this.app.ui.showMessage('No source notes loaded. Please generate a composition first.', 'warning');
                return;
            }
        }

        const selectedStructure = document.getElementById('structure-select')?.value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a version type (e.g., Intro, Chorus).', 'warning');
            return;
        }

        const selectedDuration = parseInt(document.getElementById('variation-duration')?.value, 10) || 4;
        const trackTypes = Array.from(this.sourceNotes.keys());

        try {
            this.app.ui.showLoading(`Creating "${selectedStructure}" variation...`);

            const prompt = this.buildAdvancedDirectivePrompt(selectedStructure, trackTypes, selectedDuration);
            const directiveString = await this.fetchDirectives(prompt, ['claude-fast', 'openai']);

            console.log('[generateVariation] Received directives:', directiveString);

            const newVersion = {
                apiResponse: {
                    title: `${this.versions[0]?.apiResponse?.title?.replace(/ \(Original\)/, '') || 'Composition'} - ${selectedStructure.charAt(0).toUpperCase() + selectedStructure.slice(1)}`,
                    explanation: `${selectedStructure} variation with advanced transformations`,
                    notation: null
                },
                directives: directiveString,
                structure: selectedStructure,
                isOriginal: false
            };

            this.versions.push(newVersion);
            this.renderVersionsList();
            
            this.app.ui.showMessage(`Created "${selectedStructure}" with smart directives: ${directiveString}`, 'success');

        } catch (error) {
            console.error('Variation generation failed:', error);
            this.app.ui.showMessage(`Failed to generate variation: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    async fetchDirectives(prompt, models) {
        const timeout = 25000;
        let lastError = null;

        for (const model of models) {
            this.app.ui.showMessage(`Designing ${model} directives...`, 'loading');
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch('/api/variations', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        prompt: prompt, 
                        model: model,
                        max_tokens: 150,
                        temperature: 0.9, // More creative
                        seed: Math.floor(Math.random() * 100000)
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                const text = await response.text();
                
                if (!text || text.trim().length === 0) {
                    throw new Error('Empty response');
                }

                const trimmed = text.trim();
                
                // Extract directive string
                const directiveMatch = trimmed.match(/([a-z]+:[\d.]+(?:,[a-z]+:[\d.]+)*)/i);
                
                if (directiveMatch) {
                    return directiveMatch[1];
                }
                
                if (trimmed.includes(':') && trimmed.includes(',')) {
                    return trimmed.replace(/["']/g, '').split('\n')[0].trim();
                }

                throw new Error('Response does not contain valid directives');

            } catch (error) {
                lastError = error;
                console.warn(`Attempt with ${model} failed:`, error.message);
                if (model !== models[models.length - 1]) {
                    this.app.ui.showMessage(`${model} failed, trying next...`, 'info');
                }
            }
        }

        throw lastError || new Error('All models failed');
    }

    /**
     * Apply ALL advanced directives with structure-aware creativity
     */
    applyAdvancedDirectives(directiveString, structure) {
        const directives = this.parseDirectives(directiveString);
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const finalTracks = new Map();

        console.log(`[Structure: ${structure}] Applying advanced directives:`, directives);

        // Track selection based on directives
        const trackTypes = Array.from(this.sourceNotes.keys());
        let activeTracks = [...trackTypes];
        
        if (directives.tracks && directives.tracks < trackTypes.length) {
            // Select specific tracks based on register needs
            activeTracks = trackTypes.slice(0, Math.max(1, Math.floor(directives.tracks)));
        }

        this.sourceNotes.forEach((originalNotes, trackType) => {
            if (!activeTracks.includes(trackType)) return;
            if (originalNotes.length === 0) return;

            let notes = JSON.parse(JSON.stringify(originalNotes)); // Deep copy

            // ===== DENSITY & SPARSITY =====
            if (directives.density !== undefined) {
                const density = parseFloat(directives.density);
                if (density < 1.0) {
                    notes = this.applyDensityReduction(notes, density, bpm);
                } else if (density > 1.0) {
                    notes = this.applyDensityIncrease(notes, density, bpm);
                }
            }

            if (directives.sparse === 1) {
                notes = this.applySparsity(notes, bpm);
            }

            // ===== PITCH TRANSFORMATIONS =====
            if (directives.transpose !== undefined) {
                notes = this.applyTransposition(notes, parseInt(directives.transpose));
            }

            if (directives.octave !== undefined) {
                notes = this.applyOctaveShift(notes, parseInt(directives.octave));
            }

            if (directives.invert === 1) {
                notes = this.applyInversion(notes);
            }

            if (directives.retrograde === 1) {
                notes = this.applyRetrograde(notes);
            }

            if (directives.reverse === 1) {
                notes = this.applyReverse(notes);
            }

            if (directives.rise === 1) {
                notes = this.applyRisingContour(notes);
            }

            if (directives.fall === 1) {
                notes = this.applyFallingContour(notes);
            }

            if (directives.double === 1) {
                notes = this.applyOctaveDoubling(notes);
            }

            if (directives.harmonize !== undefined) {
                notes = this.applyHarmonization(notes, parseInt(directives.harmonize));
            }

            if (directives.spread === 1) {
                notes = this.applyRegisterSpread(notes);
            }

            if (directives.cluster === 1) {
                notes = this.applyClusterHarmonies(notes);
            }

            if (directives.randomize !== undefined) {
                notes = this.applyRandomization(notes, parseFloat(directives.randomize));
            }

            // ===== RHYTHMIC TRANSFORMATIONS =====
            if (directives.stretch !== undefined) {
                notes = this.applyTimeStretch(notes, parseFloat(directives.stretch));
            }

            if (directives.staccato === 1) {
                notes = this.applyStaccato(notes);
            }

            if (directives.legato === 1) {
                notes = this.applyLegato(notes);
            }

            if (directives.sustain !== undefined) {
                notes = this.applySustain(notes, parseFloat(directives.sustain));
            }

            if (directives.truncate !== undefined) {
                notes = this.applyTruncation(notes, parseFloat(directives.truncate));
            }

            if (directives.gate !== undefined) {
                notes = this.applyGate(notes, parseFloat(directives.gate));
            }

            if (directives.syncopate !== undefined) {
                notes = this.applySyncopation(notes, parseFloat(directives.syncopate), bpm);
            }

            if (directives.swing !== undefined) {
                notes = this.applySwing(notes, parseFloat(directives.swing), bpm);
            }

            if (directives.humanize !== undefined) {
                notes = this.applyHumanization(notes, parseFloat(directives.humanize));
            }

            if (directives.quantize !== undefined) {
                notes = this.applyQuantization(notes, parseFloat(directives.quantize), bpm);
            }

            if (directives.accent !== undefined) {
                notes = this.applyAccents(notes, parseFloat(directives.accent), bpm);
            }

            if (directives.break === 1) {
                notes = this.applyRhythmicBreaks(notes, bpm);
            }

            // ===== ORNAMENTATION & TEXTURE =====
            if (directives.fill === 1) {
                notes = this.applyFills(notes, bpm);
            }

            if (directives.ghost === 1) {
                notes = this.applyGhostNotes(notes, bpm);
            }

            if (directives.arpeggiate === 1) {
                notes = this.applyArpeggiation(notes);
            }

            if (directives.tremolo === 1) {
                notes = this.applyTremolo(notes, bpm);
            }

            if (directives.rolls === 1) {
                notes = this.applyRolls(notes, bpm);
            }

            if (directives.pedal === 1) {
                notes = this.applyPedalTone(notes, trackType);
            }

            if (directives.callresponse === 1) {
                notes = this.applyCallAndResponse(notes, bpm);
            }

            // ===== DYNAMICS =====
            if (directives.velocity !== undefined) {
                notes = this.applyVelocityScaling(notes, parseFloat(directives.velocity));
            }

            if (directives.fadein === 1) {
                notes = this.applyFadeIn(notes);
            }

            if (directives.fadeout === 1) {
                notes = this.applyFadeOut(notes);
            }

            // Sort and create MIDI
            notes.sort((a, b) => a.time - b.time);

            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                finalTracks.set(trackType, {
                    midi,
                    title: `${trackType} (${structure})`,
                    description: `Advanced ${structure} variation`
                });
            }
        });

        return finalTracks;
    }

    // ===== PITCH TRANSFORMATION METHODS =====

    applyTransposition(notes, semitones) {
        notes.forEach(n => {
            n.midi += semitones;
            n.name = Tone.Frequency(n.midi, 'midi').toNote();
        });
        return notes;
    }

    applyOctaveShift(notes, octaves) {
        return this.applyTransposition(notes, octaves * 12);
    }

    applyInversion(notes) {
        if (notes.length < 2) return notes;
        const center = notes.reduce((sum, n) => sum + n.midi, 0) / notes.length;
        notes.forEach(n => {
            n.midi = Math.round(center * 2 - n.midi);
            n.name = Tone.Frequency(n.midi, 'midi').toNote();
        });
        return notes;
    }

    applyRetrograde(notes) {
        // Reverse melodic contour intervals
        if (notes.length < 2) return notes;
        const intervals = [];
        for (let i = 1; i < notes.length; i++) {
            intervals.push(notes[i].midi - notes[i-1].midi);
        }
        intervals.reverse();
        
        let currentPitch = notes[0].midi;
        for (let i = 1; i < notes.length; i++) {
            currentPitch += intervals[i-1];
            notes[i].midi = Math.max(0, Math.min(127, currentPitch));
            notes[i].name = Tone.Frequency(notes[i].midi, 'midi').toNote();
        }
        return notes;
    }

    applyReverse(notes) {
        const totalDuration = Math.max(...notes.map(n => n.time + n.duration));
        notes.forEach(n => {
            const endTime = n.time + n.duration;
            const newEnd = totalDuration - n.time;
            n.time = Math.max(0, newEnd - n.duration);
        });
        return notes.sort((a, b) => a.time - b.time);
    }

    applyRisingContour(notes) {
        // Gradually shift pitches upward
        const minPitch = Math.min(...notes.map(n => n.midi));
        const maxAdd = 12; // Up one octave max
        
        notes.forEach((n, i) => {
            const progress = i / (notes.length - 1);
            n.midi += Math.round(progress * maxAdd);
            n.name = Tone.Frequency(n.midi, 'midi').toNote();
        });
        return notes;
    }

    applyFallingContour(notes) {
        // Gradually shift pitches downward
        const maxPitch = Math.max(...notes.map(n => n.midi));
        const minPitch = Math.min(...notes.map(n => n.midi));
        const range = Math.min(12, maxPitch - 24); // Down one octave max
        
        notes.forEach((n, i) => {
            const progress = i / (notes.length - 1);
            n.midi -= Math.round(progress * range);
            n.name = Tone.Frequency(n.midi, 'midi').toNote();
        });
        return notes;
    }

    applyOctaveDoubling(notes) {
        const doubled = [];
        notes.forEach(n => {
            doubled.push({...n});
            if (n.midi + 12 <= 127) {
                doubled.push({
                    ...n,
                    midi: n.midi + 12,
                    name: Tone.Frequency(n.midi + 12, 'midi').toNote(),
                    velocity: n.velocity * 0.7
                });
            }
        });
        return doubled.sort((a, b) => a.time - b.time);
    }

    applyHarmonization(notes, interval) {
        const harmonized = [];
        notes.forEach(n => {
            harmonized.push({...n});
            const harmonyPitch = n.midi + interval;
            if (harmonyPitch <= 127) {
                harmonized.push({
                    ...n,
                    midi: harmonyPitch,
                    name: Tone.Frequency(harmonyPitch, 'midi').toNote(),
                    velocity: n.velocity * 0.8
                });
            }
        });
        return harmonized.sort((a, b) => a.time - b.time);
    }

    applyRegisterSpread(notes) {
        // Spread notes across wider register
        const center = notes.reduce((sum, n) => sum + n.midi, 0) / notes.length;
        notes.forEach(n => {
            const diff = n.midi - center;
            n.midi = Math.round(center + diff * 1.5);
            n.midi = Math.max(24, Math.min(108, n.midi));
            n.name = Tone.Frequency(n.midi, 'midi').toNote();
        });
        return notes;
    }

    applyClusterHarmonies(notes) {
        // Add nearby pitches for cluster effect
        const clustered = [];
        notes.forEach(n => {
            clustered.push({...n});
            // Add minor second above and below
            [-1, 1].forEach(offset => {
                const clusterPitch = n.midi + offset;
                if (clusterPitch >= 0 && clusterPitch <= 127) {
                    clustered.push({
                        ...n,
                        midi: clusterPitch,
                        name: Tone.Frequency(clusterPitch, 'midi').toNote(),
                        velocity: n.velocity * 0.5,
                        duration: n.duration * 0.5
                    });
                }
            });
        });
        return clustered.sort((a, b) => a.time - b.time);
    }

    applyRandomization(notes, amount) {
        notes.forEach(n => {
            const variance = Math.round((Math.random() - 0.5) * 2 * amount * 12);
            n.midi += variance;
            n.midi = Math.max(0, Math.min(127, n.midi));
            n.name = Tone.Frequency(n.midi, 'midi').toNote();
        });
        return notes;
    }

    // ===== RHYTHMIC TRANSFORMATION METHODS =====

    applyTimeStretch(notes, factor) {
        notes.forEach(n => {
            n.time *= factor;
            n.duration *= factor;
        });
        return notes;
    }

    applyStaccato(notes) {
        notes.forEach(n => n.duration *= 0.4);
        return notes;
    }

    applyLegato(notes) {
        for (let i = 0; i < notes.length - 1; i++) {
            const gap = notes[i + 1].time - (notes[i].time + notes[i].duration);
            if (gap > 0 && gap < 0.3) {
                notes[i].duration += gap - 0.02;
            }
        }
        return notes;
    }

    applySustain(notes, factor) {
        notes.forEach(n => n.duration *= factor);
        return notes;
    }

    applyTruncation(notes, factor) {
        notes.forEach(n => n.duration *= factor);
        return notes;
    }

    applyGate(notes, factor) {
        notes.forEach(n => n.duration *= Math.max(0.1, Math.min(1.0, factor)));
        return notes;
    }

    applySyncopation(notes, amount, bpm) {
        const beatDur = 60 / bpm;
        notes.forEach(n => {
            const beatPos = (n.time / beatDur) % 1;
            // If near beat, shift to off-beat
            if (Math.abs(beatPos) < 0.2 || Math.abs(beatPos - 0.5) < 0.2) {
                n.time += beatDur * 0.25 * amount;
            }
        });
        return notes;
    }

    applySwing(notes, amount, bpm) {
        const beatDur = 60 / bpm;
        notes.forEach(n => {
            const beatPos = n.time / beatDur;
            const isEighth = Math.abs((beatPos % 1) - 0.5) < 0.15;
            if (isEighth) {
                n.time += (amount / 100) * (beatDur / 3);
            }
        });
        return notes;
    }

    applyHumanization(notes, amount) {
        const timeVar = (amount / 100) * 0.03;
        const velVar = amount / 100 * 0.15;
        notes.forEach(n => {
            n.time += (Math.random() - 0.5) * 2 * timeVar;
            n.velocity *= 1 + (Math.random() - 0.5) * 2 * velVar;
            n.velocity = Math.max(0.05, Math.min(1.0, n.velocity));
        });
        return notes;
    }

    applyQuantization(notes, amount, bpm) {
        const beatDur = 60 / bpm;
        const grid = beatDur / 4; // 16th notes
        
        notes.forEach(n => {
            const targetTime = Math.round(n.time / grid) * grid;
            n.time = n.time * (1 - amount) + targetTime * amount;
        });
        return notes;
    }

    applyAccents(notes, amount, bpm) {
        notes.forEach(n => {
            const beatPos = (n.time * bpm / 60) % 4;
            const isDownbeat = Math.abs(beatPos) < 0.1;
            if (isDownbeat) {
                n.velocity = Math.min(1.0, n.velocity * (1 + amount));
            }
        });
        return notes;
    }

    applyRhythmicBreaks(notes, bpm) {
        // Remove notes at random positions to create holes
        const beatDur = 60 / bpm;
        return notes.filter((n, i) => {
            const beat = Math.floor(n.time / beatDur);
            // Keep if not in a "break" beat (every 8th beat)
            return beat % 8 !== 6; // Break on beat 6 of every 8
        });
    }

    // ===== DENSITY METHODS =====

    applyDensityReduction(notes, density, bpm) {
        return notes.filter((n, i) => {
            const beatPos = (n.time * bpm / 60) % 4;
            const isStructural = Math.abs(beatPos) < 0.1 || Math.abs(beatPos - 2) < 0.1;
            return isStructural || Math.random() < density;
        });
    }

    applyDensityIncrease(notes, density, bpm) {
        const newNotes = [];
        const extraRatio = density - 1;
        
        notes.forEach(n => {
            newNotes.push({...n});
            if (Math.random() < extraRatio) {
                newNotes.push({
                    ...n,
                    time: n.time + (60/bpm) * 0.5,
                    velocity: n.velocity * 0.6,
                    midi: n.midi + ([-2, 0, 2, 4][Math.floor(Math.random() * 4)])
                });
            }
        });
        return newNotes;
    }

    applySparsity(notes, bpm) {
        return notes.filter(n => {
            const beatPos = (n.time * bpm / 60) % 4;
            return beatPos < 0.3 || Math.abs(beatPos - 2) < 0.3;
        });
    }

    // ===== ORNAMENTATION METHODS =====

    applyFills(notes, bpm) {
        const newNotes = [];
        for (let i = 0; i < notes.length - 1; i++) {
            newNotes.push(notes[i]);
            const gap = notes[i + 1].time - (notes[i].time + notes[i].duration);
            if (gap > 0.15) {
                newNotes.push({
                    ...notes[i],
                    time: notes[i].time + notes[i].duration + gap / 2,
                    duration: gap / 3,
                    velocity: notes[i].velocity * 0.5,
                    midi: notes[i].midi + (Math.random() > 0.5 ? 7 : -5)
                });
            }
        }
        if (notes.length > 0) newNotes.push(notes[notes.length - 1]);
        return newNotes;
    }

    applyGhostNotes(notes, bpm) {
        const ghosts = [];
        notes.forEach(n => {
            if (Math.random() < 0.3) {
                ghosts.push({
                    ...n,
                    time: n.time + (60/bpm) * 0.5,
                    velocity: n.velocity * 0.25,
                    duration: n.duration * 0.5
                });
            }
        });
        return [...notes, ...ghosts].sort((a, b) => a.time - b.time);
    }

    applyArpeggiation(notes) {
        // Break simultaneous notes into sequence
        const arpeggiated = [];
        const timeGroups = {};
        
        notes.forEach(n => {
            const key = Math.round(n.time * 100) / 100;
            if (!timeGroups[key]) timeGroups[key] = [];
            timeGroups[key].push(n);
        });

        Object.entries(timeGroups).forEach(([time, group]) => {
            if (group.length > 1) {
                // Sort by pitch and arpeggiate
                group.sort((a, b) => a.midi - b.midi);
                group.forEach((n, i) => {
                    arpeggiated.push({
                        ...n,
                        time: n.time + i * 0.05,
                        duration: n.duration * 0.7
                    });
                });
            } else {
                arpeggiated.push(...group);
            }
        });

        return arpeggiated.sort((a, b) => a.time - b.time);
    }

    applyTremolo(notes, bpm) {
        const tremoloNotes = [];
        notes.forEach(n => {
            const divisions = 4;
            const subDur = n.duration / divisions;
            for (let i = 0; i < divisions; i++) {
                tremoloNotes.push({
                    ...n,
                    time: n.time + i * subDur,
                    duration: subDur * 0.8,
                    velocity: n.velocity * (0.8 + i * 0.05)
                });
            }
        });
        return tremoloNotes;
    }

    applyRolls(notes, bpm) {
        // Add flam/roll effect before accented notes
        const rolls = [];
        notes.forEach(n => {
            if (n.velocity > 0.8) {
                // Add flam before
                rolls.push({
                    ...n,
                    time: n.time - 0.02,
                    velocity: n.velocity * 0.4,
                    duration: 0.05
                });
            }
            rolls.push(n);
        });
        return rolls.sort((a, b) => a.time - b.time);
    }

    applyPedalTone(notes, trackType) {
        if (!trackType.includes('bass') && !trackType.includes('pad')) return notes;
        
        const root = notes.length > 0 ? notes[0].midi : 36;
        const totalDur = Math.max(...notes.map(n => n.time + n.duration));
        
        // Add sustained pedal
        notes.unshift({
            name: Tone.Frequency(root, 'midi').toNote(),
            midi: root,
            time: 0,
            duration: totalDur,
            velocity: 0.4
        });
        
        return notes;
    }

    applyCallAndResponse(notes, bpm) {
        // Alternate between two registers
        const phraseLength = 2 * (60 / bpm); // 2 beats
        const splitTime = Math.max(...notes.map(n => n.time)) / 2;
        
        notes.forEach(n => {
            if (n.time < splitTime) {
                // Call: higher register
                if (n.midi < 60) n.midi += 12;
            } else {
                // Response: lower register
                if (n.midi > 60) n.midi -= 12;
            }
            n.name = Tone.Frequency(n.midi, 'midi').toNote();
        });
        
        return notes;
    }

    // ===== DYNAMIC METHODS =====

    applyVelocityScaling(notes, scale) {
        notes.forEach(n => {
            n.velocity = Math.max(0.05, Math.min(1.0, n.velocity * scale));
        });
        return notes;
    }

    applyFadeIn(notes) {
        const maxTime = Math.max(...notes.map(n => n.time));
        notes.forEach(n => {
            const progress = n.time / maxTime;
            n.velocity *= progress;
        });
        return notes;
    }

    applyFadeOut(notes) {
        const maxTime = Math.max(...notes.map(n => n.time));
        notes.forEach(n => {
            const progress = 1 - (n.time / maxTime);
            n.velocity *= progress;
        });
        return notes;
    }

    // ===== UTILITY METHODS =====

    parseDirectives(directiveString) {
        const directives = {};
        if (!directiveString) return directives;
        
        const parts = directiveString.split(',');
        for (const part of parts) {
            const [cmd, val] = part.trim().split(':');
            if (cmd && val !== undefined) {
                const numVal = parseFloat(val.trim());
                directives[cmd.trim()] = isNaN(numVal) ? val.trim() : numVal;
            }
        }
        return directives;
    }

    recoverSourceNotesFromApp() {
        if (!this.app.generatedTracks) return;
        
        this.sourceNotes.clear();
        
        this.app.generatedTracks.forEach((trackData, trackType) => {
            const notes = trackData?.midi?.tracks?.[0]?.notes;
            if (notes && notes.length > 0) {
                const convertedNotes = notes.map(n => ({
                    name: Tone.Frequency(n.midi, 'midi').toNote(),
                    midi: n.midi,
                    time: n.time,
                    duration: n.duration,
                    velocity: n.velocity
                }));
                this.sourceNotes.set(trackType, convertedNotes);
            }
        });
    }

    parseNotationToTracks(notation) {
        const tracks = new Map();
        if (!notation) return tracks;
        
        const lines = notation.replace(/\\n/g, '\n').split('\n');
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        const rawTrackNotes = new Map();
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.includes('pitch,time') || !trimmed.includes('#')) continue;
            
            const [content, comment] = trimmed.split('#', 2);
            const note = this.parseNoteLine(content.trim());
            const trackType = comment?.trim().split(/\s/)[0];
            
            if (note && trackType) {
                if (!rawTrackNotes.has(trackType)) {
                    rawTrackNotes.set(trackType, []);
                }
                rawTrackNotes.get(trackType).push(note);
            }
        }
        
        rawTrackNotes.forEach((notes, trackType) => {
            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                tracks.set(trackType, {
                    midi,
                    title: trackType.charAt(0).toUpperCase() + trackType.slice(1),
                    description: `Generated ${trackType} version.`
                });
            }
        });
        
        return tracks;
    }

    parseNoteLine(line) {
        try {
            const cleanLine = line.split('#')[0].trim();
            const parts = cleanLine.split(',').map(p => p.trim());
            if (parts.length < 4) return null;

            const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
            const secondsPerBeat = 60 / bpm;

            const pitchOrName = parts[0];
            const startBeat = parseFloat(parts[1]);
            const durationBeats = parseFloat(parts[2]);
            const velocity = parseFloat(parts[3]);

            if (isNaN(startBeat) || isNaN(durationBeats) || isNaN(velocity)) return null;

            let name, midi;
            if (isNaN(parseInt(pitchOrName))) {
                name = pitchOrName;
                midi = Tone.Frequency(name).toMidi();
            } else {
                midi = parseInt(pitchOrName);
                name = Tone.Frequency(midi, 'midi').toNote();
            }

            return {
                name, midi,
                time: Math.max(0, startBeat * secondsPerBeat),
                duration: Math.max(0.01, durationBeats * secondsPerBeat),
                velocity: Math.max(0.1, Math.min(1.0, velocity)),
            };
        } catch (error) {
            console.warn("Failed to parse note line:", line, error);
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

    async downloadAllAsZip() {
        if (this.versions.length === 0) {
            this.app.ui.showMessage('No versions to download.', 'warning');
            return;
        }

        this.app.ui.showLoading('Preparing ZIP file...');
        try {
            const zip = new JSZip();
            const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
            const sourceTitle = this.versions[0]?.apiResponse?.title.replace(/ \(.+\)/, '') || 'composition';

            for (const version of this.versions) {
                let tracks;
                
                if (version.directives && this.sourceNotes.size > 0) {
                    tracks = this.applyAdvancedDirectives(version.directives, version.structure);
                } else {
                    tracks = this.parseNotationToTracks(version.apiResponse.notation);
                }
                
                if (tracks.size > 0) {
                    const combinedMidi = MidiBuilder.createCombinedMidi(tracks, bpm);
                    if (combinedMidi) {
                        const midiBytes = combinedMidi.toArray();
                        const sanitizedTitle = version.apiResponse.title.replace(/[\/\\?%*:|"<>]/g, '-
