// Paring a post-it down, and its two places (postits.ts). So that a
// post-it can stay put without covering the text, its four corners,
// dragged, bring its edges in at rest: a corner moves the two edges it
// joins. Only what shows changes — the paper, its words and its writing
// stay whole. The crop is four insets in the paper's points, left,
// right, bottom, top, kept with the post-it (lib/postits.ts).
//
// A pared-down post-it has two places: its rect, where it is open —
// typed or written on, shown whole — always inside its page; and its
// rest place, the rect moved by its shift, where the part that shows
// sits, and which may put the rest of the paper past the page's edge,
// so a sliver can be kept at the margin. Opening it slides the whole
// paper into the page; closing it slides it back. Dragged by its grip at
// rest, it is the rest place that moves, as far as the part that shows
// stays on the page (postitMove.ts).
//
// A corner shows on a hovering mouse's post-it, always where fingers
// point; never on one that is open, or someone else's. Its drag draws
// the whole paper's outline, dashed, round the part kept.

/** The least a crop leaves of the paper, each way, in points. */
const MIN_PT = 24;

export interface CropTarget {
  el: HTMLElement;
  /** The paper's size, in points. */
  w: number;
  h: number;
  /** Left, right, bottom, top insets, in points. */
  crop: number[];
}

/** Show a crop and a rest place: CSS variables the paper, its sheet,
 *  its corners and its place at rest are set by (postits.css). */
export function showCrop(el: HTMLElement, crop: number[], shift: number[]): void {
  ["l", "r", "b", "t"].forEach((side, i) => el.style.setProperty(`--crop-${side}`, String(crop[i])));
  el.style.setProperty("--shift-x", String(shift[0]));
  el.style.setProperty("--shift-y", String(shift[1]));
}

/** A rect moved, by the least it takes, inside the page's box (PDF
 *  user space, both). */
export function intoPage(r: number[], vb: number[]): number[] {
  const dx = r[0] < vb[0] ? vb[0] - r[0] : r[2] > vb[2] ? vb[2] - r[2] : 0;
  const dy = r[1] < vb[1] ? vb[1] - r[1] : r[3] > vb[3] ? vb[3] - r[3] : 0;
  return [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy];
}

/** The least each inset may be for what shows to stay on the page, the
 *  paper at rest at `rest` (left, right, bottom, top). */
export function leastInsets(rest: number[], vb: number[]): number[] {
  return [vb[0] - rest[0], rest[2] - vb[2], vb[1] - rest[1], rest[3] - vb[3]].map((v) => Math.max(0, v));
}

/** A corner's drag, from its press: `top` and `left` say which. `least`
 *  is each inset's floor (leastInsets). `done` hears the crop it ends
 *  on, if it moved. */
export function dragCorner(
  t: CropTarget,
  e: PointerEvent,
  corner: { top: boolean; left: boolean },
  least: number[],
  shift: number[],
  done: (crop: number[]) => void,
): void {
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
    const [l, r, b, tp] = t.crop;
    const x = (ev.clientX - box.left) / k;
    const y = (ev.clientY - box.top) / k;
    const fit = (v: number, i: number, other: number, size: number) => Math.max(least[i], Math.min(size - other - MIN_PT, v));
    crop = [
      corner.left ? fit(x, 0, r, t.w) : l,
      corner.left ? r : fit(t.w - x, 1, l, t.w),
      corner.top ? b : fit(t.h - y, 2, tp, t.h),
      corner.top ? fit(y, 3, b, t.h) : tp,
    ];
    showCrop(t.el, crop, shift);
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
