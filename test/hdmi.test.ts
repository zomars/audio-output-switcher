import { describe, expect, it } from "vitest";
import { monitorChoices, type HdmiCard } from "../src/hdmi";
import oneTv from "./fixtures/hdmi-steam-machine-one-tv.json";
import twoMonitors from "./fixtures/hdmi-two-monitors.json";

const cards = (json: unknown) => json as HdmiCard[];
const withProfile = (list: HdmiCard[], active: string) =>
  list.map((c) => ({ ...c, active_profile: active }));

describe("monitorChoices", () => {
  it("offers nothing with one monitor connected", () => {
    expect(monitorChoices(cards(oneTv))).toEqual([]);
  });

  it("offers each connected monitor by its EDID name, the active one marked", () => {
    expect(monitorChoices(cards(twoMonitors.cards))).toEqual([
      { card: "alsa_card.pci-0000_03_00.1", port: "hdmi-output-0", label: "Sceptre N55",
        profile: "output:hdmi-stereo", active: true },
      { card: "alsa_card.pci-0000_03_00.1", port: "hdmi-output-1", label: "DELL P2419H",
        profile: "output:hdmi-stereo-extra1", active: false },
    ]);
  });

  it("keeps the surround choice when moving to the other monitor", () => {
    const list = withProfile(cards(twoMonitors.cards), "output:hdmi-surround").map((c) => ({
      ...c,
      profiles: { ...c.profiles, "output:hdmi-surround": true },
    }));
    expect(monitorChoices(list).map((c) => c.profile)).toEqual([
      "output:hdmi-surround",
      "output:hdmi-surround-extra1",
    ]);
  });

  it("falls back to stereo when the other port lacks the current family", () => {
    // 7.1 exists only on the extra ports of this card.
    const list = withProfile(cards(twoMonitors.cards), "output:hdmi-surround71-extra1");
    expect(monitorChoices(list)[0].profile).toBe("output:hdmi-stereo");
  });

  it("marks nothing active while the card is off", () => {
    const list = withProfile(cards(twoMonitors.cards), "off");
    expect(monitorChoices(list).some((c) => c.active)).toBe(false);
  });

  it("names a monitor without EDID after its port", () => {
    const list = cards(twoMonitors.cards).map((c) => ({
      ...c,
      ports: { ...c.ports, "hdmi-output-1": { ...c.ports["hdmi-output-1"], monitor: null } },
    }));
    expect(monitorChoices(list)[1].label).toBe("HDMI 2");
  });

  it("skips profiles PipeWire marks unavailable", () => {
    const list = cards(twoMonitors.cards).map((c) => ({
      ...c,
      profiles: { ...c.profiles, "output:hdmi-stereo-extra1": false },
    }));
    expect(monitorChoices(list)[1].profile).toBe("output:hdmi-surround-extra1");
  });
});
