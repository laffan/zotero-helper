// Reading mode's notepad: a floating pad for the Apple Pencil, opened by
// the red rectangle at the window's top right (ReadingModeExit.tsx) —
// NotepadBody (its bar and canvas) in a window of its own. The bar's
// empty middle drags it about; the dotted circle at its corner sizes
// it; where it sits is this device's. One pad per PDF
// (src/notepad/model.ts), the same one the notes pane can show.
import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { CloseIcon } from "./Icons";
import { NotepadBody } from "./NotepadBody";

const BOX_KEY = "zh-notepad-box";
type Box = { left: number; top: number; width: number; height: number };

function storedBox(): Box {
  const fallback = { left: Math.max(16, window.innerWidth - 420), top: 70, width: 380, height: 460 };
  try {
    const b = JSON.parse(localStorage.getItem(BOX_KEY) ?? "null") as Box | null;
    return b && Number.isFinite(b.left) ? b : fallback;
  } catch {
    return fallback;
  }
}

/** Kept on screen, whatever size the window is now. */
function clampBox(b: Box): Box {
  const width = Math.max(240, Math.min(b.width, window.innerWidth - 16));
  const height = Math.max(200, Math.min(b.height, window.innerHeight - 16));
  return {
    width,
    height,
    left: Math.max(8, Math.min(b.left, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(b.top, window.innerHeight - height - 8)),
  };
}

/** Follow a pointer from a press until it lets go. */
function follow(e: React.PointerEvent, move: (dx: number, dy: number, ev: PointerEvent) => void, up: (ev: PointerEvent, moved: boolean) => void): void {
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    moved ||= Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4;
    if (moved) move(ev.clientX - x0, ev.clientY - y0, ev);
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    up(ev, moved);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

export function ReadingNotepad({ attKey }: { attKey: string }) {
  const [box, setBox] = useState(() => clampBox(storedBox()));

  useEffect(() => {
    try {
      localStorage.setItem(BOX_KEY, JSON.stringify(box));
    } catch {
      /* storage unavailable: it opens at the default */
    }
  }, [box]);

  const close = () => useStore.getState().setNotepadOpen(false);

  return (
    <div className="notepad notepad-floating" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <NotepadBody
        attKey={attKey}
        onBarPointerDown={(e) => {
          const start = box;
          follow(
            e,
            (dx, dy) => setBox(clampBox({ ...start, left: start.left + dx, top: start.top + dy })),
            () => {},
          );
        }}
        trailing={
          <button type="button" className="notepad-tool" title="Close the notepad" aria-label="Close the notepad" onClick={close}>
            <CloseIcon size={13} />
          </button>
        }
      />
      <div
        className="notepad-grip"
        title="Drag to size the notepad"
        onPointerDown={(e) => {
          const start = box;
          follow(
            e,
            (dx, dy) => setBox(clampBox({ ...start, width: start.width + dx, height: start.height + dy })),
            () => {},
          );
        }}
      />
    </div>
  );
}
