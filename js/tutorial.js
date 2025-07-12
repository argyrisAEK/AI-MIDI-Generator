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
                title: "1. Describe Your Music (Text Prompt)",
                content: `
                    <p>Use the <strong>Text Prompt</strong> tab to describe the music you want to create in plain language.</p>
                    <p>Be as detailed as you like! Mention genre, mood, instruments, tempo, key, and structure.</p>
                    <p><em>Example: "An uplifting Deep House track at 124 BPM in A major, featuring a groovy bassline, warm electric piano chords, and a catchy lead synth melody."</em></p>
                `,
                elementId: 'text-panel',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "2. Use the Form for Precision",
                content: `
                    <p>Switch to the <strong>Form</strong> tab to select specific musical properties using dropdowns and checkboxes.</p>
                    <p>This gives you more control over track types, key, tempo, and other musical elements.</p>
                    <p>Don't forget to select your desired <strong>Track Types</strong>!</p>
                `,
                elementId: 'form-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "3. Get Inspired with Examples",
                content: `
                    <p>The <strong>Examples</strong> tab provides ready-made prompts for various genres.</p>
                    <p>Click any example button to automatically populate the Text Prompt field, giving you a creative starting point.</p>
                `,
                elementId: 'examples-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "4. Generate Your MIDI",
                content: `
                    <p>Once you've set your prompt (text or form), click the <strong>Generate MIDI</strong> button.</p>
                    <p>The AI will process your request and create a multi-track MIDI composition.</p>
                `,
                elementId: 'generate',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "5. Play and Visualize Your Composition",
                content: `
                    <p>After generation, use the <strong>Play</strong> button to listen to your creation and see the notes animate in the <strong>Visualization</strong> area.</p>
                    <p>You can stop playback, switch between individual tracks, or download the MIDI file.</p>
                `,
                elementId: 'player-controls',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "6. Explore JSON Variations",
                content: `
                    <p>The <strong>JSON Variations</strong> tab allows you to create different structural sections (like Intro, Chorus, Bridge) based on a previously generated track.</p>
                    <p>Load a composition first, then select a variation type and duration to generate new versions.</p>
                `,
                elementId: 'variations-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "You're All Set!",
                content: `
                    <p>You now know the basics of using the AI MIDI Generator.</p>
                    <p>Feel free to experiment with different prompts and settings.</p>
                    <p>Happy composing!</p>
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
        document.body.classList.add('no-scroll'); // Prevent scrolling body
        this.currentStepIndex = 0;
        this.renderStep(this.currentStepIndex);
    }

    hideTutorial() {
        this.modal.classList.remove('active');
        document.body.classList.remove('no-scroll'); // Re-enable body scrolling
        this.removeHighlight();
        localStorage.setItem('tutorialCompleted', 'true'); // Mark tutorial as completed
    }

    skipTutorial() {
        this.hideTutorial();
    }

    nextStep() {
        if (this.currentStepIndex < this.steps.length - 1) {
            this.currentStepIndex++;
            this.renderStep(this.currentStepIndex);
        } else {
            this.hideTutorial(); // End of tutorial
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
        this.nextBtn.textContent = index === this.steps.length - 1 ? 'Finish' : 'Next';

        this.removeHighlight(); // Remove previous highlight

        if (step.elementId) {
            this.highlightElement(step.elementId, step.highlightClass);
        }
    }

    highlightElement(elementId, highlightClass) {
        const element = document.getElementById(elementId);
        if (element) {
            this.highlightedElement = element;
            // Store original border to restore it later
            this.originalHighlightBorder = element.style.border;
            element.classList.add(highlightClass);
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    removeHighlight() {
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('tutorial-highlight');
            this.highlightedElement.style.border = this.originalHighlightBorder; // Restore original border
            this.highlightedElement = null;
            this.originalHighlightBorder = '';
        }
    }
}