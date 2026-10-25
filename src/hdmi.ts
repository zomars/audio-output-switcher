// HDMI monitors: which port of an HDMI card plays. Steam shows the whole card as
// one output and cannot pick the port; a card profile can. Plain data in (the
// cards main.py reads from pactl), plain data out, so it runs against fixtures.

export interface HdmiPort {
  availability: string | null;
  profiles: string[];
  /** The monitor's name from its EDID, when it sent one. */
  monitor: string | null;
}

export interface HdmiCard {
  name: string;
  active_profile: string | null;
  /** Profile name to whether PipeWire says it is available. */
  profiles: Record<string, boolean>;
  ports: Record<string, HdmiPort>;
}

export interface MonitorChoice {
  card: string;
  port: string;
  label: string;
  /** The profile to set to play on this monitor. */
  profile: string;
  active: boolean;
}

// "output:hdmi-surround-extra2" and "output:hdmi-surround" are one family on
// two ports. Keeping the family keeps someone's 5.1 choice when they switch.
const family = (profile: string) => profile.replace(/-extra\d+$/, "");

/** One choice per connected monitor, for cards with at least two connected.
 *  A card with one monitor has nothing to choose, so it adds nothing. */
export function monitorChoices(cards: HdmiCard[] | undefined): MonitorChoice[] {
  const choices: MonitorChoice[] = [];
  for (const card of cards ?? []) {
    const connected = Object.entries(card.ports)
      .filter(([, port]) => port.availability === "available")
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    if (connected.length < 2) continue;

    const current = card.active_profile ?? "";
    for (const [name, port] of connected) {
      const usable = port.profiles.filter((p) => card.profiles[p] !== false);
      const profile =
        usable.find((p) => family(p) === family(current)) ??
        usable.find((p) => family(p) === "output:hdmi-stereo") ??
        usable[0];
      if (!profile) continue;
      choices.push({
        card: card.name,
        port: name,
        label: port.monitor || `HDMI ${Number(name.match(/\d+$/)?.[0] ?? 0) + 1}`,
        profile,
        active: port.profiles.includes(current),
      });
    }
  }
  return choices;
}
