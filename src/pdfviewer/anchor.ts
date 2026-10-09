// Keeping the reader's place across a relayout. When the pages change
// size — the outline or the notes opening beside them, a window resize
// in a fit mode — the old scroll offset points somewhere else; the
// place is kept instead as a page and a fraction into it.
import type { PageRecord } from "./types";

export interface ViewAnchor {
  idx: number;
  frac: number;
}

/** The first page reaching into view, and how far into it the view
 *  starts. `horiz`: the pages run side by side. */
export function viewAnchor(area: HTMLElement, pages: PageRecord[], horiz: boolean): ViewAnchor | null {
  const ar = area.getBoundingClientRect();
  const edge = horiz ? ar.left : ar.top;
  for (let i = 0; i < pages.length; i++) {
    const r = pages[i].wrapper.getBoundingClientRect();
    if ((horiz ? r.right : r.bottom) <= edge) continue;
    const size = horiz ? r.width : r.height;
    return { idx: i, frac: size ? (edge - (horiz ? r.left : r.top)) / size : 0 };
  }
  return null;
}

/** Scroll so the view starts where `a` says, in the new geometry. Left
 *  alone when it already does: any write to the scroll offset stops a
 *  smooth scroll under way (an outline jump, a page turn). */
export function restoreAnchor(area: HTMLElement, pages: PageRecord[], horiz: boolean, a: ViewAnchor): void {
  const w = pages[a.idx]?.wrapper;
  if (!w) return;
  const ar = area.getBoundingClientRect();
  const r = w.getBoundingClientRect();
  const delta = horiz ? r.left - ar.left + a.frac * r.width : r.top - ar.top + a.frac * r.height;
  if (Math.abs(delta) < 1) return;
  if (horiz) area.scrollLeft += delta;
  else area.scrollTop += delta;
}
