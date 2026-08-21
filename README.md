# Audio Output Switcher

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that switches the default audio output device from the Quick Access Menu.

![The plugin panel, listing available outputs with the active one marked](assets/panel.png)

SteamOS gamemode has no output-device picker on every device — on a Steam Machine driving a TV, the QAM audio section is only a CEC volume slider. Changing outputs otherwise means a trip to desktop mode. This plugin lists every available sink and switches with one tap.

## Features

- Lists all available audio outputs, active device marked and pinned to the top
- Switches the default sink **and moves already-playing streams**, so audio follows immediately instead of only affecting the next sound
- Repolls while the panel is open, so wireless headsets appearing and disappearing are reflected without a reload
- Optional **controller shortcut**: a button combo of your choice cycles to the next output, without opening the panel or leaving the game

## Install

**From the Decky store:** search for "Audio Output Switcher" in the Decky plugin browser.

**Manually:** copy this directory to `~/homebrew/plugins/audio-output-switcher` on your device, then restart Decky:

```bash
sudo cp -r audio-output-switcher ~/homebrew/plugins/
sudo chown -R root:root ~/homebrew/plugins/audio-output-switcher
sudo systemctl restart plugin_loader
```

## How it works

The backend (`main.py`) shells out to `pactl`:

- `pactl -f json list sinks` for the device list, `pactl get-default-sink` for current state
- Switching runs `set-default-sink` **and then** `move-sink-input` for every live stream. `set-default-sink` alone only affects streams that start *afterward*, so without the move pass whatever is already playing keeps going out the old device.

### The shortcut

The combo is two or more ordinary buttons pressed together, and nothing is bound
until you record one: hold the buttons, let go, done. The back paddles are the
safest pick, since most games leave them unbound.

**The Steam and `…` buttons cannot be part of it.** They do not arrive through the
controller button stream at all; they come through
`SteamClient.System.UI.RegisterForSystemKeyEvents` as `eKey: 0` and `eKey: 1`, and
only as a single instantaneous event — Steam's own handler fires ButtonDown and
ButtonUp back to back, so neither can be *held* as half of a combo. Worse, while
the Steam button is held for one of Steam's own chords (Steam + left stick for
volume), nothing reaches the plugin context: not the button, not the stick, not a
system key event. Steam consumes the chord in the client.

Two more things measured rather than assumed:

- The analog stream is not available here. `RegisterForControllerAnalogInputMessages`
  delivers nothing to a plugin even after `EnableControllerAnalogInputMessages(true)`.
- Stick and D-pad directions arrive as ordinary buttons (`22` left, `23` right, and
  so on) and *can* be part of a combo — but Steam merges the two sources, so a
  binding cannot tell a stick flick from a D-pad press.

The listener is registered when the plugin loads, not from the panel component:
the panel's effects only run while the QAM is open, and the whole point is to fire
while it is closed. The input stream also stops after a suspend — no listener
receives anything afterwards, not even one created after waking — and no API in
current builds reports a resume, so the plugin watches for the clock jump instead
and re-subscribes.

Nothing is intercepted: a game with L4 and R4 bound receives them too.

If Decky runs the backend as root, commands are re-run as the `deck` user with `XDG_RUNTIME_DIR` set, so it can reach the user's PipeWire session either way.

## Building

```bash
pnpm i
pnpm run build
```

Outputs `dist/index.js`.

## License

MIT — see [LICENSE](LICENSE). Retains the BSD-3-Clause license of the [decky-plugin-template](https://github.com/SteamDeckHomebrew/decky-plugin-template) it derives from.
