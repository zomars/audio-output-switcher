# Audio Output Switcher

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that switches the default audio output device from the Quick Access Menu.

![The plugin panel, listing available outputs with the active one marked](assets/panel.png)

In gamemode the output device can only be changed in Settings → Audio, several screens away — on a Steam Machine driving a TV, the QAM audio section is only a CEC volume slider. This plugin puts the outputs Steam knows about in the QAM and switches with one tap.

It is for setups with somewhere to switch **to**: a dock, a TV, a headset, a USB DAC. A handheld with nothing attached has exactly one output — Steam presents its speakers and headphone jack as a single device — and the panel says so rather than showing a lone row you cannot press.

## Features

- Lists the available audio outputs, active device marked and pinned to the top
- Switches the default sink **and moves already-playing streams**, so audio follows immediately instead of only affecting the next sound
- Device arrival and removal are events, not polls, so a wireless headset connecting or powering off shows up without reloading the panel
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

Switching goes through `SteamClient.System.Audio`, the same API Steam's own audio
selector uses:

- `GetDevices()` returns the outputs plus `activeOutputDeviceId`. This is not the
  raw PipeWire sink list — Steam collapses a Deck's speakers and headphone jack
  into one device, so `SetDefaultDeviceOverride` cannot reach that distinction —
  but it is not narrowed to real devices either. `steam-streaming-playback` and
  plain null sinks arrive here with `bHasOutput` set, and picking one silences
  the speakers with no clue why, so the panel drops them. Not by name: a real
  sink reports at least one entry in `availableConfigs` and a described
  `currentConfig`, and a virtual one reports none, with connector and bus `0`.
  If a build ever reported configs differently and that left nothing, the panel
  shows the unfiltered list rather than an empty one.
- `RegisterForDeviceAdded` / `RegisterForDeviceRemoved` replace polling: a wireless
  headset powering off is an event, so the panel reacts at once rather than up to
  four seconds later. Both return **nothing** on current builds, though, so there
  is no handle to unregister with. The plugin subscribes once when it loads and
  fans out to the panel from there; subscribing per panel mount would leave a dead
  callback behind on Steam for every trip into the Quick Access Menu.
- `SetDefaultDeviceOverride(id, 1)` switches. Measured on a device: it changes the
  real PipeWire default — `pactl get-default-sink` follows it — **and drags every
  already-playing stream across on its own**. An earlier version of this plugin
  shelled out to `pactl set-default-sink` and then looped `move-sink-input` over
  every live stream to get the same effect.
- `ClearDefaultDeviceOverride(1)` unpins it again, which is what the panel's
  "Follow system default" row does. It only appears while an override is set.

The active device is pinned to the top of the panel, but only there: the list the
shortcut cycles through stays in name order. Pinning it in both places would make
"next" mean the first name every time, and a third device would never come up.

`main.py` therefore stores the shortcut binding and nothing else — the audio path
has no Python in it at all.

### The shortcut

The combo is two or more ordinary buttons pressed together, and nothing is bound
until you record one: hold the buttons, let go, done. The back paddles are the
safest pick, since most games leave them unbound.

Recording ends when you let the buttons go, and gives up after ten seconds if
they never come. It is also disarmed when the panel closes — the `…` button
closes the Quick Access Menu without sending anything to the input stream, so an
abandoned recording would otherwise sit armed and take the next two buttons
pressed together in a game as the new binding.

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

## Building

```bash
pnpm i
pnpm run build
```

Outputs `dist/index.js`.

## License

MIT — see [LICENSE](LICENSE). Retains the BSD-3-Clause license of the [decky-plugin-template](https://github.com/SteamDeckHomebrew/decky-plugin-template) it derives from.
