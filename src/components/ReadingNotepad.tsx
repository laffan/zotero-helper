// Reading mode's notepad: a pad for the Apple Pencil — NotepadBody (its
// bar and canvas) in a window of its own — and, while it is closed, its
// icon: a filled red rectangle, at home below reading mode's buttons
// down the window's left edge, that can be dragged anywhere — and back
// home: while it is dragged, its home shows as a dashed ring, and let go
// near it, it settles there. A tap on the icon opens the pad out of it,
// growing from the icon to its full size, as if the icon were the pad
// in miniature; closing it shrinks it back into the icon. The pad opens
// with the corner facing away from the window's middle at the icon (its
// top right, for an icon at the top right), and closing it — moved or
// not — leaves the icon at that same corner of where it was, so the two
// keep to one place. Open, the icon is hidden; closed, the pad is.
//
// The pad floats: the bar's empty middle drags it about, the dotted
// circle at its corner sizes it. Or it docks: let go with the pointer at
// the window's left or right edge (the edge it would take shows as it
// nears) and it becomes a full-height column there, taking its width
// from the pages' room (they are laid out again beside it); its inner
// edge sizes it, and pulling its bar away from the edge floats it
// again. Where the icon and the pad sit is this device's.
//
// Auto-shift: with two pages side by side ("Fit 2 pages", the store's
// `twoUp`), a button in the pad's bar — two pages side by side, one
// dashed — on or off (this device's), makes the pad keep out of the way: a press on the pages on
// the pad's side of the window — the Pencil's or a finger's — slides it
// to the same place on the other side (a docked pad changes edges, once
// the press is over, since the pages are laid out again). One pad per
// PDF (src/notepad/model.ts), the same one the notes pane can show.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { CloseIcon } from "./Icons";
import { NotepadBody } from "./NotepadBody";

// Version 2: the default became 80% of the window's height.
const BOX_KEY = "zh-notepad-box-2";
// Version 2: the icon starts at home, below reading mode's buttons.
const ICON_KEY = "zh-notepad-icon-2";
const HOME_KEY = "zh-notepad-icon-home";
/** How near home the icon is let go to settle there, CSS px. */
const HOME_SNAP_PX = 40;
const SHIFT_KEY = "zh-notepad-autoshift";
/** The icon's target, a finger's (the rectangle is drawn inside it). */
const ICON = 44;
/** How long the pad takes to grow out of the icon, or back, ms. */
const MORPH_MS = 260;
type Box = { left: number; top: number; width: number; height: number };
type Spot = { left: number; top: number };

function stored<T>(key: string, ok: (v: T) => boolean, fallback: () => T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
    return v !== null && ok(v) ? v : fallback();
  } catch {
    return fallback();
  }
}
function keep(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: the defaults next time */
  }
}

const storedBox = () =>
  stored<Box>(BOX_KEY, (b) => Number.isFinite(b.left), () => {
    // At the right, four-fifths of the window's height, centred on it.
    const height = Math.round(window.innerHeight * 0.8);
    return { left: Math.max(16, window.innerWidth - 420), top: Math.round((window.innerHeight - height) / 2), width: 380, height };
  });

/** Below the iPad's status bar and window controls, while it has them. */
const topBand = () => {
  const c = document.documentElement.classList;
  return c.contains("ipados") && !c.contains("status-bar-hidden") ? 34 : 10;
};
/** The icon's home: the next place down reading mode's buttons, after
 *  the ×, the sentence tool and the pen (readingmode.css), 56px apart. */
const homeSpot = (): Spot => ({ left: 10, top: topBand() + 168 });
const storedIcon = () =>
  stored<Spot>(ICON_KEY, (s) => Number.isFinite(s.left) && Number.isFinite(s.top), () => ({
    left: window.innerWidth - ICON - 10,
    top: topBand(),
  }));

