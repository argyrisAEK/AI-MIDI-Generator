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
                title: "Your AI Production Partner",
                content: `
                    <p>Describe a sound, pick your instruments, and get a full multitrack MIDI arrangement — ready to drop straight into your DAW.</p>
                    <p>No music theory. No templates. Just your idea, turned into something you can actually use.</p>
                    <p style="margin-top:1rem; color: var(--accent); font-weight:600;">Let's walk through it in 60 seconds.</p>
                `
            },
            {
                icon: '🎤',
                title: "1. Describe the Vibe",
                content: `
                    <p>Type what you hear in your head — genre, mood, tempo, key, structure. The more specific, the better.</p>
                    <p><em style="color:var(--text-gray-300); display:block; margin: 0.75rem 0; padding: 0.75rem 1rem; background: rgba(84,183,110,0.06); border-left: 3px solid var(--accent); border-radius: 0.25rem;">"Dark Techno drop at 132 BPM in F minor — pounding sub, hypnotic plucks, industrial lead, 8 bars."</em></p>
                    <p>The AI reads your intent and builds every track around it.</p>
                `,
                elementId: 'text-panel',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎛️',
                title: "2. Prefer Manual Control?",
                content: `
                    <p>Switch to <strong>Customize</strong> and set everything by hand — key, BPM, time signature, mood, complexity, structure.</p>
                    <p>Choose up to <strong>5 instruments</strong> and the AI generates a separate, harmonically coherent part for each one.</p>
                `,
                elementId: 'form-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '💡',
                title: "3. Need a Starting Point?",
                content: `
                    <p>Hit <strong>Examples</strong> for genre-ready prompts — Deep House, Trap, Cinematic, Synthwave and more.</p>
                    <p>Click any example to load it into the prompt, then make it yours.</p>
                `,
                elementId: 'examples-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🚀',
                title: "4. Build the Track",
                content: `
                    <p>Hit <strong>Build My Track</strong> and let the AI go to work.</p>
                    <p>You'll get a full multitrack arrangement in <strong>under 30 seconds</strong> — every instrument in the same key, same tempo, same feel.</p>
                `,
                elementId: 'generate',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎹',
                title: "5. Preview & Export",
                content: `
                    <p>Hit <strong>Play</strong> to hear the result and watch the piano roll animate in real time.</p>
                    <p>Switch between tracks, toggle <strong>Loop</strong> or <strong>Play Once</strong>, then export — as a single multitrack MIDI or separate stems in a ZIP.</p>
                    <p style="margin-top:0.75rem; font-size:0.85em; color:var(--text-gray-400);">On Chrome/Edge a Save As dialog lets you export directly into your DAW project folder.</p>
                `,
                elementId: 'play',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '✏️',
                title: "6. Tweak Without Starting Over",
                content: `
                    <p><strong>Edit Tracks</strong> lets you refine individual parts while keeping the rest intact.</p>
                    <p>Increase intensity, simplify a part, transpose an octave, change the feel — or write your own custom instruction.</p>
                    <p style="margin-top:0.75rem; font-size:0.85em; color:var(--text-gray-400);">Every edit is saved as a new version. You can load any version back at any time.</p>
                `,
                elementId: 'variations-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '∞',
                title: "7. Unlimited Generations",
                content: `
                    <p>You get <strong>4 free generations per month</strong> — no account needed.</p>
                    <p>For unlimited, connect a free Pollinations account:</p>
                    <ol style="margin:0.75rem 0; padding-left:1.25rem; line-height:2; color:var(--text-gray-300);">
                        <li>Click <strong>Bring Your Own Pollen</strong> in the header</li>
                        <li>Authorize via Pollinations — redirected back automatically</li>
                        <li>Your key lives in your browser only. Nothing stored on our servers.</li>
                    </ol>
                `,
                elementId: 'byop-header-btn',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎧',
                title: "You're Ready. Make Something.",
                content: `
                    <p>That's everything. Now go build something worth playing.</p>
                    <p>Experiment with prompts, stack instruments, push the edits — the AI can keep up.</p>
                    <p style="margin-top: 1.25rem;">
                        <span style="color: var(--accent); font-weight: 600;">Start with the Examples tab if you need inspiration →</span>
                    </p>
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

        // Animate body
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

        // Progress bar
        this.progressFill.style.width = `${((index + 1) / total) * 100}%`;
        this.progressEl.textContent = `${index + 1} / ${total}`;

        // Buttons
        this.prevBtn.disabled = index === 0;
        this.nextBtn.textContent = index === total - 1 ? '✓ Finish' : 'Next →';

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
