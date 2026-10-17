// Which regions of the document the folded view shows: each annotation
// passing the filter, padded by a couple of lines above and below and
// merged with its neighbours on the page. Pure geometry — the folds
// themselves (drawing, scrolling, the filter's state) are folds.ts's.
import { annotationPosition, pagesOf, rectsOnPage, type Annotation } from "../lib/highlights";
import { pdfPointToViewport } from "./annotations";
import type { PageRecord, PageViewport } from "./types";

const FOLD_PAD = 28; // page units (~2 text lines) above/below the annotation
const MERGE_GAP = 16; // merge folds whose padded regions come this close

/** A fold: a stretch of one page, top to bottom in page units. */
export interface FoldSpec {
  pageIndex: number;
  top: number;
  bottom: number;
}

export type Combo = { type: string; color: string; count: number };

/** The filter's key for an annotation: its type and colour. */
export const comboKey = (a: Annotation) => `${a.type}:${(a.color || "").toLowerCase()}`;

/** Every type:colour pair present on a page, with how many of each. */
export function availableCombos(annotations: Annotation[]): Map<string, Combo> {
  const map = new Map<string, Combo>();
  for (const a of annotations) {
    if (typeof annotationPosition(a)?.pageIndex !== "number") continue;
    const key = comboKey(a);
    const entry = map.get(key) || { type: a.type, color: (a.color || "").toLowerCase(), count: 0 };
    entry.count++;
    map.set(key, entry);
  }
  return map;
}

/** The filter before anyone changes it: every type and colour there is.
 *  (Hush starts on red highlights and red ink alone, its "come back to
 *  this"; here the folded view starts on all the annotations, and the
 *  filter narrows it.) */
export function defaultFilter(combos: Map<string, Combo>): Set<string> {
  return new Set(combos.keys());
}

/** Vertical extent of an annotation in top-based page units — on page
 *  `pageIndex` (its own, unless given: a passage may run onto the next). */
export function annotationExtent(annot: Annotation, viewport: PageViewport, pageIndex?: number) {
  const pos = annotationPosition(annot);
  if (!pos) return null;
  const onNext = pageIndex !== undefined && pageIndex !== pos.pageIndex;
  let top = Infinity;
  let bottom = -Infinity;
  const take = (x: number, y: number) => {
    const [, vy] = pdfPointToViewport(viewport, x, y);
    top = Math.min(top, vy);
    bottom = Math.max(bottom, vy);
  };
  for (const r of (pageIndex === undefined ? pos.rects : rectsOnPage(pos, pageIndex)) ?? []) {
    if (!Array.isArray(r) || r.length < 4) continue;
    take(r[0], r[1]);
    take(r[2], r[3]);
  }
  for (const path of onNext ? [] : (pos.paths ?? [])) {
    if (!Array.isArray(path)) continue;
    for (let i = 1; i < path.length; i += 2) take(path[i - 1], path[i]);
  }
  return top === Infinity ? null : { top, bottom };
}

/** The pages any annotation passing `active` is on. */
export function foldedPages(annotations: Annotation[], active: Set<string>): Set<number> {
  const out = new Set<number>();
  for (const a of annotations) {
    if (active.has(comboKey(a))) for (const idx of pagesOf(annotationPosition(a))) out.add(idx);
  }
  return out;
}

/** Padded, per-page-merged fold intervals for the filter `active`. */
export function computeFolds(annotations: Annotation[], pages: PageRecord[], active: Set<string>): FoldSpec[] {
  const byPage = new Map<number, { top: number; bottom: number }[]>();
  for (const a of annotations) {
    if (!active.has(comboKey(a))) continue;
    for (const idx of pagesOf(annotationPosition(a))) {
      const p = pages[idx];
      const ext = p ? annotationExtent(a, p.viewport, idx) : null;
      if (!p || !ext) continue;
      const list = byPage.get(idx) || [];
      list.push({
        top: Math.max(0, ext.top - FOLD_PAD),
        bottom: Math.min(p.viewport.height, ext.bottom + FOLD_PAD),
      });
      byPage.set(idx, list);
    }
  }
  const out: FoldSpec[] = [];
  for (const idx of [...byPage.keys()].sort((a, b) => a - b)) {
    const list = byPage.get(idx)!.sort((a, b) => a.top - b.top);
    let cur: FoldSpec | null = null;
    for (const iv of list) {
      if (cur && iv.top <= cur.bottom + MERGE_GAP) cur.bottom = Math.max(cur.bottom, iv.bottom);
      else {
        cur = { pageIndex: idx, top: iv.top, bottom: iv.bottom };
        out.push(cur);
      }
    }
  }
  return out;
}
