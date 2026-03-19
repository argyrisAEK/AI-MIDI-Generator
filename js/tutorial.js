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
                title: "Your AI Production Partner",
                content: `
                    <p>Describe a sound, pick your instruments, and get a full multitrack MIDI arrangement — ready to drop into any DAW.</p>
                    <p>No music theory. No templates. Just your idea, turned into something you can actually use.</p>
                    <p>Let's walk through it in 60 seconds.</p>
                `
            },
            {
                title: "1. Describe the Vibe",
                content: `
                    <p>Type what you hear in your head — genre, mood, tempo, key, structure. The more specific, the better the output.</p>
                    <p><em>"Dark Techno drop at 132 BPM in F minor — pounding sub, hypnotic plucks, industrial lead, 8 bars."</em></p>
                    <p>The AI reads your intent and builds every track around it.</p>
                `,
                elementId: 'text-panel',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "2. Dial It In",
                content: `
                    <p>Prefer hands-on control? Switch to <strong>Customize</strong> and set everything manually — key, BPM, time signature, mood, complexity, structure.</p>
                    <p>Choose up to 5 instruments and the AI will generate a separate, harmonically coherent part for each one.</p>
                `,
                elementId: 'form-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "3. Need a Starting Point?",
                content: `
                    <p>Hit <strong>Examples</strong> for genre-ready prompts — Deep House, Trap, Cinematic, Synthwave and more.</p>
                    <p>Click any example to load it into the prompt, then tweak it to make it yours.</p>
                `,
                elementId: 'examples-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "4. Build the Track",
                content: `
                    <p>Hit <strong>Build My Track</strong> and let the AI go to work.</p>
                    <p>You'll get a full multitrack arrangement in under 30 seconds — every instrument in the same key, same tempo, same feel.</p>
                `,
                elementId: 'generate',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "5. Preview & Export",
                content: `
                    <p>Hit <strong>Play</strong> to hear the result and watch the piano roll animate in real time.</p>
                    <p>Switch between tracks, toggle Loop or Play Once, then hit <strong>Export MIDI</strong> — as a single multitrack file or separate tracks in a ZIP.</p>
                `,
                elementId: 'play',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "6. Tweak Without Starting Over",
                content: `
                    <p>Not quite there? <strong>Edit Tracks</strong> lets you refine individual parts while keeping the rest intact.</p>
                    <p>Increase intensity, simplify a part, transpose an octave, change the rhythmic feel — or write your own custom instruction. Every edit is saved as a new version.</p>
                `,
                elementId: 'variations-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "7. Free Tier & Unlimited Generations",
                content: `
                    <p>You get <strong>4 free generations per month</strong> — no account needed.</p>
                    <p>Want unlimited? Connect a free Pollinations account:</p>
                    <ul style="margin:10px 0;padding-left:20px;line-height:1.8;">
                        <li>Click <strong>Bring Your Own Pollen</strong> in the header.</li>
                        <li>Authorize via Pollinations — you'll be redirected back automatically with your key saved.</li>
                    </ul>
                    <p>Your key lives in your browser only. Nothing is stored on our servers.</p>
                    <p style="margin-top:10px;font-size:.85em;color:#94a3b8;">Quota resets every 30 days.</p>
                `,
                elementId: 'byop-header-btn',
                highlightClass: 'tutorial-highlight'
            },
            {
                title: "You're Ready. Make Something.",
                content: `
                    <p>That's everything. Now go build something worth playing.</p>
                    <p>Experiment with prompts, stack instruments, push the edits — the AI can keep up.</p>
                    <p style="margin-top: 1rem; color: var(--accent); font-weight: 600;">Start with the Examples tab if you need inspiration.</p>
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
