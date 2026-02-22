import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { trackAbbreviations } from './track-config.js';
import { fetchWithModelFallbacks } from './prompt-analyzer.js';

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
            this.reset();
        }
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

            const tracks = this.parseNotationToTracks(version.apiResponse.notation);
            
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
        } catch (error) {
            console.error('Visualizer update failed:', error);
            throw error;
        }
    }

    extractTrackTypesFromNotation(notationString) {
        if (!notationString) return [];
        const lines = notationString.replace(/\\n/g, '\n').split('\n');
        const trackTypes = new Set();
        
        for (const line of lines) {
            if (line.includes('#')) {
                const parts = line.split('#');
                if (parts.length > 1) {
                    const trackType = parts[1].trim().split(/\s/)[0];
                    if (trackType && trackType.length > 0) {
                        trackTypes.add(trackType);
                    }
                }
            }
        }
        return Array.from(trackTypes);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🎵 PROFESSIONAL STRUCTURE INSTRUCTIONS - Optimized for every genre & structure
    // ═══════════════════════════════════════════════════════════════════════════════

    getStructureInstructions(structure, genre, mood, trackTypes) {
        const has = (t) => trackTypes.includes(t);
        
        // Genre-specific characteristics
        const genreTraits = {
            'house': { fourOnFloor: true, groove: 'steady', energy: 'medium', swing: 0 },
            'techno': { fourOnFloor: true, groove: 'driving', energy: 'high', swing: 0 },
            'trance': { fourOnFloor: true, groove: 'uplifting', energy: 'very-high', arpeggios: true },
            'trap': { fourOnFloor: false, groove: 'bouncy', energy: 'high', swing: 0.6 },
            'hip-hop': { fourOnFloor: false, groove: 'laid-back', energy: 'medium', swing: 0.5 },
            'rock': { fourOnFloor: false, groove: 'aggressive', energy: 'high', swing: 0 },
            'pop': { fourOnFloor: false, groove: 'catchy', energy: 'medium-high', swing: 0 },
            'funk': { fourOnFloor: false, groove: 'syncopated', energy: 'high', swing: 0.4 },
            'jazz': { fourOnFloor: false, groove: 'swing', energy: 'medium', swing: 0.7 },
            'disco': { fourOnFloor: true, groove: 'four-on-floor', energy: 'high', swing: 0 },
            'ambient': { fourOnFloor: false, groove: 'floating', energy: 'low', swing: 0 },
            'cinematic': { fourOnFloor: false, groove: 'epic', energy: 'dynamic', swing: 0 },
            'synthwave': { fourOnFloor: true, groove: 'retro', energy: 'medium-high', swing: 0 },
            'progressive-rock': { fourOnFloor: false, groove: 'complex', energy: 'dynamic', swing: 0.3 },
            'drum-and-bass': { fourOnFloor: false, groove: 'breakbeat', energy: 'very-high', swing: 0.2 },
            'downtempo': { fourOnFloor: false, groove: 'relaxed', energy: 'low', swing: 0.3 }
        };

        const traits = genreTraits[genre] || genreTraits['house'];
        
        // Track selection logic per structure
        const selectTracks = (min, max, priority) => {
            const selected = [];
            for (const track of priority) {
                if (has(track) && selected.length < max) {
                    selected.push(track);
                }
                if (selected.length >= max) break;
            }
            // Fill with available if needed
            if (selected.length < min) {
                for (const track of trackTypes) {
                    if (!selected.includes(track) && selected.length < min) {
                        selected.push(track);
                    }
                }
            }
            return selected.slice(0, max);
        };

        // ═══════════════════════════════════════════════════════════════════════════
        // STRUCTURE-SPECIFIC INSTRUCTIONS
        // ═══════════════════════════════════════════════════════════════════════════

        const instructions = {
            intro: () => {
                const tracks = selectTracks(1, 2, ['pad-textures', 'chord', 'strings', 'arpeggio', 'bassline']);
                const intensity = traits.energy === 'low' ? 'minimal' : 'sparse';
                
                return `INTRO - Establish the atmosphere and set expectations.
                
MOOD: Mysterious, anticipatory, ${mood}-toned.
INTENSITY: ${intensity.toUpperCase()} - Use only ${tracks.length} tracks: ${tracks.join(', ')}.

MUSICAL DIRECTIVES:
• Start with 1-2 bars near-silence or ambient texture only
• Gradually introduce elements every 2-4 beats
• Use sustained pads/chords with long attacks (8th-16th note fades)
• Bassline: Subtle, single notes or octaves, enter at bar 2-3
• Melody: Absent or hinted only (2-3 preview notes max)
• Velocities: 0.25-0.45 (soft, intimate)
• Density: 15-25% of maximum (lots of space)
• Rhythmic complexity: Simple, predictable
• Build subtle tension toward the next section

${traits.fourOnFloor ? '• Four-on-floor kick pattern implied but not emphasized' : '• No strong rhythmic anchor yet'}

AVOID: Full melody, busy percussion, loud transients, complete harmonic information`;
            },

            build: () => {
                const tracks = selectTracks(2, 4, ['arpeggio', 'bassline', 'chord', 'plucks', 'pad-textures']);
                const isFourOnFloor = traits.fourOnFloor;
                
                return `BUILD-UP - Create tension and anticipation toward climax.
                
MOOD: Rising intensity, forward momentum, expectant.
ENERGY CURVE: Exponential increase from 30% → 85% intensity.

MUSICAL DIRECTIVES:
• Add one element every 2-4 beats (layering strategy)
• Start: Minimal (pads + subtle arpeggio)
• Middle: Add bassline, increase arpeggio speed
• End: Nearly full arrangement, just before peak

RHYTHMIC TACTICS:
${isFourOnFloor ? '• Accelerating hi-hat patterns (1/8 → 1/16 → 1/32 notes)\n• Snare rolls every 4th beat, building to drop' : '• Increasing note density and rhythmic subdivision\n• Syncopation increases toward climax'}

• Filter sweep effect (simulate with velocity/brightness increase)
• Rising pitch patterns (arpeggios ascending by semitones)
• Velocities: 0.35 → 0.75 (progressive increase)
• Density: 25% → 65% (filling the space)

${has('arpeggio') ? '• Arpeggio: Start slow (1/4 notes) → End fast (1/16 notes)' : ''}
${has('bassline') ? '• Bassline: Enter at 25% point, full energy by 75% point' : ''}

CRITICAL: End at peak tension, do NOT resolve. Prepare for Chorus/Drop.`;
            },

            verse: () => {
                const tracks = selectTracks(2, 4, ['melody', 'chord', 'bassline', 'keys', 'plucks']);
                
                return `VERSE - Tell the story. Established but not peak energy.
                
MOOD: ${mood}, grounded, narrative, groove-established.
ENERGY: 60-70% of maximum - Room to grow toward chorus.

MUSICAL DIRECTIVES:
• Complete groove established but restrained
• Melody: Present and recognizable, but not embellished
• Harmonic rhythm: Consistent, supportive (not driving)
• Bassline: Full pattern, locked with groove
• Space for vocals/lead in the "pocket"

TRACK BALANCE:
• ${tracks.join(', ')} active
• Pads: Sustained, background (velocities 0.4-0.5)
• Melody: Clear, memorable, slightly subdued (velocities 0.55-0.7)
• Bass: Driving but not overwhelming (velocities 0.6-0.75)
${has('drums') || has('percs') ? '• Drums: Full pattern but no fills or flourishes' : ''}

RHYTHMIC FEEL: ${traits.groove}, swing ${traits.swing * 100}%

VARIATION STRATEGY:
• 2nd verse can add one new element (counter-melody, extra harmony)
• Keep core identity identical for recognition

Velocities: 0.5-0.7 (moderate, controlled energy)
Density: 45-60% (busy enough to hold attention, space for growth)`;
            },

            chorus: () => {
                const tracks = selectTracks(3, 5, ['melody', 'lead', 'chord', 'bassline', 'plucks', 'strings', 'brass']);
                
                return `CHORUS/DROP - The peak. Maximum energy and memorability.
                
MOOD: Euphoric, anthemic, ${mood} at maximum intensity.
ENERGY: 90-100% - This is the payoff moment.

MUSICAL DIRECTIVES:
• ALL essential tracks active: ${tracks.join(', ')}
• Melody/Lead: Full embellishment, highest octave, confident
• Harmonic support: Rich, full voicings (add 7ths, 9ths if genre allows)
• Bass: Maximum power and presence
• Transients: Sharp attacks, full velocities

RHYTHMIC INTENSITY:
${traits.fourOnFloor ? '• Four-on-floor at maximum drive\n• Off-beat elements (hi-hats, shakers) at full density' : '• Maximum syncopation and rhythmic interest\n• All percussive elements firing'}

SPECIFIC TACTICS:
${has('lead') ? '• Lead: Highest register, most active rhythm, memorable hook' : ''}
${has('strings') ? '• Strings: Full chords, dramatic swells, high velocities' : ''}
${has('brass') ? '• Brass: Stabs on downbeats, accents on peaks' : ''}
${has('plucks') ? '• Plucks: Rapid arpeggios, rhythmic counterpoint' : ''}

Velocities: 0.75-0.95 (powerful, but leave headroom for absolute peak moments)
Density: 75-90% (full but not cluttered - every note has purpose)

HOOK STRATEGY: 
• First 2 bars: Establish peak
• Middle: Slight variation or extension
• Last 2 bars: Set up transition (breakdown or build)`;
            },

            bridge: () => {
                const tracks = selectTracks(1, 3, ['pad-textures', 'strings', 'melody', 'keys']);
                const contrastTracks = trackTypes.filter(t => !tracks.includes(t)).slice(0, 2);
                
                return `BRIDGE - Contrast and reset. Different energy, prepares for return.
                
MOOD: ${mood === 'happy' ? 'contemplative or melancholic' : mood === 'dark' ? 'hopeful or ethereal' : 'contrasting to main sections'}
ENERGY: 40-60% - Deliberately different from verse/chorus.

MUSICAL DIRECTIVES:
• PURPOSE: Provide contrast before final chorus
• STRATEGY: Change texture, register, or harmonic rhythm

CONTRAST TACTICS:
• Different lead instrument: ${contrastTracks.join(' or ') || 'unused track from original'}
• Shift register: Up one octave (lighter) or down (heavier)
• Harmonic variation: Relative minor/major, modal interchange, or pedal point
• Rhythmic shift: Half-time or double-time feel

TRACK SELECTION:
• Primary: ${tracks.join(', ')} (intimate, exposed)
• Absent or minimal: Bass (or use high bass only), dense percussion

TEXTURAL IDEAS:
${has('pad-textures') ? '• Ambient wash with subtle melodic fragments' : ''}
${has('strings') ? '• Legato string lines, emotional and lyrical' : ''}
${has('keys') ? '• Sparse piano/keys, single note or simple chord hits' : ''}
${has('melody') ? '• Melody alone, unaccompanied or minimal pad' : ''}

Velocities: 0.4-0.6 (restrained, intimate)
Density: 30-45% (space is the feature)

CRITICAL: Must create longing to return to familiar material. End with build or direct cut to chorus.`;
            },

            breakdown: () => {
                const tracks = selectTracks(1, 2, ['melody', 'pad-textures', 'strings', 'keys']);
                
                return `BREAKDOWN - Strip it back. Tension through reduction.
                
MOOD: Vulnerable, suspended, breath-before-impact.
ENERGY: 20-40% - Sudden drop from peak.

MUSICAL DIRECTIVES:
• Sudden removal of 60-70% of elements
• Keep only: ${tracks.join(', ')}
• Often follows chorus/drop for dramatic effect

RHYTHMIC STRATEGY:
• Remove or drastically simplify drums/percussion
• Sustained pads or single melodic line
• Silence as a rhythmic element (use space deliberately)

BASS HANDLING:
${has('bassline') ? '• Bass: Either absent OR sustained sub-bass drone (no rhythmic movement)' : '• No bass - let higher frequencies breathe'}

BUILD WITHIN BREAKDOWN:
• Start: Minimal (1 element)
• Middle: Add second element
• End: Prepare for re-entry (add bass drum pulse, rising FX)

Velocities: 0.3-0.5 (soft, intimate)
Density: 20-35% (the absence of sound is the feature)

DURATION: Often shorter than other sections (2-4 bars typical)`;
            },

            outro: () => {
                const tracks = selectTracks(1, 3, ['pad-textures', 'chord', 'melody', 'strings']);
                
                return `OUTRO - Graceful exit. Resolution and fade.
                
MOOD: ${mood} fading to neutral, satisfied, complete.
ENERGY: 60% → 10% (decrescendo to silence)

MUSICAL DIRECTIVES:
• Mirror the intro but with known material
• Gradual removal of elements (reverse of build)
• Create sense of "winding down"

EXIT STRATEGIES:
${has('melody') ? '• Final statement of main melody, then fade' : ''}
${has('chord') || has('pad-textures') ? '• Sustained final chord (tonic), long reverb tail' : ''}
${has('arpeggio') ? '• Slowing arpeggio to individual notes, then silence' : ''}

TRACK REMOVAL SEQUENCE:
1. Remove percussion/drums first
2. Then bass (energy drops significantly)
3. Then harmonic support (chords/pads thin out)
4. Finally: Single melody note or ambient texture to silence

Velocities: 0.6 → 0.2 (gradual fade)
Density: 50% → 5% (almost nothing)

FINAL BAR: 
• Last 2 beats: Optional (can cut to silence)
• Or: Very long final note/pad that fades naturally

AVOID: Abrupt cuts (unless genre-appropriate), new material, unresolved tension`;
            }
        };

        const instructionFn = instructions[structure] || instructions.verse;
        return instructionFn();
    }

    buildVariationPrompt(originalJson, structure, originalTrackTypes, duration) {
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const beatsPerBar = parseInt((document.getElementById('time-signature')?.value || '4/4').split('/')[0], 10) || 4;
        const totalBeats = parseInt(duration) * beatsPerBar;
        const genre = (document.getElementById('style')?.value || 'house').toLowerCase();
        const mood = (document.getElementById('mood')?.value || 'mysterious').toLowerCase();
        const key = (document.getElementById('key')?.value || 'C');

        const reverseAbbrev = Object.fromEntries(
            Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
        );

        const trackAbbrevs = originalTrackTypes.map(t => trackAbbreviations[t] || t);
        const trackAbbrList = trackAbbrevs.map(t => `"${t}"`).join(', ');

        // Get professional structure instructions
        const structureInstructions = this.getStructureInstructions(structure, genre, mood, originalTrackTypes);

        return `You are an expert music producer AI specializing in ${genre.toUpperCase()} production. Create a professional "${structure.toUpperCase()}" section. Return ONLY valid JSON.

═══════════════════════════════════════════════════════════════════
COMPOSITION CONTEXT
═══════════════════════════════════════════════════════════════════
Title: ${originalJson.title}
Original Description: ${originalJson.explanation}
Genre: ${genre.toUpperCase()} | Mood: ${mood} | Key: ${key} | BPM: ${bpm}
Time Signature: ${beatsPerBar}/4 | Duration: ${duration} bars (${totalBeats} beats total)

═══════════════════════════════════════════════════════════════════
${structureInstructions}
═══════════════════════════════════════════════════════════════════

TECHNICAL SPECIFICATIONS:
═══════════════════════════════════════════════════════════════════

NOTE FORMAT:
• pitch: MIDI number (36-96) OR note name (C2, F#4, etc.)
• beat: Decimal position in beats (0, 0.5, 1, 1.25, 2, etc.)
• duration: Length in beats (0.25=16th, 0.5=8th, 1=quarter, 2=half, etc.)
• velocity: 0.1-1.0 (use range specified in structure instructions)

TRACK SELECTION:
• Use ONLY from available tracks: ${originalTrackTypes.join(', ')}
• Track abbreviations: ${trackAbbrList}
• Assign notes to appropriate tracks based on register and function

CONSTRAINTS:
• STRICTLY stay within ${totalBeats} beats total
• Match original KEY (${key}) and TEMPO (${bpm} BPM) exactly
• Use ONLY escaped newlines (\\\\n) between notes in JSON strings
• No markdown, no explanations, ONLY the JSON response

═══════════════════════════════════════════════════════════════════
ORIGINAL MATERIAL (for reference)
═══════════════════════════════════════════════════════════════════
${originalJson.notation || JSON.stringify(originalJson.tracks || {})}

═══════════════════════════════════════════════════════════════════
RESPONSE FORMAT - Return ONLY this JSON:
═══════════════════════════════════════════════════════════════════

{
  "title": "${originalJson.title} - ${structure.charAt(0).toUpperCase() + structure.slice(1)}",
  "description": "A ${structure} variation for ${genre}: ${mood}, ${duration} bars (≤20 words)",
  "tracks": {
    ${trackAbbrList.split(', ').map(t => `"${t.replace(/"/g, '')}": "pitch,beat,duration,velocity\\\\npitch2,beat2,dur2,vel2\\\\n..."`).join(',\n    ')}
  }
}

