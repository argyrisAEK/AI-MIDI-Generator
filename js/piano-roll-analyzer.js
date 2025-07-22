import { Midi } from '@tonejs/midi';

export class PianoRollAnalyzer {
    constructor(app) {
        this.app = app;
        this.uploadedImage = null;
        this.analyzedData = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        const uploadArea = document.getElementById('piano-roll-upload-area');
        const fileInput = document.getElementById('piano-roll-upload');
        const removeButton = document.getElementById('remove-image');
        const analyzeButton = document.getElementById('analyze-piano-roll');
        const generateVariationButton = document.getElementById('generate-piano-roll-variation');

        // File upload handling
        fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        removeButton.addEventListener('click', () => this.removeImage());
        analyzeButton.addEventListener('click', () => this.analyzePianoRoll());
        generateVariationButton.addEventListener('click', () => this.generateVariation());

        // Drag and drop handling
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.processFile(files[0]);
            }
        });
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    processFile(file) {
        // Validate file type
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        if (!validTypes.includes(file.type)) {
            this.app.ui.showMessage('Please upload a valid image file (PNG, JPG, JPEG).', 'error');
            return;
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            this.app.ui.showMessage('Image file is too large. Please upload an image smaller than 10MB.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.uploadedImage = {
                file: file,
                dataUrl: e.target.result,
                name: file.name
            };
            this.displayImagePreview(e.target.result);
            document.getElementById('analyze-piano-roll').disabled = false;
        };
        reader.readAsDataURL(file);
    }

    displayImagePreview(dataUrl) {
        const placeholder = document.querySelector('.upload-placeholder');
        const preview = document.getElementById('uploaded-image-preview');
        const previewImg = document.getElementById('preview-image');

        placeholder.style.display = 'none';
        preview.style.display = 'flex';
        previewImg.src = dataUrl;

        this.app.ui.showMessage('Image uploaded successfully. Click "Analyze Piano Roll" to extract notes.', 'success');
    }

    removeImage() {
        const placeholder = document.querySelector('.upload-placeholder');
        const preview = document.getElementById('uploaded-image-preview');
        const fileInput = document.getElementById('piano-roll-upload');

        placeholder.style.display = 'block';
        preview.style.display = 'none';
        fileInput.value = '';
        
        this.uploadedImage = null;
        this.analyzedData = null;
        document.getElementById('analyze-piano-roll').disabled = true;
        document.getElementById('piano-roll-results').style.display = 'none';
    }

    async analyzePianoRoll() {
        if (!this.uploadedImage) {
            this.app.ui.showMessage('Please upload an image first.', 'error');
            return;
        }

        try {
            this.app.ui.showLoading('Analyzing piano roll image with AI vision...');

            // Convert image to base64 for API
            const base64Data = this.uploadedImage.dataUrl.split(',')[1];
            
            // Create analysis prompt
            const analysisPrompt = this.buildAnalysisPrompt();
            
            // Call Pollinations Vision API
            const requestBody = {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            { "type": "text", "text": analysisPrompt },
                            { "type": "image_url", "image_url": { "url": `data:image/jpeg;base64,${base64Data}` } }
                        ]
                    }
                ],
                "model": "openai-large",
                "jsonMode": true
            };

            const response = await fetch('https://text.pollinations.ai/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Vision API error: ${response.status} - ${response.statusText}. Response: ${errorBody}`);
            }

            const analysisResult = await response.text();
            console.log('Piano roll analysis response:', analysisResult.substring(0, 500));
            
            this.processAnalysisResult(analysisResult);

        } catch (error) {
            console.error('Piano roll analysis failed:', error);
            let errorMessage = 'Analysis failed: ';
            if (error.message.includes('timeout') || error.name === 'AbortError') {
                errorMessage += 'The analysis timed out. Please try with a clearer or smaller image.';
            } else if (error.message.includes('Vision API error')) {
                errorMessage += 'The AI vision service is temporarily unavailable. Please try again later.';
            } else {
                errorMessage += error.message;
            }
            this.app.ui.showMessage(errorMessage, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    buildAnalysisPrompt() {
        const keyHint = document.getElementById('pr-key').value;
        const bpmHint = document.getElementById('pr-bpm').value;

        return `You are an expert music transcriber AI. Your sole task is to analyze the provided piano roll image and transcribe all visible notes into a precise JSON format.

VISUAL ANALYSIS INSTRUCTIONS:
1.  **Grid Detection**: Identify the bar and beat lines to establish a time grid. Assume the grid represents a standard measure unless otherwise indicated.
2.  **Note Detection**: Locate every rectangular note block on the grid.
3.  **Pitch Mapping**: Determine the pitch of each note by its vertical position. The keyboard reference is on the side. Middle C (C4) corresponds to MIDI note 60.
4.  **Timing & Duration**: Determine each note's start time and duration based on its horizontal position and length relative to the grid. The timeline starts at 0.0 seconds.
5.  **Velocity Estimation**: Infer note velocity (0.1 to 1.0) from its color or brightness, if possible. If not, use a default of 0.7.

${keyHint ? `CONTEXT HINT: The user suggests the key is ${keyHint}. Use this to resolve ambiguous notes.` : ''}
${bpmHint ? `CONTEXT HINT: The user suggests the tempo is ${bpmHint} BPM. Use this to calculate the duration of one beat and scale your time/duration estimates.` : 'CONTEXT HINT: Estimate the tempo (BPM) from the visual grid spacing.'}

CRITICAL: Your response MUST be ONLY a valid JSON object. Do not include any other text, explanations, or markdown formatting.

JSON RESPONSE FORMAT:
{
  "title": "Piano Roll Transcription",
  "explanation": "Transcribed [number] notes from the image. Detected key: [key] [scale], Tempo: [bpm] BPM.",
  "key": "detected_key_letter (e.g., C, Dm, F#)",
  "bpm": estimated_bpm_as_number,
  "timeSignature": "4/4",
  "notation": "note_data_string"
}

NOTATION STRING FORMAT:
- A single string containing all notes, with each note on a new line separated by \\n.
- Each line MUST follow this exact format: \`MIDI_NUMBER,TIME_SECONDS,DURATION_SECONDS,VELOCITY_0_TO_1 # melody\`
- For this initial transcription, every line must end with \`# melody\`. This is mandatory.

Example of a valid "notation" string value:
"60,0.0,0.45,0.8 # melody\\n62,0.5,0.45,0.7 # melody\\n64,1.0,0.95,0.9 # melody"

Analyze the image with maximum precision and provide an accurate transcription in the specified JSON format.`;
    }

    processAnalysisResult(analysisText) {
        try {
            // Clean and parse the response
            let cleanedJson = analysisText.trim();
            
            // Remove potential markdown formatting
            cleanedJson = cleanedJson.replace(/```json\n?|\n?```/g, '');
            
            // Find JSON object boundaries
            const firstBrace = cleanedJson.indexOf('{');
            const lastBrace = cleanedJson.lastIndexOf('}');
            
            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error('No valid JSON object found in response');
            }
            
            cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1);
            
            const analysisData = JSON.parse(cleanedJson);

            // Validate required fields
            if (!analysisData.notation || typeof analysisData.notation !== 'string') {
                throw new Error('No valid notation data found in analysis');
            }

            // Validate notation format
            const noteLines = analysisData.notation.split('\\n').filter(line => line.trim());
            if (noteLines.length === 0) {
                throw new Error('No musical notes detected in the notation');
            }

            // Store the validated data
            this.analyzedData = {
                title: analysisData.title || 'Piano Roll Analysis',
                explanation: analysisData.explanation || 'Extracted notes from piano roll',
                key: analysisData.key || 'C',
                bpm: parseInt(analysisData.bpm) || 120,
                timeSignature: analysisData.timeSignature || '4/4',
                notation: analysisData.notation
            };

            this.displayAnalysisResults();

        } catch (error) {
            console.error('Failed to parse analysis result:', error, 'Raw response:', analysisText);
            this.app.ui.showMessage(`Failed to parse analysis results: ${error.message}. The image may not contain a clear piano roll or the AI couldn't detect musical patterns.`, 'error');
        }
    }

    displayAnalysisResults() {
        const resultsDiv = document.getElementById('piano-roll-results');
        const infoDiv = document.getElementById('detected-notes-info');

        // Count and validate notes
        const noteLines = this.analyzedData.notation.split('\\n').filter(line => line.trim());
        const validNotes = noteLines.filter(line => {
            const parts = line.trim().split(',');
            return parts.length >= 4 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]));
        });

        // Display comprehensive analysis info
        infoDiv.innerHTML = `
            <strong>Analysis Results:</strong><br>
            • Detected Notes: ${validNotes.length} (${noteLines.length} total lines)<br>
            • Key: ${this.analyzedData.key}<br>
            • BPM: ${this.analyzedData.bpm}<br>
            • Time Signature: ${this.analyzedData.timeSignature}<br><br>
            
            <strong>Sample Notation (first 5 notes):</strong><br>
            ${validNotes.slice(0, 5).join('<br>')}
            ${validNotes.length > 5 ? '<br>... and more' : ''}
        `;

        resultsDiv.style.display = 'block';

        // Load the extracted data into the visualizer
        this.loadExtractedData();

        this.app.ui.showMessage(`Successfully analyzed piano roll! Detected ${validNotes.length} musical notes. You can now generate variations.`, 'success');
    }

    loadExtractedData() {
        try {
            // Parse the notation data into tracks
            const tracks = this.parseNotationToTracks(this.analyzedData.notation);
            
            if (tracks.size === 0) {
                this.app.ui.showMessage('No valid notes could be extracted from the analysis.', 'warning');
                return;
            }

            // Update main app state with ONLY the extracted track
            this.app.generatedTracks.clear();
            this.app.generatedTracks = tracks;
            this.app.compositionTitle = this.analyzedData.title || 'Piano Roll Extract';
            this.app.compositionDescription = this.analyzedData.explanation || 'Extracted from uploaded piano roll';

            // Update form fields if detected
            if (this.analyzedData.key) {
                const keySelect = document.getElementById('key');
                if (keySelect) keySelect.value = this.analyzedData.key;
            }
            
            if (this.analyzedData.bpm) {
                const bpmInput = document.getElementById('bpm');
                if (bpmInput) bpmInput.value = this.analyzedData.bpm;
            }
            
            if(this.analyzedData.timeSignature) {
                const timeSigSelect = document.getElementById('time-signature');
                if(timeSigSelect) timeSigSelect.value = this.analyzedData.timeSignature;
            }

            // Update mixer and visualizer
            this.app.mixer.setTracks(this.app.generatedTracks);
            this.app.visualizer.compositionTitle = this.app.compositionTitle;
            this.app.visualizer.compositionDescription = this.app.compositionDescription;
            this.app.visualizer.setTracks(tracks);

            // Enable playback controls
            this.app.ui.updateButtonStates(true);

        } catch (error) {
            console.error('Failed to load extracted data:', error);
            this.app.ui.showMessage('Failed to load extracted musical data.', 'error');
        }
    }

    parseNotationToTracks(notation, specificTrackType = null) {
        const tracks = new Map();
        const lines = notation.replace(/\\n/g, '\n').split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            let content = trimmed;
            let trackType = specificTrackType; 
            
            // Check if line has track type comment
            if (trimmed.includes('#')) {
                const parts = trimmed.split('#');
                content = parts[0].trim();
                const commentPart = parts[1].trim();
                if (commentPart) {
                    trackType = trackType || commentPart.split(/\s/)[0]; // Get first word after #
                }
            }

            if (!trackType) continue; // Skip if we can't determine track type
            
            // Parse the note data
            const noteParts = content.split(',');
            if (noteParts.length >= 4) {
                try {
                    const pitch = noteParts[0].trim();
                    const time = parseFloat(noteParts[1].trim());
                    const duration = parseFloat(noteParts[2].trim());
                    const velocity = parseFloat(noteParts[3].trim());
                    
                    if (isNaN(time) || isNaN(duration) || isNaN(velocity)) continue;
                    
                    // Convert pitch to MIDI number and note name
                    let midiNumber, noteName;
                    if (isNaN(parseInt(pitch))) {
                        // It's a note name like "C4"
                        noteName = pitch;
                        try {
                            midiNumber = this.noteNameToMidi(noteName);
                        } catch (e) {
                            console.warn('Invalid note name:', noteName);
                            continue;
                        }
                    } else {
                        // It's a MIDI number
                        midiNumber = parseInt(pitch);
                        noteName = this.midiToNoteName(midiNumber);
                    }
                    
                    const note = {
                        name: noteName,
                        midi: midiNumber,
                        time: Math.max(0, time),
                        duration: Math.max(0.05, duration),
                        velocity: Math.max(0.1, Math.min(1.0, velocity))
                    };
                    
                    // Add note to appropriate track
                    if (!tracks.has(trackType)) {
                        tracks.set(trackType, { notes: [] });
                    }
                    tracks.get(trackType).notes.push(note);
                    
                } catch (error) {
                    console.warn('Failed to parse note line:', line, error);
                }
            }
        }
        
        // Convert note arrays to MIDI objects
        const finalTracks = new Map();
        const bpm = this.analyzedData ? this.analyzedData.bpm : 120;
        
        tracks.forEach((trackData, trackType) => {
            if (trackData.notes.length > 0) {
                const midi = this.createMidiFromNotes(trackData.notes, bpm);
                finalTracks.set(trackType, {
                    midi: midi,
                    title: trackType.charAt(0).toUpperCase() + trackType.slice(1),
                    description: `Generated ${trackType} from piano roll analysis`
                });
            }
        });
        
        return finalTracks;
    }

    noteNameToMidi(noteName) {
        // Simple note name to MIDI conversion
        const noteMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const match = noteName.match(/([A-G])([#b]?)(\d+)/);
        
        if (!match) throw new Error('Invalid note name format');
        
        const [, note, accidental, octave] = match;
        let midiNumber = noteMap[note] + (parseInt(octave) + 1) * 12;
        
        if (accidental === '#') midiNumber += 1;
        else if (accidental === 'b') midiNumber -= 1;
        
        return Math.max(21, Math.min(108, midiNumber));
    }

    midiToNoteName(midiNumber) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midiNumber / 12) - 1;
        const note = noteNames[midiNumber % 12];
        return note + octave;
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

    async generateVariation() {
        if (!this.analyzedData) {
            this.app.ui.showMessage('Please analyze a piano roll first.', 'error');
            return;
        }

        const variationType = document.getElementById('pr-variation-type').value;
        if (!variationType) {
            this.app.ui.showMessage('Please select a variation type.', 'warning');
            return;
        }

        try {
            this.app.ui.showLoading(`Generating ${variationType} variation...`);

            const variationPrompt = this.buildVariationPrompt(variationType);
            const url = `https://text.pollinations.ai/${encodeURIComponent(variationPrompt)}?model=midijourney&seed=${Math.floor(Math.random() * 100000)}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 90000);

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Generation API error: ${response.status} - ${response.statusText}. Response: ${errorBody}`);
            }

            const responseText = await response.text();
            console.log('Variation response:', responseText.substring(0, 500));
            
            const variationData = this.parseVariationResponse(responseText);
            
            // Validate the variation data
            if (!variationData.notation || typeof variationData.notation !== 'string') {
                throw new Error('Generated variation contains no valid musical notation');
            }

            // Combine original and variation
            this.combineWithVariation(variationData, variationType);

            this.app.ui.showMessage(`Successfully generated and added a ${variationType} track!`, 'success');

        } catch (error) {
            console.error('Variation generation failed:', error);
            let errorMessage = `Failed to generate ${variationType} variation: `;
            if (error.message.includes('timeout') || error.name === 'AbortError') {
                errorMessage += 'The generation timed out. Please try again.';
            } else if (error.message.includes('Generation API error')) {
                errorMessage += 'The AI generation service is temporarily unavailable.';
            } else {
                errorMessage += error.message;
            }
            this.app.ui.showMessage(errorMessage, 'error');
        } finally {
            this.app.ui.hideLoading();
        }
    }

    buildVariationPrompt(variationType) {
        const instructions = {
            harmony: `Add harmonic chord progressions that complement the original melody. 
MUSICAL APPROACH: Analyze the melodic notes to determine the implied harmony, then create sustained chord voicings using root position and inversions. Use 3-4 note chords (triads and 7th chords) in the middle register (C3-C5). Time the chord changes to align with phrase structure. The new track MUST be named 'chord'.`,

            bass: `Create a bassline that follows the harmonic structure and provides rhythmic foundation.
MUSICAL APPROACH: Use the lower register (E1-E3). Create a walking bassline or repetitive pattern that outlines the chord progressions. Use quarter notes and eighth notes primarily. Ensure the bass notes are the root notes of the implied harmony or strong chord tones. The new track MUST be named 'bassline'.`,

            drums: `Add a drum pattern that matches the rhythm and style of the original melody.
MUSICAL APPROACH: Create a standard drum kit pattern using MIDI notes: Kick=36, Snare=38, Hi-hat=42, Open Hi-hat=46, Crash=49. Analyze the rhythm of the original melody to determine appropriate drum timing. Use steady patterns with occasional fills. The new track MUST be named 'drums'.`,

            arpeggio: `Create arpeggiated patterns based on the implied harmony of the original melody.
MUSICAL APPROACH: Break down the chord progressions into flowing arpeggiated patterns using 8th notes and 16th notes. Use ascending and descending patterns. Stay in the middle-to-upper register (C4-C6). Create rhythmic interest with varied timing. The new track MUST be named 'arpeggio'.`,

            extend: `Extend the musical pattern with variations, developments, and additional phrases.
MUSICAL APPROACH: Take the original melodic material and create variations through rhythmic augmentation, pitch transposition, and motivic development. Add call-and-response phrases, sequence the melody at different pitch levels, and create a more complete musical form. The new track MUST be named 'melody'.`
        };

        const variationName = variationType.charAt(0).toUpperCase() + variationType.slice(1);
        
        const trackNameMap = {
            'harmony': 'chord',
            'bass': 'bassline',
            'drums': 'drums',
            'arpeggio': 'arpeggio',
            'extend': 'melody'
        };
        const newTrackName = trackNameMap[variationType];

        return `You are an expert music composer creating a new musical part to complement an existing melody.

ORIGINAL MELODY (from piano roll):
Title: ${this.analyzedData.title}
Key: ${this.analyzedData.key || 'C'}
BPM: ${this.analyzedData.bpm || 120}
Time Signature: ${this.analyzedData.timeSignature || '4/4'}
Original Notation (for context only):
${this.analyzedData.notation}

VARIATION TASK: ${instructions[variationType]}

COMPOSITION RULES:
- The new part you create must be a separate track.
- Maintain the same key, tempo, and time signature as the original melody.
- Create musical content that complements the original harmonically and rhythmically.
- Use appropriate velocity dynamics (0.4-1.0 range).
- Ensure proper voice leading and harmonic progression.

CRITICAL: Your response MUST be ONLY a valid JSON object. Do not include any other text or markdown.

JSON RESPONSE FORMAT:
{
  "title": "${this.analyzedData.title} + ${variationName}",
  "explanation": "Added a new ${variationType} part featuring [describe the musical elements you created and how they complement the original].",
  "notation": "pitch,time,duration,velocity # ${newTrackName}\\npitch,time,duration,velocity # ${newTrackName}\\n[continue for all new notes]"
}

NOTATION STRING FORMAT:
- A single string containing all notes for the NEW PART ONLY, with each note separated by \\n.
- Every line MUST follow this exact format: \`pitch,time,duration,velocity # ${newTrackName}\`
- Use MIDI note numbers (21-108) or note names (C4, F#3, etc.).
- Time in seconds, starting from 0.0.
- Duration in seconds (minimum 0.05).
- Velocity as decimal 0.4-1.0.

Generate a professional-quality ${newTrackName} part now.`;
    }

    parseVariationResponse(responseText) {
        try {
            // Clean the response more thoroughly
            let cleanedJson = responseText.trim();
            
            // Remove markdown code blocks
            cleanedJson = cleanedJson.replace(/```json\n?|\n?```/g, '');
            
            // Find JSON boundaries
            const firstBrace = cleanedJson.indexOf('{');
            const lastBrace = cleanedJson.lastIndexOf('}');
            
            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error('No JSON object found in response');
            }
            
            cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1);
            
            // Parse and validate
            const parsed = JSON.parse(cleanedJson);
            
            if (!parsed.notation) {
                throw new Error('Missing notation field in response');
            }
            
            return {
                title: parsed.title || 'Piano Roll Variation',
                explanation: parsed.explanation || 'Generated variation',
                notation: parsed.notation
            };
            
        } catch (error) {
            console.error('Parse error:', error, 'Raw response:', responseText);
            throw new Error(`Failed to parse AI response: ${error.message}`);
        }
    }

    combineWithVariation(variationData, variationType) {
        try {
            // Infer track name from variationType for parsing
            const trackNameMap = {
                'harmony': 'chord',
                'bass': 'bassline',
                'drums': 'drums',
                'arpeggio': 'arpeggio',
                'extend': 'melody'
            };
            const newTrackName = trackNameMap[variationType];
            
            // Parse variation notation
            const variationTracks = this.parseNotationToTracks(variationData.notation, newTrackName);
            
            if (variationTracks.size === 0) {
                throw new Error(`No valid notes found in generated ${variationType} variation`);
            }

            // Add the new track(s) to the existing tracks
            variationTracks.forEach((trackData, trackType) => {
                this.app.generatedTracks.set(trackType, trackData);
            });

            // Update mixer with new tracks
            this.app.mixer.setTracks(this.app.generatedTracks);

            // Update visualizer
            this.app.visualizer.setTracks(this.app.generatedTracks);
            
            // Update composition metadata
            this.app.compositionTitle = variationData.title || this.app.compositionTitle;
            this.app.compositionDescription = variationData.explanation || this.app.compositionDescription;
            this.app.visualizer.compositionTitle = this.app.compositionTitle;
            this.app.visualizer.compositionDescription = this.app.compositionDescription;

            // Enable playback controls
            this.app.ui.updateButtonStates(true);
            
            // Select the newly added track in the visualizer for immediate feedback
            this.app.visualizer.setActiveTrack(newTrackName);

        } catch (error) {
            console.error('Failed to combine variation:', error);
            this.app.ui.showMessage(`Failed to load ${variationType} variation: ${error.message}`, 'error');
        }
    }

    reset() {
        this.removeImage();
        this.analyzedData = null;
        document.getElementById('pr-key').value = '';
        document.getElementById('pr-bpm').value = '';
        document.getElementById('piano-roll-results').style.display = 'none';
    }
}
