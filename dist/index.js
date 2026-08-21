const manifest = {"name":"Audio Output Switcher"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const callable = api.callable;
const toaster = api.toaster;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

const getShortcut = callable("get_shortcut");
const saveShortcut = callable("set_shortcut");
// EAudioDirection.Output, read out of Steam's bundle.
const OUTPUT = 1;
const audioApi = () => window.SteamClient?.System?.Audio;
/** Outputs as Steam sees them, active device included.
 *
 * Steam's list is narrower than PipeWire's on purpose: virtual sinks like
 * steam-streaming-playback never appear, and they were never a destination a
 * person meant to pick.
 */
async function readOutputs() {
    const api = audioApi();
    if (!api?.GetDevices)
        throw new Error("SteamClient.System.Audio unavailable");
    const state = await api.GetDevices();
    const devices = (state?.vecDevices ?? [])
        .filter((d) => d?.bHasOutput)
        .sort((a, b) => a.sName.localeCompare(b.sName));
    return {
        devices,
        activeId: state?.activeOutputDeviceId ?? -1,
        overrideId: state?.overrideOutputDeviceId ?? -1,
    };
}
/** Switch output. Steam changes the real PipeWire default and drags every
 *  already-playing stream over, so nothing has to be moved by hand.
 *  Fire-and-forget, the way Steam's own selector calls it. */
function switchTo(id) {
    audioApi()?.SetDefaultDeviceOverride(id, OUTPUT);
}
/** Drop the pin and follow whatever the system picks. */
function followSystemDefault() {
    audioApi()?.ClearDefaultDeviceOverride(OUTPUT);
}
async function cycleOutput() {
    const { devices, activeId } = await readOutputs();
    if (devices.length < 2)
        return null;
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
const BUTTON_NAMES = {
    0: "A", 1: "B", 2: "X", 3: "Y",
    4: "D-Up", 5: "D-Right", 6: "D-Down", 7: "D-Left",
    8: "Menu", 9: "View",
    20: "Up", 21: "Down", 22: "Left", 23: "Right",
    28: "LT", 29: "RT", 30: "L1", 31: "R1",
    32: "L4", 33: "R4", 34: "Steam", 35: "Select", 36: "Start",
    37: "L-Pad", 39: "R-Pad", 44: "L5", 45: "R5",
};
function comboLabel(buttons) {
    if (!buttons.length)
        return "Not set";
    return buttons.map((b) => BUTTON_NAMES[b] || `BTN${b}`).join(" + ");
}
// The A press that clicks "record" arrives AFTER capture starts, so without a
// guard it would record itself and close the capture on its own. Two protections,
// both learned from the Steamcord plugin, which hit this as a user-reported bug:
// a grace window that ignores the click's own events, and excluding anything
// already held when capture began, for when A's press is processed first instead.
const CAPTURE_GRACE_MS = 250;
const held = new Set();
const captured = new Set();
const capturePreHeld = new Set();
let captureStart = 0;
let config = { enabled: false, buttons: [] };
let capture = null;
// Latched so holding the combo fires once, on the press that completes it,
// instead of repeating for every further button that happens to go down.
let comboHeld = false;
let inputReg = null;
function drop(reg) {
    try {
        if (typeof reg === "function")
            reg();
        else
            reg?.unregister?.();
    }
    catch {
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
    }
    catch {
        toaster.toast({ title: "Audio Output", body: "Switch failed." });
    }
}
function onButton(button, pressed) {
    if (pressed)
        held.add(button);
    else
        held.delete(button);
    if (capture) {
        if (pressed) {
            if (Date.now() - captureStart < CAPTURE_GRACE_MS || capturePreHeld.has(button)) {
                capturePreHeld.add(button);
            }
            else {
                captured.add(button);
            }
        }
        else {
            // Released means no longer excluded: the same button can then be recorded.
            capturePreHeld.delete(button);
            if (captured.size && held.size === 0) {
                const done = capture;
                capture = null;
                const buttons = [...captured].sort((a, b) => a - b);
                captured.clear();
                capturePreHeld.clear();
                done(buttons);
            }
        }
        return;
    }
    const combo = config.buttons;
    const active = config.enabled && combo.length >= MIN_COMBO && combo.every((b) => held.has(b));
    if (active && !comboHeld)
        fire();
    comboHeld = active;
}
function listen() {
    drop(inputReg);
    held.clear();
    comboHeld = false;
    const Input = window.SteamClient?.Input;
    // Steam swallows exceptions thrown inside this callback, so a regression here
    // would leave the shortcut dead with nothing in the log. Hence the try/catch.
    inputReg = Input?.RegisterForControllerInputMessages?.((_index, button, pressed) => {
        try {
            onButton(button, !!pressed);
        }
        catch (e) {
            console.warn("[AudioOutputSwitcher] button handler failed:", e);
        }
    });
    if (!inputReg)
        console.warn("[AudioOutputSwitcher] controller input API unavailable");
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
        if (gap < RESUME_GAP_MS)
            return;
        console.log("[AudioOutputSwitcher] resume detected, re-subscribing to input");
        listen();
    }, RESUME_TICK_MS);
}
function SpeakerIcon() {
    return (SP_JSX.jsx("svg", { width: "1em", height: "1em", viewBox: "0 0 24 24", fill: "currentColor", children: SP_JSX.jsx("path", { d: "M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" }) }));
}
function Content() {
    const [outputs, setOutputs] = SP_REACT.useState({ devices: [], activeId: -1, overrideId: -1 });
    const [busy, setBusy] = SP_REACT.useState(false);
    const [error, setError] = SP_REACT.useState("");
    const [shortcut, setShortcut] = SP_REACT.useState(config);
    const [capturing, setCapturing] = SP_REACT.useState(false);
    const refresh = async () => {
        try {
            setOutputs(await readOutputs());
            setError("");
        }
        catch {
            setError("Could not read audio devices.");
        }
    };
    SP_REACT.useEffect(() => {
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
        return () => subs.forEach(drop);
    }, []);
    const persist = async (next) => {
        config = next;
        setShortcut(next);
        try {
            await saveShortcut(next.enabled, next.buttons);
        }
        catch {
            setError("Could not save the shortcut.");
        }
    };
    const startCapture = () => {
        captured.clear();
        capturePreHeld.clear();
        held.forEach((b) => capturePreHeld.add(b));
        captureStart = Date.now();
        setCapturing(true);
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
    const pick = async (device) => {
        setBusy(true);
        try {
            switchTo(device.id);
            toaster.toast({ title: "Audio Output", body: device.sName });
            // SetDefaultDeviceOverride returns nothing to wait on -- Steam's own
            // selector fires and forgets too -- so re-read once it has landed.
            window.setTimeout(refresh, 400);
        }
        catch {
            setError("Switch failed.");
        }
        finally {
            setBusy(false);
        }
    };
    const useSystemDefault = async () => {
        setBusy(true);
        try {
            followSystemDefault();
            window.setTimeout(refresh, 400);
        }
        finally {
            setBusy(false);
        }
    };
    const ready = shortcut.buttons.length >= MIN_COMBO;
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "Output Device", children: [outputs.devices.map((device) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy || device.id === outputs.activeId, onClick: () => pick(device), children: (device.id === outputs.activeId ? "●  " : "") + device.sName }) }, device.id))), outputs.devices.length === 0 && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { opacity: 0.6 }, children: "No outputs found." }) })), outputs.overrideId !== -1 && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: useSystemDefault, children: "Follow system default" }) })), error !== "" && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { color: "#e05c5c" }, children: error }) }))] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Shortcut", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Cycle output with a button combo", description: ready
                                ? `Press ${comboLabel(shortcut.buttons)} together, anywhere, even in a game.`
                                : `Set a combo of at least ${MIN_COMBO} buttons first.`, checked: shortcut.enabled, disabled: !ready, onChange: (value) => persist({ ...config, enabled: value }) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: capturing, onClick: startCapture, children: capturing ? "Hold the buttons, then let go" : comboLabel(shortcut.buttons) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { opacity: 0.6, fontSize: "0.8em" }, children: "The Steam and \u2026 buttons cannot be part of a combo \u2014 Steam keeps them to itself. The back paddles are the safest choice: most games leave them alone." }) })] })] }));
}
var index = definePlugin(() => {
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
        .catch(() => { });
    listen();
    watchForResume();
    return {
        name: "Audio Output Switcher",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "Audio Output" }),
        content: SP_JSX.jsx(Content, {}),
        icon: SP_JSX.jsx(SpeakerIcon, {}),
        onDismount() {
            window.clearInterval(resumeTimer);
            drop(inputReg);
            inputReg = null;
        },
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
