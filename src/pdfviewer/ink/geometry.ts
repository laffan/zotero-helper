// The arithmetic of ink, in PDF user space (points, y up) — what
// Zotero's own reader does to a drawing, so one made here is shaped,
// erased and merged the way one made in Zotero is.
//
// Zotero keeps an ink annotation as `{ pageIndex, width, paths }`: one
// pen width for the whole annotation and each path a flat run of
// x, y pairs. Its reader smooths a finished stroke (two rounds of
// Chaikin, then drops points closer than 1pt, rounded to 3 decimals),
// erases by taking out the points inside the eraser's circle (which
// splits a path in two) and adds a stroke to the last ink annotation
// when it is close by, recent and drawn with the same pen
// (zotero/reader src/pdf/lib/path.js and pdf-view.js) — the rules
// below are those.

export type Rect = [number, number, number, number];

/** A stroke joins the last ink annotation drawn within this long… */
export const MERGE_MS = 10_000;
/** …and this close to it (PDF points between the two bounding boxes). */
export const MERGE_DISTANCE = 50;
/** Zotero's server refuses a position longer than this. Kept clear of,
 *  so an annotation that would outgrow it starts a new one. */
export const MAX_POSITION_CHARS = 60_000;

/** The pen's widths: 0.1–3pt in tenths — the range writing uses, finer
 *  than Zotero's own steps. (Zotero stores any width; a drawing made in
 *  Zotero with a wider pen keeps its width here.) */
export const PEN_WIDTHS: ReadonlyArray<number> = Array.from({ length: 30 }, (_, i) => (i + 1) / 10);

/** The eraser's sizes (its diameter): the steps Zotero's reader offers
 *  (INK_ANNOTATION_WIDTH_STEPS). */
export const ERASER_SIZES: ReadonlyArray<number> = [
  0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5,
  11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21,
  21.5, 22, 22.5, 23, 23.5, 24, 24.5, 25,
];
/** Zotero's defaults: a 2pt pen, a 16pt eraser. */
export const DEFAULT_PEN_WIDTH = 2;
export const DEFAULT_ERASER_SIZE = 16;
/** Ink may also be black, which highlights can't (EXTRA_INK_AND_TEXT_COLORS). */
export const INK_EXTRA_COLORS: ReadonlyArray<string> = ["#000000"];

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function chaikin(p: number[]): number[] {
  if (p.length < 4) return p;
  const out = [p[0], p[1]];
  for (let i = 0; i < p.length - 2; i += 2) {
    const x1 = p[i], y1 = p[i + 1], x2 = p[i + 2], y2 = p[i + 3];
    out.push(0.75 * x1 + 0.25 * x2, 0.75 * y1 + 0.25 * y2, 0.25 * x1 + 0.75 * x2, 0.25 * y1 + 0.75 * y2);
  }
  out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}

/** A finished stroke as Zotero stores one: smoothed, thinned to points
 *  at least 1pt apart, rounded to 3 decimals. */
export function smoothPath(points: number[]): number[] {
  let p = chaikin(chaikin(points));
  if (p.length >= 4) {
    const kept = [p[0], p[1]];
    for (let i = 2; i < p.length; i += 2) {
      const dx = p[i] - kept[kept.length - 2];
      const dy = p[i + 1] - kept[kept.length - 1];
      if (dx * dx + dy * dy >= 1) kept.push(p[i], p[i + 1]);
    }
    p = kept;
  }
  return p.map(round3);
}

/** The bounding box of some paths. */
export function pathsBounds(paths: number[][]): Rect | null {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i += 2) {
      const x = path[i], y = path[i + 1];
      if (x < x1) x1 = x;
      if (x > x2) x2 = x;
      if (y < y1) y1 = y;
      if (y > y2) y2 = y;
    }
  }
  return x1 === Infinity ? null : [x1, y1, x2, y2];
}

/** Zotero's distanceBetweenRects: 0 when they overlap. */
export function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(a[0], b[0]) > Math.min(a[2], b[2]) ? Math.max(a[0], b[0]) - Math.min(a[2], b[2]) : 0;
  const dy = Math.max(a[1], b[1]) > Math.min(a[3], b[3]) ? Math.max(a[1], b[1]) - Math.min(a[3], b[3]) : 0;
  return Math.hypot(dx, dy);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** The paths with the points inside a circle (`diameter` across, at
 *  x, y) taken out, a path that loses points in its middle becoming
 *  two. Null when the circle touched nothing. */
export function erasePaths(paths: number[][], x: number, y: number, diameter: number): number[][] | null {
  const r2 = (diameter / 2) ** 2;
  let changed = false;
  const out: number[][] = [];
  for (const path of paths) {
    let run: number[] = [];
    for (let i = 0; i + 1 < path.length; i += 2) {
      const dx = path[i] - x;
      const dy = path[i + 1] - y;
      if (dx * dx + dy * dy <= r2) {
        changed = true;
        if (run.length) out.push(run);
        run = [];
      } else run.push(path[i], path[i + 1]);
    }
    if (run.length) out.push(run);
  }
  return changed ? out : null;
}

function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
  const dx = ax + t * vx - px, dy = ay + t * vy - py;
  return dx * dx + dy * dy;
}

/** Does a point fall on the drawn line (within `reach` of its edge)? */
export function hitsPaths(paths: number[][], width: number, x: number, y: number, reach: number): boolean {
  const r = width / 2 + reach;
  const r2 = r * r;
  for (const p of paths) {
    if (p.length === 2 && segmentDistance2(x, y, p[0], p[1], p[0], p[1]) <= r2) return true;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (segmentDistance2(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r2) return true;
    }
  }
  return false;
}

export function translatePaths(paths: number[][], dx: number, dy: number): number[][] {
  return paths.map((p) => p.map((v, i) => round3(v + (i % 2 ? dy : dx))));
}

/** Zotero draws ink a shade darker than its swatch (5%,
 *  DARKEN_INK_AND_TEXT_COLOR), so it reads on a white page. */
export function inkStrokeColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex || "#000000";
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * 0.95);
  return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
}

/** An SVG path's `d` for one path; a single point is a zero-length
 *  line, which round caps draw as a dot. */
export function pathD(p: number[]): string {
  if (p.length < 2) return "";
  let d = `M${p[0]} ${p[1]}`;
  if (p.length === 2) return `${d}L${p[0]} ${p[1]}`;
  for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
  return d;
}

/** Zotero's sortIndex, `page|offset|top`: `offset` is the character
 *  on the page the drawing starts beside, `top` its distance from the
 *  page's top in points. */
export function inkSortIndex(pageIndex: number, offset: number, top: number): string {
  const pad = (n: number, w: number) => String(Math.max(0, Math.floor(n))).slice(0, w).padStart(w, "0");
  return [pad(pageIndex, 5), pad(offset, 6), pad(top, 5)].join("|");
}

/** A path too long to store in one annotation, cut into pieces that
 *  each fit (sharing their end points, so the line stays unbroken). */
export function splitLongPath(path: number[], maxPoints: number): number[][] {
  if (path.length <= maxPoints * 2) return [path];
  const out: number[][] = [];
  for (let i = 0; i < path.length - 2; i += (maxPoints - 1) * 2) out.push(path.slice(i, i + maxPoints * 2));
  return out;
}
