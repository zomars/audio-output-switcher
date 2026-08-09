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

const listSinks = callable("list_sinks");
const setSink = callable("set_sink");
function SpeakerIcon() {
    return (SP_JSX.jsx("svg", { width: "1em", height: "1em", viewBox: "0 0 24 24", fill: "currentColor", children: SP_JSX.jsx("path", { d: "M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" }) }));
}
function Content() {
    const [sinks, setSinks] = SP_REACT.useState([]);
    const [busy, setBusy] = SP_REACT.useState(false);
    const [error, setError] = SP_REACT.useState("");
    const refresh = async () => {
        try {
            const result = await listSinks();
            setSinks(Array.isArray(result) ? result : []);
            setError("");
        }
        catch {
            setError("Could not read audio devices.");
        }
    };
    SP_REACT.useEffect(() => {
        refresh();
        // Wireless dongles drop their sink when the headset powers off, so repoll
        // while the panel is open rather than trusting the first read.
        const timer = window.setInterval(refresh, 4000);
        return () => window.clearInterval(timer);
    }, []);
    const pick = async (sink) => {
        setBusy(true);
        try {
            const result = await setSink(sink.name);
            if (result?.ok) {
                toaster.toast({ title: "Audio Output", body: sink.label });
            }
            else {
                setError(result?.error || "Switch failed.");
            }
            await refresh();
        }
        catch {
            setError("Switch failed.");
        }
        finally {
            setBusy(false);
        }
    };
    return (SP_JSX.jsxs(DFL.PanelSection, { title: "Output Device", children: [sinks.map((sink) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy || sink.active, onClick: () => pick(sink), children: (sink.active ? "●  " : "") + sink.label }) }, sink.name))), sinks.length === 0 && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { opacity: 0.6 }, children: "No outputs found." }) })), error !== "" && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { color: "#e05c5c" }, children: error }) }))] }));
}
var index = definePlugin(() => {
    return {
        name: "Audio Output Switcher",
        title: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "Audio Output" }),
        content: SP_JSX.jsx(Content, {}),
        icon: SP_JSX.jsx(SpeakerIcon, {}),
        onDismount() {
        },
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
