// Reading mode's notepad: a floating pad for the Apple Pencil, opened by
// the red rectangle at the window's top right (ReadingModeExit.tsx). Its
// header drags it about (the grip at its corner sizes it); the canvas
// beneath is src/notepad/surface.ts — the Pencil writes, a finger pans,
// and a finger tap on a note goes back to where the reader was when it
// was written.
//
// LINK, at the header's left, makes a link: press it (with the Pencil,
// a finger or the mouse), drag onto the pages and let go over a
// highlight or a spot on a page, and a link to it lands on the pad, to
// be dragged where it belongs and tapped to go back there. One pad per
// PDF (src/notepad/model.ts); where the window sits is this device's.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { emptyNotepad, flushNotepad, loadNotepad, saveNotepadSoon, type Notepad } from "../notepad/model";
import { createSurface, type NotepadSurface } from "../notepad/surface";
import type { PlaceTarget } from "../pdfviewer/places";
import { CloseIcon } from "./Icons";
import { goToReaderPosition, readerPlace, readerPlaceAt, showInReader } from "./ReaderPane";

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
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<Notepad>(emptyNotepad());
  const surfaceRef = useRef<NotepadSurface | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(BOX_KEY, JSON.stringify(box));
    } catch {
      /* storage unavailable: it opens at the default */
    }
  }, [box]);

  // This PDF's pad, then the canvas over it.
  useEffect(() => {
    let cancelled = false;
    let surface: NotepadSurface | null = null;
    void loadNotepad(attKey).then((pad) => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      padRef.current = pad;
      surface = createSurface(host, {
        pad: () => padRef.current,
        changed: () => {
          saveNotepadSoon(attKey, padRef.current);
          setCanUndo(Boolean(surface?.canUndo()));
        },
        place: () => readerPlace(),
        goTo,
      });
      surfaceRef.current = surface;
    });
    return () => {
      cancelled = true;
      surface?.destroy();
      surfaceRef.current = null;
      flushNotepad();
    };
  }, [attKey]);

  function goTo(t: PlaceTarget): void {
    if (t.kind === "annotation") showInReader(attKey, t.pageIndex + 1, t.key);
    else goToReaderPosition(t.pageIndex, t.top);
  }

  const close = () => useStore.getState().setNotepadOpen(false);

  return (
    <div className="notepad" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <div
        className="notepad-head"
        onPointerDown={(e) => {
          const start = box;
          follow(
            e,
            (dx, dy) => setBox(clampBox({ ...start, left: start.left + dx, top: start.top + dy })),
            () => {},
          );
        }}
      >
        <button
          type="button"
          className="notepad-link-btn"
          title="Drag onto a highlight or a place on the page to link to it"
          onPointerDown={(e) =>
            follow(
              e,
              (_dx, _dy, ev) => setGhost({ x: ev.clientX, y: ev.clientY }),
              (ev, moved) => {
                setGhost(null);
                if (!moved) return;
                const target = readerPlaceAt(ev.clientX, ev.clientY);
                if (target) surfaceRef.current?.addLink(target);
              },
            )
          }
        >
          LINK
        </button>
        <span className="notepad-title">Notes</span>
        <button
          type="button"
          className="icon-btn notepad-undo"
          disabled={!canUndo}
          title="Undo"
          aria-label="Undo"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => surfaceRef.current?.undo()}
        >
          ↶
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Close the notepad"
          aria-label="Close the notepad"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={close}
        >
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="notepad-canvas" ref={hostRef} />
      <div
        className="notepad-grip"
        onPointerDown={(e) => {
          const start = box;
          follow(
            e,
            (dx, dy) => setBox(clampBox({ ...start, width: start.width + dx, height: start.height + dy })),
            () => {},
          );
        }}
      />
      {ghost && (
        <span className="notepad-link-ghost" style={{ left: ghost.x, top: ghost.y }}>
          LINK
        </span>
      )}
    </div>
  );
}
