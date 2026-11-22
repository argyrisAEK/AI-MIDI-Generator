# MIDI notation format

The API uses a compact text representation for notes. It is not a Standard MIDI File by itself; clients convert it to MIDI events or request a binary file from the generation endpoint.

## One note

`pitch:beat:duration:velocity`

- **pitch**: MIDI note number. For generated companion tracks, the current AI validator accepts 24–96. The edit endpoint accepts 0–127.
- **beat**: note start position measured in quarter-note beats from the start of the arrangement. It can be fractional (for example, `0.5`).
- **duration**: note length in quarter-note beats; must be greater than zero.
- **velocity**: integer from 1 to 9 in the API notation. Convert to the target MIDI library's 1–127 range when creating MIDI note-on events.

## Multiple notes and tracks

Notes are separated with `|`:

```text
36:0:1:8|36:1.5:0.5:7|43:2:2:8
```

A composition groups notation strings by track name:

```json
{
  "title": "Night Drive",
  "desc": "Dark melodic techno sketch",
  "tracks": {
    "bassline": "36:0:1:8|36:1.5:0.5:7",
    "melody": "60:0:0.5:7|63:1:1:8"
  }
}
```

## Timing conversion

The notation's beat positions are independent of seconds. To convert beats to seconds:

`seconds = beat * 60 / bpm`

Likewise:

`secondsDuration = duration * 60 / bpm`

For a MIDI file with PPQ (ticks per quarter note):

`ticks = beat * PPQ`

Use the composition BPM and time signature when converting to a DAW timeline. Do not assume that one bar always contains four quarter-note beats: for example, a 3/4 bar contains three.

## Track names

Common track names include `bassline`, `chord`, `melody`, `arpeggio`, `lead`, `plucks`, `strings`, `keys`, `pad-textures`, `guitar`, `brass` and `percs`. Endpoint-specific accepted values are listed in the API reference.

## Important implementation notes

- Preserve fractional beat positions; do not round every note to an integer beat.
- Sort notes by start beat for display, but preserve simultaneous notes.
- A track is polyphonic: multiple notes may overlap.
- The notation does not encode instrument sound, audio samples, automation, effects, controller lanes or expressive MIDI metadata.
- The import endpoint currently returns a best-effort conversion. Validate unusual MIDI files in your own test suite before relying on them in a production workflow.
- The direct `/midi?format=midi` generation option returns a binary Standard MIDI File. Import and edit currently return JSON notation, not a binary file.
