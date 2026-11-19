# AI MIDI Generator

**From a musical idea to editable, multitrack MIDI.**

AI MIDI Generator is a browser-based music production tool that helps turn musical descriptions and creative direction into editable MIDI arrangements. Generate musical parts, preview and refine them, import existing MIDI, and export material for your DAW.

- **Website:** https://midi-aigenerator.vercel.app/
- **Studio:** https://midi-aigenerator.vercel.app/studio/
- **Techno MIDI Generator:** https://midi-aigenerator.vercel.app/techno/
- **Repository:** https://github.com/argyrisAEK/AI-MIDI-Generator

---

## What you can do

### Generate multitrack MIDI

Start with a natural-language description or use the Studio's musical controls to define the direction of an idea. Work with parameters such as tempo, key, scale, mood, rhythmic feel and arrangement structure.

The generator focuses on musical parts such as:

- Basslines
- Chords and harmonic layers
- Melodies and lead lines
- Arpeggios and plucks
- Keys, guitar, strings and pad textures

The result is editable MIDI material—not a rendered audio track—so you can continue composing and arranging inside your preferred DAW.

### Choose your AI model

The Studio separates model choices into **Standard** and **Pro** tiers. You can select the specific model you want to use from the available list. Pro models may have different Pollen costs.

Model availability and pricing can change. The live Studio and Pollinations model catalogue are the authoritative references.

### Edit and develop arrangements

Use the Studio to preview generated material and refine individual tracks. You can also import an existing MIDI file and use it as the basis for further work, including developing companion parts.

### Export for your DAW

Export MIDI arrangements for use in compatible music production software. The Studio also includes WAV audition/export tools; consult the live interface for current options and limitations.

### Explore Suno prompts

The Studio includes a Suno Prompt workflow for developing more detailed music-generation prompts, including musical style, arrangement direction and lyrics. It is a prompt-authoring tool, separate from MIDI generation.

---

## Getting started

1. Open the [AI MIDI Generator Studio](https://midi-aigenerator.vercel.app/studio/).
2. Connect your Pollinations account using **Bring Your Own Pollen (BYOP)**.
3. Review and authorize the spending budget for your Pollinations account.
4. Choose Standard or Pro and select an available model.
5. Describe your musical idea or configure the musical parameters.
6. Generate, preview and refine the MIDI, then export it to your DAW.

### Generation costs and Pollinations Pay

The Studio is free to access, but **AI generations do not include built-in free credits**. Generation requests use your own Pollinations Pollen through Pollinations Pay. You authorize a budget when connecting your account, and the amount consumed depends on the model and request.

Review the current model pricing and your Pollinations usage before generating. A client-side timeout does not necessarily mean that upstream processing stopped or that no usage was recorded.

- [Pollinations](https://pollinations.ai/)
- [Pollinations account and Pollen](https://enter.pollinations.ai/)
- [Pollinations API documentation](https://gen.pollinations.ai/docs)

---

## Technology

The application is built as a browser-based web app with JavaScript modules and serverless API routes.

Key technologies and services include:

- [Tone.js](https://tonejs.github.io/) for audio and playback functionality
- [@tonejs/midi](https://github.com/Tonejs/Midi) for MIDI data workflows
- [Pollinations](https://pollinations.ai/) for AI model access
- [Vercel](https://vercel.com/) for hosting and serverless API routes

The Studio is designed to complement a DAW, not replace a complete production environment.

---

## Project structure

- `index.html` — public landing page
- `studio/` — MIDI Generator Studio interface
- `js/` — frontend application modules and workflows
- `api/` — serverless API routes
- `techno/` — dedicated Techno MIDI Generator experience

For implementation and API details, see the source files and [API documentation](https://midi-aigenerator.vercel.app/api-docs.html).

---

## Creator

Created by [Argyris Koutras](https://github.com/argyrisAEK).

AI model access is provided through [Pollinations](https://pollinations.ai/).

---

## Copyright and license

Copyright © 2026 Argyris Koutras. All rights reserved.

This repository is publicly visible for reference, but **it is not open-source software and is not released under the MIT License**.

No permission is granted to copy, modify, redistribute, publish, sublicense, sell, commercially exploit, or create derivative works from this software or substantial portions of its source code without prior written permission from the copyright holder.

The name, branding, graphics and other project assets are also reserved and may not be used to imply endorsement, affiliation or ownership.

Third-party libraries, services and assets remain subject to their respective licenses and terms. This notice does not claim ownership of third-party materials.

For permission or licensing enquiries, contact the copyright holder through the [GitHub profile](https://github.com/argyrisAEK).
