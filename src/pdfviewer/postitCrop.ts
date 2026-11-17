// Paring a post-it down (postits.ts), so that at rest it covers less of
// the text: its two bottom corners, dragged, bring its left or right
// edge and its bottom edge in. Only what shows changes — the paper, its
// words and its writing stay whole, and come back whole while it is
// typed or written on (postits.css), to be pared down again after. The
// crop is three insets in the paper's points — left, right, bottom; the
// top, with its grip, stays — kept with the post-it (lib/postits.ts).
//
// A corner shows on a hovering mouse's post-it, always where fingers
// point, never on one being worked on or someone else's. Its drag
// draws the whole paper's outline, dashed, round the part kept.

/** The least a crop leaves of the paper, each way, in points. */
const MIN_PT = 24;

export interface CropTarget {
  el: HTMLElement;
  /** The paper's size, in points. */
  w: number;
  h: number;
  /** Left, right, bottom insets, in points. */
  crop: number[];
}

/** Show a crop: the insets as CSS variables the paper, its sheet and
 *  its corners are placed by. */
export function showCrop(el: HTMLElement, crop: number[]): void {
  el.style.setProperty("--crop-l", String(crop[0]));
  el.style.setProperty("--crop-r", String(crop[1]));
  el.style.setProperty("--crop-b", String(crop[2]));
}

/** A corner's drag, from its press. `done` hears the crop it ends on,
 *  if it moved. */
export function dragCorner(t: CropTarget, e: PointerEvent, side: "l" | "r", done: (crop: number[]) => void): void {
  e.preventDefault();
  const box = t.el.getBoundingClientRect();
  const k = box.width / t.w;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let crop = t.crop.slice();
  let moved = false;
  t.el.classList.add("cropping");
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    moved ||= Math.hypot(ev.clientX - x0, ev.clientY - y0) > 3;
    if (!moved) return;
    ev.preventDefault();
    const [l, r] = t.crop;
    const b = Math.max(0, Math.min(t.h - MIN_PT, t.h - (ev.clientY - box.top) / k));
    const x = (ev.clientX - box.left) / k;
    crop = side === "l"
      ? [Math.max(0, Math.min(t.w - r - MIN_PT, x)), r, b]
      : [l, Math.max(0, Math.min(t.w - l - MIN_PT, t.w - x)), b];
    showCrop(t.el, crop);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    t.el.classList.remove("cropping");
    if (moved) done(crop.map((v) => Math.round(v * 100) / 100));
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
}
