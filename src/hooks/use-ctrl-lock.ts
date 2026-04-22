import { useEffect, useState } from "react";

// Global "Ctrl-lock" state shared between the left and right sidebars.
// Double-tapping the Ctrl key (two quick taps with no other key pressed
// between them) cycles the mode:
//   none   → closed (both sidebars visibly closed, hover disabled)
//   closed → open   (both sidebars visibly open, hover disabled)
//   open   → closed (and so on)
//
// While the mode is "open" or "closed" the effective visibility is forced
// and hover handlers are gated off. The mode clears to "none" when the
// user manually clicks either sidebar's toggle button — picked up by
// each sidebar calling unlockCtrlLock() from its setIsSidebarOpen wrapper.

const DOUBLE_TAP_GAP_MS = 350;

export type CtrlLockMode = "none" | "open" | "closed";

let mode: CtrlLockMode = "none";
const listeners = new Set<(m: CtrlLockMode) => void>();

function setMode(next: CtrlLockMode): void {
  if (mode === next) return;
  mode = next;
  listeners.forEach((l) => l(mode));
}

export function cycleCtrlLockOnDoubleTap(): void {
  // none → closed (first double-tap collapses both sidebars for a
  // distraction-free terminal view).
  // closed → open (next double-tap opens both).
  // open → closed (cycle back).
  if (mode === "none") setMode("closed");
  else if (mode === "closed") setMode("open");
  else setMode("closed");
}

export function unlockCtrlLock(): void {
  setMode("none");
}

export function getCtrlLockMode(): CtrlLockMode {
  return mode;
}

// Hook into a component so re-renders fire when the mode changes.
export function useCtrlLockMode(): CtrlLockMode {
  const [value, setValue] = useState(mode);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
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
