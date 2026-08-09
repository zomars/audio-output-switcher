// Hand-authored bundle: same shape @decky/rollup emits, minus the build step.
// Decky Loader passes its API in through a versioned global.
const manifest = {"name":"Audio Output Switcher","author":"deck","flags":[],"api_version":1,"publish":{"tags":["audio"],"description":"Switch the default audio output device from the Quick Access Menu.","image":""}};
const API_VERSION = 2;

const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[audio-output-switcher] Loader API was not initialized.');
}

let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
} catch {
    api = internalAPIConnection.connect(1, manifest.name);
}

const callable = api.callable;
const toaster = api.toaster;
const definePlugin = (fn) => (...args) => fn(...args);

const R = window.SP_REACT;
const h = R.createElement;

const listSinks = callable("list_sinks");
const setSink = callable("set_sink");

function SpeakerIcon() {
    return h(
        "svg",
        { width: "1em", height: "1em", viewBox: "0 0 24 24", fill: "currentColor" },
        h("path", { d: "M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" })
    );
}

function Content() {
    const [sinks, setSinks] = R.useState([]);
    const [busy, setBusy] = R.useState(false);
    const [error, setError] = R.useState("");

    const refresh = async () => {
        try {
            const result = await listSinks();
            setSinks(Array.isArray(result) ? result : []);
            setError("");
        } catch (e) {
            setError("Could not read audio devices.");
        }
    };

    R.useEffect(() => {
        refresh();
        // The 2.4GHz dongle disappears when the headset powers off, so re-poll
        // while the panel is open rather than trusting the first read.
        const timer = window.setInterval(refresh, 4000);
        return () => window.clearInterval(timer);
    }, []);

    const pick = async (sink) => {
        setBusy(true);
        try {
            const result = await setSink(sink.name);
            if (result && result.ok) {
                toaster.toast({ title: "Audio Output", body: sink.label });
            } else {
                setError((result && result.error) || "Switch failed.");
            }
            await refresh();
        } catch (e) {
            setError("Switch failed.");
        } finally {
            setBusy(false);
        }
    };

    const rows = sinks.map((sink) =>
        h(
            DFL.PanelSectionRow,
            { key: sink.name },
            h(
                DFL.ButtonItem,
                {
                    layout: "below",
                    disabled: busy || sink.active,
                    onClick: () => pick(sink),
                },
                (sink.active ? "●  " : "") + sink.label
            )
        )
    );

    if (!rows.length) {
        rows.push(
            h(
                DFL.PanelSectionRow,
                { key: "__empty" },
                h("div", { style: { opacity: 0.6 } }, "No outputs found.")
            )
        );
    }

    if (error) {
        rows.push(
            h(
                DFL.PanelSectionRow,
                { key: "__error" },
                h("div", { style: { color: "#e05c5c" } }, error)
            )
        );
    }

    return h(DFL.PanelSection, { title: "Output Device" }, rows);
}

// Own entry in the QAM tab rail. tabsHook is Decky-internal rather than part of
// the plugin api object, so every access is guarded: if Decky changes it, we
// silently fall back to the normal Decky-panel section instead of breaking.
// Off by default: tabsHook is Decky-internal and the id is hardcoded, so two
// plugins doing this would collide. See README "QAM tab rail".
const ENABLE_QAM_TAB = false;
const TAB_ID = 998;

function tabsHook() {
    const loader = window.DeckyPluginLoader;
    const hook = loader && loader.tabsHook;
    if (!hook || !Array.isArray(hook.tabs) || typeof hook.removeById !== "function") {
        return null;
    }
    return hook;
}

function registerTab() {
    try {
        const hook = tabsHook();
        if (!hook) {
            console.warn("[audio-output-switcher] tabsHook unavailable, QAM tab skipped");
            return;
        }
        // Drop any stale copy first so a plugin reload cannot double-register.
        hook.removeById(TAB_ID);
        // unshift, not add(): render() pushes in array order, and we want to
        // land ahead of Decky's own tab (id 999) in the rail.
        hook.tabs.unshift({
            id: TAB_ID,
            title: h("div", null, "Audio Output"),
            icon: h(SpeakerIcon, null),
            content: h(Content, null),
        });
    } catch (e) {
        console.error("[audio-output-switcher] could not register QAM tab:", e);
    }
}

function unregisterTab() {
    try {
        const hook = tabsHook();
        if (hook) hook.removeById(TAB_ID);
    } catch (e) {
        console.error("[audio-output-switcher] could not remove QAM tab:", e);
    }
}

const index = definePlugin(() => {
    if (ENABLE_QAM_TAB) registerTab();
    return {
        name: "Audio Output Switcher",
        title: h("div", { className: DFL.staticClasses.Title }, "Audio Output"),
        content: h(Content, null),
        icon: h(SpeakerIcon, null),
        onDismount() {
            if (ENABLE_QAM_TAB) unregisterTab();
        },
    };
});

export { index as default };
