import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  findModuleExport,
  staticClasses,
} from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { useEffect, useState } from "react";

import { monitorChoices, type HdmiCard, type MonitorChoice } from "./hdmi";
import { outputList, type DevicesSnapshot, type Output } from "./outputs";
import { MIN_COMBO, comboLabel, createShortcut, type Shortcut } from "./shortcut";

const getShortcut = callable<[], Shortcut>("get_shortcut");
const saveShortcut = callable<[boolean, number[]], { ok: boolean }>("set_shortcut");
const hdmiCards = callable<[], HdmiCard[]>("hdmi_cards");
const setHdmiProfile = callable<[string, string], { ok: boolean }>("set_hdmi_profile");

// EAudioDirection.Output, read out of Steam's bundle.
const OUTPUT = 1;

const audioApi = () => (window as any).SteamClient?.System?.Audio;

/** Steam's own audio store, the one behind Settings → Audio. Its export name is
 *  minified, so it is found by shape; its method names are not. */
const audioStore = findModuleExport(
  (e: any) => typeof e?.getDevices === "function" && typeof e?.getActiveDeviceId === "function",
);

/** The name Settings → Audio shows. Steam relabels onboard audio -- a Deck's
 *  "ACP/ACP3X/ACP6x Audio Coprocessor" becomes "Speakers", localized -- and
 *  asking its store keeps the panel in step without copying its list of names.
 *  Falls back to the raw name if a Steam update moves the store. */
function displayName(device: Output): string {
  try {
    const name = audioStore?.getDevice?.(device.id)?.GetName?.(OUTPUT);
    if (typeof name === "string" && name) return name;
  } catch {}
  return device.sName;
}

