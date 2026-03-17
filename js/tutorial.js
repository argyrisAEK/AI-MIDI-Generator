export class TutorialManager {
    constructor(app) {
        this.app = app;
        this.modal = document.getElementById('tutorial-modal');
        this.titleEl = document.getElementById('tutorial-title');
        this.bodyEl = document.getElementById('tutorial-body');
        this.progressEl = document.getElementById('tutorial-progress');
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
                title: "Welcome to AI MIDI Generator!",
                content: `
                    <p>This interactive tool helps you compose unique MIDI melodies and multi-track arrangements using Artificial Intelligence.</p>
                    <p>Let's take a quick tour to show you how to get started.</p>
                `
            },
            {
                title: "1. Describe Your Music",
                content: `
                    <p>Use the <strong>Describe</strong> tab to write what you want in plain language.</p>
                    <p>Be as detailed as you like — mention genre, mood, instruments, tempo, key, and structure.</p>
                    <p><em>Example: "An uplifting Deep House track at 124 BPM in A major, featuring a groovy bassline, warm electric piano chords, and a catchy lead synth melody."</em></p>
                `,
                elementId: 'text-panel',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "2. Customize with the Form",
                content: `
                    <p>Switch to the <strong>Customize</strong> tab to fine-tune your composition using dropdowns and checkboxes.</p>
                    <p>Choose up to 5 track instruments, set the key, BPM, time signature, mood, rhythmic complexity, and song structure.</p>
                `,
                elementId: 'form-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "3. Get Inspired with Examples",
                content: `
                    <p>The <strong>Examples</strong> tab offers ready-made prompts across a variety of genres — from Deep House and Trap to Cinematic and Ambient.</p>
                    <p>Click any example to instantly populate the Describe field with a creative starting point.</p>
                `,
                elementId: 'examples-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "4. Generate Your MIDI",
                content: `
                    <p>Once your prompt or form is ready, hit the <strong>Generate MIDI</strong> button.</p>
                    <p>The AI will create a multi-track MIDI composition based on your input. Generation typically takes a few seconds.</p>
                `,
                elementId: 'generate',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "5. Play, Visualize & Download",
                content: `
                    <p>After generation, use the <strong>Play</strong> button to listen to your composition and watch the notes animate in the <strong>Visualization</strong> area.</p>
                    <p>You can mute or solo individual tracks, switch playback mode between Loop and Play Once, and download your MIDI as a single multi-track file or as separate files in a ZIP.</p>
                `,
                elementId: 'play',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "6. Remix & Edit Your Tracks",
                content: `
                    <p>The <strong>Remix & Edit</strong> tab lets you refine your composition without starting over.</p>
                    <p>Select one or more tracks, choose an edit type — such as increasing intensity, simplifying, transposing, or writing custom instructions — and apply the edit. Each result is saved as a new version that you can load or delete.</p>
                `,
                elementId: 'variations-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "7. Free Generations & Bring Your Own Key",
                content: `
                    <p>Every visitor gets <strong>4 free MIDI generations per month</strong> — no sign-up required.</p>
                    <p>Once you reach the limit, you can connect a free Pollinations account for unlimited generations:</p>
                    <ul style="margin:10px 0;padding-left:20px;line-height:1.8;">
                        <li>Click <strong>Bring Your Own Pollen</strong> in the header.</li>
                        <li>You'll be redirected to Pollinations to authorize — then brought back automatically with your key saved.</li>
                    </ul>
                    <p>Your key is stored <strong>only in your browser</strong> and is never sent to our servers.</p>
                    <p style="margin-top:10px;font-size:.85em;color:#94a3b8;">The free quota resets every 30 days.</p>
                `,
                elementId: 'byop-header-btn',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "8. You're All Set!",
                content: `
                    <p>You now know everything you need to start creating with the AI MIDI Generator.</p>
                    <p>Experiment freely with different prompts, track combinations, and edits.</p>
                    <p>Happy composing! 🎵</p>
                `
            }
        ];
    }

    bindEventListeners() {
        this.closeBtn.addEventListener('click', () => this.hideTutorial());
        this.prevBtn.addEventListener('click', () => this.prevStep());
        this.nextBtn.addEventListener('click', () => this.nextStep());
        this.skipBtn.addEventListener('click', () => this.skipTutorial());

        // Close modal if user clicks outside of modal content
        window.addEventListener('click', (event) => {
            if (event.target === this.modal) {
                this.hideTutorial();
            }
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (this.modal.classList.contains('active')) {
                if (e.key === 'ArrowRight' && !this.nextBtn.disabled) {
                    this.nextStep();
                } else if (e.key === 'ArrowLeft' && !this.prevBtn.disabled) {
                    this.prevStep();
                } else if (e.key === 'Escape') {
                    this.hideTutorial();
                }
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

    skipTutorial() {
        this.hideTutorial();
    }

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
        this.titleEl.innerHTML = step.title;
        this.bodyEl.innerHTML = step.content;
        this.progressEl.textContent = `Step ${index + 1} of ${this.steps.length}`;

        this.prevBtn.disabled = index === 0;
        this.nextBtn.textContent = index === this.steps.length - 1 ? 'Finish' : 'Next →';

        this.removeHighlight();

        if (step.elementId) {
            this.highlightElement(step.elementId, step.highlightClass);
        }
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
