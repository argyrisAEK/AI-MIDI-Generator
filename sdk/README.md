# AI MIDI Generator developer SDKs

The API can be called from web, desktop, mobile, server and plugin projects over HTTPS. These small examples reduce repetitive request code; they do not replace platform-specific MIDI handling.

## Available examples

- [JavaScript client](javascript/index.js) — dependency-free, Node.js 18+ and modern browsers.
- [Python client](python/ai_midi_generator.py) — dependency-free, Python 3.9+.
- [MIDI notation format](../docs/midi-notation-format.md) — note fields and timing conversion.
- [DAW plugin integration](../docs/plugin-integration.md) — background networking, credentials and host MIDI conversion.

## Credentials

Every protected API request needs an AI MIDI Generator key (`mgk_...`). AI-powered requests also need the caller's Pollinations key in `X-Pollinations-Key`. Pollinations usage is billed to that Pollinations account.

Never publish a developer-owned `mgk_` key or Pollinations token in a public website, mobile package or plugin binary. For a production public client, use a backend you control to authenticate your users and call this API securely. The JavaScript browser example is for local testing or trusted environments where credentials are not exposed to untrusted users.

## JavaScript quick start

```js
import { MidiApiClient } from './sdk/javascript/index.js';

const midi = new MidiApiClient({
  apiKey: process.env.MIDI_API_KEY,
  pollinationsKey: process.env.POLLINATIONS_API_KEY
});

const composition = await midi.generate({
  prompt: 'Melodic techno bassline in F minor',
  bpm: 124,
  bars: 8,
  model: 'openai/gpt-6.1-terra'
});

console.log(composition);
```

To download a binary MIDI file:

```js
const midiBytes = await midi.generate(
  { prompt: 'Ambient piano sketch in D minor', bpm: 80, bars: 4 },
  { format: 'midi' }
);
```

## Python quick start

```python
import os
from sdk.python.ai_midi_generator import MidiApiClient

client = MidiApiClient(
    api_key=os.environ['MIDI_API_KEY'],
    pollinations_key=os.environ['POLLINATIONS_API_KEY'],
)

result = client.generate({
    'prompt': 'Melodic techno bassline in F minor',
    'bpm': 124,
    'bars': 8,
    'model': 'openai/gpt-6.1-terra',
})
print(result)
```

## Endpoint overview

| Endpoint | Purpose | AI request |
|---|---|---|
| `POST /midi` | Generate a composition | Yes |
| `POST /import` | Import MIDI; optionally generate companion tracks | Only when companion tracks are requested |
| `POST /tracks/edit` | Edit selected tracks | Deterministic edits do not call AI; custom AI edits do |
| `GET /keys/validate` | Check API key status | No |

See the [online API reference](https://midi-aigenerator.vercel.app/api-docs.html) for the full request schemas, model list and error responses.