Generate the ${structure.toUpperCase()} variation now. Output ONLY JSON.`;
    }

    async generateVariation() {
        if (!this.sourceJson) {
            this.app.ui.showMessage('Please provide a source JSON in the text area.', 'warning');
            return;
        }

        const selectedStructure = document.getElementById('structure-select')?.value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a version type (e.g., Intro, Chorus).', 'warning');
            return;
        }

        const selectedDuration = parseInt(document.getElementById('variation-duration')?.value, 10) || 4;

        let sourceVersion;
        try {
            const currentJson = JSON.parse(this.sourceJson);
            sourceVersion = {
                apiResponse: currentJson,
                context: this.versions.find(v => v.isOriginal)?.context || {},
                isOriginal: true,
                structure: 'Original'
            };
        } catch (e) {
            this.app.ui.showMessage('The JSON is currently invalid. Cannot generate variation.', 'error');
            return;
        }
        
        let trackTypes = this.extractTrackTypesFromNotation(sourceVersion.apiResponse.notation);

        if (trackTypes.length === 0 && sourceVersion.apiResponse.tracks) {
            trackTypes = Object.keys(sourceVersion.apiResponse.tracks);
        }

        if (trackTypes.length === 0) {
            this.app.ui.showMessage('Could not find any tracks in the composition. Make sure notes are commented with a track name (e.g., # melody).', 'error');
            return;
        }

        try {
            this.app.ui.showLoading(`Generating "${selectedStructure}" version...`);

            const variationPrompt = this.buildVariationPrompt(sourceVersion.apiResponse, selectedStructure, trackTypes, selectedDuration);
            
            console.log('[VARIATION] Prompt length:', variationPrompt.length);
            console.log('[VARIATION] Structure:', selectedStructure);
            console.log('[VARIATION] Genre:', document.getElementById('style')?.value);
            console.log('[VARIATION] Tracks:', trackTypes.join(', '));

            const response = await fetchWithModelFallbacks('/api/variations', ['openai-large', 'openai'], this.app.ui, {
                prompt: variationPrompt,
                seed: Math.floor(Math.random() * 100000)
            });

            const responseText = await response.text();
            const variationJson = this.parseVariationResponse(responseText);
            
            const newVersion = {
                apiResponse: variationJson,
                context: sourceVersion.context,
                isOriginal: false,
                structure: selectedStructure
            };

            this.versions.push(newVersion);
            this.renderVersionsList();
            
            this.app.ui.showMessage(`Successfully generated "${selectedStructure}" version.`, 'success');

        } catch (error) {
            console.error('Variation generation failed:', error);
            this.app.ui.showMessage(`Failed to generate version: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    parseVariationResponse(responseText) {
        try {
            const cleanedJson = responseText.replace(/```json\s*|\s*```/g, '').trim();
            const firstBrace = cleanedJson.indexOf('{');
            const lastBrace = cleanedJson.lastIndexOf('}');

            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error('No valid JSON object found in the API response.');
            }

            const jsonText = cleanedJson.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonText);

            if (!parsed.title) {
                throw new Error("Parsed JSON is missing 'title'.");
            }

            if (!parsed.tracks && !parsed.notation) {
                throw new Error("Parsed JSON is missing 'tracks' or 'notation'.");
            }

            const reverseAbbrev = Object.fromEntries(
                Object.entries(trackAbbreviations).map(([full, abbr]) => [abbr, full])
            );

            let notation = parsed.notation || '';

            if (parsed.tracks && typeof parsed.tracks === 'object') {
                const lines = [];
                for (const [trackAbbr, notesStr] of Object.entries(parsed.tracks)) {
                    if (!notesStr || notesStr.trim() === '') continue;

                    const trackFull = reverseAbbrev[trackAbbr] || trackAbbr;
                    const noteLines = notesStr.replace(/\\n/g, '\n').split('\n').filter(l => l.trim());

                    for (const noteLine of noteLines) {
                        const trimmed = noteLine.trim();
                        if (trimmed && !trimmed.startsWith('pitch')) {
                            lines.push(`${trimmed} # ${trackFull}`);
                        }
                    }
                }
                notation = lines.join('\n');
            }

            return {
                title: parsed.title,
                explanation: parsed.description || parsed.explanation || '',
                notation: notation
            };

        } catch (error) {
            console.error("Failed to parse variation response:", error, "Raw response:", responseText);
            throw new Error(`Could not parse the AI's response. It may have been malformed. Details: ${error.message}`);
        }
    }

    parseNotationToTracks(notation) {
        const tracks = new Map();
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
        
        const finalTracks = new Map();
        
        rawTrackNotes.forEach((notes, trackType) => {
            if (notes.length > 0) {
                const midi = this.createMidiFromNotes(notes, bpm);
                
                finalTracks.set(trackType, {
                    midi,
                    title: trackType.charAt(0).toUpperCase() + trackType.slice(1),
                    description: `Generated ${trackType} version.`
                });
            }
        });
        
        return finalTracks;
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
                const tracks = this.parseNotationToTracks(version.apiResponse.notation);
                if (tracks.size > 0) {
                    const combinedMidi = MidiBuilder.createCombinedMidi(tracks, bpm);
                    if (combinedMidi) {
                        const midiBytes = combinedMidi.toArray();
                        const sanitizedTitle = version.apiResponse.title.replace(/[\/\\?%*:|"<>]/g, '-').trim();
                        const filename = `${sanitizedTitle}.mid`;
                        zip.file(filename, midiBytes);
                    }
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            
            const sanitizedSourceTitle = sourceTitle.replace(/[\/\\?%*:|"<>]/g, '-').trim();
            const zipFilename = `${sanitizedSourceTitle}-variations.zip`;

            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = zipFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            this.app.ui.showMessage('All versions downloaded successfully as a ZIP file.', 'success');

        } catch (error) {
            console.error('Failed to create ZIP file:', error);
            this.app.ui.showMessage(`Error creating ZIP file: ${error.message}`, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }
}
