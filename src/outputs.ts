// The Output list: which of Steam's audio devices the plugin offers, in what
// order, and which comes next. Plain data in, plain data out -- no Steam, no
// Decky -- so every rule here runs against recorded GetDevices() snapshots.

export interface Output {
  id: number;
  sName: string;
  bHasOutput: boolean;
  availableConfigs?: number[];
  eBus?: number;
}

/** What SteamClient.System.Audio.GetDevices() resolves to, as far as we read it. */
export interface DevicesSnapshot {
  vecDevices?: Output[];
  activeOutputDeviceId?: number;
  overrideOutputDeviceId?: number;
}

export interface OutputList {
  /** Real outputs in label order. The shortcut walks this; it never reshuffles. */
  cycle: Output[];
  /** The same outputs with the active one first, for the panel. */
  shown: Output[];
  active: Output | undefined;
  /** The output after the active one in cycle order; null with fewer than two. */
  next: Output | null;
  /** The user pinned an output, so "Follow system default" means something. */
  overridden: boolean;
}

// EAudioBus.Unknown, read out of Steam's bundle.
const EBUS_UNKNOWN = 0;

/** A sink someone could mean to pick.
 *
 * Measured on hardware rather than matched by name: HDMI and a USB headset both
 * report availableConfigs [1] and a described currentConfig, while
 * steam-streaming-playback -- the sink a Remote Play session parks on, and one
 * that really does turn up in GetDevices() with bHasOutput set -- reports no
 * configs at all, eConfig 0, an empty description, and connector and bus 0.
 * Plain null sinks look the same. Picking one silences the speakers with no way
 * to tell why, so they do not belong in the list.
 *
 * Configs alone are not enough: a Steam Deck's built-in audio (the ACP device,
 * speakers and headphone jack together) also reports no configs and eConfig 0.
 * It does sit on a real bus (Pci), which a virtual sink never does.
 */
function isRealOutput(device: Output): boolean {
  return (device.availableConfigs?.length ?? 0) > 0 || (device.eBus ?? 0) !== EBUS_UNKNOWN;
}

/** Outputs as Steam sees them.
 *
 * This is not the raw PipeWire sink list. Steam collapses some sinks into one
 * device -- a Deck's speakers and headphone jack arrive as a single entry, which
 * is why a handheld with nothing attached has exactly one output to pick.
 *
 * `label` is the name the user sees; it also sets the order. It defaults to
 * Steam's raw name.
 */
export function outputList(
  snapshot: DevicesSnapshot | undefined,
  label: (output: Output) => string = (output) => output.sName,
): OutputList {
  const outputs = (snapshot?.vecDevices ?? []).filter((d) => d?.bHasOutput);
  const real = outputs.filter(isRealOutput);
  // Never leave someone with an empty panel over a heuristic: if a build reports
  // devices differently and nothing passes, show everything rather than nothing.
  const cycle = (real.length ? real : outputs).sort((a, b) => label(a).localeCompare(label(b)));

  const activeId = snapshot?.activeOutputDeviceId ?? -1;
  const index = cycle.findIndex((d) => d.id === activeId);
  const active = cycle[index];

  // "Next" in the unpinned order: pinning the active device first would make it
  // the first name every time, and a third device would never come up.
  const next = cycle.length < 2 ? null : cycle[(index + 1) % cycle.length];

  return {
    cycle,
    shown: active ? [active, ...cycle.filter((d) => d !== active)] : cycle,
    active,
    next,
    overridden: (snapshot?.overrideOutputDeviceId ?? -1) !== -1,
  };
}
