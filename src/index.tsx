import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  staticClasses,
} from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { useEffect, useState } from "react";

interface AudioDevice {
  id: number;
  sName: string;
  bHasOutput: boolean;
}

interface Outputs {
  devices: AudioDevice[];
  activeId: number;
  overrideId: number;
}

interface Shortcut {
  enabled: boolean;
  buttons: number[];
}

const getShortcut = callable<[], Shortcut>("get_shortcut");
const saveShortcut = callable<[boolean, number[]], { ok: boolean }>("set_shortcut");

// EAudioDirection.Output, read out of Steam's bundle.
const OUTPUT = 1;

const audioApi = () => (window as any).SteamClient?.System?.Audio;

/** Outputs as Steam sees them, active device included.
 *
 * This is not the raw PipeWire sink list. Steam collapses some sinks into one
 * device -- a Deck's speakers and headphone jack arrive as a single entry, which
 * is why a handheld with nothing attached has exactly one output to pick. It is
 * not filtered down to physical devices either: a plain null sink shows up here
 * with bHasOutput set.
 *
 * Sorted by name and nothing else. The active device is pinned to the top for
 * display only -- see Content -- so that the shortcut's cycle order stays put
 * instead of reshuffling under itself after every switch.
 */
async function readOutputs(): Promise<Outputs> {
  const api = audioApi();
  if (!api?.GetDevices) throw new Error("SteamClient.System.Audio unavailable");
  const state = await api.GetDevices();
  const devices: AudioDevice[] = (state?.vecDevices ?? [])
    .filter((d: AudioDevice) => d?.bHasOutput)
    .sort((a: AudioDevice, b: AudioDevice) => a.sName.localeCompare(b.sName));
  return {
    devices,
    activeId: state?.activeOutputDeviceId ?? -1,
    overrideId: state?.overrideOutputDeviceId ?? -1,
  };
}

/** Switch output. Steam changes the real PipeWire default and drags every
 *  already-playing stream over, so nothing has to be moved by hand.
 *  Fire-and-forget, the way Steam's own selector calls it. */
function switchTo(id: number) {
  audioApi()?.SetDefaultDeviceOverride(id, OUTPUT);
}

/** Drop the pin and follow whatever the system picks. */
function followSystemDefault() {
  audioApi()?.ClearDefaultDeviceOverride(OUTPUT);
}

/** Next output in name order. Deliberately the unpinned order: pinning the
 *  active device first would make "next" mean the first name in the list every
 *  time, and a third device would never come up. */
async function cycleOutput(): Promise<AudioDevice | null> {
  const { devices, activeId } = await readOutputs();
  if (devices.length < 2) return null;
  const index = devices.findIndex((d) => d.id === activeId);
  const next = devices[(index + 1) % devices.length];
  switchTo(next.id);
  return next;
}

// A single button would fire every time it is pressed for its normal purpose.
const MIN_COMBO = 2;

// EGamepadButton, read out of Steam's bundle. Unknown ids show as BTN<n>: capture
// makes the name cosmetic, and a wrong guess would be worse than a raw number.
// 20-23 are direction events, and Steam merges the D-pad and the left stick into
// them -- the two cannot be told apart, so they share one label.
const BUTTON_NAMES: Record<number, string> = {
  0: "A", 1: "B", 2: "X", 3: "Y",
  4: "D-Up", 5: "D-Right", 6: "D-Down", 7: "D-Left",
  8: "Menu", 9: "View",
  20: "Up", 21: "Down", 22: "Left", 23: "Right",
  28: "LT", 29: "RT", 30: "L1", 31: "R1",
  32: "L4", 33: "R4", 34: "Steam", 35: "Select", 36: "Start",
  37: "L-Pad", 39: "R-Pad", 44: "L5", 45: "R5",
};

function comboLabel(buttons: number[]): string {
  if (!buttons.length) return "Not set";
  return buttons.map((b) => BUTTON_NAMES[b] || `BTN${b}`).join(" + ");
}

// The A press that clicks "record" arrives AFTER capture starts, so without a
// guard it would record itself and close the capture on its own. Two protections,
// both learned from the Steamcord plugin, which hit this as a user-reported bug:
// a grace window that ignores the click's own events, and excluding anything
// already held when capture began, for when A's press is processed first instead.
const CAPTURE_GRACE_MS = 250;

// Recording has to end on its own if the buttons never come. Closing the Quick
// Access Menu with the ... button does not reach the input stream, so without a
// deadline an abandoned capture would sit armed and swallow the next two buttons
// pressed together in a game, overwriting the saved combo with them. Measured
// from the last input rather than from the start, so a long hold is never cut
// off mid-combo.
const CAPTURE_TIMEOUT_MS = 10000;

