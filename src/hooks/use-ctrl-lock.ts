import { useEffect, useState } from "react";

// Global "Ctrl-lock" state shared between the left and right sidebars.
// Double-tapping the Ctrl key (two quick taps with no other key pressed
// between them) cycles the mode:
//   none   → closed (both sidebars visibly closed, hover disabled)
//   closed → open   (both sidebars visibly open, hover disabled)
//   open   → closed (and so on)
//
// While the mode is "open" or "closed" the effective visibility is forced
// and hover handlers are gated off. Each side tracks its own mode so that
// manually clicking one sidebar's toggle button unlocks only that side —
// the other stays in whatever forced state the ctrl-tap left it in until
// the user interacts with it directly.

const DOUBLE_TAP_GAP_MS = 350;

export type CtrlLockMode = "none" | "open" | "closed";
export type CtrlLockSide = "left" | "right";

const modes: Record<CtrlLockSide, CtrlLockMode> = {
  left: "none",
  right: "none",
};
const listeners: Record<CtrlLockSide, Set<(m: CtrlLockMode) => void>> = {
  left: new Set(),
  right: new Set(),
};

function setMode(side: CtrlLockSide, next: CtrlLockMode): void {
  if (modes[side] === next) return;
  modes[side] = next;
  listeners[side].forEach((l) => l(next));
}

export function cycleCtrlLockOnDoubleTap(): void {
  // Both sides cycle together on a double-tap. Use the left side as the
  // reference for the current cycle position — they're kept in sync by
  // this function, and only diverge when the user manually unlocks one.
  const ref = modes.left;
  const next: CtrlLockMode =
    ref === "none" ? "closed" : ref === "closed" ? "open" : "closed";
  setMode("left", next);
  setMode("right", next);
}

export function unlockCtrlLock(side: CtrlLockSide): void {
  setMode(side, "none");
}

export function getCtrlLockMode(side: CtrlLockSide): CtrlLockMode {
  return modes[side];
}

// Hook into a component so re-renders fire when the mode changes.
export function useCtrlLockMode(side: CtrlLockSide): CtrlLockMode {
  const [value, setValue] = useState(modes[side]);
  useEffect(() => {
    listeners[side].add(setValue);
    return () => {
      listeners[side].delete(setValue);
    };
  }, [side]);
  return value;
}

// Install once at the app root. Detects two Ctrl-only taps inside
// DOUBLE_TAP_GAP_MS and calls cycleCtrlLockOnDoubleTap. If any other
// key is pressed while Ctrl is held (Ctrl+C, Ctrl+Shift+T, etc.), the
// sequence is treated as a modifier use and not a tap.
export function installCtrlLockListener(): () => void {
  let lastTapAt = 0;
  let usedAsModifier = false;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Control" && e.ctrlKey) usedAsModifier = true;
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== "Control") return;
    if (usedAsModifier) {
      usedAsModifier = false;
      lastTapAt = 0;
      return;
    }
    const now = Date.now();
    if (lastTapAt && now - lastTapAt < DOUBLE_TAP_GAP_MS) {
      cycleCtrlLockOnDoubleTap();
      lastTapAt = 0;
    } else {
      lastTapAt = now;
    }
  };

  const onBlur = () => {
    lastTapAt = 0;
    usedAsModifier = false;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  };
}
