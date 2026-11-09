// Keeping the reader's place across a relayout. When the pages change
// size — the outline or the notes opening beside them, a window resize
// in a fit mode — the old scroll offset points somewhere else; the
// place is kept instead as a page and a fraction into it. Holding on
// to it through resizes and the app's trips to the background is
// place.ts's.
import type { PageRecord } from "./types";

export interface ViewAnchor {
  idx: number;
  frac: number;
}

/** The first page reaching into view, and how far into it the view
 *  starts. `horiz`: the pages run side by side. The pages' far edges
 *  go forward page by page, so it is found by halving — a scroll in a
 *  long book measures a dozen pages, not every one before the view.
 *  At a fixed zoom pages wrap in rows, where a short page can end
 *  before a taller one beside it: the few pages before are looked at
 *  too. */
/** More pages than a row at a fixed zoom holds. */
const ROW_LOOKBACK = 8;

export function viewAnchor(area: HTMLElement, pages: PageRecord[], horiz: boolean): ViewAnchor | null {
  const ar = area.getBoundingClientRect();
  const edge = horiz ? ar.left : ar.top;
  const farEdge = (i: number) => {
    const r = pages[i].wrapper.getBoundingClientRect();
    return horiz ? r.right : r.bottom;
  };
  let lo = 0;
  let hi = pages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (farEdge(mid) <= edge) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= Math.max(0, lo - ROW_LOOKBACK); i--) if (farEdge(i) > edge) lo = i;
  if (lo >= pages.length) return null;
  const r = pages[lo].wrapper.getBoundingClientRect();
  const size = horiz ? r.width : r.height;
  return { idx: lo, frac: size ? (edge - (horiz ? r.left : r.top)) / size : 0 };
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

/** Scroll (smoothly, top to bottom) to `top`, in PDF user space (y up),
 *  on page `p` — a little above it, so the line is not on the edge. */
export function scrollToPagePoint(area: HTMLElement, p: PageRecord, top: number): void {
  const y = p.viewport.convertToViewportPoint(p.viewport.viewBox[0], top)[1];
  const frac = Math.max(0, Math.min(1, y / p.viewport.height));
  const wr = p.wrapper.getBoundingClientRect();
  const ar = area.getBoundingClientRect();
  const target = area.scrollTop + wr.top - ar.top + frac * wr.height - 16;
  area.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
}

/** Bring a point on a page (fractions of its width and height) into
 *  view, smoothly: centred across, a third of the way down. */
export function scrollToPageFraction(area: HTMLElement, wrapper: HTMLElement, x: number, y: number): void {
  const wr = wrapper.getBoundingClientRect();
  const ar = area.getBoundingClientRect();
  const left = area.scrollLeft + wr.left - ar.left + x * wr.width - area.clientWidth / 2;
  const top = area.scrollTop + wr.top - ar.top + y * wr.height - area.clientHeight / 3;
  area.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: "smooth" });
}

/** Bring `el` (a page, a fold) into view by scrolling the scroll area
 *  alone: at the start of the view — after the area's scroll-padding,
 *  which in the paged view centres the set (pdfviewer.css) — or at its
 *  centre. `horiz`: along the row, the pages running side by side.
 *
 *  Not `scrollIntoView`, which also scrolls every box around the area,
 *  `overflow: hidden` ones included — and nothing scrolls those back,
 *  so the whole viewer stays shifted, a band of nothing below it. And
 *  on WebKit an instant `scrollIntoView` in the paged view put the set's
 *  first page at the very top of the view, its scroll-padding ignored
 *  and the set never snapped again: with two or three pages to a set
 *  (their pad a large part of the view) the set sat at the top with a
 *  gap beneath, until the next swipe. */
export function scrollAreaTo(
  area: HTMLElement,
  el: HTMLElement,
  horiz: boolean,
  opts: { block?: "start" | "center"; behavior?: ScrollBehavior } = {},
): void {
  const er = el.getBoundingClientRect();
  const ar = area.getBoundingClientRect();
  const cs = getComputedStyle(area);
  const centre = opts.block === "center";
  // "auto" (no scroll-padding) is no room.
  const padding = (v: string) => parseFloat(v) || 0;
  const behavior = opts.behavior ?? "auto";
  if (horiz) {
    const lead = centre ? (area.clientWidth - er.width) / 2 : padding(cs.scrollPaddingLeft);
    const left = area.scrollLeft + er.left - (ar.left + area.clientLeft) - lead;
    area.scrollTo({ left: Math.max(0, Math.round(left)), behavior });
  } else {
    const lead = centre ? (area.clientHeight - er.height) / 2 : padding(cs.scrollPaddingTop);
    const top = area.scrollTop + er.top - (ar.top + area.clientTop) - lead;
    area.scrollTo({ top: Math.max(0, Math.round(top)), behavior });
  }
}

/** Keep boxes that are never meant to scroll — the viewer's frame
 *  around the scroll area, `overflow: hidden` — at their origin. Script
 *  can still scroll them (a `scrollIntoView`, a focus, WebKit's own
 *  revealing of a caret), and once moved nothing moved them back: the
 *  pages sat shifted up, a band of nothing below them. Their scroll
 *  events are heard, so whatever moved them, they are put back. */
export function pinFrames(...frames: HTMLElement[]): void {
  for (const f of frames) {
    f.addEventListener(
      "scroll",
      () => {
        if (f.scrollTop) f.scrollTop = 0;
        if (f.scrollLeft) f.scrollLeft = 0;
      },
      { passive: true },
    );
  }
}

/** Put the point `frac` of the way down page `p` at the centre of the
 *  view (at once). Side by side, the page is centred across instead. */
export function centerPagePoint(area: HTMLElement, p: PageRecord, frac: number, horiz: boolean): void {
  const wr = p.wrapper.getBoundingClientRect();
  const ar = area.getBoundingClientRect();
  if (horiz) area.scrollLeft += wr.left + wr.width / 2 - (ar.left + area.clientWidth / 2);
  else area.scrollTop += wr.top + frac * wr.height - (ar.top + area.clientHeight / 2);
}

/** How far down page `p` (0–1) the view's vertical centre falls. */
export function pageFracAtCenter(area: HTMLElement, p: PageRecord): number {
  const wr = p.wrapper.getBoundingClientRect();
  const ar = area.getBoundingClientRect();
  return wr.height ? Math.max(0, Math.min(1, (ar.top + area.clientHeight / 2 - wr.top) / wr.height)) : 0;
}
