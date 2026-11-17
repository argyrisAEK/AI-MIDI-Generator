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
                    <p><strong>AI MIDI Generator</strong> turns a written music brief into an editable, multitrack MIDI arrangement. You can also import an existing MIDI file and generate complementary parts.</p>
                    <p>Preview the result, refine individual tracks, export MIDI files for your DAW, or prepare a Suno prompt from your musical material.</p>
                    <p style="margin-top:1rem; color:var(--accent); font-weight:600;">This guide covers the features currently available in the app.</p>
                `
            },
            {
                icon: '✍️',
                title: '1. Describe the music',
                content: `
                    <p>Open <strong>Describe</strong> and enter a prompt explaining the sound you want. Include details such as genre, mood, tempo, key, instruments, rhythmic feel and intended section.</p>
                    <em style="color:var(--text-gray-300); display:block; margin:0.75rem 0; padding:0.75rem 1rem; background:rgba(84,183,110,0.06); border-left:3px solid var(--accent); border-radius:0.25rem;">"Dark melodic techno, 132 BPM, F minor: a driving bassline, hypnotic arpeggio, atmospheric pads and a restrained lead. 8 bars."</em>
                    <p>Be specific about the musical roles of the instruments. The text prompt can contain up to 600 characters.</p>
                `,
                elementId: 'text-panel',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎛️',
                title: '2. Customize the arrangement',
                content: `
                    <p>Choose <strong>Customize</strong> to set the available musical parameters, including genre, key, scale, tempo, time signature, duration, mood and rhythmic complexity.</p>
                    <p>Select up to <strong>5 track types</strong> for the arrangement. Available choices include bassline, melody, pad/chords, arpeggio, strings, lead, plucks, keys/piano, brass, guitar, pad textures and percs.</p>
                    <p>Use the text prompt when you need to describe musical details that are not covered by the controls.</p>
                `,
                elementId: 'form-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '💡',
                title: '3. Start with Prompt Examples',
                content: `
                    <p>Open <strong>Prompt Examples</strong> to load a ready-made starting prompt for styles such as Deep House, Disco, Trap, Synthwave, Cinematic, Techno, Progressive Rock, Hip-Hop Soul, Ambient and Pop.</p>
                    <p>Select an example to copy it into the Describe field. You can edit the prompt before generating.</p>
                `,
                elementId: 'examples-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🤖',
                title: '4. Connect and choose an AI model',
                content: `
                    <p>A Pollinations connection through <strong>Bring Your Own Pollen</strong> is required for AI generation and the other AI-powered tools. The requests use your own Pollen balance and the budget you authorize with Pollinations.</p>
                    <p>After connecting, the model selector becomes available. <strong>Standard</strong> is the default option; Pro models may use more Pollen and some require purchased Pollen. Check the model label and your Pollinations balance before choosing a Pro model.</p>
                    <p>The BYOP authorization is held as a temporary browser session. If it expires or is cleared, connect again.</p>
                `,
                elementId: 'byop-header-btn',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🚀',
                title: '5. Generate your MIDI',
                content: `
                    <p>Return to <strong>Describe</strong> or <strong>Customize</strong> and press <strong>Build My Track</strong>. Generation time depends on the selected model and the request; it is not guaranteed to finish within a fixed number of seconds.</p>
                    <p>The result is loaded into the piano-roll preview. The app generates MIDI parts, not a finished audio production or a complete song arrangement.</p>
                `,
                elementId: 'generate',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎹',
                title: '6. Preview and export MIDI',
                content: `
                    <p>Use <strong>Play</strong> and <strong>Stop</strong> to audition the arrangement in the built-in piano-roll/player view.</p>
                    <p>Choose <strong>Export MIDI</strong> to save either one multitrack <code>.mid</code> file or a <code>.zip</code> containing individual track MIDI files. Import the files into Ableton, FL Studio, Logic or another DAW and assign your own instruments.</p>
                    <p>The browser's save experience depends on browser support; browsers without the native Save As interface use a regular download.</p>
                `,
                elementId: 'play',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '✏️',
                title: '7. Edit individual tracks',
                content: `
                    <p>Open <strong>Edit Tracks</strong> after generating or loading a composition. Select the track or tracks you want to change, then choose an edit such as increasing/decreasing intensity, simplifying, adding complexity, changing rhythmic feel, transposing an octave, or entering custom instructions.</p>
                    <p>Press <strong>Apply to Selected Tracks</strong> to request an AI edit. The app keeps versions of the results so you can switch between edits. You can also paste a previously saved composition JSON and load it into the preview.</p>
                    <p><strong>Export as Audio (BETA)</strong> is experimental. It offers WAV rendering options, but results can vary and should be checked before using them in a production.</p>
                `,
                elementId: 'variations-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '⬆️',
                title: '8. Import MIDI and create companion tracks',
                content: `
                    <p>Choose <strong>Import MIDI</strong> to load an existing MIDI file. The app analyzes its musical content and track information, then lets you work with the imported material and generate additional companion parts.</p>
                    <p>Review the detected track roles and musical settings before generating. Automatic track classification is an aid, so correct a role or setting when the detection does not match your source MIDI.</p>
                    <p>The imported MIDI is intended to act as the musical reference for the new parts; listen to the combined result and make any adjustments you need.</p>
                `,
                elementId: 'import-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎤',
                title: '9. Prepare a Suno prompt',
                content: `
                    <p><strong>Suno Prompt Studio</strong> can use the current MIDI composition and/or an uploaded audio file as musical source material to prepare a Suno-ready prompt.</p>
                    <p>It helps create prompt elements such as a title, style description, tags and lyrics. Review and edit the generated text before copying it into Suno.</p>
                    <p>This feature prepares creative instructions for Suno; it does not generate or export a finished Suno song from inside this application.</p>
                `
            },
            {
                icon: '🎧',
                title: 'You are ready to create',
                content: `
                    <p>Start with a short, clear musical idea. Generate the arrangement, listen to the parts, then refine only the tracks that need work.</p>
                    <p>For an existing MIDI project, try <strong>Import MIDI</strong>. To develop a song idea further with Suno, use <strong>Suno Prompt Studio</strong>.</p>
                    <p style="margin-top:1.25rem;"><span style="color:var(--accent); font-weight:600;">Experiment, compare versions and export the MIDI you want to take into your DAW.</span></p>
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