// A view of a PDF's notepad (src/notepad/): a slim toolbar over the
// canvas, the two one surface — reading mode's floating pad
// (ReadingNotepad.tsx) and the notes pane's lower half (NotesPanel.tsx)
// are both this, sharing one pad.
//
// The toolbar: the link icon at its left makes a link — press it (the
// Pencil, a finger or the mouse) and drag onto the pages, a dashed line
// running from it to the pointer, and let go over a highlight or a spot
// on a page: a link to it lands on the pad. Beside it, the eye: while
// it is open the pad follows the PDF, panning to the part about each
// page as the reader turns to it (off by default in the floating pad,
// on under the notes; remembered for each). Then the eraser (also the
// Pencil's double-tap, when the Pencil was last on this pad) and undo.
//
// Which visit to the page the reader is on is counted here: a stroke
// joins the note being written only during the same visit
// (surface.ts).
// What else the host puts in the bar (a close button) goes at its right;
// the bar's empty middle is the host's to drag the pad by.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readerPageNow, useReaderPage } from "../lib/outline";
import { pencilLastOn } from "../lib/pencil";
import { flushNotepad, notepadChanged, notepadFor, watchNotepad, type Notepad } from "../notepad/model";
import { createSurface, type NotepadSurface, type PadTool } from "../notepad/surface";
import type { PlaceTarget } from "../pdfviewer/places";
import { goToReaderPosition, readerPlace, readerPlaceAt, showInReader } from "./ReaderPane";

const LinkIcon = () => (
  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-1 1" />
    <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l1-1" />
  </svg>
);
const EraserIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.2 13.5L2.4 9.7a1 1 0 0 1 0-1.4l5.9-5.9a1 1 0 0 1 1.4 0l3.8 3.8a1 1 0 0 1 0 1.4l-6 5.9z" />
    <path d="M5 7.1l4.9 4.9" />
    <path d="M6.2 13.5h7.3" />
  </svg>
);
const EyeIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    {open ? <circle cx="8" cy="8" r="2" /> : <path d="M2.5 13.5l11-11" />}
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
  /** At the bar's right. */
  trailing?: React.ReactNode;
}

const followKey = (kind: string) => `zh-notepad-follow-${kind}`;
function storedFollow(kind: "floating" | "docked"): boolean {
  try {
    const v = localStorage.getItem(followKey(kind));
    return v === null ? kind === "docked" : v === "1";
  } catch {
    return kind === "docked";
  }
}

export function NotepadBody({ attKey, kind, onBarPointerDown, trailing }: NotepadBodyProps) {
  const [follow, setFollowState] = useState(() => storedFollow(kind));
  const setFollow = (on: boolean) => {
    setFollowState(on);
    try {
      localStorage.setItem(followKey(kind), on ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };
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
  const surfaceRef = useRef<NotepadSurface | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [tool, setTool] = useState<PadTool>("pen");
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

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
        toolChanged: setTool,
      });
      surfaceRef.current = surface;
      const at = readerPageNow();
      if (storedFollow(kind) && at > 0) surface.follow(at - 1);
    });
    return () => {
      cancelled = true;
      unwatch();
      surface?.destroy();
      surfaceRef.current = null;
      flushNotepad();
    };
  }, [attKey]);

  // The Pencil's double-tap: the eraser and back, when the Pencil was
  // last on this pad (ink mode's otherwise).
  useEffect(() => {
    const onPencil = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      const host = hostRef.current;
      const surface = surfaceRef.current;
      if (kind !== "tap" || !host || !surface || !pencilLastOn(host)) return;
      surface.setTool(surface.tool() === "eraser" ? "pen" : "eraser");
    };
    window.addEventListener("zh-pencil", onPencil);
    return () => window.removeEventListener("zh-pencil", onPencil);
  }, []);

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
    const move = (ev: PointerEvent) => {
      moved ||= Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4;
      if (moved) setLine({ x1, y1, x2: ev.clientX, y2: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setLine(null);
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
          className="notepad-tool notepad-link-btn"
          title="Link — drag onto a highlight or a place on the page"
          aria-label="Link to a place in the PDF"
          onPointerDown={startLink}
        >
          <LinkIcon />
        </button>
        <button
          type="button"
          className={follow ? "notepad-tool active" : "notepad-tool"}
          title={follow ? "Following the PDF — the pad shows the part about the page in view" : "Follow the PDF as it scrolls"}
          aria-label="Follow the PDF"
          aria-pressed={follow}
          onClick={() => setFollow(!follow)}
        >
          <EyeIcon open={follow} />
        </button>
        <div className="notepad-bar-grab" onPointerDown={onBarPointerDown} />
        <button
          type="button"
          className={tool === "eraser" ? "notepad-tool active" : "notepad-tool"}
          title="Eraser (the Pencil's double-tap)"
          aria-label="Eraser"
          aria-pressed={tool === "eraser"}
          onClick={() => surfaceRef.current?.setTool(tool === "eraser" ? "pen" : "eraser")}
        >
          <EraserIcon />
        </button>
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
      <div className="notepad-canvas" ref={hostRef} />
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
