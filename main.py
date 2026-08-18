import asyncio
import json
import os
import pwd

import decky

# Sinks we never want to show as a pickable destination.
HIDDEN_PREFIXES = ("auto_null",)

# pactl is normally instant; this only exists so a wedged PipeWire can't hang the panel.
TIMEOUT = 6


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


async def _run(args):
    """Run a pactl command, returning (returncode, stdout, stderr).

    Never raises: a failure to spawn or a timeout comes back as a non-zero code
    so callers can keep treating this as an ordinary command result.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_session_env(),
        )
    except (OSError, ValueError) as exc:
        decky.logger.error("could not start %s: %s", args, exc)
        return 1, "", str(exc)

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT)
    except asyncio.TimeoutError:
        decky.logger.error("%s timed out after %ss", args, TIMEOUT)
        proc.kill()
        await proc.wait()
        return 1, "", f"timed out after {TIMEOUT}s"

    return proc.returncode, stdout.decode().strip(), stderr.decode().strip()


async def _pactl_json(args):
    code, stdout, stderr = await _run(["pactl", "-f", "json"] + args)
    if code != 0:
        decky.logger.error("pactl %s failed: %s", args, stderr)
        return []
    try:
        return json.loads(stdout or "[]")
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
        code, stdout, _ = await _run(["pactl", "get-default-sink"])
        default_name = stdout if code == 0 else ""

        sinks = []
        for sink in await _pactl_json(["list", "sinks"]):
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
        code, _, stderr = await _run(["pactl", "set-default-sink", name])
        if code != 0:
            message = stderr or "pactl refused the change"
            decky.logger.error("set-default-sink %s failed: %s", name, message)
            return {"ok": False, "error": message}

        # set-default-sink only affects future streams; existing ones must be moved.
        moved = 0
        for stream in await _pactl_json(["list", "sink-inputs"]):
            index = stream.get("index")
            if index is None:
                continue
            move_code, _, move_err = await _run(
                ["pactl", "move-sink-input", str(index), name]
            )
            if move_code == 0:
                moved += 1
            else:
                decky.logger.warning("could not move stream %s: %s", index, move_err)

        decky.logger.info("switched output to %s (%s streams moved)", name, moved)
        return {"ok": True, "moved": moved}

    async def _main(self):
        decky.logger.info("Audio Output Switcher loaded")

    async def _unload(self):
        decky.logger.info("Audio Output Switcher unloaded")
