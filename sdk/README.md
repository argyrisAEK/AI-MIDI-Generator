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

## Validate an API key without a Pollinations key

Key validation only checks the AI MIDI Generator `mgk_...` key. You can create either SDK with no Pollinations credential for this operation:

```js
const midi = new MidiApiClient({ apiKey: process.env.MIDI_API_KEY });
const status = await midi.validateKey();
console.log(status);
```

```python
client = MidiApiClient(api_key=os.environ["MIDI_API_KEY"])
print(client.validate_key())
```

A Pollinations key is required when calling generation, import, or track-edit operations through these SDK examples. If it is missing, the SDK raises a clear local error before making the request.

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


## Import an existing MIDI file

The import endpoint accepts base64 content. In Node.js, read the file and encode its bytes:

```js
import { readFile } from 'node:fs/promises';

const midiBase64 = (await readFile('./idea.mid')).toString('base64');
const imported = await midi.importMidi(midiBase64, {
  trackTypes: ['bassline', 'pad-textures'],
  model: 'openai/gpt-6.1-terra'
});
console.log(imported.analysis, imported.importedTracks, imported.generated);
```

## Edit selected tracks

Pass the complete composition and the exact track names you want to edit. Unselected tracks are preserved by the API.

```js
const edited = await midi.editTracks(composition, {
  targetTracks: ['bassline'],
  editType: 'transpose_up'
});
console.log(edited.composition);
```

For AI-assisted edits, use an AI edit type such as `custom` and provide `instructions`. Deterministic edit types such as transpose, quantize and velocity adjustments do not need an AI model call.

## Endpoint overview

| Endpoint | Purpose | AI request |
|---|---|---|
| `POST /midi` | Generate a composition | Yes |
| `POST /import` | Import MIDI; optionally generate companion tracks | Only when companion tracks are requested |
| `POST /tracks/edit` | Edit selected tracks | Deterministic edits do not call AI; custom AI edits do |
| `GET /keys/validate` | Check API key status | No |

See the [online API reference](https://midi-aigenerator.vercel.app/api-docs.html) for the full request schemas, model list and error responses.
