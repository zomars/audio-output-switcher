// The Combo shortcut: a held button combo that cycles the output, and the
// recording of that combo. Button events in, typed events out -- no Steam, no
// Decky, no storage -- so every timing rule here can be replayed in a test.

export interface Shortcut {
  enabled: boolean;
  buttons: number[];
}

export type ShortcutEvent =
  /** The combo went down: cycle the output. */
  | { type: "fire" }
  /** The binding changed: save it. Not sent for load(). */
  | { type: "config"; config: Shortcut }
  | { type: "capture"; capturing: boolean }
  /** A recording finished with fewer than MIN_COMBO buttons; nothing saved. */
  | { type: "tooShort" }
  /** A recording got no input before the deadline; nothing saved. */
  | { type: "expired" };

// A single button would fire every time it is pressed for its normal purpose.
export const MIN_COMBO = 2;

// The A press that clicks "record" arrives AFTER capture starts, so without a
// guard it would record itself and close the capture on its own. Two protections,
// both learned from the Steamcord plugin, which hit this as a user-reported bug:
// a grace window that ignores the click's own events, and excluding anything
// already held when capture began, for when A's press is processed first instead.
export const CAPTURE_GRACE_MS = 250;

// Recording has to end on its own if the buttons never come. Closing the Quick
// Access Menu with the ... button does not reach the input stream, so without a
// deadline an abandoned capture would sit armed and swallow the next two buttons
// pressed together in a game, overwriting the saved combo with them. Measured
// from the last input rather than from the start, so a long hold is never cut
// off mid-combo.
export const CAPTURE_TIMEOUT_MS = 10000;

// EGamepadButton, read out of Steam's bundle. Unknown ids show as BTN<n>: capture
// makes the name cosmetic, and a wrong guess would be worse than a raw number.
// 20-23 are direction events, and Steam merges the D-pad and the left stick into
// them -- the two cannot be told apart, so they share one label.
const BUTTON_NAMES: Record<number, string> = {
  0: "A", 1: "B", 2: "X", 3: "Y",
  4: "D-Up", 5: "D-Right", 6: "D-Down", 7: "D-Left",
  8: "Menu", 9: "View",
  20: "Up", 21: "Down", 22: "Left", 23: "Right",
  28: "LT", 29: "RT", 30: "L1", 31: "R1",
  32: "L4", 33: "R4", 34: "Steam", 35: "Select", 36: "Start",
  37: "L-Pad", 39: "R-Pad", 44: "L5", 45: "R5",
};

export function comboLabel(buttons: number[]): string {
  if (!buttons.length) return "Not set";
  return buttons.map((b) => BUTTON_NAMES[b] || `BTN${b}`).join(" + ");
}

export function createShortcut() {
  let config: Shortcut = { enabled: false, buttons: [] };
  const listeners = new Set<(event: ShortcutEvent) => void>();
  const held = new Set<number>();

  // Latched so holding the combo fires once, on the press that completes it,
  // instead of repeating for every further button that happens to go down.
  let comboHeld = false;

  let capturing = false;
  let captureStart = 0;
  let captureTimer: ReturnType<typeof setTimeout> | undefined;
  const captured = new Set<number>();
  const preHeld = new Set<number>();

  const emit = (event: ShortcutEvent) => listeners.forEach((listener) => listener(event));
  const ready = () => config.buttons.length >= MIN_COMBO;

  const setConfig = (next: Shortcut) => {
    config = next;
    emit({ type: "config", config });
  };

  /** Disarm recording. The one place that clears it, so no path can leave
   *  the capture armed with the panel gone. */
  const endCapture = () => {
    clearTimeout(captureTimer);
    captureTimer = undefined;
    captured.clear();
    preHeld.clear();
    if (!capturing) return;
    capturing = false;
    emit({ type: "capture", capturing: false });
  };

  const armDeadline = () => {
    clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      endCapture();
      emit({ type: "expired" });
    }, CAPTURE_TIMEOUT_MS);
  };

  const finishCapture = () => {
    const buttons = [...captured].sort((a, b) => a - b);
    endCapture();
    // Too short a combo would fire during ordinary play, so refuse it rather
    // than saving something that turns the shortcut into a nuisance.
    if (buttons.length < MIN_COMBO) emit({ type: "tooShort" });
    else setConfig({ ...config, buttons });
  };

  return {
    state: () => ({ config, capturing, ready: ready() }),

    subscribe(listener: (event: ShortcutEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** The stored binding, at startup. Not echoed as a "config" event. */
    load(stored: Shortcut) {
      config = stored;
    },

    setEnabled(enabled: boolean) {
      if (enabled && !ready()) return;
      setConfig({ ...config, enabled });
    },

    clear() {
      setConfig({ enabled: false, buttons: [] });
    },

    startCapture() {
      endCapture();
      held.forEach((b) => preHeld.add(b));
      captureStart = Date.now();
      capturing = true;
      emit({ type: "capture", capturing: true });
      armDeadline();
    },

    cancelCapture: endCapture,

    /** Steam's input stream died and was re-subscribed (after a suspend): what
     *  was held before is unknown now. */
    reset() {
      endCapture();
      held.clear();
      comboHeld = false;
    },

    button(button: number, pressed: boolean) {
      if (pressed) held.add(button);
      else held.delete(button);

      if (capturing) {
        armDeadline();
        if (pressed) {
          if (Date.now() - captureStart < CAPTURE_GRACE_MS || preHeld.has(button)) {
            preHeld.add(button);
          } else {
            captured.add(button);
          }
        } else {
          // Released means no longer excluded: the same button can then be recorded.
          preHeld.delete(button);
          if (captured.size && held.size === 0) finishCapture();
        }
        return;
      }

      const active = config.enabled && ready() && config.buttons.every((b) => held.has(b));
      if (active && !comboHeld) emit({ type: "fire" });
      comboHeld = active;
    },
  };
}

export type ShortcutModule = ReturnType<typeof createShortcut>;
