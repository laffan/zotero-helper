// Reading mode's notepad: a pad for the Apple Pencil, opened by the red
// rectangle at the window's top right (ReadingModeExit.tsx) —
// NotepadBody (its bar and canvas) in a window of its own. It floats:
// the bar's empty middle drags it about, the dotted circle at its corner
// sizes it. Or it docks: let go with the pointer at the window's left or
// right edge (the edge it would take shows as it nears) and it becomes a
// full-height column there, taking its width from the pages' room (they
// are laid out again beside it); its inner edge sizes it, and pulling
// its bar away from the edge floats it again. Where it sits, floating or
// docked, is this device's. One pad per PDF (src/notepad/model.ts), the
// same one the notes pane can show.
import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { CloseIcon } from "./Icons";
import { NotepadBody } from "./NotepadBody";

// Version 2: the default became 80% of the window's height.
const BOX_KEY = "zh-notepad-box-2";
type Box = { left: number; top: number; width: number; height: number };

function storedBox(): Box {
  // At the right, four-fifths of the window's height, centred on it.
  const height = Math.round(window.innerHeight * 0.8);
  const fallback = {
    left: Math.max(16, window.innerWidth - 420),
    top: Math.round((window.innerHeight - height) / 2),
    width: 380,
    height,
  };
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

type Side = "left" | "right";
const DOCK_KEY = "zh-notepad-dock";
/** How near an edge the pointer comes for the pad to dock there, and how
 *  far a docked pad's bar is pulled before it floats again. */
const DOCK_EDGE_PX = 28;
const UNDOCK_PX = 40;

function storedDock(): { side: Side | null; width: number } {
  try {
    const d = JSON.parse(localStorage.getItem(DOCK_KEY) ?? "null") as { side: Side | null; width: number } | null;
    if (d && (d.side === null || d.side === "left" || d.side === "right") && Number.isFinite(d.width)) return d;
  } catch {
    /* storage unavailable */
  }
  return { side: null, width: 360 };
}

const clampWidth = (w: number) => Math.round(Math.max(240, Math.min(w, window.innerWidth * 0.6)));

export function ReadingNotepad({ attKey }: { attKey: string }) {
  const [box, setBox] = useState(() => clampBox(storedBox()));
  const [dock, setDock] = useState(storedDock);
  // The edge a floating pad being dragged would dock to, if let go now.
  const [preview, setPreview] = useState<Side | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(BOX_KEY, JSON.stringify(box));
      localStorage.setItem(DOCK_KEY, JSON.stringify(dock));
    } catch {
      /* storage unavailable: it opens at the default */
    }
  }, [box, dock]);

  // Docked, the pad takes its width from the pages' room: the reader and
  // what reading mode floats over it move in (readingmode.css).
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--notepad-dock-left", dock.side === "left" ? `${dock.width}px` : "0px");
    root.setProperty("--notepad-dock-right", dock.side === "right" ? `${dock.width}px` : "0px");
    return () => {
      root.removeProperty("--notepad-dock-left");
      root.removeProperty("--notepad-dock-right");
    };
  }, [dock]);

  const close = () => useStore.getState().setNotepadOpen(false);

  /** The bar dragged: a floating pad moves, and docks if let go at an
   *  edge; a docked one, pulled away from its edge, floats again under
   *  the pointer and carries on moving. */
  const dragBar = (e: React.PointerEvent) => {
    let docked = dock.side;
    let start = box;
    let grabX = 0;
    let grabY = 0;
    follow(
      e,
      (dx, dy, ev) => {
        if (docked) {
          if (Math.abs(dx) < UNDOCK_PX) return;
          docked = null;
          setDock((d) => ({ ...d, side: null }));
          // Floating again, the bar under the pointer as it was grabbed.
          grabX = Math.min(start.width / 2, 120);
          grabY = 16;
          start = clampBox({ ...start, left: ev.clientX - grabX, top: ev.clientY - grabY });
          setBox(start);
          grabX = ev.clientX - start.left;
          grabY = ev.clientY - start.top;
          return;
        }
        const left = grabX || grabY ? ev.clientX - grabX : start.left + dx;
        const top = grabX || grabY ? ev.clientY - grabY : start.top + dy;
        setBox(clampBox({ ...start, left, top }));
        setPreview(ev.clientX < DOCK_EDGE_PX ? "left" : ev.clientX > window.innerWidth - DOCK_EDGE_PX ? "right" : null);
      },
      (ev) => {
        setPreview(null);
        if (docked) return;
        const side = ev.clientX < DOCK_EDGE_PX ? "left" : ev.clientX > window.innerWidth - DOCK_EDGE_PX ? "right" : null;
        if (side) setDock((d) => ({ side, width: clampWidth(d.width) }));
      },
    );
  };

  const bar = (
    <NotepadBody
      attKey={attKey}
      kind="floating"
      onBarPointerDown={dragBar}
      trailing={
        <button type="button" className="notepad-tool" title="Close the notepad" aria-label="Close the notepad" onClick={close}>
          <CloseIcon size={13} />
        </button>
      }
    />
  );

  // One tree, floating or docked, so the pad (its undo, its pan) lives on
  // through the change.
  const side = dock.side;
  const style = side ? { width: dock.width } : { left: box.left, top: box.top, width: box.width, height: box.height };
  return (
    <>
      <div className={side ? `notepad notepad-edge notepad-edge-${side}` : "notepad notepad-floating"} style={style}>
        {bar}
        {side ? (
          <div
            className="notepad-edge-size"
            title="Drag to size the notepad"
            onPointerDown={(e) => {
              const w0 = dock.width;
              follow(
                e,
                (dx) => setDock({ side, width: clampWidth(side === "left" ? w0 + dx : w0 - dx) }),
                () => {},
              );
            }}
          />
        ) : (
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
        )}
      </div>
      {preview && <div className={`notepad-dock-preview notepad-dock-preview-${preview}`} style={{ width: clampWidth(dock.width) }} />}
    </>
  );
}
