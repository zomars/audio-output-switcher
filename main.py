import asyncio
import json
import os
import pwd

import decky

SHORTCUT_FILE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "shortcut.json")

# Nothing bound until the user records a combo. A default binding would fire on
# buttons they never chose, mid-game, which is worse than no shortcut at all.
DEFAULT_SHORTCUT = {"enabled": False, "buttons": []}

# pactl is normally instant; this only exists so a wedged PipeWire can't hang the panel.
PACTL_TIMEOUT = 6


def _session_env():
    """Environment that points pactl at the user's PipeWire session.

    The session lives under that user's runtime dir, so derive it from the
    account Decky is running for instead of assuming uid 1000.
    """
    try:
        uid = pwd.getpwnam(decky.DECKY_USER).pw_uid
    except KeyError:
        uid = os.getuid()
    runtime_dir = f"/run/user/{uid}"
    env = dict(os.environ)
    env["XDG_RUNTIME_DIR"] = runtime_dir
    env["PULSE_RUNTIME_PATH"] = os.path.join(runtime_dir, "pulse")
    return env


async def _pactl(*args):
    """Run pactl; return (ok, stdout). Never raises."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "pactl", *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_session_env(),
        )
    except (OSError, ValueError) as exc:
        decky.logger.error("could not start pactl %s: %s", args, exc)
        return False, ""
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=PACTL_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        decky.logger.error("pactl %s timed out after %ss", args, PACTL_TIMEOUT)
        return False, ""
    if proc.returncode != 0:
        decky.logger.error("pactl %s failed: %s", args, stderr.decode().strip())
        return False, ""
    return True, stdout.decode().strip()


async def _pactl_json(*args):
    ok, out = await _pactl("-f", "json", *args)
    if not ok:
        return []
    try:
        return json.loads(out or "[]")
    except json.JSONDecodeError as exc:
        decky.logger.error("could not parse pactl output: %s", exc)
        return []


def _hdmi_card(card):
    """The part of a pactl card the frontend reads, or None if it has no HDMI port."""
    ports = {
        name: {
            "availability": port.get("availability"),
            "profiles": port.get("profiles") or [],
            "monitor": (port.get("properties") or {}).get("device.product.name"),
        }
        for name, port in (card.get("ports") or {}).items()
        if name.startswith("hdmi-output")
    }
    if not ports:
        return None
    return {
        "name": card.get("name"),
        "active_profile": card.get("active_profile"),
        "profiles": {
            name: bool(profile.get("available"))
            for name, profile in (card.get("profiles") or {}).items()
        },
        "ports": ports,
    }


async def _card_sink(card_name):
    for sink in await _pactl_json("list", "sinks"):
        if (sink.get("properties") or {}).get("device.name") == card_name:
            return sink.get("name")
    return None


class Plugin:
    """Settings storage, and HDMI port selection.

    Output switching itself goes through SteamClient.System.Audio in the
    frontend. Steam presents a whole HDMI card as one device, though, and has no
    call to pick which of its ports -- which monitor -- plays. That is a card
    profile, and only pactl can set it.
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

    async def hdmi_cards(self):
        cards = [_hdmi_card(card) for card in await _pactl_json("list", "cards")]
        return [card for card in cards if card]

    async def set_hdmi_profile(self, card_name: str, profile: str):
        """Move a card to another port's profile.

        A new profile means a new sink name, and PipeWire then drops back to
        whichever sink it ranks first -- measured: the TV lost the default to a
        USB headset. So if this card held the default before, give it back.
        """
        cards = {card["name"]: card for card in await self.hdmi_cards()}
        card = cards.get(card_name)
        if not card or profile not in card["profiles"]:
            decky.logger.error("refusing unknown card/profile %s %s", card_name, profile)
            return {"ok": False}

        _, default_before = await _pactl("get-default-sink")
        sink_before = await _card_sink(card_name)
        held_default = sink_before is not None and sink_before == default_before

        ok, _ = await _pactl("set-card-profile", card_name, profile)
        if not ok:
            return {"ok": False}

        sink_after = None
        if held_default:
            # The new sink takes a moment to appear.
            for _ in range(10):
                sink_after = await _card_sink(card_name)
                if sink_after and sink_after != sink_before:
                    break
                await asyncio.sleep(0.2)
            if sink_after:
                await _pactl("set-default-sink", sink_after)

        _, default_after = await _pactl("get-default-sink")
        # Logged so a tester's log shows whether the audio followed.
        decky.logger.info(
            "hdmi profile %s -> %s; default %s -> %s (card held default: %s, new sink %s)",
            card["active_profile"], profile, default_before, default_after,
            held_default, sink_after,
        )
        return {"ok": True, "default": default_after}

    async def _main(self):
        decky.logger.info("Audio Output Switcher loaded")

    async def _unload(self):
        decky.logger.info("Audio Output Switcher unloaded")
