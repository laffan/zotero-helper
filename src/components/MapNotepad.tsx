// The notepad over the Highlight Map (HighlightMap.tsx): View Notepad, at
// the right end of the map's bar (the notepad's red page, an arrow to the
// left across it — the pane comes in from the right), opens the PDF's
// notepad as a pane over the canvas's right — a view of the same pad reading mode floats and
// the notes pane holds (NotepadBody, kind "map"), so what is gathered on
// the map can be written down beside it. The pane is over the map, not
// beside it: the map keeps its size, and keeps to what the pane leaves
// when it fits or goes to a match (view.ts's `covered`), its zoom
// buttons moving in beside the pane (`--hlmap-covered`).
//
// The pane's inner edge sizes it: a strip as thick as the bar dividing
// the notes from their notepad (notepad-notes.css), and like it, from
// 240px to all but 60px of the canvas. Whether it is open and its
// width are this device's (`zh-hlmap-notepad`), whichever PDF is open.
import { useEffect, useRef, useState } from "react";
import { trackPointerDrag } from "../lib/dragGesture";
import { CloseIcon } from "./Icons";
import { NotepadBody } from "./NotepadBody";

const KEY = "zh-hlmap-notepad";
const MIN_W = 240;
/** The least of the map left showing beside the pane, px. */
const MAP_LEFT_PX = 60;

interface PadState {
  open: boolean;
  width: number;
}

function stored(): PadState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as PadState | null;
    if (v && typeof v.open === "boolean" && typeof v.width === "number") return v;
  } catch {
    /* storage unavailable */
  }
  return { open: false, width: 380 };
}

/** The pane's state, kept on this device. */
export function useMapNotepad() {
  const [state, setState] = useState(stored);
  const set = (s: PadState) => {
    setState(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  };
  return {
    ...state,
    toggle: () => set({ ...state, open: !state.open }),
    close: () => set({ ...state, open: false }),
    setWidth: (width: number) => set({ ...state, width }),
  };
}

export type MapNotepadState = ReturnType<typeof useMapNotepad>;

/** View / Hide Notepad: the notepad's red page (reading mode's icon,
 *  readingmode.css), an arrow to the left across it; lit while open. */
export function MapNotepadToggle({ pad }: { pad: MapNotepadState }) {
  const label = pad.open ? "Hide Notepad" : "View Notepad";
  return (
    <button
      type="button"
      className={pad.open ? "icon-btn hlmap-notepad-toggle active" : "icon-btn hlmap-notepad-toggle"}
      onClick={pad.toggle}
      aria-pressed={pad.open}
      aria-label={label}
      title={pad.open ? "Hide the notepad" : "View the PDF's notepad over the map"}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect x="2.5" y="1.5" width="11" height="13" rx="1.8" fill="#ff5f57" />
        <path
          d="M10.8 8H5.2M7.6 5.6 5.2 8l2.4 2.4"
          fill="none"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** The pane: the pad, over the canvas's right. Its width, as shown, is
 *  set on its parent as `--hlmap-covered` for what lies beside it. */
export function MapNotepadPane({ attKey, pad }: { attKey: string; pad: MapNotepadState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    const ro = new ResizeObserver(() => stage.style.setProperty("--hlmap-covered", `${el.offsetWidth}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      stage.style.removeProperty("--hlmap-covered");
    };
  }, []);

  const size = (e: React.PointerEvent) => {
    const stage = ref.current?.parentElement;
    if (!stage) return;
    e.stopPropagation();
    const right = stage.getBoundingClientRect().right;
    const most = Math.max(MIN_W, stage.clientWidth - MAP_LEFT_PX);
    let width = pad.width;
    trackPointerDrag(
      e,
      (ev) => {
        width = Math.round(Math.min(most, Math.max(MIN_W, right - ev.clientX)));
        if (ref.current) ref.current.style.width = `${width}px`;
      },
      () => pad.setWidth(width),
    );
  };

  return (
    <div ref={ref} className="hlmap-notepad" style={{ width: pad.width }}>
      <div className="hlmap-notepad-edge" title="Drag to size the notepad" onPointerDown={size} />
      <div className="notepad hlmap-notepad-pad">
        <NotepadBody
          attKey={attKey}
          kind="map"
          trailing={
            <button type="button" className="notepad-tool" title="Hide the notepad" aria-label="Hide the notepad" onClick={pad.close}>
              <CloseIcon size={13} />
            </button>
          }
        />
      </div>
    </div>
  );
}