/** Kept on screen, whatever size the window is now. */
function clampBox(b: Box): Box {
  const width = Math.max(240, Math.min(b.width, window.innerWidth - 16));
  const height = Math.max(200, Math.min(b.height, window.innerHeight - 16));
  return {
    width,
    height,
    // Clear of the window's left edge by the quote knob's half, which
    // reaches out over the pad's left edge.
    left: Math.max(20, Math.min(b.left, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(b.top, window.innerHeight - height - 8)),
  };
}
const clampIcon = (s: Spot): Spot => ({
  left: Math.max(0, Math.min(s.left, window.innerWidth - ICON)),
  top: Math.max(0, Math.min(s.top, window.innerHeight - ICON)),
});

/** Which of the pad's corners is at the icon: the one facing away from
 *  the window's middle, as the icon is placed. */
type Corner = { right: boolean; below: boolean };
const cornerOf = (i: Spot): Corner => ({
  right: i.left + ICON / 2 > window.innerWidth / 2,
  below: i.top + ICON / 2 > window.innerHeight / 2,
});
/** The pad's box opened from the icon, that corner at it. */
function boxAtIcon(b: Box, i: Spot, c: Corner): Box {
  return clampBox({ ...b, left: c.right ? i.left + ICON - b.width : i.left, top: c.below ? i.top + ICON - b.height : i.top });
}
/** …and the icon where a pad at `b` closes into: the same corner. */
function iconAtBox(b: Box, c: Corner): Spot {
  return clampIcon({ left: c.right ? b.left + b.width - ICON : b.left, top: c.below ? b.top + b.height - ICON : b.top });
}

/** The pad grown out of `from` (the icon) to where it is — or, with
 *  `back`, shrunk into it. */
function morph(el: HTMLElement, from: Box, back: boolean): Animation | null {
  if (typeof el.animate !== "function") return null;
  const to = el.getBoundingClientRect();
  const small = {
    transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
    opacity: 0.3,
  };
  const full = { transform: "none", opacity: 1 };
  return el.animate(back ? [full, small] : [small, full], {
    duration: MORPH_MS,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    fill: back ? "forwards" : "none",
  });
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

const storedDock = () =>
  stored<{ side: Side | null; width: number }>(
    DOCK_KEY,
    (d) => (d.side === null || d.side === "left" || d.side === "right") && Number.isFinite(d.width),
    () => ({ side: null, width: 360 }),
  );

const clampWidth = (w: number) => Math.round(Math.max(240, Math.min(w, window.innerWidth * 0.6)));

/** Two pages side by side, one dashed: the pad keeps to the other. */
const ShiftIcon = () => (
  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <rect x="1.8" y="2.5" width="5.4" height="11" rx="1" />
    <rect x="8.8" y="2.5" width="5.4" height="11" rx="1" strokeDasharray="1.8 1.4" />
  </svg>
);

export function ReadingNotepad({ attKey }: { attKey: string }) {
  const open = useStore((s) => s.notepadOpen);
  const twoUp = useStore((s) => s.twoUp);
  const [box, setBox] = useState(() => clampBox(storedBox()));
  const [dock, setDock] = useState(storedDock);
  const [spot, setIcon] = useState(() => clampIcon(storedIcon()));
  const [home, setHome] = useState(() => stored<boolean>(HOME_KEY, (v) => typeof v === "boolean", () => true));
  const icon = home ? homeSpot() : spot;
  // The icon being dragged: its home shows, ringed when it is near.
  const [homing, setHoming] = useState<"far" | "near" | null>(null);
  const [autoShift, setAutoShift] = useState(() => stored<boolean>(SHIFT_KEY, (v) => typeof v === "boolean", () => false));
  // Sliding to the other side (auto-shift): the move is animated.
  const [shifting, setShifting] = useState(false);
  // The edge a floating pad being dragged would dock to, if let go now.
  const [preview, setPreview] = useState<Side | null>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  // The pad's corner at the icon, chosen as it opens: it closes back
  // into that corner, wherever it has been moved.
  const corner = useRef(cornerOf(icon));

  useEffect(() => keep(BOX_KEY, box), [box]);
  useEffect(() => keep(DOCK_KEY, dock), [dock]);
  useEffect(() => keep(ICON_KEY, spot), [spot]);
  useEffect(() => keep(HOME_KEY, home), [home]);
  useEffect(() => keep(SHIFT_KEY, autoShift), [autoShift]);

  // A window resized: the icon and the pad kept on screen.
  useEffect(() => {
    const onResize = () => {
      setIcon((i) => clampIcon(i));
      setBox((b) => clampBox(b));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Docked, the pad takes its width from the pages' room: the reader and
  // what reading mode floats over it move in (readingmode.css).
  const docked = open ? dock.side : null;
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--notepad-dock-left", docked === "left" ? `${dock.width}px` : "0px");
    root.setProperty("--notepad-dock-right", docked === "right" ? `${dock.width}px` : "0px");
    return () => {
      root.removeProperty("--notepad-dock-left");
      root.removeProperty("--notepad-dock-right");
    };
  }, [docked, dock.width]);

  // Opened: the pad grows out of the icon.
  useLayoutEffect(() => {
    if (open && padRef.current) morph(padRef.current, { ...icon, width: ICON, height: ICON }, false);
  }, [open]);

  const openPad = () => {
    corner.current = cornerOf(icon);
    if (!dock.side) setBox((b) => boxAtIcon(b, icon, corner.current));
    useStore.getState().setNotepadOpen(true);
  };

  /** Shrink the pad into the icon — moved to the pad's corner, for a
   *  floating pad — and close it. */
  const close = () => {
    const el = padRef.current;
    if (closing.current) return;
    const to = dock.side ? icon : iconAtBox(box, corner.current);
    // Back home, if that is where it closes to.
    const h = homeSpot();
    if (!(home && Math.hypot(to.left - h.left, to.top - h.top) < 2)) {
      setHome(false);
      setIcon(to);
    }
    const done = () => {
      closing.current = false;
      useStore.getState().setNotepadOpen(false);
    };
    const anim = el && morph(el, { ...to, width: ICON, height: ICON }, true);
    if (!anim) return done();
    closing.current = true;
    anim.onfinish = done;
    anim.oncancel = done;
  };

  // Auto-shift: a press on the pages on the pad's side sends it across.
  useEffect(() => {
    if (!open || !autoShift || !twoUp) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!t.closest?.(".pdf-scroll-area") || padRef.current?.contains(t)) return;
      const mid = window.innerWidth / 2;
      const padLeft = dock.side ? dock.side === "left" : box.left + box.width / 2 < mid;
      if (e.clientX < mid !== padLeft) return;
      if (dock.side) {
        // Once the press is over: the pages are laid out again.
        const side: Side = dock.side === "left" ? "right" : "left";
        const after = () => {
          window.removeEventListener("pointerup", after, true);
          window.removeEventListener("pointercancel", after, true);
          setDock((d) => ({ ...d, side }));
        };
        window.addEventListener("pointerup", after, true);
        window.addEventListener("pointercancel", after, true);
        return;
      }
      setShifting(true);
      setBox((b) => clampBox({ ...b, left: window.innerWidth - b.left - b.width }));
      window.setTimeout(() => setShifting(false), 350);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, autoShift, twoUp, dock.side, box]);

  /** The bar dragged: a floating pad moves, and docks if let go at an
   *  edge; a docked one, pulled away from its edge, floats again under
   *  the pointer and carries on moving. */
  const dragBar = (e: React.PointerEvent) => {
    let side = dock.side;
    let start = box;
    let grabX = 0;
    let grabY = 0;
    follow(
      e,
      (dx, dy, ev) => {
        if (side) {
          if (Math.abs(dx) < UNDOCK_PX) return;
          side = null;
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
        if (side) return;
        const edge = ev.clientX < DOCK_EDGE_PX ? "left" : ev.clientX > window.innerWidth - DOCK_EDGE_PX ? "right" : null;
        if (edge) setDock((d) => ({ side: edge, width: clampWidth(d.width) }));
      },
    );
  };

  if (!open) {
    const h = homeSpot();
    const near = (s: Spot) => Math.hypot(s.left - h.left, s.top - h.top) < HOME_SNAP_PX;
    return (
      <>
        {homing && (
          <div className={`reading-mode-notepad-home${homing === "near" ? " near" : ""}`} style={{ left: h.left, top: h.top }} />
        )}
        <button
          type="button"
          className="reading-mode-notepad"
          style={{ left: icon.left, top: icon.top }}
          title="Open the notepad — write with the Pencil (drag to move)"
          aria-label="Open the notepad"
          onPointerDown={(e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const start = icon;
            let to = start;
            follow(
              e,
              (dx, dy) => {
                to = clampIcon({ left: start.left + dx, top: start.top + dy });
                setHome(false);
                setIcon(to);
                setHoming(near(to) ? "near" : "far");
              },
              (ev, moved) => {
                setHoming(null);
                if (moved) setHome(near(to));
                else if (ev.type === "pointerup") openPad();
              },
            );
          }}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openPad()}
          onContextMenu={(e) => e.preventDefault()}
        />
      </>
    );
  }

  const bar = (
    <NotepadBody
      attKey={attKey}
      kind="floating"
      onBarPointerDown={dragBar}
      knobSide={dock.side === "left" ? "right" : "left"}
      tools={
        twoUp && (
          <button
            type="button"
            className={autoShift ? "notepad-tool active" : "notepad-tool"}
            title={autoShift ? "Auto-shift on: the pad moves to the other page when you work on its side" : "Auto-shift: move the pad to the other page when you work on its side"}
            aria-label="Auto-shift"
            aria-pressed={autoShift}
            onClick={() => setAutoShift(!autoShift)}
          >
            <ShiftIcon />
          </button>
        )
      }
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
  const cls = side ? `notepad notepad-edge notepad-edge-${side}` : `notepad notepad-floating${shifting ? " shifting" : ""}`;
  return (
    <>
      <div ref={padRef} className={cls} style={style}>
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
