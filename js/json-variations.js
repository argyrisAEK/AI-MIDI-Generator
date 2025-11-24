import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import { MidiBuilder } from './midi-builder.js';
import { ScaleValidator, ScaleStrictness } from './scale-validator.js';

export class JSONVariations {
    constructor(app) {
        this.app = app;
        this.sourceJson = null;
        this.versions = [];
        this.validator = new ScaleValidator();
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('generate-variations').addEventListener('click', () => this.generateVariation());
        document.getElementById('download-all-zip').addEventListener('click', () => this.downloadAllAsZip());
        document.getElementById('raw-json-input').addEventListener('input', (e) => this.handleJsonInputChange(e));
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
                sourceTitle.textContent = parsedJson.title || 'Custom Composition';
                sourceExplanation.textContent = parsedJson.explanation || parsedJson.description || '';
            }

            this.app.ui.showMessage('JSON is valid. Ready to generate.', 'success');
            document.getElementById('generate-variations').disabled = false;
            rawJsonInput.style.borderColor = 'var(--accent)';

        } catch (error) {
            this.app.ui.showMessage('Invalid JSON format. Please correct it to generate variations.', 'warning');
            document.getElementById('generate-variations').disabled = true;
            rawJsonInput.style.borderColor = 'var(--error)';
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

        rawJsonInput.value = '';
        versionsList.innerHTML = '<p>Your generated versions will appear here.</p>';
        
        sourceTitle.textContent = '';
        sourceExplanation.textContent = '';
        sourceDetails.querySelector('p').style.display = 'block';
        
        document.getElementById('generate-variations').disabled = true;
        document.getElementById('download-all-zip').disabled = true;
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
            rawJsonInput.value = JSON.stringify(parsedSource, null, 2);

            const originalVersion = {
                apiResponse: {
                    title: metadata.title,
                    explanation: metadata.explanation,
                    notation: parsedSource.notation,
                },
                context: context,
                isOriginal: true,
                structure: 'Original'
            };
            this.versions.push(originalVersion);
            this.renderVersionsList();

            sourceTitle.textContent = metadata.title;
            sourceExplanation.textContent = metadata.explanation;
            sourceDetails.querySelector('p').style.display = 'none';
            
            document.getElementById('generate-variations').disabled = false;
            this.app.ui.showMessage('Composition loaded. You can now generate versions!', 'info');

        } catch (error) {
            console.error('Failed to parse and set source composition:', error);
            this.app.ui.showMessage('Error loading source composition for variations.', 'error');
            this.reset();
        }
    }

    async generateVariation() {
        if (!this.sourceJson) {
            this.app.ui.showMessage('Please provide a source JSON in the text area.', 'warning');
            return;
        }

        const selectedStructure = document.getElementById('structure-select').value;
        if (!selectedStructure) {
            this.app.ui.showMessage('Please select a version type (e.g., Intro, Chorus).', 'warning');
            return;
        }
        
        const selectedDuration = document.getElementById('variation-duration').value;

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
        
        const trackTypes = this.extractTrackTypesFromNotation(sourceVersion.apiResponse.notation);
        if (trackTypes.length === 0) {
            this.app.ui.showMessage('Could not find any tracks in the notation. Make sure notes are commented with a track name (e.g., # melody).', 'error');
            return;
        }

        try {
            this.app.ui.showLoading(`Generating "${selectedStructure}" version...`);
            
            const variationPrompt = this.buildVariationPrompt(sourceVersion.apiResponse, selectedStructure, trackTypes, selectedDuration);
            const url = `https://enter.pollinations.ai/api/generate/text/${encodeURIComponent(variationPrompt)}?model=midijourney&seed=${Math.floor(Math.random() * 100000)}&key=plln_sk_JmbRcolKjEzatmVsRROri34kyDAmSoUj`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error(`API Error: ${response.statusText || response.status}`);

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
    
    renderVersionsList() {
        const listEl = document.getElementById('versions-list');
        listEl.innerHTML = '';

        if (this.versions.length === 0) {
            listEl.innerHTML = '<p>Your generated versions will appear here.</p>';
            document.getElementById('download-all-zip').disabled = true;
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
        
        document.getElementById('download-all-zip').disabled = this.versions.length < 1;
        
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
            const tracks = this.parseNotationToTracks(version.apiResponse.notation);
            
            if (tracks.size === 0) {
                this.app.ui.showMessage('Cannot load an empty version.', 'error');
                return;
            }

            // ✅ Ενημέρωση κατάστασης εφαρμογής
            this.app.generatedTracks = tracks;
            this.app.compositionTitle = version.apiResponse.title;
            this.app.compositionDescription = version.apiResponse.explanation;
            
            // ✅ Ενημέρωση visualizer με σωστή σειρά
            this.updateVisualizer(
                tracks,
                version.apiResponse.title,
                version.apiResponse.explanation
            );
            
            // ✅ Ενημέρωση UI
            this.app.ui.updateButtonStates(true);
            this.app.ui.showMessage(`Loaded "${version.apiResponse.title}" into the main player.`, 'success');

        } catch (error) {
            console.error('Error loading version:', error);
            this.app.ui.showMessage(`Failed to load version: ${error.message}`, 'error');
        }
    }

    /**
     * ✅ ΒΕΛΤΙΣΤΟΠΟΙΗΜΕΝΗ ΜΕΘΟΔΟΣ: Ενημέρωση Visualizer
     * Σωστή σύνδεση με όλα τα απαραίτητα δεδομένα και σειρά
     */
    updateVisualizer(tracks, title, description) {
        try {
            // 1. Ενημέρωση Properties Visualizer
            this.app.visualizer.compositionTitle = title;
            this.app.visualizer.compositionDescription = description;
            
            // 2. Φόρτωση Σημειώσεων - Αυτή είναι η κύρια μέθοδος ανανέωσης
            this.app.visualizer.loadNotes(tracks, title, description);
            
            // 3. Ανανέωση Selectors Track (για αλλαγή δομής)
            this.app.visualizer.updateTrackSelectors();
            
            // 4. Reset Visualization State
            this.app.visualizer.stopVisualization();
            this.app.visualizer.renderStaticBackground();
            this.app.visualizer.drawFrame();
            
            console.log(`✅ Visualizer updated with ${tracks.size} tracks`);
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
                    if (trackType) {
                        trackTypes.add(trackType);
                    }
                }
            }
        }
        return Array.from(trackTypes);
    }

    buildVariationPrompt(originalJson, structure, originalTrackTypes, duration) {
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;
        const beatsPerBar = parseInt((document.getElementById('time-signature')?.value || '4/4').split('/')[0], 10) || 4;
        const totalSeconds = (duration * beatsPerBar) * (60 / bpm);
        
        const structureInstructions = {
            intro: `Create a sophisticated INTRO version that captures attention immediately.
TRACK SELECTION: Use 1-2 of the most atmospheric tracks from: ${originalTrackTypes.join(', ')}
  Preferred: ambient pad/strings + subtle bass foundation
SONIC CHARACTER:
  - Opening 2 bars: Sparse, minimal - establish the key with single notes or whole chords
  - Bars 3-6: Gradually introduce melodic fragments, maintain space and breathing room
  - Final bars: Subtle layering begins, build anticipation without climax
RHYTHM & DYNAMICS:
  - Velocities: 0.25-0.45 throughout
  - Note spacing: Wide gaps between notes (40-60% of bar filled maximum)
  - Tempo: Steady, no acceleration
  - Accents: Minimal, only on strongest beats
HARMONIC CONTENT:
  - Use mostly root, 3rd, 5th tones (avoid complex extensions)
  - Sustained notes and whole notes preferred
  - Synth pad layers if available
ENERGY ARC: Gentle rise from bar 1 to ${duration}, peaks at 60% of intro intensity
OUTCOME: Listener is intrigued, sets tone, ready for verse/chorus to enter`,

            build: `Create a dynamic BUILD-UP version that creates mounting tension and anticipation.
TRACK SELECTION: Start with 2-3 tracks, progressively add more from: ${originalTrackTypes.join(', ')}
  Progression: Foundation (bass/rhythm) → Harmonic fill → Melodic acceleration
SONIC CHARACTER:
  - Bars 1-4: Core groove established (bass + rhythm elements)
  - Bars 5-8: Harmonic layers enter, tension increases
  - Bars 9-12: Melodic elements accelerate, density increases
  - Bars 13+: Climactic peak approaching, all elements engaged
RHYTHM & DYNAMICS:
  - Velocities: Progressive 0.40 → 0.55 → 0.70 → 0.85
  - Note density: 30% bar → 50% → 70% → 90% filled
  - Syncopation: Increase progressively (simple → syncopated → complex)
  - Hits/accents: Every 4 bars → every 2 bars → every beat
HARMONIC CONTENT:
  - Introduce passing tones, chord extensions, blue notes
  - Layer chord variations over bass foundation
  - Add arpeggios that lead to climax
  - Modulation up semi-tone in final 4 bars (optional, powerful)
ENERGY ARC: Linear exponential climb from 30% to 95% intensity
OUTCOME: Listener experiences irresistible momentum toward payoff`,

            verse: `Create a compelling VERSE version that balances groove with lyrical/melodic space.
TRACK SELECTION: 3-4 core tracks from: ${originalTrackTypes.join(', ')}
  Foundation: Steady bass + rhythmic elements
  Melody: Primary melodic instrument (vocals would sit here)
  Harmony: Chord/pad support
SONIC CHARACTER:
  - Establish solid pocket/groove immediately
  - Leave 40-50% of space clear for lead vocal/instrument
  - Repetitive but not rigid - small variations keep interest
  - Relaxed, comfortable feel compared to chorus
RHYTHM & DYNAMICS:
  - Velocities: 0.50-0.70 (moderate, not aggressive)
  - Groove placement: Notes land just ahead/behind beat (pocket playing)
  - Syncopation: Moderate, tasteful - complement not compete
  - Rhythm figure repeats every 4-8 bars with subtle variation
HARMONIC CONTENT:
  - Stick to primary chord tones and predictable extensions
  - Use minimal chromatic movement
  - Bass walks in 1/4 or 1/8 note patterns
  - Chord stabs on strong beats only
ENERGY ARC: Steady 50-60% throughout, slight dips at phrase endings
OUTCOME: Solid foundation that supports and enhances primary content (vocals/lead)`,

            chorus: `Create an explosive CHORUS version that epitomizes energy and memorability.
TRACK SELECTION: Use 4-5+ of your fullest tracks from: ${originalTrackTypes.join(', ')}
  All available instruments layered for maximum impact
SONIC CHARACTER:
  - Immediate impact - no intro, hits hard on bar 1
  - Dense, rich, layered arrangement
  - Memorable hook lines that repeat exactly
  - 70-80% of space filled with musical content
  - Maximum frequency range utilization
RHYTHM & DYNAMICS:
  - Velocities: 0.70-1.0 (bright, punchy)
  - Note density: Fill 80-90% of available space
  - Kick/bass: Present every beat or strong half-note pattern
  - All percussion hits emphasized and accented
HARMONIC CONTENT:
  - Use full chord voicings including extensions and color tones
  - Chromatic passing tones for interest
  - Repetitive melodic hooks (2-4 bar patterns that repeat)
  - Doubled notes for emphasis and thickness
  - Possibly add one octave higher or lower for doubling
ENERGY ARC: Peak energy maintained 90%+ throughout entire chorus
TEXTURAL ELEMENTS:
  - Layered pad underneath
  - Stacked melodies or harmonies
  - Rhythmic emphasis/offbeats create movement
  - Wide stereo imaging if applicable
OUTCOME: Most memorable, energetic, impactful section - listener gets 'hooked'`,

            bridge: `Create a compelling BRIDGE version that provides contrast and recontextualization.
TRACK SELECTION: 2-4 different or repurposed tracks from: ${originalTrackTypes.join(', ')}
  Deliberately avoid 1-2 instruments used prominently in verse/chorus
SONIC CHARACTER:
  - Stark contrast to surrounding sections
  - Provide surprise/interest without losing cohesion
  - Can go either sparse OR complex (opposite of chorus)
  - Shift perspective or energy - prepare listener for final chorus
RHYTHM & DYNAMICS:
  - Velocities: Opposite of chorus (if chorus is 0.8+, bridge is 0.40-0.60)
  - Syncopation: Different groove feel (swing if song is straight, or vice versa)
  - Tempo: Could feature a short ritardando or fermata for effect
  - Accents: Place on unexpected beats (syncopated)
HARMONIC CONTENT:
  - Borrow chords from parallel key or minor/major shift
  - Introduce previously unused melodic fragments
  - Add unresolved tensions that resolve back to final chorus
  - Consider modulation (up/down semi-tone, or to relative major/minor)
TEXTURAL CHOICES (pick one approach):
  Approach A - SPARSE: Solo instrument + minimal harmony, naked feel
  Approach B - DENSE: All instruments but in different register/voicing
  Approach C - RHYTHMIC: Strips harmony, emphasizes interesting rhythm patterns
  Approach D - HARMONIC: Same melody, completely reimagined chords
ENERGY ARC: Either drops to 30-40% then rises into final chorus, OR rises to 85% with different character
OUTCOME: Listener feels surprise, maintains engagement, momentum builds toward final chorus climax`
        };

        const technicalRequirements = {
            intro: `
PRODUCTION NOTES:
  • Open with 2 full bars of minimal content (establish space)
  • Gradually layer elements: Beat 1 → Bar 3 → Bar 5 → Building
  • Use longer note durations (whole notes, half notes preferred)
  • Velocity range strictly 0.25-0.45
  • Minimum 40% silence/space in every bar
  • Place "interest notes" on expected beats (1, 3, or strong subdivisions)
  • End with slight fermata or longer sustain suggesting continuation
  • Avoid drums or percussion entirely OR use very light brush/pad rolls`,

            build: `
PRODUCTION NOTES:
  • BARS 1-4: 30% note density, 2 tracks maximum, locked groove
  • BARS 5-8: 50% note density, add 3rd track, introduce syncopation
  • BARS 9-12: 70% note density, 4 tracks, increased syncopation and accents
  • BARS 13+: 85%+ note density, all tracks, heavy syncopation and driving rhythm
  • Velocity progression ESSENTIAL: Start 0.40, end 0.85
  • Each 4-bar phrase must be noticeably denser than previous
  • Add rhythmic "hits" that move closer together: every 4 bars → every 2 bars → every bar
  • Consider frequency climbing: low register → mid → high (natural crescendo)
  • Final bar should feel like "point of no return" before payoff
  • No release/diminuendo - end at peak intensity`,

            verse: `
PRODUCTION NOTES:
  • Establish groove lock on bars 1-2 (immediately recognizable pattern)
  • Repeat core groove every 4 bars with ONE small variation
  • Velocities: 0.55-0.65 (consistent, not drawing attention)
  • 50% note density - deliberate space for lead vocals/instruments
  • Bass should lock with kick/rhythm in a consistent pattern
  • Chord changes happen on predictable beats (usually bar 1 or bar 3)
  • No sudden dynamic jumps - smooth, gliding energy
  • Use passing tones and chromatic movement sparingly
  • Peak dynamics on bar 7-8 of 8-bar phrase, drop slightly on 1 for repeat
  • Suggest repetition with small orchestration changes (add 1 voice, remove 1)`,

            chorus: `
PRODUCTION NOTES:
  • MAXIMUM IMPACT on bar 1 beat 1 - all elements present immediately
  • Velocities: 0.75-1.0 throughout (bright, no dynamic dips)
  • 85%+ note density - fill available space generously
  • Kick/bass: Present on every strong beat (1, 3 minimum)
  • All available tracks playing in full arrangement
  • Implement 4-bar melodic hook that repeats exactly 2-3 times
  • Layer harmonic doublings: melody + octave higher + counter-melody
  • Emphasize offbeats with accents to create movement/groove
  • Use frequency masking strategically (lead occupies mid/high, bass occupies low)
  • No silence longer than 1/4 bar anywhere in chorus
  • Peak energy on bars 3-8 of 8-bar phrase
  • Consider wide dynamic range WITHIN high-energy context (0.75 min, 1.0 max)`,

            bridge: `
PRODUCTION NOTES:
  • BREAK EXPECTATIONS: Drastically different from verse/chorus character
  • Change at least TWO of these elements from surrounding sections:
    - Groove feel (straight → swing, or vice versa)
    - Register (shift melody up 1-2 octaves or down to bass)
    - Instrumentation (drop 1-2 prominent voices, introduce different sound)
    - Harmony (borrow from parallel key, add color chords)
    - Rhythmic complexity (simplify OR complexify syncopation)
  • Velocities: Opposite energy from chorus (if chorus 0.8+, bridge 0.40-0.60)
  • Note density: Inverse of surrounding context
  • Syncopation style: Different groove feel than verse
  • Include moment of "vulnerability" or "surprise" (unexpected silence or resolution)
  • Optional: Include brief ritardando or tempo shift (+/- 5 BPM briefly)
  • Final bar: Transition note/chord that launches into next chorus
  • Bridge should feel like "different section" not "repetition with variation"
  • Duration: Typically 8 bars, can be 4 or 12 for effect`
        };

        return `You are an expert music producer and composer creating a professional "${structure.toUpperCase()}" section. Your output must be a VALID JSON object ONLY - no markdown, no explanations, no preamble.

═══════════════════════════════════════════════════════════════
COMPOSITION CONTEXT
═══════════════════════════════════════════════════════════════
Title: ${originalJson.title}
Style: ${originalJson.explanation}
Tempo: ${bpm} BPM | Time Signature: ${beatsPerBar}/4
Available Tracks: ${originalTrackTypes.join(', ')}
Target Duration: ${duration} bars (~${totalSeconds.toFixed(2)} seconds)

═══════════════════════════════════════════════════════════════
STRUCTURAL VISION FOR "${structure.toUpperCase()}"
═══════════════════════════════════════════════════════════════
${structureInstructions[structure]}

═══════════════════════════════════════════════════════════════
PRODUCTION TECHNICAL SPECIFICATIONS
═══════════════════════════════════════════════════════════════
${technicalRequirements[structure]}

═══════════════════════════════════════════════════════════════
CRITICAL CONSTRAINTS (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════
✓ KEY & TEMPO: Maintain original key and ${bpm} BPM - ZERO modifications
✓ TIME SIGNATURE: Maintain ${beatsPerBar}/4 - ZERO modifications
✓ DURATION: All notes must start between 0 and ${totalSeconds.toFixed(2)} seconds
✓ TRACKS: Use ONLY these exact names: ${originalTrackTypes.join(', ')}
✓ FORMAT: Each note MUST be "pitch,time,duration,velocity # track_name"
  Example: "60,0.5,0.25,0.8 # bass"
✓ PITCH FORMAT: Use MIDI numbers (36-96) for all pitches
✓ TIME VALUES: Maximum 2 decimal places (X.XX format)
✓ VELOCITY: Range 0.1 to 1.0 only
✓ NEWLINES: Use ONLY escaped newlines (\\n) between notes
✓ ORIGINALITY: Create NEW arrangements - avoid copying original structure
✓ MUSICALITY: All notes must be harmonically coherent and rhythmically locked

═══════════════════════════════════════════════════════════════
REFERENCE NOTATION (Transform, Don't Copy)
═══════════════════════════════════════════════════════════════
${originalJson.notation}

═══════════════════════════════════════════════════════════════
RESPONSE FORMAT (EXACTLY AS SHOWN - JSON ONLY)
═══════════════════════════════════════════════════════════════
{
  "title": "${originalJson.title} - ${structure.charAt(0).toUpperCase() + structure.slice(1)}",
  "explanation": "A ${structure} version: [concise description max 20 words capturing the musical character]",
  "notation": "pitch,time,duration,velocity # track_name\\npitch,time,duration,velocity # track_name\\n[...all notes...]"
}

═══════════════════════════════════════════════════════════════
GO! Create the ${structure.toUpperCase()} now with professional musical excellence.
═══════════════════════════════════════════════════════════════`;
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

            if (!parsed.title || !parsed.explanation || !parsed.notation) {
                throw new Error("Parsed JSON is missing one or more required keys: title, explanation, notation.");
            }
            return parsed;

        } catch (error) {
            console.error("Failed to parse variation response:", error, "Raw response:", responseText);
            throw Error(`Could not parse the AI's response. It may have been malformed. Details: ${error.message}`);
        }
    }

    parseNotationToTracks(notation) {
        const tracks = new Map();
        const lines = notation.replace(/\\n/g, '\n').split('\n');
        
        const key = document.getElementById('key')?.value || 'C';
        const scaleType = document.getElementById('scale-type')?.value || 'major';
        const validationStrictness = document.getElementById('scale-validation-strictness')?.value || ScaleStrictness.MEDIUM;
        const bpm = parseInt(document.getElementById('bpm')?.value, 10) || 120;

        this.validator.setScale(key, scaleType);

        const rawTrackNotes = new Map();
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.includes('pitch,time') || !trimmed.includes('#')) continue;
            
            const [content, comment] = trimmed.split('#', 2);
            const note = this.parseNoteLine(content.trim());
            const trackType = comment.trim().split(/\s/)[0];
            
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
                const { notes: validatedNotes, stats } = this.validator.validateNotes(notes, validationStrictness);
                
                if (stats.message) {
                    console.log(`[Variation ${trackType}] Scale validation: ${stats.message}`);
                }

                const midi = this.createMidiFromNotes(validatedNotes, bpm);
                
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
            const parts = line.split(',').map(p => p.trim());
            if (parts.length < 4) return null;

            const pitchOrName = parts[0];
            const time = parseFloat(parts[1]);
            const duration = parseFloat(parts[2]);
            const velocity = parseFloat(parts[3]);
            
            if (isNaN(time) || isNaN(duration) || isNaN(velocity)) return null;
            
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
                time: Math.max(0, time),
                duration: Math.max(0.01, duration),
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
                    const midiBytes = combinedMidi.toArray();
                    const sanitizedTitle = version.apiResponse.title.replace(/[\/\\?%*:|"<>]/g, '-').trim();
                    const filename = `${sanitizedTitle}.mid`;
                    zip.file(filename, midiBytes);
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
