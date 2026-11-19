// A post-it dragged out of its button onto a page — reading mode's
// Post-it, or the bottom bar's — besides the tool's tap-to-place
// (postits.ts). A press on the button that moves past DRAG_PX becomes a
// square of paper under the finger or pointer (in the colour picked
// last); over a page it gives way to the tool's own dashed guide,
// showing where the post-it would land (centred on the point, kept
// inside the page), and letting go there sticks it, as the tool's tap
// would. Let go anywhere else, or cancelled, and nothing is stuck. A
// press that doesn't move is the button's own tap, which readies the
// tool as before; the click a drag ends in is kept from the button, so
// the drag doesn't also toggle the tool.
//
// The button holds the pointer while it is dragged (pointer capture),
// so the drag goes on over the pages without selecting their text or
// scrolling them; what is under the point is found by hit-testing it.

/** A press on the button that moves this far is a drag, CSS px. */
const DRAG_PX = 8;

export interface PostItDragEnv {
  /** May a post-it be stuck at all (a writer, an editable library)? */
  enabled: () => boolean;
  /** The colour a new post-it takes. */
  color: () => string;
  /** A drag began: the folded view is left for whole pages. */
  start: () => void;
  /** Show where a post-it would land at a client point; false when no
   *  page is there (and the guide is put away). */
  guideAt: (x: number, y: number) => boolean;
  hideGuide: () => void;
  /** Stick a post-it centred on a client point; false when no page is
   *  there. */
  stickAt: (x: number, y: number) => boolean;
}

/** Follow a press on `button` (its pointerdown, `e`): a drag sticks a
 *  post-it where it is let go; a tap is left to the button. */
export function beginPostItDrag(e: PointerEvent, button: HTMLElement, env: PostItDragEnv): void {
  if (!env.enabled() || (e.pointerType === "mouse" && e.button !== 0)) return;
  const id = e.pointerId;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let ghost: HTMLElement | null = null;
  try {
    button.setPointerCapture(id);
  } catch {
    /* the press may already be over */
  }

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
      env.start();
      ghost = document.createElement("div");
      ghost.className = "pdf-postit-ghost";
      ghost.style.setProperty("--postit-color", env.color());
      document.body.appendChild(ghost);
    }
    ev.preventDefault();
    ghost.classList.toggle("over-page", env.guideAt(ev.clientX, ev.clientY));
    ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`;
  };
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    if (!ghost) return;
    ghost.remove();
    env.hideGuide();
    if (ev.type === "pointerup") env.stickAt(ev.clientX, ev.clientY);
    // The click the drag ends in (the button holds the pointer, so it
    // lands there) isn't a tap on the button.
    const eat = (c: MouseEvent) => {
      c.preventDefault();
      c.stopImmediatePropagation();
    };
    button.addEventListener("click", eat, { capture: true, once: true });
    window.setTimeout(() => button.removeEventListener("click", eat, true), 600);
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
}
