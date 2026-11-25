// A pointer drag that moves part of the interface — a pane edge, a
// list column, the log's height, items on their way to a folder.
//
// The interface is not selectable to begin with (base.css), but a press
// that slides onto text the reader may select — the notes, a chat
// answer, the PDF's words — would otherwise start selecting it. While a
// drag is under way, a class on <html> turns selection off everywhere.
//
// A drag hears at most one move a frame: a pointer reports moves faster
// than the screen draws, and each move of a pane's edge resizes the
// panes and is written to the stored UI prefs.
//
// A drag of a pane's edge (`resizesPanes`) is also a signal: while one
// is under way, what lays itself out by the panes' size — the PDF's
// pages (pdfviewer/place.ts), the right panel's list or map
// (MetadataPanel.tsx) — waits, and does it once when the edge is let
// go (onPaneResized). Laid out again at every pause in a quick drag,
// the pages were drawn again at each new size, one set of rasters
// after another, and on the iPad the web view ran out of memory.

let active = 0;
let resizing = 0;
const resized = new Set<() => void>();

/** A pane's edge is being dragged. */
export const paneResizing = (): boolean => resizing > 0;

/** `fn` runs when the last pane edge being dragged is let go (a frame
 *  later, once the panes have their final size). Returns the undo. */
export function onPaneResized(fn: () => void): () => void {
  resized.add(fn);
  return () => resized.delete(fn);
}

/** A pane's edge is being dragged until the returned function is called
 *  (once) — for a drag that isn't trackPointerDrag's (the docked
 *  notepad's edge, ReadingNotepad.tsx). */
export function beginPaneResize(): () => void {
  resizing++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (--resizing === 0) {
      requestAnimationFrame(() => {
        if (!resizing) for (const fn of [...resized]) fn();
      });
    }
  };
}

/** Selection is off until the returned function is called (once). */
export function beginDragGesture(): () => void {
  if (active++ === 0) document.documentElement.classList.add("ui-dragging");
  // Drop a selection the press may already have started — unless the
  // reader is typing, where the selection is their caret.
  const el = document.activeElement as HTMLElement | null;
  const typing = el?.isContentEditable || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA";
  if (!typing) window.getSelection()?.removeAllRanges();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (--active === 0) document.documentElement.classList.remove("ui-dragging");
  };
}

/** Follow the pointer from a press until it lets go: `onMove` hears
 *  the latest move once a frame (and the last before the release),
 *  `onEnd` the release (or a cancelled touch). `resizesPanes`: the
 *  drag is a pane's edge (paneResizing). */
export function trackPointerDrag(
  e: { preventDefault(): void },
  onMove: (ev: PointerEvent) => void,
  onEnd?: () => void,
  opts: { resizesPanes?: boolean } = {},
): void {
  e.preventDefault();
  const end = beginDragGesture();
  const endResize = opts.resizesPanes ? beginPaneResize() : null;
  let latest: PointerEvent | null = null;
  let raf = 0;
  const flush = () => {
    raf = 0;
    const ev = latest;
    latest = null;
    if (ev) onMove(ev);
  };
  const move = (ev: PointerEvent) => {
    latest = ev;
    raf ||= requestAnimationFrame(flush);
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    cancelAnimationFrame(raf);
    flush();
    end();
    onEnd?.();
    endResize?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}
