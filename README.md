# Audio Output Switcher

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that switches the default audio output device from the Quick Access Menu.

SteamOS gamemode has no output-device picker on every device — on a Steam Machine driving a TV, the QAM audio section is only a CEC volume slider. Changing outputs otherwise means a trip to desktop mode. This plugin lists every available sink and switches with one tap.

## Features

- Lists all available audio outputs, active device marked and pinned to the top
- Switches the default sink **and moves already-playing streams**, so audio follows immediately instead of only affecting the next sound
- Repolls while the panel is open, so wireless headsets appearing and disappearing are reflected without a reload

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

If Decky runs the backend as root, commands are re-run as the `deck` user with `XDG_RUNTIME_DIR` set, so it can reach the user's PipeWire session either way.

## QAM tab rail

The plugin can add its own icon to the Quick Access Menu tab rail, ahead of Decky's, so the device list is one tap away. **This is disabled by default** — build it with `pnpm run build:qam` instead of `pnpm run build`.

Because the flag resolves at build time, the default build has the entire code path eliminated by rollup: the shipped bundle contains no reference to Decky internals at all.

It is off because it reaches into `window.DeckyPluginLoader.tabsHook`, which is Decky-internal and not part of the plugin API:

- The tab id is hardcoded, so two plugins doing this would collide
- Registering mid-session duplicates the rail, because `render()` only bails early when its decky-tab count matches `tabs.length` — it settles after a `plugin_loader` restart
- A Decky Loader update can move the internal without warning

All access is guarded and wrapped, so if any of that happens the tab silently does not appear and the normal Decky-panel section keeps working. Use `build:qam` for a personal build if you accept those caveats.

## Building

```bash
pnpm i
pnpm run build       # store variant
pnpm run build:qam   # variant with the QAM tab rail icon
```

Both output `dist/index.js`. The committed `dist/` is the store variant, so if you build `build:qam` for personal use, run `pnpm run build` again before committing.

## License

MIT — see [LICENSE](LICENSE). Retains the BSD-3-Clause license of the [decky-plugin-template](https://github.com/SteamDeckHomebrew/decky-plugin-template) it derives from.
