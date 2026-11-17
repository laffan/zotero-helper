// The notepad over the Highlight Map (HighlightMap.tsx): View Notepad, in
// the map's bar where the count was, opens the PDF's notepad as a pane
// over the canvas's right — a view of the same pad reading mode floats and
// the notes pane holds (NotepadBody, kind "map"), so what is gathered on
// the map can be written down beside it. The pane is over the map, not
// beside it: the map keeps its size, and keeps to what the pane leaves
// when it fits or goes to a match (view.ts's `covered`), its zoom
// buttons moving in beside the pane (`--hlmap-covered`).
//
// The pane's inner edge sizes it (the docked pad's handle, notepad.css),
// from 240px to all but 60px of the canvas. Whether it is open and its
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

/** View / Hide Notepad: the notepad's red page, and the words. */
export function MapNotepadToggle({ pad }: { pad: MapNotepadState }) {
  return (
    <button
      type="button"
      className={pad.open ? "hlmap-notepad-toggle active" : "hlmap-notepad-toggle"}
      onClick={pad.toggle}
      aria-pressed={pad.open}
      title={pad.open ? "Hide the notepad" : "Show the PDF's notepad over the map"}
    >
      <span className="hlmap-notepad-glyph" aria-hidden="true" />
      {pad.open ? "Hide Notepad" : "View Notepad"}
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
    <div ref={ref} className="notepad hlmap-notepad" style={{ width: pad.width }}>
      <NotepadBody
        attKey={attKey}
        kind="map"
        trailing={
          <button type="button" className="notepad-tool" title="Hide the notepad" aria-label="Hide the notepad" onClick={pad.close}>
            <CloseIcon size={13} />
          </button>
        }
      />
      <div className="notepad-edge-size" title="Drag to size the notepad" onPointerDown={size} />
    </div>
  );
}
