import { ButtonItem, PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { useEffect, useState } from "react";

interface Sink {
  name: string;
  label: string;
  active: boolean;
  state: string;
}

interface SwitchResult {
  ok: boolean;
  moved?: number;
  error?: string;
}

const listSinks = callable<[], Sink[]>("list_sinks");
const setSink = callable<[string], SwitchResult>("set_sink");

// Adds an icon to the QAM tab rail, ahead of Decky's own tab.
//
// This is OFF by default because it reaches into `window.DeckyPluginLoader`,
// which is Decky-internal and not part of the plugin API. The tab id below is
// hardcoded, so two plugins doing this would collide. Flip to true only for a
// personal build. See the README section "QAM tab rail".
const ENABLE_QAM_TAB = false;
const TAB_ID = 998;

function SpeakerIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" />
    </svg>
  );
}

function Content() {
  const [sinks, setSinks] = useState<Sink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const result = await listSinks();
      setSinks(Array.isArray(result) ? result : []);
      setError("");
    } catch {
      setError("Could not read audio devices.");
    }
  };

  useEffect(() => {
    refresh();
    // Wireless dongles drop their sink when the headset powers off, so repoll
    // while the panel is open rather than trusting the first read.
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const pick = async (sink: Sink) => {
    setBusy(true);
    try {
      const result = await setSink(sink.name);
      if (result?.ok) {
        toaster.toast({ title: "Audio Output", body: sink.label });
      } else {
        setError(result?.error || "Switch failed.");
      }
      await refresh();
    } catch {
      setError("Switch failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelSection title="Output Device">
      {sinks.map((sink) => (
        <PanelSectionRow key={sink.name}>
          <ButtonItem
            layout="below"
            disabled={busy || sink.active}
            onClick={() => pick(sink)}
          >
            {(sink.active ? "●  " : "") + sink.label}
          </ButtonItem>
        </PanelSectionRow>
      ))}
      {sinks.length === 0 && (
        <PanelSectionRow>
          <div style={{ opacity: 0.6 }}>No outputs found.</div>
        </PanelSectionRow>
      )}
      {error !== "" && (
        <PanelSectionRow>
          <div style={{ color: "#e05c5c" }}>{error}</div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}

function tabsHook(): any | null {
  // @ts-ignore - Decky-internal, deliberately not in the public API surface.
  const loader = window.DeckyPluginLoader;
  const hook = loader?.tabsHook;
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
    // unshift, not add(): render() pushes in array order, and add() would land
    // us after Decky's own tab (id 999) rather than before it.
    hook.tabs.unshift({
      id: TAB_ID,
      title: <div>Audio Output</div>,
      icon: <SpeakerIcon />,
      content: <Content />,
    });
  } catch (e) {
    console.error("[audio-output-switcher] could not register QAM tab:", e);
  }
}

function unregisterTab() {
  try {
    tabsHook()?.removeById(TAB_ID);
  } catch (e) {
    console.error("[audio-output-switcher] could not remove QAM tab:", e);
  }
}

export default definePlugin(() => {
  if (ENABLE_QAM_TAB) registerTab();
  return {
    name: "Audio Output Switcher",
    title: <div className={staticClasses.Title}>Audio Output</div>,
    content: <Content />,
    icon: <SpeakerIcon />,
    onDismount() {
      if (ENABLE_QAM_TAB) unregisterTab();
    },
  };
});
