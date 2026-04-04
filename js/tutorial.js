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
            title: "Professional AI MIDI Generation",
            content: `
                <p>Welcome to a high-performance <strong>Generative AI MIDI engine</strong>. Convert your musical intent into structured, multitrack MIDI arrangements ready for professional production.</p>
                <p>No generic templates. Just pure <strong>Text-to-MIDI</strong> technology that respects music theory and your creative vision.</p>
                <p style="margin-top:1rem; color: var(--accent); font-weight:600;">Optimized for DAW-ready workflows.</p>
            `
        },
        {
            icon: '🎤',
            title: "1. AI Prompting & Intent",
            content: `
                <p>Describe your vibe using natural language. Specify genre, mood, tempo, and key. Our LLM-powered <strong>Prompt Builder</strong> translates these into precise MIDI data.</p>
                <p><em style="color:var(--text-gray-300); display:block; margin: 0.75rem 0; padding: 0.75rem 1rem; background: rgba(84,183,110,0.06); border-left: 3px solid var(--accent); border-radius: 0.25rem;">"Deep House at 124 BPM in G minor — syncopated bass, ethereal pads, and melodic plucks."</em></p>
                <p>The engine handles complex <strong>harmonic consistency</strong> across all tracks automatically.</p>
            `,
            elementId: 'text-panel',
            highlightClass: 'tutorial-highlight'
        },
        {
            icon: '🎛️',
            title: "2. Precision Music Theory",
            content: `
                <p>Switch to <strong>Customize</strong> to enforce strict music theory constraints. Set specific scales (Aeolian, Phrygian, Dorian), BPM, and time signatures.</p>
                <p>Generate up to <strong>5 harmonically synchronized tracks</strong> including Basslines, Leads, and Textures, all locked to your chosen scale.</p>
            `,
            elementId: 'form-tab',
            highlightClass: 'tutorial-highlight'
        },
        {
            icon: '🚀',
            title: "3. Edge-Computed Generation",
            content: `
                <p>Hit <strong>Build My Track</strong> to trigger our <strong>Vercel Edge-powered</strong> generation engine.</p>
                <p>Receive a full, loopable arrangement in seconds. Each track is intelligently staggered to ensure a clean mix and avoid rhythmic clutter.</p>
            `,
            elementId: 'generate',
            highlightClass: 'tutorial-highlight'
        },
        {
            icon: '🎹',
            title: "4. Humanized Export",
            content: `
                <p>Preview with our real-time <strong>Piano Roll</strong>. Every note features <strong>Humanized Velocity</strong> — emphasizing downbeats (8-9) and ghost notes (4-6) for a natural groove.</p>
                <p>Export as multitrack MIDI or ZIP stems. Seamlessly drag-and-drop into <strong>Ableton, FL Studio, or Logic Pro</strong>.</p>
            `,
            elementId: 'play',
            highlightClass: 'tutorial-highlight'
        },
        {
            icon: '✏️',
            title: "5. Iterative AI Editing",
            content: `
                <p>Refine your creation with <strong>Track Variations</strong>. Modify intensity, transpose octaves, or apply custom AI instructions to specific tracks without losing your foundation.</p>
                <p style="margin-top:0.75rem; font-size:0.85em; color:var(--text-gray-400);">Perfect for rapid prototyping and breaking creative blocks.</p>
            `,
            elementId: 'variations-tab',
            highlightClass: 'tutorial-highlight'
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
