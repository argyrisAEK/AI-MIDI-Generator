import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { AudioEngine } from './audio.js';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { generateMultiTrackMIDIFromAPI } from './midi-generator-api.js';

class MIDIGeneratorApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.ui = new UIManager(this);
        this.visualizer = new Visualizer(this.audioEngine);
        
        this.generatedTracks = new Map();
        this.musicalContext = null;
        
        this.initializeEventListeners();
        this.setupPageLifecycle();
        this.setupServiceWorker();
        this.updateDurationTooltip(); // Initial update

        setTimeout(() => {
            this.ui.showTooltip('Tip: Use keyboard shortcuts - Space (Play/Stop), G (Generate), D (Download), R (Reset), T (Text mode), F (Form mode)', 
                document.querySelector('.container'), 5000);
        }, 2000);
    }

    initializeEventListeners() {
        document.getElementById('generate').addEventListener('click', () => this.handleGenerate());
        document.getElementById('play').addEventListener('click', () => this.handlePlay());
        document.getElementById('stop').addEventListener('click', () => this.handleStop());
        document.getElementById('download').addEventListener('click', () => this.handleDownload());
        document.getElementById('reset').addEventListener('click', () => this.handleReset());
        document.getElementById('text-mode').addEventListener('click', () => this.switchMode('text'));
        document.getElementById('form-mode').addEventListener('click', () => this.switchMode('form'));
        this.setupTrackTypeSelection();
        
        // Add listeners to update duration tooltip
        document.getElementById('duration').addEventListener('input', () => this.updateDurationTooltip());
        document.getElementById('bpm').addEventListener('input', () => this.updateDurationTooltip());
        document.getElementById('time-signature').addEventListener('change', () => this.updateDurationTooltip());
    }

    setupTrackTypeSelection() {
        const trackTypeCheckboxes = document.querySelectorAll('input[name="track-type"]');
        const maxSelections = 4; // Changed from 3 to 4

        trackTypeCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const checkedCheckboxes = document.querySelectorAll('input[name="track-type"]:checked');
                if (checkedCheckboxes.length > maxSelections) {
                    this.ui.showMessage(`You can select up to ${maxSelections} track types.`, 'warning');
                    e.target.checked = false;
                }
            });
        });
    }

    updateDurationTooltip() {
        const durationInput = document.getElementById('duration');
        const durationInSeconds = this.calculateTotalDurationInSeconds();
        durationInput.title = `Total duration: ${durationInSeconds.toFixed(2)} seconds`;
    }

    setupPageLifecycle() {
        window.addEventListener('beforeunload', () => this.cleanup());
        document.addEventListener('visibilitychange', () => document.hidden && this.handleStop());
    }

    setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(error => {
                    console.log('ServiceWorker registration failed:', error);
                });
            });
        }
    }

    cleanup() {
        this.handleStop();
        this.audioEngine.dispose();
        this.ui.dispose();
    }

    switchMode(mode) {
        const textMode = document.getElementById('text-mode');
        const formMode = document.getElementById('form-mode');
        const textContainer = document.getElementById('text-prompt-container');
        const formContainer = document.getElementById('form-fields-container');

        if (mode === 'text') {
            textMode.classList.add('active');
            formMode.classList.remove('active');
            textContainer.classList.add('active');
            formContainer.classList.remove('active');
        } else {
            textMode.classList.remove('active');
            formMode.classList.add('active');
            textContainer.classList.remove('active');
            formContainer.classList.add('active');
        }
    }

    async _getTrackTypesFromPrompt(userPrompt) {
        this.ui.showMessage('Analyzing your prompt to determine tracks...', 'loading');
        const availableTracks = ['bassline', 'melody', 'chord', 'arpeggio', 'strings', 'lead', 'plucks', 'drums'];
        
        const analysisPrompt = `From the following user request, identify which of these musical tracks should be generated: ${availableTracks.join(', ')}. List only the identified track types, separated by commas. If none are clearly identified, make a sensible guess based on the description. For example, 'house beat with a groovy bass' should result in 'drums,bassline'. User request: "${userPrompt}"`;

        const url = `https://text.pollinations.ai/${encodeURIComponent(analysisPrompt)}?model=midijourney`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Failed to analyze prompt for track types.');
        }

        const text = await response.text();
        const cleanedText = text.toLowerCase().replace(/[^a-z,]/g, '');
        const identifiedTracks = cleanedText.split(',').map(t => t.trim()).filter(t => availableTracks.includes(t));

        if (identifiedTracks.length === 0) {
            this.ui.showMessage('Could not determine specific tracks from your prompt. Defaulting to a melody and bassline. Try being more descriptive!', 'warning');
            return ['melody', 'bassline'];
        }
        
        if (identifiedTracks.length > 3) {
            this.ui.showMessage(`Your prompt suggested ${identifiedTracks.length} tracks. To keep the composition focused, we'll generate the first 3: ${identifiedTracks.slice(0, 3).join(', ')}.`, 'warning');
            return identifiedTracks.slice(0, 3);
        }

        return identifiedTracks;
    }

    generateMusicalContext(trackTypes) {
        const get = (id) => document.getElementById(id).value;
        const key = get('key');

        const chordProgressions = {
            'C': ['C', 'Am', 'F', 'G'], 'Cm': ['Cm', 'Ab', 'Eb', 'Bb'],
            'D': ['D', 'Bm', 'G', 'A'], 'Dm': ['Dm', 'Bb', 'F', 'C'],
            'E': ['E', 'C#m', 'A', 'B'], 'Em': ['Em', 'C', 'G', 'D'],
            'F': ['F', 'Dm', 'Bb', 'C'], 'Fm': ['Fm', 'Db', 'Ab', 'Eb'],
            'G': ['G', 'Em', 'C', 'D'], 'Gm': ['Gm', 'Eb', 'Bb', 'F'],
            'A': ['A', 'F#m', 'D', 'E'], 'Am': ['Am', 'F', 'C', 'G'],
            'B': ['B', 'G#m', 'E', 'F#'], 'Bm': ['Bm', 'G', 'D', 'A']
        };

        this.musicalContext = {
            key, scale: get('scale-type'), tempo: get('bpm'), timeSignature: get('time-signature'),
            style: get('style') || 'house', mood: get('mood'), duration: get('duration'),
            totalDurationInSeconds: this.calculateTotalDurationInSeconds(),
            rhythmicComplexity: get('rhythmic-complexity'),
            chordProgression: chordProgressions[key] || ['C', 'Am', 'F', 'G'],
            trackTypes: trackTypes
        };
    }

    calculateTotalDurationInSeconds() {
        try {
            const bars = parseInt(document.getElementById('duration').value, 10);
            const bpm = parseInt(document.getElementById('bpm').value, 10);
            const timeSignature = document.getElementById('time-signature').value;
            const beatsPerBar = parseInt(timeSignature.split('/')[0], 10);

            if (isNaN(bars) || isNaN(bpm) || isNaN(beatsPerBar) || bpm <= 0) {
                return 0;
            }

            const beatDuration = 60 / bpm;
            const barDuration = beatDuration * beatsPerBar;
            return barDuration * bars;
        } catch (e) {
            console.warn("Could not calculate duration, returning 0.", e);
            return 0;
        }
    }

    constructMultiTrackPrompt() {
        const isTextMode = document.getElementById('text-prompt-container').classList.contains('active');
        const context = this.musicalContext;
        
        let prompt = `Generate a cohesive, multi-track MIDI composition with the following tracks: ${context.trackTypes.join(', ')}.
Musical Context:
- Key: ${context.key} ${context.scale}
- Tempo: ${context.tempo} BPM
- Time Signature: ${context.timeSignature}
- Style: ${context.style}
- Mood: ${context.mood}
- Duration: ${context.duration} bars (approximately ${context.totalDurationInSeconds.toFixed(1)} seconds)
- Rhythmic Complexity: ${context.rhythmicComplexity}
- Chord Progression: ${context.chordProgression.join(' - ')}

`;

        if (isTextMode) {
            const userPrompt = document.getElementById('text-prompt').value;
            if (userPrompt) {
                prompt += `User's creative direction: "${userPrompt}"\n\n`;
            }
        }

        prompt += 'Instructions for each track:\n';
        context.trackTypes.forEach(trackType => {
            prompt += `- ${trackType}: ${this.getTrackSpecificInstructions(trackType, context)}\n`;
        });

        prompt += `
IMPORTANT: Generate a single response. For each track, provide its musical notation in a structured format.
Use the following format exactly, with a [TRACK:...] separator for each instrument:

[TRACK:track_name_1]
notation: |-
pitch,time,duration,velocity
...
[TRACK:track_name_2]
notation: |-
pitch,time,duration,velocity
...

Ensure track names (${context.trackTypes.join(', ')}) are used in the [TRACK:...] separators. The tracks must be harmonically and rhythmically aligned.`;
        
        return prompt;
    }

    getTrackSpecificInstructions(trackType, context) {
        const style = context.style || 'house';

        const styleSpecificInstructions = {
            bassline: {
                default: "Create a strong foundational bassline that emphasizes the root notes of each chord. Use mostly quarter and eighth notes. Stay in the lower register (E1-E3).",
                house: "Create a driving, groovy bassline, often syncopated with the kick. Typically uses eighth notes and stays in a hypnotic loop. Essential for the house groove.",
                techno: "Create a repetitive, hypnotic, and powerful sub-bass line. Can be a simple one or two-note pattern that evolves subtly over time. Often uses saw or square waves.",
                trap: "Create a heavy, booming 808 bassline that doubles as a melodic element. Heavy use of slides and glides between notes is common. The 808 is the foundation.",
                'hip-hop': "Create a deep, melodic sub-bass line that sits under the beat. Can be simple and powerful or a more complex, funky line inspired by soul/funk samples.",
                rock: "Create a solid, driving bassline that locks in tightly with the kick drum. Usually follows the root notes of the chords with connecting runs. Played with a pick or fingers.",
                pop: "Create a clean, catchy, and melodic bassline that supports the vocal and main melody. It should be simple enough to be memorable but groovy enough to drive the track.",
                funk: "Create a highly syncopated, melodic, and percussive bassline. Slap bass techniques are common. The bass is a lead instrument in funk.",
                reggae: "Create a heavy, sparse, and deep bassline with a lot of space ('dub'). The rhythm is key, often playing on the off-beats, creating the 'one drop' feel.",
                jazz: "Create a 'walking bassline' that outlines the chord changes using mostly quarter notes with a swing feel. It should be harmonically rich and melodically interesting.",
                disco: "Create an energetic, octave-jumping bassline with a strong sense of melody and rhythm. The bassline is a primary hook and drives the dancefloor.",
                classical: "Create a contrapuntal bassline for cello or double bass. It should follow traditional voice-leading rules and provide a solid harmonic foundation.",
                ambient: "Create a very slow, sustained, and low-frequency bass drone. It can be a single note held for a long time or slowly shifting notes that provide a warm foundation.",
            },
            melody: {
                default: "Create a memorable main melody. Use a mix of quarter, eighth, and sixteenth notes. Stay in the middle to upper register (C4-C6).",
                house: "Create a catchy, often simple and repetitive synth hook or vocal chop melody. It should be memorable and loopable.",
                techno: "Melodies are often minimal and hypnotic. A short, repeating sequence of notes (an ostinato) that evolves with filter and effects automation.",
                trap: "Create a dark, catchy, and often simple melody using bells, flutes, or synth leads. The melody should be repetitive and leave space for the vocals and 808s.",
                'hip-hop': "Create a melody that sounds like it could be from a soul, jazz, or classical sample. Piano, strings, or horns are common. It's the main harmonic content of the beat.",
                rock: "Create a powerful vocal melody or a guitar riff/solo that serves as the main melodic hook. It should be strong and memorable.",
                pop: "Create an extremely catchy, simple, and singable melody for the lead vocal. This is the most important part of a pop song.",
                funk: "The melody is often played by brass instruments (horns), clavinet, or guitar. It's rhythmic and syncopated, interacting with the bass and drums.",
                reggae: "The melody is often played by an organ ('bubble' or 'skank') or a guitar on the off-beats. Vocal melodies are relaxed and soulful.",
                jazz: "The 'head' is the main melody, played at the beginning and end. It's often complex and improvisational in nature. Solos are improvised melodies over the chords.",
                disco: "Create a soaring, singalong vocal melody or a powerful string/horn theme. The melody should be uplifting and memorable.",
                classical: "Create a well-developed melodic theme for instruments like violin, piano, or flute. It should follow the rules of harmony and counterpoint for the period.",
                ambient: "Melodies are slow, simple, and ethereal. Often played with soft synth pads or piano with a lot of reverb. The focus is on texture and atmosphere, not a catchy tune.",
            },
            chord: {
                default: "Create sustained chord progressions using the specified harmony. Use whole notes and half notes for pad-like sounds.",
                house: "Use lush, sustained pads or rhythmic stabs. 7th and 9th chords are common, creating a soulful, deep atmosphere.",
                techno: "Chords are often minimal, dissonant, and dark. A single, minor chord stab with heavy reverb and delay can be very effective.",
                trap: "Use dark, minor key pads, often with a vintage or detuned sound. The chords provide a moody, atmospheric backdrop.",
                'hip-hop': "Use chords from sampled sources like jazz or soul. Jazzy extensions (7ths, 9ths) on pianos or electric pianos are very common.",
                rock: "Power chords (root and fifth) on distorted electric guitars are the foundation. Full major/minor chords on acoustic guitar or piano are also used.",
                pop: "Use simple, strong major and minor chord progressions (e.g., I-V-vi-IV). The harmony is clear and supports the lead vocal.",
                funk: "Use percussive, rhythmic stabs on clavinet, guitar, or horns. 7th and 9th chords are essential for the funky sound.",
                reggae: "Use guitar or organ 'skank' chords played on the off-beats (beats 2 and 4). The harmony is often simple and repetitive.",
                jazz: "Use complex chords with many extensions (7ths, 9ths, 11ths, 13ths). The harmony is rich and constantly evolving.",
                disco: "Use lush, orchestrated 7th chords on strings, electric piano, and brass to create a rich, full sound.",
                classical: "Use traditional triadic harmony and voice-leading. The chords form a clear progression based on functional harmony.",
                ambient: "Use very long, evolving pads with slow filter sweeps. The chords should blur into one another, creating a seamless wash of sound.",
            },
            arpeggio: {
                default: "Create arpeggiated patterns based on the chord progression. Use sixteenth and eighth notes in repeating patterns.",
                house: "Classic rolling arpeggios on a synth, often with a filter that opens and closes, creating movement and energy.",
                techno: "Fast, driving 16th-note arpeggios, often with a dark and acidic sound (like from a TB-303).",
                trap: "Fast-paced, often triplet-based arpeggios on bell or pluck sounds, adding rhythmic complexity to the beat.",
                'hip-hop': "Subtle arpeggios on piano or synth to add texture. Less common as a main element.",
                pop: "Bright, clean synth arpeggios are very common in synth-pop, providing the main rhythmic and harmonic drive.",
                classical: "Arpeggios are a core technique for piano, harp, and strings, used to outline chords in a melodic way (e.g., Alberti bass).",
                ambient: "Very slow, sparse arpeggios with long decay and heavy reverb, creating a twinkling, spacious effect.",
            },
            lead: {
                default: "Create a sharp, monophonic lead synth line that cuts through the mix. Rhythmically interesting and occupies the upper-mid frequency range.",
                house: "A saw or square wave lead synth with a catchy, simple melody. Often used in the breakdown and main drop.",
                techno: "An 'acid' lead from a 303-style synth with squelching filter resonance, or a detuned 'supersaw' lead for trance-ier techno.",
                trap: "A synth lead with a lot of glide or pitch bend, often playing a simple, memorable hook.",
                rock: "The lead guitar solo. It should be melodic, expressive, and use techniques like string bending, vibrato, and distortion.",
                pop: "A bright synth lead that doubles the vocal melody or provides a counter-melody. Must be very catchy.",
                funk: "A synth lead with a funky, syncopated rhythm, often using a 'mini-moog' style sound.",
            },
            plucks: {
                default: "Create short, percussive plucky synth sounds that follow the chord progression or a counter-melody. Short eighth or sixteenth notes with a quick decay.",
                house: "Short, percussive plucks can play the main melody or a counter-rhythm. Common in progressive and tropical house.",
                techno: "Can be used to create rhythmic, hypnotic patterns that work alongside the main arpeggio or bassline.",
                trap: "A main sound source for melodies in trap, often using bell-like or 'pizzicato' string-style pluck sounds.",
                pop: "Often used to create arpeggios or play a light, rhythmic part that adds texture without cluttering the mix.",
                ambient: "Slow, sparse plucks with very long reverb and delay tails, creating a sense of space and wonder.",
            },
            strings: {
                default: "Create sustained, flowing string parts that support the harmony. Use legato phrasing with longer note values.",
                house: "Lush, soulful string pads or disco-style string stabs and runs to add drama and emotion.",
                'hip-hop': "Melodies or pads that sound like they are sampled from an old orchestral or movie score record.",
                rock: "Can be used for ballads or epic rock anthems to add drama and emotion. Think big, sustained pads.",
                pop: "A very common element to add size and emotional weight to the chorus. Can be soaring pads or rhythmic 'staccato' parts.",
                reggae: "Less common, but can be used for 'lover's rock' style reggae to add a smooth, romantic feel.",
                disco: "Absolutely essential. Fast, sweeping runs, dramatic stabs, and lush, sustained pads are the heart of the disco sound.",
                classical: "The core of the orchestra. Includes violin, viola, cello, and double bass, playing melodies, harmonies, and rhythmic parts.",
                ambient: "Slow, sustained string pads with very slow attack and release, creating a soft, evolving texture.",
            },
            drums: {
                default: "Create a drum beat that fits the style. Use standard drum mapping (kick, snare, hi-hat).",
                house: "A classic 'four-on-the-floor' kick pattern (kick on every beat). Snare or clap on beats 2 and 4. Open hi-hat on the off-beats and 16th-note closed hi-hats.",
                techno: "A powerful, driving four-on-the-floor kick, often with heavy processing. The snare is often replaced with a sharp clap or rimshot. The groove is defined by hi-hat and percussion patterns.",
                trap: "Complex, syncopated hi-hat patterns (triplets, 32nd notes). A sparse but powerful kick and a sharp snare on beat 3 of the bar. The deep 808 bass often syncopates with the kick.",
                'hip-hop': "The classic 'boom-bap' rhythm is kick on 1 and 3, snare on 2 and 4, often with a lazy or 'swung' feel. The groove is king.",
                rock: "A strong, driving pattern. Kick on 1 and 3, snare on 2 and 4 is a common base. Lots of powerful cymbal crashes.",
                pop: "The drum pattern is usually simple and serves the song. Can be a live rock pattern or a programmed electronic beat like in house or trap.",
                funk: "The groove is everything. Highly syncopated kick and snare patterns that lock in with the bassline. The hi-hats are often very intricate and busy.",
                reggae: "The 'one drop' rhythm where the kick and snare both hit on beat 3. Or the 'steppers' beat which is a four-on-the-floor kick. Hi-hats are on the off-beats.",
                jazz: "The 'swing' pattern on the ride cymbal is the foundation. The kick and snare are used for accents ('dropping bombs') rather than a steady backbeat.",
                disco: "Four-on-the-floor kick, snare on 2 and 4, and a constant 16th-note hi-hat pattern, often with the open hi-hat on the off-beats. Very energetic.",
                classical: "Percussion is used for dramatic effect (timpani rolls, cymbal crashes) rather than a steady beat. Snare drums are used for military-style marches.",
                ambient: "Often no drums at all. If used, they are very sparse, with lots of reverb, or replaced with soft percussive sounds.",
            }
        };

        const instructionsForTrack = styleSpecificInstructions[trackType];
        if (instructionsForTrack) {
            return instructionsForTrack[style] || instructionsForTrack.default;
        }

        return `Create a ${trackType} part that complements a ${style} arrangement.`;
    }

    async handleGenerate() {
        try {
            this.ui.showLoading('Preparing generation...');
            
            const isTextMode = document.getElementById('text-prompt-container').classList.contains('active');
            let selectedTrackTypes;

            if (isTextMode) {
                const userPrompt = document.getElementById('text-prompt').value.trim();
                if (!userPrompt) {
                    throw new Error('Please enter a description for the MIDI you want to create.');
                }
                selectedTrackTypes = await this._getTrackTypesFromPrompt(userPrompt);
            } else {
                selectedTrackTypes = Array.from(document.querySelectorAll('input[name="track-type"]:checked')).map(cb => cb.value);
                if (selectedTrackTypes.length === 0) {
                    throw new Error('Please select at least one track type in the form.');
                }
            }

            this.generateMusicalContext(selectedTrackTypes);
            this.generatedTracks.clear();
            
            const prompt = this.constructMultiTrackPrompt();
            this.ui.showMessage(`Generating ${selectedTrackTypes.length > 1 ? `${selectedTrackTypes.length} cohesive tracks...` : `a ${selectedTrackTypes[0]} track...`}`, 'loading');

            const generatedMidis = await generateMultiTrackMIDIFromAPI(prompt, this.ui, selectedTrackTypes);

            generatedMidis.forEach((midi, trackType) => {
                if (midi && midi.tracks && midi.tracks[0] && midi.tracks[0].notes && midi.tracks[0].notes.length > 0) {
                    this.generatedTracks.set(trackType, midi);
                }
            });
            
            if (this.generatedTracks.size === 0) throw new Error('Failed to generate any valid MIDI tracks from the API response.');
            
            const tracksGenerated = Array.from(this.generatedTracks.keys());
            const missingTracks = selectedTrackTypes.filter(t => !tracksGenerated.includes(t));

            this.visualizer.setTracks(this.generatedTracks);
            this.ui.updateButtonStates(true);
            
            let successMessage = `Successfully generated: ${tracksGenerated.join(', ')}.`;
            if (missingTracks.length > 0) {
                successMessage += `\nCould not generate: ${missingTracks.join(', ')}.`;
            }
            this.ui.showMessage(successMessage, 'success');

        } catch (error) {
            console.error('Generation Error:', error);
            this.ui.showMessage(`Generation failed: ${error.message}`, 'error');
            this.ui.updateButtonStates(false);
        } finally {
            this.ui.hideLoading();
        }
    }

    async handlePlay() {
        if (this.generatedTracks.size === 0) return;
        
        // Stop any existing playback before starting a new one.
        this.handleStop();

        try {
            await this.audioEngine.start();
            const activeTrackType = this.visualizer.activeTrackType;
            const totalDuration = this.musicalContext?.totalDurationInSeconds || 8;

            const tracksToPlay = new Map();
            if (activeTrackType === 'all') {
                this.generatedTracks.forEach((midi, trackType) => {
                    if (midi && midi.tracks[0]?.notes) {
                        tracksToPlay.set(trackType, midi.tracks[0].notes);
                    }
                });
            } else {
                const midi = this.generatedTracks.get(activeTrackType);
                if (midi && midi.tracks[0]?.notes) {
                    tracksToPlay.set(activeTrackType, midi.tracks[0].notes);
                }
            }

            if (tracksToPlay.size === 0) {
                this.ui.showMessage('No notes to play for this selection.', 'warning');
                return;
            }

            tracksToPlay.forEach((notes, trackType) => {
                this.audioEngine.playNotes(notes, Tone.now(), trackType, totalDuration);
            });
            
            const playMode = document.getElementById('play-mode')?.value || 'loop';
            if (playMode === 'single' && totalDuration > 0) {
                 Tone.Transport.scheduleOnce(() => {
                    this.handleStop();
                }, totalDuration + 0.1);
            }

            this.ui.showMessage(`Playing ${activeTrackType === 'all' ? 'all tracks' : activeTrackType}...`, 'success');
        } catch (error) {
            console.error('Playback Error:', error);
            this.ui.showMessage('Playback failed: ' + error.message, 'error');
            this.handleStop();
        }
    }

    handleStop() {
        this.audioEngine.stop();
        document.querySelectorAll('.note.active').forEach(n => n.classList.remove('active'));
        const playhead = document.querySelector('.playhead');
        if (playhead) playhead.style.left = '20px'; // Reset to start
        this.ui.showMessage('Playback stopped.', 'info');
    }

    handleDownload() {
        if (this.generatedTracks.size === 0) return;
        
        try {
            const activeTrackType = this.visualizer.activeTrackType;
            let midiToDownload, filename;

            if (activeTrackType && activeTrackType !== 'all') {
                midiToDownload = this.generatedTracks.get(activeTrackType);
                filename = `${activeTrackType}-track`;
            } else {
                midiToDownload = new Midi();
                midiToDownload.header.setTempo(this.musicalContext?.tempo || 120);

                const instrumentMap = {
                    bassline: 38, // Synth Bass 1
                    melody: 81,   // Lead 2 (sawtooth)
                    chord: 89,    // Pad 2 (warm)
                    arpeggio: 98, // FX 3 (crystal)
                    strings: 48,  // String Ensemble 1
                    lead: 80, // Lead 1 (square)
                    plucks: 7, // Harpsichord (often used for pluck sounds)
                };

                // Handle drums first on channel 9
                if (this.generatedTracks.has('drums')) {
                    const midi = this.generatedTracks.get('drums');
                    if (midi?.tracks[0]?.notes) {
                        const track = midiToDownload.addTrack();
                        track.name = 'drums';
                        track.channel = 9; // Crucial for drums
                        midi.tracks[0].notes.forEach(note => {
                            if (note?.name) track.addNote(note);
                        });
                    }
                }
                
                let currentChannel = 0;
                this.generatedTracks.forEach((midi, type) => {
                    if (type === 'drums') return; // Already handled

                    if (midi?.tracks[0]?.notes) {
                        if (currentChannel === 9) currentChannel++; // Skip drum channel

                        const track = midiToDownload.addTrack();
                        track.name = type;
                        track.channel = currentChannel;
                        if (instrumentMap[type] !== undefined) {
                            track.instrument.number = instrumentMap[type];
                        }

                        midi.tracks[0].notes.forEach(note => {
                            if (note?.name) track.addNote(note);
                        });
                        
                        currentChannel++;
                    }
                });

                filename = 'combined-tracks';
            }
            
            if (!midiToDownload || midiToDownload.tracks.length === 0) {
                 this.ui.showMessage('No data to download.', 'warning');
                 return;
            }
            
            const blob = new Blob([midiToDownload.toArray()], { type: 'audio/midi' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}.mid`;
            a.click();
            URL.revokeObjectURL(url);
            
            this.ui.showMessage('MIDI file downloaded successfully!', 'success');
        } catch (error) {
            console.error('Download Error:', error);
            this.ui.showMessage('Download failed: ' + error.message, 'error');
        }
    }

    handleReset() {
        this.handleStop();
        this.generatedTracks.clear();
        this.musicalContext = null;
        this.ui.updateButtonStates(false);
        this.visualizer.reset();
        
        document.getElementById('text-prompt').value = '';
        document.querySelectorAll('input[name="track-type"]').forEach((cb, i) => cb.checked = i === 0);
        document.getElementById('style').value = '';
        document.getElementById('mood').value = 'uplifting';
        document.getElementById('key').value = 'C';
        document.getElementById('bpm').value = '120';
        document.getElementById('duration').value = '4';
        
        this.ui.showMessage('Application reset.', 'success');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MIDIGeneratorApp();
});