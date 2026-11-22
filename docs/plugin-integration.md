# DAW plugin integration guide

This guide explains how a VST3, Audio Unit (AU), or other native music plugin can use the AI MIDI Generator API. The API is an HTTPS service; it is not itself a plugin and does not load inside a DAW without a native integration layer.

## Recommended architecture

1. The plugin UI collects the user's prompt, model and musical settings.
2. A background worker sends an HTTPS request to the API.
3. The worker parses the JSON response and validates the returned note data.
4. The plugin converts beat positions and durations into the DAW/plugin's MIDI event format.
5. The plugin schedules or exports the resulting MIDI through the host-supported mechanism.

**Never make network requests on the audio processing thread.** Network latency is unpredictable. Keep HTTP, JSON parsing, file operations and MIDI conversion on a worker/background thread, then pass completed data to the audio thread using a thread-safe queue or the plugin framework's recommended mechanism.

## Authentication and distributed plugins

The API requires two credentials:

- `mgk_...`: identifies the developer's AI MIDI Generator API access.
- `X-Pollinations-Key`: the end user's Pollinations credential, used for AI requests and billed to their Pollinations account.

Do not compile a shared developer API key into a plugin binary. Native binaries can be inspected and embedded credentials can be extracted. A production commercial plugin should use an authenticated developer backend or another server-side credential design. If users provide their own Pollinations credentials, explain clearly where those credentials are sent and how they are handled. Do not log or persist Pollinations tokens.

The current API does not provide a dedicated plugin licensing system, user-account proxy, OAuth handoff for third-party plugins, or native SDK. Those are separate product features and should not be implied by a basic API integration.

## Request flow

For generation, send a JSON POST to:

`https://midi-aigenerator.vercel.app/api/v1/midi`

Headers:

- `Authorization: Bearer mgk_YOUR_KEY`
- `X-Pollinations-Key: YOUR_POLLINATIONS_API_KEY`
- `Content-Type: application/json`

For a binary MIDI file, use `/midi?format=midi`. For notation JSON, use `/midi`.

The companion endpoints are:

- `POST /api/v1/import` — import a base64-encoded Standard MIDI File and optionally generate companion tracks.
- `POST /api/v1/tracks/edit` — edit selected tracks in an existing notation-based composition.

## MIDI conversion

The API notation is documented in [MIDI notation format](midi-notation-format.md). A note is `pitch:beat:duration:velocity`; convert beat positions to the host's timeline using the composition BPM and the host's PPQ/tick resolution.

Do not assume that the response is monophonic. Preserve overlapping notes and fractional beat positions. Convert the API's 1–9 velocity scale to the host's MIDI velocity range (commonly 1–127).

## Reliability checklist

- Run requests asynchronously and allow cancellation when the user closes the dialog or starts a new request.
- Set a client-side timeout longer than the API's expected generation time and display a useful retry message.
- Handle HTTP 400, 401, 402, 403, 429, 502, 503 and 504 responses distinctly.
- Respect `Retry-After` when supplied.
- Validate pitches, beat positions, durations and velocities before scheduling MIDI.
- Never block the audio thread while waiting for HTTP or parsing.
- Test in each target DAW and operating system; plugin host behavior differs.
- Make the generated MIDI previewable/editable before committing it to the user's project.

## Scope

These are integration guidelines, not a guarantee of compatibility with every DAW, plugin format or host. The plugin developer remains responsible for host-specific MIDI insertion, transport synchronization, UI, credential security and platform testing.
