// The notepad's geometry: strokes as SVG paths, their bounds, how near
// a point comes to one, and whether a point is inside a lasso. Canvas
// coordinates (CSS pixels) throughout.
import type { NoteStroke } from "./model";

/** A smooth path through the points (midpoint quadratics). */
export function pathD(pts: number[]): string {
  if (pts.length < 2) return "";
  if (pts.length < 4) return `M${pts[0]} ${pts[1]}l0.01 0`;
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i + 3 < pts.length; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2;
    const my = (pts[i + 1] + pts[i + 3]) / 2;
    d += `Q${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  return `${d}L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
}

export function bounds(pts: number[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    x1 = Math.max(x1, pts[i]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return [x0, y0, x1, y1];
}

/** Distance from (x, y) to a stroke's line. */
function distanceTo(pts: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1];
    const bx = pts[i + 2] ?? ax, by = pts[i + 3] ?? ay;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

/** Is (x, y) within `reach` of the stroke's line? */
export function touches(s: NoteStroke, x: number, y: number, reach: number): boolean {
  const [x0, y0, x1, y1] = bounds(s.points);
  if (x < x0 - reach || x > x1 + reach || y < y0 - reach || y > y1 + reach) return false;
  return distanceTo(s.points, x, y) <= reach;
}

/** Is (x, y) inside the polygon `poly` (x, y pairs)? Even-odd, as
 *  Hush's lasso counts it. */
export function inPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 2; i + 1 < n; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1];
    const xj = poly[j], yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
