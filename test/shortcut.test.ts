import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_GRACE_MS,
  CAPTURE_TIMEOUT_MS,
  comboLabel,
  createShortcut,
  type ShortcutEvent,
} from "../src/shortcut";

const L4 = 32, R4 = 33, A = 0;
const last = <T>(list: T[]) => list[list.length - 1];

function setup(stored = { enabled: true, buttons: [L4, R4] }) {
  const shortcut = createShortcut();
  shortcut.load(stored);
  const events: ShortcutEvent[] = [];
  shortcut.subscribe((e) => events.push(e));
  const press = (...buttons: number[]) => buttons.forEach((b) => shortcut.button(b, true));
  const release = (...buttons: number[]) => buttons.forEach((b) => shortcut.button(b, false));
  const fired = () => events.filter((e) => e.type === "fire").length;
  return { shortcut, events, press, release, fired };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("firing", () => {
  it("fires once per press of the whole combo, however long it is held", () => {
    const { press, release, fired } = setup();
    press(L4, R4, A);
    expect(fired()).toBe(1);
    release(A);
    press(A);
    expect(fired()).toBe(1);
    release(L4, R4, A);
    press(R4, L4);
    expect(fired()).toBe(2);
  });

  it("does not fire when disabled", () => {
    const { press, fired } = setup({ enabled: false, buttons: [L4, R4] });
    press(L4, R4);
    expect(fired()).toBe(0);
  });

  it("refuses to enable without a combo", () => {
    const { shortcut, events } = setup({ enabled: false, buttons: [] });
    shortcut.setEnabled(true);
    expect(shortcut.state().config.enabled).toBe(false);
    expect(events).toEqual([]);
  });

  it("forgets held buttons on reset, so a stale press cannot complete the combo", () => {
    const { shortcut, press, fired } = setup();
    press(L4);
    shortcut.reset();
    press(R4);
    expect(fired()).toBe(0);
  });
});

describe("recording", () => {
  it("records the combo on release, sorted, keeping enabled", () => {
    const { shortcut, events, press, release } = setup();
    shortcut.startCapture();
    vi.advanceTimersByTime(CAPTURE_GRACE_MS);
    press(R4, A);
    release(R4, A);
    expect(last(events)).toEqual({ type: "config", config: { enabled: true, buttons: [A, R4] } });
    expect(shortcut.state().capturing).toBe(false);
  });

  it("ignores the click that started it, inside the grace window", () => {
    const { shortcut, events, press, release } = setup();
    shortcut.startCapture();
    press(A);
    release(A);
    expect(shortcut.state().capturing).toBe(true);
    vi.advanceTimersByTime(CAPTURE_GRACE_MS);
    press(L4, R4);
    release(L4, R4);
    expect(last(events)).toMatchObject({ config: { buttons: [L4, R4] } });
  });

  it("excludes a button already held when recording began, until it is released", () => {
    const { shortcut, events, press, release } = setup();
    press(A);
    shortcut.startCapture();
    vi.advanceTimersByTime(CAPTURE_GRACE_MS);
    press(L4, R4);
    release(L4, R4, A);
    expect(last(events)).toMatchObject({ config: { buttons: [L4, R4] } });
  });

  it("refuses a single button and keeps the old combo", () => {
    const { shortcut, events, press, release } = setup();
    shortcut.startCapture();
    vi.advanceTimersByTime(CAPTURE_GRACE_MS);
    press(A);
    release(A);
    expect(last(events)).toEqual({ type: "tooShort" });
    expect(shortcut.state().config.buttons).toEqual([L4, R4]);
  });

  it("expires after the deadline with no input", () => {
    const { shortcut, events } = setup();
    shortcut.startCapture();
    vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS);
    expect(events.slice(-2)).toEqual([{ type: "capture", capturing: false }, { type: "expired" }]);
  });

  it("measures the deadline from the last input, so a long hold is not cut off", () => {
    const { shortcut, events, press, release } = setup();
    shortcut.startCapture();
    vi.advanceTimersByTime(CAPTURE_GRACE_MS);
    press(L4);
    vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS - 1);
    press(R4);
    vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS - 1);
    release(L4, R4);
    expect(events.some((e) => e.type === "expired")).toBe(false);
    expect(last(events)).toMatchObject({ config: { buttons: [L4, R4] } });
  });

  it("does not fire the old combo while recording", () => {
    const { shortcut, press, fired } = setup();
    shortcut.startCapture();
    vi.advanceTimersByTime(CAPTURE_GRACE_MS);
    press(L4, R4);
    expect(fired()).toBe(0);
  });

  it("leaves nothing armed after a cancel", () => {
    const { shortcut, events, press, release } = setup();
    shortcut.startCapture();
    shortcut.cancelCapture();
    vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS);
    press(A, R4);
    release(A, R4);
    expect(events.map((e) => e.type)).toEqual(["capture", "capture"]);
  });
});

describe("binding", () => {
  it("does not echo the stored binding as a change", () => {
    const { events } = setup();
    expect(events).toEqual([]);
  });

  it("clears to unbound and disabled", () => {
    const { shortcut, events } = setup();
    shortcut.clear();
    expect(events).toEqual([{ type: "config", config: { enabled: false, buttons: [] } }]);
  });

  it("labels buttons, and unknown ids by number", () => {
    expect(comboLabel([L4, R4])).toBe("L4 + R4");
    expect(comboLabel([99])).toBe("BTN99");
    expect(comboLabel([])).toBe("Not set");
  });
});