const held = new Set<number>();
const captured = new Set<number>();
const capturePreHeld = new Set<number>();
let captureStart = 0;
let config: Shortcut = { enabled: false, buttons: [] };
let capture: ((buttons: number[]) => void) | null = null;
let captureTimer = 0;
let captureExpire: (() => void) | null = null;

/** Disarm recording. The one place that clears it, so no path can leave the
 *  capture hook live with the panel gone. */
function endCapture() {
  capture = null;
  captureExpire = null;
  captured.clear();
  capturePreHeld.clear();
  window.clearTimeout(captureTimer);
  captureTimer = 0;
}

function armCaptureTimeout() {
  window.clearTimeout(captureTimer);
  captureTimer = window.setTimeout(() => {
    const expired = captureExpire;
    endCapture();
    expired?.();
  }, CAPTURE_TIMEOUT_MS);
}

// Latched so holding the combo fires once, on the press that completes it,
// instead of repeating for every further button that happens to go down.
let comboHeld = false;

let inputReg: any = null;

function drop(reg: any) {
  try {
    if (typeof reg === "function") reg();
    else reg?.unregister?.();
  } catch {
    // A registration that refuses to unregister is not worth failing over.
  }
}

async function fire() {
  try {
    const next = await cycleOutput();
    toaster.toast({
      title: "Audio Output",
      body: next ? next.sName : "Only one output available.",
    });
  } catch {
    toaster.toast({ title: "Audio Output", body: "Switch failed." });
  }
}

function onButton(button: number, pressed: boolean) {
  if (pressed) held.add(button);
  else held.delete(button);

  if (capture) {
    armCaptureTimeout();
    if (pressed) {
      if (Date.now() - captureStart < CAPTURE_GRACE_MS || capturePreHeld.has(button)) {
        capturePreHeld.add(button);
      } else {
        captured.add(button);
      }
    } else {
      // Released means no longer excluded: the same button can then be recorded.
      capturePreHeld.delete(button);
      if (captured.size && held.size === 0) {
        const done = capture;
        const buttons = [...captured].sort((a, b) => a - b);
        endCapture();
        done(buttons);
      }
    }
    return;
  }

  const combo = config.buttons;
  const active =
    config.enabled && combo.length >= MIN_COMBO && combo.every((b) => held.has(b));

  if (active && !comboHeld) fire();
  comboHeld = active;
}

function listen() {
  drop(inputReg);
  held.clear();
  comboHeld = false;

  const Input = (window as any).SteamClient?.Input;

  // Steam swallows exceptions thrown inside this callback, so a regression here
  // would leave the shortcut dead with nothing in the log. Hence the try/catch.
  inputReg = Input?.RegisterForControllerInputMessages?.(
    (_index: number, button: number, pressed: boolean) => {
      try {
        onButton(button, !!pressed);
      } catch (e) {
        console.warn("[AudioOutputSwitcher] button handler failed:", e);
      }
    },
  );

  if (!inputReg) console.warn("[AudioOutputSwitcher] controller input API unavailable");
}

// Steam's input stream stops after a suspend: no listener receives anything
// afterwards, not even one created after waking. No API in this build reports a
// resume, so detect the clock jump -- a 10s interval that took far longer means
// the machine slept -- and re-subscribe.
const RESUME_TICK_MS = 10000;
const RESUME_GAP_MS = 30000;
let resumeTimer = 0;

function watchForResume() {
  let lastTick = Date.now();
  resumeTimer = window.setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap < RESUME_GAP_MS) return;
    console.log("[AudioOutputSwitcher] resume detected, re-subscribing to input");
    listen();
  }, RESUME_TICK_MS);
}

function SpeakerIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" />
    </svg>
  );
}

