import json
import os
import subprocess

import decky

RUNTIME_DIR = "/run/user/1000"
DECK_USER = "deck"

# Sinks we never want to show as a pickable destination.
HIDDEN_PREFIXES = ("auto_null",)


def _run(args, timeout=6):
    """Run a pactl command inside the deck user's PipeWire session.

    Decky may run the backend as root, in which case pactl has no route to the
    user session unless we drop back down to the deck user with its runtime dir.
    """
    env = dict(os.environ)
    env["XDG_RUNTIME_DIR"] = RUNTIME_DIR
    env["PULSE_RUNTIME_PATH"] = os.path.join(RUNTIME_DIR, "pulse")

    cmd = list(args)
    if os.geteuid() == 0:
        cmd = [
            "sudo", "-n", "-u", DECK_USER,
            "env",
            f"XDG_RUNTIME_DIR={RUNTIME_DIR}",
            f"PULSE_RUNTIME_PATH={RUNTIME_DIR}/pulse",
        ] + list(args)

    return subprocess.run(
        cmd, env=env, capture_output=True, text=True, timeout=timeout
    )


def _pactl_json(args):
    proc = _run(["pactl", "-f", "json"] + args)
    if proc.returncode != 0:
        decky.logger.error("pactl %s failed: %s", args, proc.stderr.strip())
        return []
    try:
        return json.loads(proc.stdout or "[]")
    except json.JSONDecodeError as exc:
        decky.logger.error("could not parse pactl output: %s", exc)
        return []


def _label_for(sink):
    """Prefer the human description, fall back to the node name."""
    props = sink.get("properties") or {}
    for key in ("device.description", "node.description", "alsa.card_name"):
        value = props.get(key)
        if value:
            return value
    return sink.get("description") or sink.get("name") or "Unknown output"


class Plugin:
    async def list_sinks(self):
        """Return every available output, newest state included."""
        default_proc = _run(["pactl", "get-default-sink"])
        default_name = default_proc.stdout.strip() if default_proc.returncode == 0 else ""

        sinks = []
        for sink in _pactl_json(["list", "sinks"]):
            name = sink.get("name") or ""
            if not name or name.startswith(HIDDEN_PREFIXES):
                continue
            sinks.append(
                {
                    "name": name,
                    "label": _label_for(sink),
                    "active": name == default_name,
                    "state": sink.get("state", ""),
                }
            )

        # Keep the active device pinned to the top, then sort for stable ordering.
        sinks.sort(key=lambda s: (not s["active"], s["label"].lower()))
        return sinks

    async def set_sink(self, name: str):
        """Make `name` the default output and drag every playing stream with it."""
        proc = _run(["pactl", "set-default-sink", name])
        if proc.returncode != 0:
            message = proc.stderr.strip() or "pactl refused the change"
            decky.logger.error("set-default-sink %s failed: %s", name, message)
            return {"ok": False, "error": message}

        # set-default-sink only affects future streams; existing ones must be moved.
        moved = 0
        for stream in _pactl_json(["list", "sink-inputs"]):
            index = stream.get("index")
            if index is None:
                continue
            move = _run(["pactl", "move-sink-input", str(index), name])
            if move.returncode == 0:
                moved += 1
            else:
                decky.logger.warning(
                    "could not move stream %s: %s", index, move.stderr.strip()
                )

        decky.logger.info("switched output to %s (%s streams moved)", name, moved)
        return {"ok": True, "moved": moved}

    async def _main(self):
        decky.logger.info("Audio Output Switcher loaded")

    async def _unload(self):
        decky.logger.info("Audio Output Switcher unloaded")
