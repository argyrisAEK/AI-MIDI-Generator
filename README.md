# AI MIDI Generator

> Describe a vibe. Get multitrack MIDI *in seconds* — no music theory required.

A free, browser-based AI tool that turns plain-language descriptions into studio-ready multitrack MIDI files. Built for bedroom producers, songwriters, game developers, and anyone who wants to move fast in the studio.

**Live:** [midi-aigenerator.vercel.app](https://midi-aigenerator.vercel.app)

---

## Features

- **Text-to-MIDI** — describe your track in plain language and get a full multitrack arrangement
- **Multitrack output** — up to 5 simultaneous instruments, each with its own harmonically coherent part
- **Piano Roll Visualizer** — real-time animated playback with color-coded tracks
- **Track Editing** — tweak individual tracks (intensity, rhythm, complexity, transposition) without regenerating the full composition
- **Export options** — single multitrack `.mid` file or separate stems as `.zip`, with native Save As dialog on Chrome/Edge
- **Playback engine** — built on Tone.js with loop and single-play modes
- **JSON-based variations** — paste previously generated JSON to reload and re-edit any past composition
- **4 free generations/month** — no sign-up required; connect a free Pollinations account for unlimited generations

---

## Tech Stack

| Layer | Technology |
|---|---|
| Audio engine | [Tone.js](https://tonejs.github.io/) 14.7 |
| MIDI parsing | [@tonejs/midi](https://github.com/Tonejs/Midi) |
| AI generation | [Pollinations.ai](https://pollinations.ai) API |
| ZIP export | [JSZip](https://stuk.github.io/jszip/) |
| Fonts | Plus Jakarta Sans, Inter, JetBrains Mono |
| Hosting | Vercel |

No build step. No bundler. Pure ES modules with an import map.

---
## Getting Started

No installation required. Open `index.html` in a browser or serve locally:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

> **Note:** Requires a browser with ES module import map support (Chrome 89+, Edge 89+, Safari 16.4+, Firefox 108+).

---

## How It Works

1. **Describe** your track in the text field or use the **Customize** form to set genre, key, BPM, and instruments
2. Hit **Build My Track** — the prompt is analyzed and sent to the Pollinations AI API
3. The API returns a structured JSON composition with note sequences per instrument
4. Notes are converted to MIDI data and loaded into the piano roll visualizer
5. Press **Play** to preview, then **Export MIDI** to save — directly to your DAW project folder on Chrome/Edge

---

## Generations & API Key

Every visitor gets **4 free generations per month** — no account needed.

For unlimited generations, connect a free [Pollinations](https://enter.pollinations.ai) account via the **Bring Your Own Pollen** button in the header. Your key is stored only in your browser's localStorage — nothing is sent to any server.

---

## Track Editing

After generating a composition, switch to the **Edit Tracks** tab to refine individual parts:

- Select one or more instruments
- Choose an edit type: increase/decrease intensity, simplify, add complexity, change rhythmic feel, transpose up/down, or write custom instructions
- Hit **Apply to Selected Tracks** — the AI regenerates only the selected parts while keeping the rest intact
- Each result is saved as a new version; load or delete at any time
- Paste previously generated Raw JSON to reload any past composition

---

## Export

- **Single Multitrack MIDI** — all instruments on separate tracks in one `.mid` file, ready for any DAW
- **Separate Files (.zip)** — individual `.mid` per instrument, numbered (`01_Bassline.mid`, `02_Arpeggio.mid`...) for correct DAW import order, plus the combined multitrack

On Chrome/Edge, both options use the **File System Access API** to open a native Save As dialog — save directly to your DAW project folder. Firefox/Safari fall back to standard browser download.

---

## MIDI Pack

**Chromatic Currents — Vol. 1**
20 master-crafted multitrack compositions for Melodic House & Dark Techno.
Available on [Ko-fi](https://ko-fi.com/s/7dcb2e5f18).

---

## License

MIT — free to use, modify, and distribute.

---

Built with ⚡ by [Argyris Koutras](https://github.com/argyrisAEK) · AI powered by [Pollinations.ai](https://pollinations.ai)
