// Keeping the reader's place across a relayout. When the pages change
// size — the outline or the notes opening beside them, a window resize
// in a fit mode — the old scroll offset points somewhere else; the
// place is kept instead as a page and a fraction into it. The paged
// view keeps its set (watchResize).
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

export interface ResizeEnv {
  hasPages: () => boolean;
  /** The view's size changed: cached page geometry is stale. */
  geometryChanged: () => void;
  /** The pages are fitted to the view, so a resize lays them out again. */
  fitsView: () => boolean;
  relayout: () => void;
  /** The paged view's set on screen (its first page, 1-based). */
  shownSet: () => number;
  isPaged: () => boolean;
  horizontal: () => boolean;
  goToPage: (n: number) => void;
}

/** Follow the view's size. A resize (reading mode in or out, a panel
 *  opening) also moves where the paged view's sets snap: the browser
 *  may settle on the neighbouring set before the relayout runs, and
 *  WebKit may not snap again after it at all, leaving the set
 *  off-centre. So the set shown when the resize began is put back,
 *  centred, once the pages are relaid — and side by side the view is
 *  never left scrolled vertically (the pages fit its height). */
export function watchResize(area: HTMLElement, env: ResizeEnv): () => void {
  let timer: number | null = null;
  let lead: number | null = null;
  const observer = new ResizeObserver(() => {
    if (!env.hasPages()) return;
    lead ??= env.shownSet();
    // A container resize can re-wrap rows, so cached geometry is stale
    // either way; fit-mode geometry follows behind a short debounce.
    env.geometryChanged();
    if (!env.fitsView()) {
      lead = null;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      const set = lead;
      lead = null;
      env.relayout();
      if (env.horizontal() && area.scrollTop) area.scrollTop = 0;
      if (env.isPaged() && set) env.goToPage(set);
    }, 80);
  });
  observer.observe(area);
  return () => {
    observer.disconnect();
    if (timer) clearTimeout(timer);
  };
}
