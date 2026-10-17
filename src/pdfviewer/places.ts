// Places in the PDF for reading mode's notepad (src/notepad/): where the
// reader is when a note is written — so a tap on the note goes back
// there — and what is under a point where a LINK is dropped: a
// highlight, or a spot on a page.
import { annotationPosition, type Annotation } from "../lib/highlights";
import { annotationAtPoint, pageBoxAt } from "./annotate";
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
