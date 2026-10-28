// The Pencil's eraser, one switch for both places it writes: the pages'
// ink mode (src/pdfviewer/ink/) and the notepad (src/notepad/). Each
// kept its own, and the Pencil's double-tap went to whichever the Pencil
// had last touched — so the two disagreed, and the notepad could be
// left erasing while the pages wrote. Now erasing is one state: either
// one's eraser button, or the double-tap, turns it on or off in both
// (this device's, `zh-erasing`).
//
// The double-tap (lib/pencil.ts's "zh-pencil", kind "tap", or a
// squeeze set to switch to the eraser) is heard here, once, while
// something is there to erase with: ink mode on, or a notepad shown.
const KEY = "zh-erasing";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let erasing = stored();
const watchers = new Set<(on: boolean) => void>();

export const isErasing = (): boolean => erasing;

export function setErasing(on: boolean): void {
  if (on === erasing) return;
  erasing = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  for (const fn of watchers) fn(on);
}

/** Hear the eraser go on or off. */
export function watchErasing(fn: (on: boolean) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

if (typeof window !== "undefined") {
  window.addEventListener("zh-pencil", (e) => {
    const { kind, action } = (e as CustomEvent<{ kind?: string; action?: string }>).detail ?? {};
    if (kind !== "tap" && action !== "switchEraser") return;
    if (!document.querySelector(".pdf-ink-active, .notepad-canvas")) return;
    setErasing(!erasing);
  });
}
