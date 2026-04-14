// Pro Demo compositions — generated with midijourney-large
const PRO_DEMOS = [
    {
        id: 'veiled-horizons',
        title: 'Veiled Horizons',
        genre: 'Ambient',
        bpm: 65,
        key: 'F Major',
        tracks: ['arpeggio', 'strings', 'plucks', 'pad-textures'],
        desc: 'Peaceful ambient textures with evolving pads, gentle arpeggios, and delicate plucks.',
        json: {
            title: 'Veiled Horizons',
            desc: 'Peaceful ambient textures in F major with evolving pads, gentle arpeggios, and delicate plucks',
            bpm: 65,
            tracks: {
                arpeggio: '65:1.0:0.25:4|69:1.5:0.25:5|72:2.0:0.25:4|76:2.5:0.25:5|72:3.0:0.25:4|69:3.5:0.25:5|65:4.25:0.25:4|69:4.75:0.25:5|72:5.25:0.25:4|76:5.75:0.25:5|72:6.25:0.25:4|69:6.75:0.25:5|65:9.0:0.25:4|69:9.5:0.25:5|72:10.0:0.25:4|77:10.5:0.25:6|72:11.0:0.25:4|69:11.5:0.25:5|65:12.25:0.25:4|69:12.75:0.25:5|72:13.25:0.25:4|77:13.75:0.25:5|72:14.25:0.25:4|69:14.75:0.25:5|67:17.0:0.25:5|71:17.5:0.25:4|74:18.0:0.25:5|79:18.5:0.25:6|74:19.0:0.25:5|71:19.5:0.25:4|67:20.25:0.25:5|71:20.75:0.25:4|74:21.25:0.25:5|79:21.75:0.25:6|74:22.25:0.25:5|71:22.75:0.25:4|65:25.0:0.25:5|69:25.5:0.25:4|72:26.0:0.25:5|76:26.5:0.25:6|72:27.0:0.25:5|69:27.5:0.25:4|65:28.25:0.25:5|69:28.75:0.25:4|72:29.25:0.25:5|76:29.75:0.25:6|72:30.25:0.25:4|69:30.75:0.25:4',
                strings: '60:0.0:4.0:3|65:0.0:4.0:2|69:0.0:4.0:3|60:4.0:4.0:3|64:4.0:4.0:2|69:4.0:4.0:3|60:8.0:4.0:3|65:8.0:4.0:3|69:8.0:4.0:2|60:12.0:4.0:3|64:12.0:4.0:2|69:12.0:4.0:3|62:16.0:4.0:4|65:16.0:4.0:3|69:16.0:4.0:3|60:20.0:4.0:4|64:20.0:4.0:3|67:20.0:4.0:3|60:24.0:4.0:4|65:24.0:4.0:3|69:24.0:4.0:3|60:28.0:3.5:5|65:28.0:3.5:4|69:28.0:3.5:4',
                plucks: '72:1.75:0.25:6|77:3.25:0.25:5|72:5.75:0.25:6|69:7.25:0.25:5|72:9.75:0.25:7|77:11.25:0.25:5|72:13.75:0.25:6|69:15.5:0.25:5|74:17.75:0.25:7|79:19.25:0.25:6|74:21.75:0.25:7|71:23.25:0.25:6|72:25.75:0.25:7|76:27.25:0.25:6|72:29.5:0.25:8|69:30.5:0.25:7',
                'pad-textures': '53:0.0:8.0:3|57:0.0:8.0:2|48:0.0:8.0:3|53:8.0:8.0:3|57:8.0:8.0:3|48:8.0:8.0:2|50:16.0:4.0:3|55:16.0:4.0:3|45:16.0:4.0:3|48:20.0:4.0:3|52:20.0:4.0:3|45:20.0:4.0:2|53:24.0:7.5:4|57:24.0:7.5:3|48:24.0:7.5:3'
            }
        }
    }
    // More demos will be added here
];

const GENRE_COLORS = {
    'Ambient':    '#00B8D4',
    'Techno':     '#FF1744',
    'House':      '#54B76E',
    'Trance':     '#AA00FF',
    'Cinematic':  '#FF9100',
    'Hip-Hop':    '#FFD600',
    'Synthwave':  '#F50057',
    'Jazz':       '#FFAB91',
};

export class ProDemosManager {
    constructor(app) {
        this.app = app;
        this.modal   = document.getElementById('pro-demos-modal');
        this.listEl  = document.getElementById('pro-demos-list');
        this.closeBtn = document.getElementById('close-pro-demos');
        this.openBtn  = document.getElementById('show-pro-demos');

        this._bindEvents();
        this._renderList();
    }

    _bindEvents() {
        this.openBtn?.addEventListener('click', () => this.show());
        this.closeBtn?.addEventListener('click', () => this.hide());
        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hide();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal?.classList.contains('active')) this.hide();
        });
    }

    _renderList() {
        if (!this.listEl) return;
        this.listEl.innerHTML = '';

        PRO_DEMOS.forEach(demo => {
            const color = GENRE_COLORS[demo.genre] || '#54B76E';
            const trackBadges = demo.tracks
                .map(t => `<span class="demo-track-badge">${t}</span>`)
                .join('');

            const card = document.createElement('div');
            card.className = 'demo-card';
            card.innerHTML = `
                <div class="demo-card-left">
                    <div class="demo-genre-dot" style="background:${color}; box-shadow:0 0 8px ${color}66;"></div>
                    <div class="demo-card-info">
                        <span class="demo-card-title">${demo.title}</span>
                        <span class="demo-card-meta">${demo.genre} · ${demo.bpm} BPM · ${demo.key}</span>
                        <p class="demo-card-desc">${demo.desc}</p>
                        <div class="demo-tracks-row">${trackBadges}</div>
                    </div>
                </div>
                <button class="demo-load-btn" data-id="${demo.id}" aria-label="Load ${demo.title}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Load
                </button>
            `;

            card.querySelector('.demo-load-btn').addEventListener('click', () => {
                this._loadDemo(demo);
            });

            this.listEl.appendChild(card);
        });
    }

    async _loadDemo(demo) {
        const btn = this.listEl.querySelector(`[data-id="${demo.id}"]`);
        if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }

        try {
            // Apply BPM
            const bpmEl = document.getElementById('bpm');
            if (bpmEl && demo.bpm) bpmEl.value = demo.bpm;

            // Use json-variations loadJsonIntoPreview pathway
            const jv = this.app.jsonVariations;
            if (jv) {
                jv.sourceJson = JSON.stringify(demo.json);

                // Switch to Edit Tracks tab so user can see/interact
                this.app.switchMode('variations');
                const varTab = document.getElementById('variations-tab');
                if (varTab) varTab.click();

                // Load into preview
                await jv.loadJsonIntoPreview();
            }

            this.hide();
            this.app.ui?.showToast(`"${demo.title}" loaded — hit Play to preview.`, 'success');

        } catch (err) {
            console.error('[ProDemos] Load failed:', err);
            this.app.ui?.showMessage(`Failed to load demo: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Load'; btn.disabled = false; }
        }
    }

    show() {
        this.modal?.classList.add('active');
        document.body.classList.add('no-scroll');
    }

    hide() {
        this.modal?.classList.remove('active');
        document.body.classList.remove('no-scroll');
    }
}
