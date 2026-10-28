// A view of a PDF's notepad (src/notepad/): a slim toolbar over the
// canvas, the two one surface — reading mode's floating pad
// (ReadingNotepad.tsx) and the notes pane's lower half (NotesPanel.tsx)
// are both this, sharing one pad.
//
// The toolbar, from its left: the branch (two dots joined by a dotted,
// stepped line) — while it is on the pad follows the PDF, panning to the
// part about each page as the reader turns to it (off by default in the
// floating pad, on under the notes; remembered for each). Beside it, the
// map: a minimap of the whole pad down the canvas's left (minimap.ts;
// off to begin with, remembered for each view). The host's own tools
// follow (`tools`). At the right, just before undo, what the Pencil
// does, one switch of four parts — write in the theme's ink (black,
// white in the dark theme), write in red, erase, or lasso; the colour
// is this device's choice, shared by every view, and the eraser is
// shared with the pages' ink mode (lib/penTool.ts — the Pencil's
// double-tap turns it on and off in both).
//
// The quote knob sits on the pad's edge, at its middle — a round bump
// in the pad's colour, half outside it, on the side facing the pages
// (`knobSide`): press it (the Pencil, a finger or the mouse) and drag
// onto the pages, a dashed line running from it to the pointer, its
// ring turning the highlight orange, and let go over a highlight or a
// spot on a page: a link to it lands on the pad. At the canvas's lower
// left, a faint trash can clears the pad, once confirmed (undo brings it
// back).
//
// Which visit to the page the reader is on is counted here: a stroke
// joins the note being written only during the same visit
// (surface.ts).
// What else the host puts in the bar (a close button) goes at its right;
// the bar's empty middle is the host's to drag the pad by.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readerPageNow, useReaderPage } from "../lib/outline";
import { isErasing, setErasing, watchErasing } from "../lib/penTool";
import { flushNotepad, notepadChanged, notepadFor, watchNotepad, type Notepad } from "../notepad/model";
import { createMinimap } from "../notepad/minimap";
import { createSurface, RED_INK, type NotepadSurface, type PadTool } from "../notepad/surface";
import type { PlaceTarget } from "../pdfviewer/places";
import { goToReaderPosition, readerPlace, readerPlaceAt, showInReader } from "./ReaderPane";

/** A quotation mark: drag it out to quote a highlight. */
const QuoteIcon = () => (
  <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true">
    <path d="M2.5 9.6c0-3 1.4-5.2 4-6.3l.6 1.1C5.6 5.1 4.8 6.2 4.7 7.4h.7c1 0 1.8.8 1.8 1.9v1.5c0 1-.8 1.9-1.8 1.9H4.3c-1 0-1.8-.8-1.8-1.9z" />
    <path d="M8.8 9.6c0-3 1.4-5.2 4-6.3l.6 1.1c-1.5.7-2.3 1.8-2.4 3h.7c1 0 1.8.8 1.8 1.9v1.5c0 1-.8 1.9-1.8 1.9h-1.1c-1 0-1.8-.8-1.8-1.9z" />
  </svg>
);
const EraserIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.2 13.5L2.4 9.7a1 1 0 0 1 0-1.4l5.9-5.9a1 1 0 0 1 1.4 0l3.8 3.8a1 1 0 0 1 0 1.4l-6 5.9z" />
    <path d="M5 7.1l4.9 4.9" />
    <path d="M6.2 13.5h7.3" />
  </svg>
);
/** Two dots joined by a dotted, stepped line, as a branch is drawn:
 *  the pad linked to the PDF. */
const BranchIcon = () => (
  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12.2" cy="4" r="1.9" />
    <circle cx="3.8" cy="12" r="1.9" />
    <path d="M10 4H8v8H6" strokeDasharray="0.1 2.3" />
  </svg>
);
/** A loop with a tail: the lasso. */
export const LassoIcon = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <ellipse cx="8.5" cy="6.3" rx="5.5" ry="3.8" strokeDasharray="2.2 1.8" />
    <path d="M5.2 9.4c-1 .9-1 2.2 0 2.8.9.6.9 1.6.1 2.3" />
  </svg>
);
const MapIcon = () => (
  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.8 3.8l4-1.6 4.4 1.6 4-1.6v10l-4 1.6-4.4-1.6-4 1.6z" />
    <path d="M5.8 2.2v10M10.2 3.8v10" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 4.5h11" />
    <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
    <path d="M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6" />
    <path d="M6.7 7v4.5M9.3 7v4.5" />
  </svg>
);
/** Undo: an arrow curving back to the left. */
const UndoIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5.5 3.5L2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7" />
  </svg>
);

