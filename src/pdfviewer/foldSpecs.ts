// Which regions of the document the folded view shows: each annotation
// passing the filter, padded by a couple of lines above and below and
// merged with its neighbours on the page. Pure geometry — the folds
// themselves (drawing, scrolling, the filter's state) are folds.ts's.
import { annotationPosition, type Annotation } from "../lib/highlights";
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

/** Zotero red is #ff6666; accept the red family without catching
 *  orange (#f19837) or magenta (#e56eee). */
function isRed(color: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((color || "").trim());
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const r = v >> 16;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return r >= 180 && g < 140 && b < 140;
}

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

/** The filter before anyone changes it: red highlights and red ink
 *  (Hush's "come back to this"), plus what was marked in this viewer,
 *  else everything. */
export function defaultFilter(combos: Map<string, Combo>, madeHere: Set<string>): Set<string> {
  const filter = new Set<string>();
  for (const [key, c] of combos) {
    if ((c.type === "ink" || c.type === "highlight") && isRed(c.color)) filter.add(key);
  }
  for (const key of madeHere) if (combos.has(key)) filter.add(key);
  if (!filter.size) for (const key of combos.keys()) filter.add(key);
  return filter;
}

/** Vertical extent of an annotation in top-based page units. */
export function annotationExtent(annot: Annotation, viewport: PageViewport) {
  const pos = annotationPosition(annot);
  if (!pos) return null;
  let top = Infinity;
  let bottom = -Infinity;
  const take = (x: number, y: number) => {
    const [, vy] = pdfPointToViewport(viewport, x, y);
    top = Math.min(top, vy);
    bottom = Math.max(bottom, vy);
  };
  for (const r of pos.rects ?? []) {
    if (!Array.isArray(r) || r.length < 4) continue;
    take(r[0], r[1]);
    take(r[2], r[3]);
  }
  for (const path of pos.paths ?? []) {
    if (!Array.isArray(path)) continue;
    for (let i = 1; i < path.length; i += 2) take(path[i - 1], path[i]);
  }
  return top === Infinity ? null : { top, bottom };
}

/** The pages any annotation passing `active` is on. */
export function foldedPages(annotations: Annotation[], active: Set<string>): Set<number> {
  const out = new Set<number>();
  for (const a of annotations) {
    const idx = annotationPosition(a)?.pageIndex;
    if (typeof idx === "number" && active.has(comboKey(a))) out.add(idx);
  }
  return out;
}

/** Padded, per-page-merged fold intervals for the filter `active`. */
export function computeFolds(annotations: Annotation[], pages: PageRecord[], active: Set<string>): FoldSpec[] {
  const byPage = new Map<number, { top: number; bottom: number }[]>();
  for (const a of annotations) {
    if (!active.has(comboKey(a))) continue;
    const pos = annotationPosition(a);
    const p = pos ? pages[pos.pageIndex] : undefined;
    if (!pos || !p) continue;
    const ext = annotationExtent(a, p.viewport);
    if (!ext) continue;
    const list = byPage.get(pos.pageIndex) || [];
    list.push({
      top: Math.max(0, ext.top - FOLD_PAD),
      bottom: Math.min(p.viewport.height, ext.bottom + FOLD_PAD),
    });
    byPage.set(pos.pageIndex, list);
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
