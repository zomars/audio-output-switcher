import json
import os

import decky

SHORTCUT_FILE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "shortcut.json")

# Nothing bound until the user records a combo. A default binding would fire on
# buttons they never chose, mid-game, which is worse than no shortcut at all.
DEFAULT_SHORTCUT = {"enabled": False, "buttons": []}


class Plugin:
    """Settings storage, and nothing else.

    Audio itself is handled in the frontend through SteamClient.System.Audio,
    which changes the real PipeWire default and drags already-playing streams
    with it. This class exists because that API has nowhere to persist the
    shortcut binding across restarts.
    """

    async def get_shortcut(self):
        try:
            with open(SHORTCUT_FILE, encoding="utf-8") as handle:
                stored = json.load(handle)
        except (OSError, json.JSONDecodeError):
            return dict(DEFAULT_SHORTCUT)

        # Defensive: a hand-edited or half-written file must not break the panel.
        buttons = stored.get("buttons")
        if not isinstance(buttons, list) or not all(isinstance(b, int) for b in buttons):
            buttons = list(DEFAULT_SHORTCUT["buttons"])
        return {"enabled": bool(stored.get("enabled")), "buttons": buttons}

    async def set_shortcut(self, enabled: bool, buttons):
        config = {
            "enabled": bool(enabled),
            "buttons": [int(b) for b in (buttons or [])],
        }
        try:
            os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)
            with open(SHORTCUT_FILE, "w", encoding="utf-8") as handle:
                json.dump(config, handle)
        except OSError as exc:
            decky.logger.error("could not save shortcut: %s", exc)
            return {"ok": False, "error": str(exc)}
        return {"ok": True}

    async def _main(self):
        decky.logger.info("Audio Output Switcher loaded")

    async def _unload(self):
        decky.logger.info("Audio Output Switcher unloaded")