export interface NotepadBodyProps {
  attKey: string;
  /** Which view this is: whether it follows the PDF is kept for each,
   *  and starts off in the floating pad, on under the notes. */
  kind: "floating" | "docked";
  /** A press on the bar's empty middle (the host drags the pad by it). */
  onBarPointerDown?: (e: React.PointerEvent) => void;
  /** The host's own tools, after the bar's. */
  tools?: React.ReactNode;
  /** The edge the quote knob sits on: the one facing the pages. */
  knobSide?: "left" | "right";
  /** At the bar's right. */
  trailing?: React.ReactNode;
}

const followKey = (kind: string) => `zh-notepad-follow-${kind}`;
const mapKey = (kind: string) => `zh-notepad-map-${kind}`;
const COLOR_KEY = "zh-notepad-pen-color";
/** The pen's colours: the theme's ink ("") and red. */
const PEN_COLORS = [
  { color: "", label: "Write in ink (black, white in the dark theme)" },
  { color: RED_INK, label: "Write in red" },
];
function storedColor(): string {
  try {
    return localStorage.getItem(COLOR_KEY) === RED_INK ? RED_INK : "";
  } catch {
    return "";
  }
}
/** A view's remembered switch, or `fallback`. */
function storedFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
const storedFollow = (kind: "floating" | "docked") => storedFlag(followKey(kind), kind === "docked");

/** A switch kept for each view. */
function useFlag(key: string, fallback: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => storedFlag(key, fallback));
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };
  return [on, set];
}

