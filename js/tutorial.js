export class TutorialManager {
    constructor(app) {
        this.app = app;
        this.modal = document.getElementById('tutorial-modal');
        this.titleEl = document.getElementById('tutorial-title');
        this.iconEl = document.getElementById('tutorial-icon');
        this.bodyEl = document.getElementById('tutorial-body');
        this.progressEl = document.getElementById('tutorial-progress');
        this.progressFill = document.getElementById('tutorial-progress-fill');
        this.prevBtn = document.getElementById('prev-step');
        this.nextBtn = document.getElementById('next-step');
        this.skipBtn = document.getElementById('skip-tutorial');
        this.closeBtn = this.modal.querySelector('.close-button');

        this.currentStepIndex = 0;
        this.highlightedElement = null;
        this.originalHighlightBorder = '';

        this.steps = this.defineTutorialSteps();
        this.bindEventListeners();
    }

    defineTutorialSteps() {
        return [
            {
                icon: '⚡',
                title: 'Create, edit and extend MIDI arrangements',
                content: `
                    <p><strong>AI MIDI Generator</strong> turns a written music brief into an editable, multitrack MIDI arrangement. You can also import an existing MIDI file and build complementary parts around it.</p>
                    <p>Preview and refine individual tracks, export MIDI or WAV, and prepare Suno prompts from your musical material. The <strong>Free MIDI Demo Library</strong> lets you load, preview and download example arrangements without connecting an AI account.</p>
                    <p style="margin-top:1rem; color:var(--accent); font-weight:600;">This guide covers the current Studio workflow and tools.</p>
                `
            },
            {
                icon: '✍️',
                title: '1. Describe the music',
                content: `
                    <p>Open <strong>Describe</strong> and write a clear brief for the arrangement you want. Include genre, mood, tempo, key, instruments, rhythmic feel and the intended section (such as intro, verse, chorus or bridge).</p>
                    <em style="color:var(--text-gray-300); display:block; margin:0.75rem 0; padding:0.75rem 1rem; background:rgba(84,183,110,0.06); border-left:3px solid var(--accent); border-radius:0.25rem;">"Dark melodic techno, 132 BPM, F minor: a driving bassline, hypnotic arpeggio, atmospheric pads and a restrained lead. 8 bars."</em>
                    <p>Describe the musical role of each part and specify whether you want percussion. The prompt field accepts up to 600 characters.</p>
                `,
                elementId: 'text-panel',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎛️',
                title: '2. Customize the arrangement',
                content: `
                    <p>Use <strong>Customize</strong> to set genre, key, scale, tempo, time signature, mood, rhythmic complexity and arrangement structure.</p>
                    <p>Choose a duration of <strong>4 or 8 bars</strong> and select up to <strong>5 track types</strong>, such as bassline, melody, chords, arpeggio, strings, lead, plucks, keys, brass, guitar, pad textures or percs.</p>
                    <p>The <strong>Subgenre</strong> control refines the musical direction and genre-based preview sound. You can also describe details that are not covered by the controls in the text prompt. The Customize fields have their own scroll area, so the Generate controls remain accessible below.</p>
                `,
                elementId: 'form-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '💡',
                title: '3. Start with Prompt Examples',
                content: `
                    <p>Open <strong>Prompt Examples</strong> to explore ready-made starting points for genres such as Deep House, Disco, Trap, Synthwave, Cinematic, Techno, Progressive Rock, Hip-Hop Soul, Ambient and Pop.</p>
                    <p>Select an example to place it in the Describe field, then adapt the instruments, groove and musical direction before generating.</p>
                `,
                elementId: 'examples-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🤖',
                title: '4. Connect and choose an AI model',
                content: `
                    <p><strong>Bring Your Own Pollen</strong> connects your Pollinations account. AI generation, AI-powered track edits, complementary-track generation and Suno prompt assistance use your own Pollen and the spending budget you authorize.</p>
                    <p>After connecting, choose a <strong>Standard</strong> or <strong>Pro</strong> model. Pro models can cost more Pollen, and some require purchased credits. Check the selected model and your Pollinations balance before making a request.</p>
                    <p>The authorization is kept as a temporary browser session. If it expires or is cleared, connect again.</p>
                `,
                elementId: 'byop-header-btn',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🚀',
                title: '5. Generate your MIDI',
                content: `
                    <p>Return to <strong>Describe</strong> or <strong>Customize</strong> and press <strong>Build My Track</strong>. Generation time varies with the selected model and the complexity of the request.</p>
                    <p>The result is an editable MIDI arrangement, not a finished audio production or a complete song with fully developed sections. You can build on it by editing tracks, importing MIDI or arranging the exported parts in a DAW.</p>
                `,
                elementId: 'generate',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎹',
                title: '6. Preview and export your arrangement',
                content: `
                    <p>Use the track selector to audition individual parts. The <strong>Preview Sound</strong> menu switches between genre-based sounds and default instrument sounds. You can adjust the preview tempo and choose whether playback loops or plays once.</p>
                    <p>In <strong>Playback &amp; Export</strong>, use <strong>Export MIDI</strong> to save a multitrack MIDI file or separate track files, and <strong>Export WAV</strong> to render audio for listening or use as a reference sample.</p>
                    <p>Preview audio is intended for auditioning your MIDI. For a finished production, assign instruments and mix the exported MIDI in your DAW.</p>
                `,
                elementId: 'playback-export-title',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '✏️',
                title: '7. Edit and develop individual tracks',
                content: `
                    <p>Open <strong>Edit Tracks</strong> and select exactly which tracks you want to change. AI-powered operations include custom instructions, intensity, simplification, added complexity, rhythmic changes, motif development and harmonic variation. Unselected tracks remain unchanged.</p>
                    <p>Some operations are <strong>local</strong> and do not use AI or Pollen: octave transposition, quantization, velocity adjustments and note-length changes. The interface identifies which type of operation you selected. Edited versions are kept in the history so you can compare or restore them.</p>
                    <p>You can also load a saved composition JSON or, when the arrangement has 1–4 tracks, use <strong>Add a complementary track</strong> to generate one new layer without editing the existing tracks. The editing fields have their own scroll area.</p>
                `,
                elementId: 'variations-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '⬆️',
                title: '8. Import MIDI and create companion tracks',
                content: `
                    <p>Choose <strong>Import MIDI</strong> to load an existing MIDI file. Review the detected tracks, musical settings and suggested track roles. Automatic classification is a starting point, so correct any role that does not match your source material.</p>
                    <p>Choose the imported tracks you want to work with and generate companion parts that use the source MIDI as their musical reference. Listen to the combined arrangement and adjust the result where needed.</p>
                    <p>The import controls have a dedicated scroll area to keep the workflow manageable when a file contains several tracks.</p>
                `,
                elementId: 'import-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎤',
                title: '9. Build a song idea with Suno',
                content: `
                    <p>Open <strong>Suno Prompt</strong> to prepare a title, style description, tags and optional lyrics using the current MIDI composition and/or an uploaded audio sample. Review and edit the generated text before copying it into Suno.</p>
                    <p>For an audio-based workflow, export your mix as <strong>WAV</strong> from Playback &amp; Export, upload that file to Suno as an audio reference, and use it as inspiration for a fuller song. Suno creates the finished song on its own platform; this Studio prepares the musical reference and prompt.</p>
                    <p>The generated result in Suno may develop or change the source material rather than reproduce it exactly.</p>
                `
            },
            {
                icon: '🎧',
                title: 'You are ready to create',
                content: `
                    <p>Start with a short musical idea, generate an arrangement, audition the individual parts and refine only the tracks that need attention. Import MIDI when you want to develop material you already have.</p>
                    <p>Try the <strong>Free MIDI Demo Library</strong> to explore complete examples: load a demo, preview its tracks and download it without connecting Pollinations or spending Pollen. AI-powered actions still require your own Pollinations connection.</p>
                    <p style="margin-top:1.25rem;"><span style="color:var(--accent); font-weight:600;">Experiment, compare versions and export the material you want to take into your DAW or use as a starting point in Suno.</span></p>
                `
            }
        ];
    }
    bindEventListeners() {
        this.closeBtn.addEventListener('click', () => this.hideTutorial());
        this.prevBtn.addEventListener('click', () => this.prevStep());
        this.nextBtn.addEventListener('click', () => this.nextStep());
        this.skipBtn.addEventListener('click', () => this.skipTutorial());

        window.addEventListener('click', (event) => {
            if (event.target === this.modal) this.hideTutorial();
        });

        document.addEventListener('keydown', (e) => {
            if (this.modal.classList.contains('active')) {
                if (e.key === 'ArrowRight' && !this.nextBtn.disabled) this.nextStep();
                else if (e.key === 'ArrowLeft' && !this.prevBtn.disabled) this.prevStep();
                else if (e.key === 'Escape') this.hideTutorial();
            }
        });
    }

    showTutorial() {
        this.modal.classList.add('active');
        document.body.classList.add('no-scroll');
        this.currentStepIndex = 0;
        this.renderStep(this.currentStepIndex);
    }

    hideTutorial() {
        this.modal.classList.remove('active');
        document.body.classList.remove('no-scroll');
        this.removeHighlight();
        localStorage.setItem('tutorialCompleted', 'true');
    }

    skipTutorial() { this.hideTutorial(); }

    nextStep() {
        if (this.currentStepIndex < this.steps.length - 1) {
            this.currentStepIndex++;
            this.renderStep(this.currentStepIndex);
        } else {
            this.hideTutorial();
        }
    }

    prevStep() {
        if (this.currentStepIndex > 0) {
            this.currentStepIndex--;
            this.renderStep(this.currentStepIndex);
        }
    }

    renderStep(index) {
        const step = this.steps[index];
        const total = this.steps.length;

        this.bodyEl.style.opacity = '0';
        this.bodyEl.style.transform = 'translateY(6px)';

        setTimeout(() => {
            this.iconEl.textContent = step.icon || '';
            this.titleEl.innerHTML = step.title;
            this.bodyEl.innerHTML = step.content;
            this.bodyEl.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            this.bodyEl.style.opacity = '1';
            this.bodyEl.style.transform = 'translateY(0)';
        }, 120);

        this.progressFill.style.width = `${((index + 1) / total) * 100}%`;
        this.progressEl.textContent = `${index + 1} / ${total}`;

        this.prevBtn.disabled = index === 0;
        this.nextBtn.textContent = index === total - 1 ? '\u2713 Finish' : 'Next \u2192';

        this.removeHighlight();
        if (step.elementId) this.highlightElement(step.elementId, step.highlightClass);
    }

    highlightElement(elementId, highlightClass) {
        const element = document.getElementById(elementId);
        if (element) {
            this.highlightedElement = element;
            this.originalHighlightBorder = element.style.border;
            element.classList.add(highlightClass);
        }
    }

    removeHighlight() {
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('tutorial-highlight');
            this.highlightedElement.style.border = this.originalHighlightBorder;
            this.highlightedElement = null;
            this.originalHighlightBorder = '';
        }
    }
}