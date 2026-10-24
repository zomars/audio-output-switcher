import { describe, expect, it } from "vitest";
import { outputList, type DevicesSnapshot } from "../src/outputs";
import deckOnboard from "./fixtures/steam-deck-onboard-only.json";
import deckUsb from "./fixtures/steam-deck-usb-headset.json";
import machine from "./fixtures/steam-machine-hdmi-usb-headset.json";
import remotePlay from "./fixtures/steam-machine-remote-play.json";

const names = (list: { sName: string }[]) => list.map((d) => d.sName);
const ACP = "ACP/ACP3X/ACP6x Audio Coprocessor";

describe("outputList", () => {
  it("keeps a Deck's onboard audio next to a USB headset (PR #1103)", () => {
    const list = outputList(deckUsb);
    expect(names(list.cycle)).toEqual([ACP, "TUF H3 Wireless"]);
    expect(list.active?.sName).toBe("TUF H3 Wireless");
    expect(list.next?.sName).toBe(ACP);
  });

  it("lists a Deck's onboard audio alone, and drops the HDMI controller with no output", () => {
    const list = outputList(deckOnboard);
    expect(names(list.shown)).toEqual([ACP]);
    expect(list.next).toBeNull();
  });

  it("hides the Remote Play sink", () => {
    expect(names(outputList(remotePlay).cycle)).toEqual([
      "HDMI / DisplayPort",
      "Razer Barracuda X 2.4",
    ]);
  });

  it("pins the active output first for display, but cycles in label order", () => {
    const snapshot = { ...machine, activeOutputDeviceId: 47 };
    const list = outputList(snapshot);
    expect(names(list.shown)).toEqual(["Razer Barracuda X 2.4", "HDMI / DisplayPort"]);
    expect(names(list.cycle)).toEqual(["HDMI / DisplayPort", "Razer Barracuda X 2.4"]);
    expect(list.next?.sName).toBe("HDMI / DisplayPort");
  });

  it("orders by the label it is given, not the raw name", () => {
    // Raw names put ACP first; a label that sorts after the headset must win.
    const list = outputList(deckUsb, (d) => (d.sName === ACP ? "Zz speakers" : d.sName));
    expect(names(list.cycle)).toEqual(["TUF H3 Wireless", ACP]);
  });

  it("starts the cycle at the first output when the active one is not listed", () => {
    const list = outputList({ ...machine, activeOutputDeviceId: 999 });
    expect(list.active).toBeUndefined();
    expect(list.next?.sName).toBe("HDMI / DisplayPort");
  });

  it("shows every output rather than none when nothing looks real", () => {
    const snapshot: DevicesSnapshot = {
      activeOutputDeviceId: 1,
      vecDevices: [
        { id: 1, sName: "b", bHasOutput: true, availableConfigs: [], eBus: 0 },
        { id: 2, sName: "a", bHasOutput: true },
      ],
    };
    expect(names(outputList(snapshot).cycle)).toEqual(["a", "b"]);
  });

  it("reports an override only when one is set", () => {
    expect(outputList({ ...machine, overrideOutputDeviceId: -1 }).overridden).toBe(false);
    expect(outputList({ ...machine, overrideOutputDeviceId: 47 }).overridden).toBe(true);
  });

  it("copes with no snapshot at all", () => {
    expect(outputList(undefined)).toEqual({
      cycle: [], shown: [], active: undefined, next: null, overridden: false,
    });
  });
});