export function NotepadBody({ attKey, kind, onBarPointerDown, tools, knobSide = "left", trailing }: NotepadBodyProps) {
  const [follow, setFollow] = useFlag(followKey(kind), kind === "docked");
  const [map, setMap] = useFlag(mapKey(kind), false);
  const [confirming, setConfirming] = useState(false);
  // The reader's page, and which visit to it this is.
  const page = useReaderPage();
  const visit = useRef(0);
  useEffect(() => {
    visit.current++;
    if (follow && page > 0) surfaceRef.current?.follow(page - 1);
  }, [page]);
  useEffect(() => {
    if (follow && page > 0) surfaceRef.current?.follow(page - 1);
  }, [follow]);
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<NotepadSurface | null>(null);
  const padRef = useRef<Notepad | null>(null);
  // The surface comes once the pad has loaded; the minimap waits for it.
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [tool, setTool] = useState<PadTool>("pen");
  const [color, setColor] = useState(storedColor);
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [linking, setLinking] = useState(false);

  // The PDF's pad (shared with any other view of it), then the canvas.
  useEffect(() => {
    let cancelled = false;
    let surface: NotepadSurface | null = null;
    let pad: Notepad | null = null;
    const me = {};
    const unwatch = watchNotepad(attKey, (from) => from !== me && surface?.render());
    void notepadFor(attKey).then((p) => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      pad = p;
      surface = createSurface(host, {
        pad: () => pad!,
        changed: () => {
          notepadChanged(attKey, pad!, me);
          setCanUndo(Boolean(surface?.canUndo()));
        },
        place: () => {
          const p = readerPlace();
          return p && { ...p, visit: visit.current };
        },
        goTo,
        toolChanged: (t) => {
          setTool(t);
          setErasing(t === "eraser");
        },
      });
      surface.setColor(storedColor());
      surface.setTool(isErasing() ? "eraser" : "pen");
      surfaceRef.current = surface;
      padRef.current = p;
      setReady(true);
      const at = readerPageNow();
      if (storedFollow(kind) && at > 0) surface.follow(at - 1);
    });
    return () => {
      cancelled = true;
      unwatch();
      surface?.destroy();
      surfaceRef.current = null;
      setReady(false);
      flushNotepad();
    };
  }, [attKey]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const pad = padRef.current;
    if (!map || !ready || !surface || !pad || !mapRef.current) return;
    const minimap = createMinimap(mapRef.current, surface, () => padRef.current ?? pad);
    return () => minimap.destroy();
  }, [map, ready]);

  // Clearing, asked first: any press elsewhere drops the question.
  useEffect(() => {
    if (!confirming) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".notepad-confirm, .notepad-trash")) setConfirming(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [confirming]);

  // The eraser, shared with ink mode: on or off there (or by the
  // Pencil's double-tap), on or off here.
  useEffect(
    () =>
      watchErasing((on) => {
        const surface = surfaceRef.current;
        if (!surface) return;
        if (on) surface.setTool("eraser");
        else if (surface.tool() === "eraser") surface.setTool("pen");
      }),
    [],
  );

  /** A colour dot: the pen writes in it from now on. */
  const pickColor = (c: string) => {
    setColor(c);
    try {
      localStorage.setItem(COLOR_KEY, c);
    } catch {
      /* storage unavailable */
    }
    const surface = surfaceRef.current;
    surface?.setColor(c);
    if (surface && surface.tool() !== "pen") surface.setTool("pen");
  };

  function goTo(t: PlaceTarget): void {
    if (t.kind === "annotation") showInReader(attKey, t.pageIndex + 1, t.key);
    else goToReaderPosition(t.pageIndex, t.top);
  }

  /** LINK: follow the drag, a dashed line from the button to the
   *  pointer; let go over the pages to link to what is there. */
  const startLink = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const x1 = r.left + r.width / 2;
    const y1 = r.top + r.height / 2;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    setLinking(true);
    const move = (ev: PointerEvent) => {
      moved ||= Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4;
      if (moved) setLine({ x1, y1, x2: ev.clientX, y2: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setLine(null);
      setLinking(false);
      if (!moved || ev.type === "pointercancel") return;
      const target = readerPlaceAt(ev.clientX, ev.clientY);
      if (target) surfaceRef.current?.addLink(target);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <>
      <div className="notepad-bar">
        <button
          type="button"
          className={follow ? "notepad-tool active" : "notepad-tool"}
          title={follow ? "Following the PDF — the pad shows the part about the page in view" : "Follow the PDF as it scrolls"}
          aria-label="Follow the PDF"
          aria-pressed={follow}
          onClick={() => setFollow(!follow)}
        >
          <BranchIcon />
        </button>
        <button
          type="button"
          className={map ? "notepad-tool active" : "notepad-tool"}
          title={map ? "Hide the minimap" : "Show a minimap of the whole pad"}
          aria-label="Minimap"
          aria-pressed={map}
          onClick={() => setMap(!map)}
        >
          <MapIcon />
        </button>
        {tools}
        <div className="notepad-bar-grab" onPointerDown={onBarPointerDown} />
        <div className="notepad-modes" role="radiogroup" aria-label="What the Pencil does">
          {PEN_COLORS.map((c) => {
            const on = tool === "pen" && c.color === color;
            return (
              <button
                key={c.color || "ink"}
                type="button"
                role="radio"
                className={on ? "notepad-mode on" : "notepad-mode"}
                title={c.label}
                aria-label={c.label}
                aria-checked={on}
                onClick={() => pickColor(c.color)}
              >
                <span className="notepad-mode-dot" style={c.color ? ({ "--swatch": c.color } as React.CSSProperties) : undefined} />
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            className={tool === "eraser" ? "notepad-mode on" : "notepad-mode"}
            title="Erase (the Pencil's double-tap) — the pages' pen erases too"
            aria-label="Erase"
            aria-checked={tool === "eraser"}
            onClick={() => surfaceRef.current?.setTool("eraser")}
          >
            <EraserIcon />
          </button>
          <button
            type="button"
            role="radio"
            className={tool === "lasso" ? "notepad-mode on" : "notepad-mode"}
            title="Lasso — draw a loop round what to select (or hold the Pencil still)"
            aria-label="Lasso"
            aria-checked={tool === "lasso"}
            onClick={() => surfaceRef.current?.setTool("lasso")}
          >
            <LassoIcon />
          </button>
        </div>
        <button
          type="button"
          className="notepad-tool notepad-undo"
          disabled={!canUndo}
          title="Undo"
          aria-label="Undo"
          onClick={() => surfaceRef.current?.undo()}
        >
          <UndoIcon />
        </button>
        {trailing}
      </div>
      <button
        type="button"
        className={`notepad-link-knob notepad-link-knob-${knobSide}${linking ? " linking" : ""}`}
        title="Quote — drag onto a highlight or a place on the page"
        aria-label="Link to a highlight or a place in the PDF"
        onPointerDown={startLink}
      >
        <QuoteIcon />
      </button>
      <div className={map ? "notepad-main with-map" : "notepad-main"}>
        {map && <div className="notepad-minimap" ref={mapRef} />}
        <div className="notepad-canvas" ref={hostRef} />
        <button
          type="button"
          className="notepad-trash"
          title="Clear the notepad"
          aria-label="Clear the notepad"
          onClick={() => setConfirming(!confirming)}
        >
          <TrashIcon />
        </button>
        {confirming && (
          <div className="notepad-confirm" role="dialog" aria-label="Clear the notepad">
            <span>Clear the whole notepad?</span>
            <button
              type="button"
              className="notepad-confirm-clear"
              onClick={() => {
                setConfirming(false);
                surfaceRef.current?.clear();
              }}
            >
              Clear
            </button>
            <button type="button" className="notepad-confirm-cancel" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {line &&
        createPortal(
          <svg className="notepad-link-line" aria-hidden="true">
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            <circle cx={line.x2} cy={line.y2} r="5" />
          </svg>,
          document.body,
        )}
    </>
  );
}