function Content() {
  const [outputs, setOutputs] = useState<Outputs>({ devices: [], activeId: -1, overrideId: -1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shortcut, setShortcut] = useState<Shortcut>(config);
  const [capturing, setCapturing] = useState(false);

  const refresh = async () => {
    try {
      setOutputs(await readOutputs());
      setError("");
    } catch {
      setError("Could not read audio devices.");
    }
  };

  useEffect(() => {
    refresh();
    setShortcut(config);
    // A wireless headset powering off is an event, not something to poll for:
    // Steam says so directly, so the panel reacts at once instead of up to four
    // seconds later.
    const api = audioApi();
    const subs = [
      api?.RegisterForDeviceAdded?.(refresh),
      api?.RegisterForDeviceRemoved?.(refresh),
    ];
    return () => {
      subs.forEach(drop);
      // The panel can go away mid-recording -- the ... button closes the Quick
      // Access Menu without sending anything to the input stream -- and the
      // capture hook is a module global, so it would outlive the component.
      endCapture();
    };
  }, []);

  const persist = async (next: Shortcut) => {
    config = next;
    setShortcut(next);
    try {
      await saveShortcut(next.enabled, next.buttons);
    } catch {
      setError("Could not save the shortcut.");
    }
  };

  const startCapture = () => {
    endCapture();
    held.forEach((b) => capturePreHeld.add(b));
    captureStart = Date.now();
    setCapturing(true);
    captureExpire = () => {
      setCapturing(false);
      setError("Nothing recorded. Hold the buttons together, then let go.");
    };
    armCaptureTimeout();
    capture = (buttons) => {
      setCapturing(false);
      // Too short a combo would fire during ordinary play, so refuse it rather
      // than saving something that turns the shortcut into a nuisance.
      if (buttons.length < MIN_COMBO) {
        setError(`Hold at least ${MIN_COMBO} buttons at once.`);
        return;
      }
      setError("");
      persist({ ...config, buttons });
    };
  };

  const pick = async (device: AudioDevice) => {
    setBusy(true);
    try {
      switchTo(device.id);
      toaster.toast({ title: "Audio Output", body: device.sName });
      // SetDefaultDeviceOverride returns nothing to wait on -- Steam's own
      // selector fires and forgets too -- so re-read once it has landed.
      window.setTimeout(refresh, 400);
    } catch {
      setError("Switch failed.");
    } finally {
      setBusy(false);
    }
  };

  const useSystemDefault = async () => {
    setBusy(true);
    try {
      followSystemDefault();
      window.setTimeout(refresh, 400);
    } finally {
      setBusy(false);
    }
  };

  // Pinned here rather than in readOutputs so the shortcut keeps cycling through
  // a stable name-ordered list; see cycleOutput.
  const listed = [
    ...outputs.devices.filter((d) => d.id === outputs.activeId),
    ...outputs.devices.filter((d) => d.id !== outputs.activeId),
  ];

  const ready = shortcut.buttons.length >= MIN_COMBO;

  return (
    <>
      <PanelSection title="Output Device">
        {listed.map((device) => (
          <PanelSectionRow key={device.id}>
            <ButtonItem
              layout="below"
              disabled={busy || device.id === outputs.activeId}
              onClick={() => pick(device)}
            >
              {(device.id === outputs.activeId ? "●  " : "") + device.sName}
            </ButtonItem>
          </PanelSectionRow>
        ))}
        {outputs.devices.length === 0 && (
          <PanelSectionRow>
            <div style={{ opacity: 0.6 }}>No outputs found.</div>
          </PanelSectionRow>
        )}
        {outputs.devices.length === 1 && (
          <PanelSectionRow>
            <div style={{ opacity: 0.6, fontSize: "0.8em" }}>
              Only one output right now. Connect a headset, dock or TV and it appears
              here. Steam presents a handheld's speakers and headphone jack as this
              one device, so there is nothing to switch between until something else
              is attached.
            </div>
          </PanelSectionRow>
        )}
        {outputs.overrideId !== -1 && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy} onClick={useSystemDefault}>
              Follow system default
            </ButtonItem>
          </PanelSectionRow>
        )}
        {error !== "" && (
          <PanelSectionRow>
            <div style={{ color: "#e05c5c" }}>{error}</div>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="Shortcut">
        <PanelSectionRow>
          <ToggleField
            label="Cycle output with a button combo"
            description={
              ready
                ? `Press ${comboLabel(shortcut.buttons)} together, anywhere, even in a game.`
                : `Set a combo of at least ${MIN_COMBO} buttons first.`
            }
            checked={shortcut.enabled}
            disabled={!ready}
            onChange={(value: boolean) => persist({ ...config, enabled: value })}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={capturing} onClick={startCapture}>
            {capturing ? "Hold the buttons, then let go" : comboLabel(shortcut.buttons)}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ opacity: 0.6, fontSize: "0.8em" }}>
            The Steam and … buttons cannot be part of a combo — Steam keeps them to
            itself. The back paddles are the safest choice: most games leave them alone.
          </div>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  // Registered here rather than inside Content: the panel's effects only live
  // while the Quick Access Menu is open, and the whole point is to fire with it
  // closed, in a game.
  getShortcut()
    .then((stored) => {
      config = {
        enabled: !!stored?.enabled,
        buttons: Array.isArray(stored?.buttons) ? stored.buttons : [],
      };
    })
    .catch(() => {});

  listen();
  watchForResume();

  return {
    name: "Audio Output Switcher",
    titleView: <div className={staticClasses.Title}>Audio Output</div>,
    content: <Content />,
    icon: <SpeakerIcon />,
    onDismount() {
      window.clearInterval(resumeTimer);
      drop(inputReg);
      inputReg = null;
    },
  };
});
