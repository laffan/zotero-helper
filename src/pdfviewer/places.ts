// Places in the PDF for reading mode's notepad (src/notepad/): where the
// reader is when a note is written — so a tap on the note goes back
// there — and what is under a point where a LINK is dropped: a
// highlight, or a spot on a page. And the pages in view, which the
// Share menu and Ask PDF offer as Visible pages.
import { annotationPosition, type Annotation } from "../lib/highlights";
import { annotationAtPoint, pageBoxAt } from "./annotate";
import type { Crop } from "./crop";
import type { PageRecord } from "./types";

/** A spot on a page: 0-based page, and a height on it in PDF units (y
 *  up), or null for its top. */
export interface PagePlace {
  pageIndex: number;
  top: number | null;
}

export type PlaceTarget =
  | ({ kind: "place" } & PagePlace)
  | { kind: "annotation"; key: string; pageIndex: number; text: string; color: string };

/** The PDF height of a point a fraction `fy` down page `p`. */
function heightAt(p: PageRecord, fy: number): number {
  const [, y] = p.viewport.convertToPdfPoint(0, Math.max(0, Math.min(1, fy)) * p.viewport.height);
  return Math.round(y);
}

/** Where the reader is: page `idx` (the one at the view's centre), at
 *  the height a quarter of the way down the view — about where the
 *  eye is — or its top when the page isn't laid out (the folded view). */
export function placeInView(area: HTMLElement, pages: PageRecord[], idx: number): PagePlace | null {
  const p = pages[idx];
  if (!p) return null;
  const wr = p.wrapper.getBoundingClientRect();
  if (!wr.height) return { pageIndex: idx, top: null };
  const ar = area.getBoundingClientRect();
  return { pageIndex: idx, top: heightAt(p, (ar.top + area.clientHeight / 4 - wr.top) / wr.height) };
}

/** What is at a client point: one of the reader's highlights, or the
 *  spot on the page; null off the pages. */
export function placeAtPoint(pages: PageRecord[], annotations: Annotation[], x: number, y: number): PlaceTarget | null {
  const at = pageBoxAt(document.elementFromPoint(x, y));
  const p = at ? pages[at.pageIndex] : undefined;
  if (!at || !p) return null;
  const r = at.box.getBoundingClientRect();
  const fx = (x - r.left) / r.width;
  const fy = (y - r.top) / r.height;
  const a = annotationAtPoint(p, at.pageIndex, fx, fy, annotations);
  if (a) {
    const pageIndex = annotationPosition(a)?.pageIndex ?? at.pageIndex;
    return { kind: "annotation", key: a.key, pageIndex, text: a.text, color: a.color };
  }
  return { kind: "place", pageIndex: at.pageIndex, top: heightAt(p, fy) };
}

/** The pages in view, first–last (1-based): each whole from top to
 *  bottom in the view and at least half of it across — so a spread of
 *  pages side by side counts, and a sliver at the edge doesn't. Found
 *  from page `idx` (the one at the view's centre) outwards, as far as
 *  the pages still meet the view. With a reading crop, only what it
 *  leaves of a page has to show. Null when no page is whole (zoomed
 *  in, a page taller than the view) or none is laid out (folded). */
export function pagesInView(area: HTMLElement, pages: PageRecord[], idx: number, crop: Crop | null): [number, number] | null {
  const a = area.getBoundingClientRect();
  // The frame round the scroll area clips it when it is magnified.
  const f = area.parentElement?.getBoundingClientRect() ?? a;
  const SLOP = 2;
  const view = {
    top: Math.max(a.top, f.top) - SLOP,
    bottom: Math.min(a.bottom, f.bottom) + SLOP,
    left: Math.max(a.left, f.left),
    right: Math.min(a.right, f.right),
  };
  const c = crop ?? { t: 0, r: 0, b: 0, l: 0 };
  let first = -1;
  let last = -1;
  /** Does page `i` meet the view? Noted when it is whole in it. */
  const take = (i: number): boolean => {
    const w = pages[i]?.wrapper.getBoundingClientRect();
    if (!w || !w.height) return false;
    const top = w.top + c.t * w.height;
    const bottom = w.bottom - c.b * w.height;
    const left = w.left + c.l * w.width;
    const right = w.right - c.r * w.width;
    if (bottom <= view.top || top >= view.bottom || right <= view.left || left >= view.right) return false;
    const across = Math.min(right, view.right) - Math.max(left, view.left);
    if (top >= view.top && bottom <= view.bottom && across >= (right - left) / 2) {
      first = first < 0 ? i : Math.min(first, i);
      last = Math.max(last, i);
    }
    return true;
  };
  if (!take(idx)) return null;
  for (let i = idx - 1; i >= 0 && take(i); i--);
  for (let i = idx + 1; i < pages.length && take(i); i++);
  return first < 0 ? null : [first + 1, last + 1];
}