async function readOutputs() {
  const api = audioApi();
  if (!api?.GetDevices) throw new Error("SteamClient.System.Audio unavailable");
  const snapshot: DevicesSnapshot = await api.GetDevices();
  return outputList(snapshot, displayName);
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

const shortcut = createShortcut();

// Measured on current builds: RegisterForDeviceAdded and RegisterForDeviceRemoved
// return nothing at all, so there is no handle to unregister with and the panel
// cannot take its callback back off Steam when it closes. Subscribing once at
// load and fanning out from there keeps that from leaving one dead callback
// behind per QAM open, each re-reading the device list forever.
const deviceListeners = new Set<() => void>();

function onDevicesChanged(listener: () => void) {
  deviceListeners.add(listener);
  return () => {
    deviceListeners.delete(listener);
  };
}

function watchDevices() {
  const api = audioApi();
  const notify = () => deviceListeners.forEach((listener) => listener());
  api?.RegisterForDeviceAdded?.(notify);
  api?.RegisterForDeviceRemoved?.(notify);
}

function drop(reg: any) {
  try {
    if (typeof reg === "function") reg();
    else reg?.unregister?.();
  } catch {
    // A registration that refuses to unregister is not worth failing over.
  }
}

// Steam queues toasts and shows each one for its full duration, so switching
// several times in a row used to leave a trail of stale device names playing out
// long after the last switch. Only the newest switch is worth showing: earlier
// ones are pulled out of Steam's queue -- on screen or still waiting -- before
// the next goes in. Decky's dismiss() only clears the tray entry, not the queue,
// hence the reach into NotificationStore. The queue holds a copy of each toast,
// not the object handed to Decky, so they are recognised by title.
const TOAST_TITLE = "Audio Output";
let lastToast: { dismiss?: () => void } | undefined;

function notify(body: string) {
  try {
    // Measured: the predicate says what to KEEP, despite the method's name.
    (window as any).NotificationStore?.RemoveFromToastsWhere?.(
      (entry: any) => entry?.data?.title !== TOAST_TITLE,
    );
  } catch {
    // Worst case the old toasts play out, as they did before.
  }
  lastToast?.dismiss?.();
  // Another plugin can wrap the toaster and return nothing, hence the optional calls.
  lastToast = toaster.toast({ title: TOAST_TITLE, body });
}

async function cycle() {
  try {
    const { next } = await readOutputs();
    if (next) switchTo(next.id);
    notify(next ? displayName(next) : "Only one output available.");
  } catch {
    notify("Switch failed.");
  }
}

let inputReg: any = null;

function listen() {
  drop(inputReg);
  shortcut.reset();

  const Input = (window as any).SteamClient?.Input;

  // Steam swallows exceptions thrown inside this callback, so a regression here
  // would leave the shortcut dead with nothing in the log. Hence the try/catch.
  inputReg = Input?.RegisterForControllerInputMessages?.(
    (_index: number, button: number, pressed: boolean) => {
      try {
        shortcut.button(button, !!pressed);
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
  const [outputs, setOutputs] = useState(() => outputList(undefined));
  const [monitors, setMonitors] = useState<MonitorChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [binding, setBinding] = useState(() => shortcut.state());

  const refresh = async () => {
    try {
      setOutputs(await readOutputs());
      setError("");
    } catch {
      setError("Could not read audio devices.");
    }
    // Optional: without pactl the section just stays hidden.
    try {
      setMonitors(monitorChoices(await hdmiCards()));
    } catch {
      setMonitors([]);
    }
  };

  useEffect(() => {
    refresh();
    setBinding(shortcut.state());
    // A wireless headset powering off is an event, not something to poll for:
    // Steam says so directly, so the panel reacts at once instead of up to four
    // seconds later.
    const unsubscribeDevices = onDevicesChanged(refresh);
    const unsubscribeShortcut = shortcut.subscribe((event) => {
      setBinding(shortcut.state());
      if (event.type === "tooShort") setError(`Hold at least ${MIN_COMBO} buttons at once.`);
      if (event.type === "expired") setError("Nothing recorded. Hold the buttons together, then let go.");
      if (event.type === "config") {
        setError("");
        // Saved from here, not from the plugin: every change to the binding is
        // made in this panel, and a failure needs somewhere to show.
        saveShortcut(event.config.enabled, event.config.buttons).catch(() =>
          setError("Could not save the shortcut."),
        );
      }
    });
    return () => {
      unsubscribeDevices();
      unsubscribeShortcut();
      // The panel can go away mid-recording, and an armed capture would outlive
      // it. Leaving the plugin page unmounts and lands here; the capture deadline
      // covers anything that does not.
      shortcut.cancelCapture();
    };
  }, []);

  const pick = async (device: Output) => {
    setBusy(true);
    try {
      switchTo(device.id);
      notify(displayName(device));
      // SetDefaultDeviceOverride returns nothing to wait on -- Steam's own
      // selector fires and forgets too -- so re-read once it has landed.
      window.setTimeout(refresh, 400);
    } catch {
      setError("Switch failed.");
    } finally {
      setBusy(false);
    }
  };

  // Steam has no call for this: it shows the whole HDMI card as one output.
  // The backend sets the card profile through pactl, and hands the default back
  // to the card if it had it, since a new profile means a new sink.
  const pickMonitor = async (monitor: MonitorChoice) => {
    setBusy(true);
    try {
      const result = await setHdmiProfile(monitor.card, monitor.profile);
      if (!result?.ok) throw new Error("set_hdmi_profile failed");
      notify(monitor.label);
    } catch {
      setError("Could not switch the HDMI monitor.");
    } finally {
      setBusy(false);
      window.setTimeout(refresh, 400);
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

  const { config, capturing, ready } = binding;

  return (
    <>
      <PanelSection title="Output Device">
        {outputs.shown.map((device) => (
          <PanelSectionRow key={device.id}>
            <ButtonItem
              layout="below"
              disabled={busy || device === outputs.active}
              onClick={() => pick(device)}
            >
              {(device === outputs.active ? "●  " : "") + displayName(device)}
            </ButtonItem>
          </PanelSectionRow>
        ))}
        {outputs.shown.length === 0 && (
          <PanelSectionRow>
            <div style={{ opacity: 0.6 }}>No outputs found.</div>
          </PanelSectionRow>
        )}
        {outputs.shown.length === 1 && (
          <PanelSectionRow>
            <div style={{ opacity: 0.6, fontSize: "0.8em" }}>
              Only one output right now. Connect a headset, dock or TV and it appears
              here. Steam presents a handheld's speakers and headphone jack as this
              one device, so there is nothing to switch between until something else
              is attached.
            </div>
          </PanelSectionRow>
        )}
        {outputs.overridden && (
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

      {monitors.length > 0 && (
        <PanelSection title="HDMI Monitor">
          {monitors.map((monitor) => (
            <PanelSectionRow key={monitor.card + monitor.port}>
              <ButtonItem
                layout="below"
                disabled={busy || monitor.active}
                onClick={() => pickMonitor(monitor)}
              >
                {(monitor.active ? "●  " : "") + monitor.label}
              </ButtonItem>
            </PanelSectionRow>
          ))}
          <PanelSectionRow>
            <div style={{ opacity: 0.6, fontSize: "0.8em" }}>
              Which connected screen plays HDMI audio. Steam shows them all as one
              HDMI output.
            </div>
          </PanelSectionRow>
        </PanelSection>
      )}

      <PanelSection title="Shortcut">
        <PanelSectionRow>
          <ToggleField
            label="Cycle output with a button combo"
            description={
              ready
                ? `Press ${comboLabel(config.buttons)} together, anywhere, even in a game.`
                : `Set a combo of at least ${MIN_COMBO} buttons first.`
            }
            checked={config.enabled}
            disabled={!ready}
            onChange={(value: boolean) => shortcut.setEnabled(value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={capturing} onClick={() => shortcut.startCapture()}>
            {capturing ? "Hold the buttons, then let go" : comboLabel(config.buttons)}
          </ButtonItem>
        </PanelSectionRow>
        {config.buttons.length > 0 && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={capturing} onClick={() => shortcut.clear()}>
              Clear shortcut
            </ButtonItem>
          </PanelSectionRow>
        )}
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
      shortcut.load({
        enabled: !!stored?.enabled,
        buttons: Array.isArray(stored?.buttons) ? stored.buttons : [],
      });
    })
    .catch(() => {});

  const unsubscribe = shortcut.subscribe((event) => {
    if (event.type === "fire") cycle();
  });

  listen();
  watchForResume();
  watchDevices();

  return {
    name: "Audio Output Switcher",
    titleView: <div className={staticClasses.Title}>Audio Output</div>,
    content: <Content />,
    icon: <SpeakerIcon />,
    onDismount() {
      window.clearInterval(resumeTimer);
      unsubscribe();
      shortcut.reset();
      drop(inputReg);
      inputReg = null;
    },
  };
});
