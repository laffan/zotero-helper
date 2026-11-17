// Moving a post-it by its grip (postits.ts) about its page. Shown whole
// — never pared down, or open — the paper moves, kept inside the page.
// Pared down at rest it is the rest place that moves (postitCrop.ts):
// the part that shows is kept on the page, the rest of the paper may go
// past its edge; the rect it opens at follows, the rest place moved into
// the page by the least it takes. A press that doesn't move is a tap,
// for the caller (its menu).
//
// Positions are worked in the page's points (PDF user space, y up), the
// pointer's moves turned into points by the post-it's own scale; the
// drag shows as a translation of the element, laid out again once only
// when it ends.
import { restRect, shownRect } from "../lib/postits";
import { intoPage } from "./postitCrop";

export interface MoveTarget {
  el: HTMLElement;
  rect: number[];
  shift: number[];
  crop: number[];
  /** Shown whole: the paper moves, rather than its rest place. */
  whole: boolean;
}

/** Where a post-it went: its rect, and its rest place's distance from
 *  it (x right, y down, points). */
export interface Moved {
  rect: number[];
  shift: number[];
}

const shiftTo = (rest: number[], rect: number[]) => [rest[0] - rect[0], rect[3] - rest[3]];

/** Follow a drag from the grip's press; `done` hears where it went, or
 *  null for a tap. */
export function dragPostIt(t: MoveTarget, e: PointerEvent, vb: number[], done: (moved: Moved | null, ev: PointerEvent) => void): void {
  e.preventDefault();
  const k = t.el.getBoundingClientRect().width / (t.rect[2] - t.rect[0]);
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  let to: Moved = { rect: t.rect, shift: t.shift };
  t.el.classList.add("dragging");

  /** Where a drag of (dx right, dy down) points takes it. */
  function place(dx: number, dy: number): Moved {
    const by = (r: number[], x: number, y: number) => [r[0] + x, r[1] - y, r[2] + x, r[3] - y];
    if (t.whole) {
      const rect = intoPage(by(t.rect, dx, dy), vb);
      // The rest place keeps its distance, as far as what shows of it
      // stays on the page.
      const shown = shownRect(rect, t.crop, t.shift);
      const fix = intoPage(shown, vb);
      return { rect, shift: [t.shift[0] + fix[0] - shown[0], t.shift[1] - (fix[1] - shown[1])] };
    }
    const shown = by(shownRect(t.rect, t.crop, t.shift), dx, dy);
    const fix = intoPage(shown, vb);
    const rest = by(restRect(t.rect, t.shift), dx + fix[0] - shown[0], dy - (fix[1] - shown[1]));
    const rect = intoPage(rest, vb);
    return { rect, shift: shiftTo(rest, rect) };
  }

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    moved ||= Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4;
    if (!moved) return;
    ev.preventDefault();
    to = place((ev.clientX - x0) / k, (ev.clientY - y0) / k);
    // Shown where it is going: the paper (whole) or its rest place.
    const a = t.whole ? to.rect : restRect(to.rect, to.shift);
    const b = t.whole ? t.rect : restRect(t.rect, t.shift);
    t.el.style.translate = `${(a[0] - b[0]) * k}px ${(b[3] - a[3]) * k}px`;
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    t.el.style.translate = "";
    done(moved ? to : null, ev);
    // Laid out at its new place with no easing from the old one.
    requestAnimationFrame(() => t.el.classList.remove("dragging"));
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
}
