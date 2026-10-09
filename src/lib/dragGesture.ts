// A pointer drag that moves part of the interface — a pane edge, a
// list column, the log's height, items on their way to a folder.
//
// The interface is not selectable to begin with (base.css), but a press
// that slides onto text the reader may select — the notes, a chat
// answer, the PDF's words — would otherwise start selecting it. While a
// drag is under way, a class on <html> turns selection off everywhere.

let active = 0;

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
 *  every move, `onEnd` the release (or a cancelled touch). */
export function trackPointerDrag(
  e: { preventDefault(): void },
  onMove: (ev: PointerEvent) => void,
  onEnd?: () => void,
): void {
  e.preventDefault();
  const end = beginDragGesture();
  const stop = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    end();
    onEnd?.();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}
