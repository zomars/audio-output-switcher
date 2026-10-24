# Glossary

**Output**: an audio device Steam reports with `bHasOutput`. Steam already
merges some PipeWire sinks into one Output: a Steam Deck's speakers and
headphone jack are a single Output.

**Real output**: an Output someone could mean to pick. It has configs or sits on
a known bus. `steam-streaming-playback` and null sinks are not real outputs.

**Output list**: the real outputs in label order (the *cycle*), the same
outputs with the active one first (what the panel *shows*), and the *next*
output after the active one. `src/outputs.ts`.

**Label**: the name the user sees for an Output. It comes from Steam's audio
store, so a Deck's onboard audio reads "Speakers" as in Settings → Audio.
Falls back to Steam's raw `sName`.

**Override**: an Output the user pinned with `SetDefaultDeviceOverride`.
"Follow system default" clears it.

**Combo shortcut**: two or more controller buttons held together, anywhere,
that switch to the next output. `src/shortcut.ts`.

**Capture**: recording a new combo from the panel. It ignores the click that
started it, ends when every button is released, and expires after 10 seconds
without input.
