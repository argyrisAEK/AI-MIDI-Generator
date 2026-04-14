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
                    <p>Turn a text description into a full <strong>multitrack MIDI arrangement</strong> — in under 30 seconds. Every instrument is harmonically locked to your key and scale.</p>
                    <p>Drop the result straight into <strong>Ableton, FL Studio, Logic</strong>, or any DAW. No templates. No compromises.</p>
                    <p style="margin-top:1rem; color: var(--accent); font-weight:600;">Let's walk through it.</p>
                `
            },
            {
                icon: '🎤',
                title: "1. Describe the Vibe",
                content: `
                    <p>Type what you hear — genre, mood, BPM, key, structure. The more specific, the better the output.</p>
                    <em style="color:var(--text-gray-300); display:block; margin: 0.75rem 0; padding: 0.75rem 1rem; background: rgba(84,183,110,0.06); border-left: 3px solid var(--accent); border-radius: 0.25rem;">"Dark Techno drop at 132 BPM in F minor — pounding sub, hypnotic plucks, industrial lead, 8 bars."</em>
                    <p>The AI builds every track around your intent — harmonically consistent, rhythmically complementary.</p>
                `,
                elementId: 'text-panel',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎛️',
                title: "2. Dial In the Details",
                content: `
                    <p>Switch to <strong>Customize</strong> for full control: key, BPM, scale (including Dorian, Phrygian, Aeolian), time signature, mood, and complexity.</p>
                    <p>Choose up to <strong>5 instruments</strong> — Bassline, Lead, Pads, Arpeggios, Strings, Brass, and more. Each gets its own harmonically coherent MIDI part.</p>
                `,
                elementId: 'form-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '💡',
                title: "3. Start from an Example",
                content: `
                    <p>Hit <strong>Examples</strong> for genre-ready prompts — Deep House, Trap, Cinematic, Synthwave, and more.</p>
                    <p>Click any to load it, then make it yours. Great for breaking creative blocks or exploring new sounds.</p>
                `,
                elementId: 'examples-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🚀',
                title: "4. Build the Track",
                content: `
                    <p>Hit <strong>Build My Track</strong>. The AI generates a loopable, multitrack arrangement in under 30 seconds — every instrument staggered, voiced, and dynamically humanized.</p>
                    <p style="margin-top:0.75rem; font-size:0.85em; color:var(--text-gray-400);">Pro users can choose between <strong>Standard</strong>, <strong>Pro (midijourney-large)</strong>, or <strong>Claude Sonnet</strong> for higher-quality output.</p>
                `,
                elementId: 'generate',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎹',
                title: "5. Preview & Export",
                content: `
                    <p>Watch the <strong>Piano Roll</strong> animate in real time. Switch between tracks, toggle Loop or Play Once.</p>
                    <p>Export as a <strong>single multitrack MIDI</strong> or <strong>separate stems (.zip)</strong> — numbered for correct DAW import order. On Chrome/Edge, a Save As dialog lets you export directly to your project folder.</p>
                `,
                elementId: 'play',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '✏️',
                title: "6. Tweak Individual Tracks",
                content: `
                    <p><strong>Edit Tracks</strong> lets you refine any instrument without touching the rest. Increase intensity, simplify a part, transpose an octave, or write custom AI instructions.</p>
                    <p>Every edit creates a new <strong>versioned snapshot</strong> — load or delete any version at any time.</p>
                    <p style="margin-top:0.75rem; font-size:0.85em; color:var(--text-gray-400);">Paste a previously generated JSON to reload and re-edit any past composition.</p>
                `,
                elementId: 'variations-tab',
                highlightClass: 'tutorial-highlight'
            },
            {
                icon: '🎧',
                title: "7. Export as Audio (WAV)",
                content: `
                    <p>Go beyond MIDI — export directly as <strong>AI-synthesized audio</strong>.</p>
                    <p><strong>Active Track WAV</strong>: The AI designs a custom synth patch for that instrument based on genre and MIDI data — then renders it offline.</p>
                    <p><strong>Full Mix WAV</strong>: All tracks rendered together with AI-designed patches, gain staging, stereo panning, and — for House, Techno, and Trance — <strong>sidechain ducking</strong> baked in, ready for your kicks.</p>
                    <p style="margin-top:0.75rem; font-size:0.85em; color:var(--text-gray-400);">After export, a <strong>DAW Setup Guide</strong> appears showing all synth settings so you can recreate the sound manually.</p>
                `
            },
            {
                icon: '∞',
                title: "8. Unlimited Generations",
                content: `
                    <p>You get <strong>4 free generations per month</strong> — no account needed.</p>
                    <p>For unlimited, connect a free <a href="https://enter.pollinations.ai" target="_blank" style="color:var(--accent); text-decoration:none; border-bottom:1px dotted var(--accent);">Pollinations account</a>:</p>
                    <ol style="margin:0.75rem 0; padding-left:1.25rem; line-height:2; color:var(--text-gray-300);">
                        <li>Click <strong>Bring Your Own Pollen</strong> in the header</li>
                        <li>Authorize via Pollinations — redirected back automatically</li>
                        <li>Unlock <strong>Pro AI models</strong> for higher-quality output</li>
                    </ol>
                    <p style="font-size:0.82em; color:var(--text-gray-500);">Your key stays in your browser only. Nothing stored on our servers.</p>
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
