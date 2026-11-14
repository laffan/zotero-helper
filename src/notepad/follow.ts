// Following the PDF (surface.ts's `follow`, the bar's scroll link):
// where on the pad the notes about a page are — on the supposition that
// the pad is written from top to bottom as the PDF is read — and the
// glide there.
import { strokeBox } from "./ink";
import type { Notepad } from "./model";

interface Span {
  page: number;
  x0: number;
  y0: number;
  y1: number;
}

/** The part of the pad about page `pageIndex`: the top of its notes
 *  and links; for a page with none, between those of the pages before
 *  and after it, as far along as the page is; past the last, just
 *  under it. Canvas coordinates, or null on an empty pad. */
export function spotFor(pad: Notepad, pageIndex: number): { x: number; y: number } | null {
  const spans: Span[] = [];
  const byNote = new Map<string, Span>();
  for (const n of pad.notes) byNote.set(n.id, { page: n.pageIndex, x0: Infinity, y0: Infinity, y1: -Infinity });
  for (const s of pad.strokes) {
    const span = byNote.get(s.note);
    if (!span) continue;
    const b = strokeBox(s);
    span.x0 = Math.min(span.x0, b[0]);
    span.y0 = Math.min(span.y0, b[1]);
    span.y1 = Math.max(span.y1, b[3]);
  }
  for (const span of byNote.values()) if (span.x0 !== Infinity) spans.push(span);
  for (const l of pad.links) spans.push({ page: l.target.pageIndex, x0: l.x, y0: l.y, y1: l.y + (l.h ?? 24) });
  if (!spans.length) return null;
  const here = spans.filter((s) => s.page === pageIndex);
  if (here.length) return { x: Math.min(...here.map((s) => s.x0)), y: Math.min(...here.map((s) => s.y0)) };
  const before = spans.filter((s) => s.page < pageIndex);
  const after = spans.filter((s) => s.page > pageIndex);
  const a = before.length ? before.reduce((m, s) => (s.page > m.page || (s.page === m.page && s.y1 > m.y1) ? s : m)) : null;
  const b = after.length ? after.reduce((m, s) => (s.page < m.page || (s.page === m.page && s.y0 < m.y0) ? s : m)) : null;
  if (a && b) {
    const t = (pageIndex - a.page) / (b.page - a.page);
    return { x: Math.min(a.x0, b.x0), y: a.y1 + (b.y0 - a.y1) * t };
  }
  return a ? { x: a.x0, y: a.y1 + 20 } : { x: b!.x0, y: b!.y0 };
}

/** How long the pad takes to glide to the part about a page, ms. */
const GLIDE_MS = 350;

export interface FollowEnv {
  pad: () => Notepad;
  host: HTMLElement;
  /** The view's pan, and moving it (once a frame). */
  pan: () => { x: number; y: number };
  setPan: (x: number, y: number) => void;
  /** A gesture is under way: the pad stays put. */
  busy: () => boolean;
}

/** Following the PDF: `follow` pans, smoothly, to the part of the pad
 *  about a page — its top a little below the pad's top, its left in
 *  view — in a short glide (GLIDE_MS, easing out), which `stop` (a
 *  press on the pad) ends where it is. */
export function createFollower(env: FollowEnv) {
  let glide = 0;
  function stop(): void {
    cancelAnimationFrame(glide);
    glide = 0;
  }
  function glideTo(x: number, y: number): void {
    stop();
    const from = env.pan();
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / GLIDE_MS);
      const k = 1 - (1 - t) ** 3;
      env.setPan(Math.round(from.x + (x - from.x) * k), Math.round(from.y + (y - from.y) * k));
      glide = t < 1 ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  }
  function follow(pageIndex: number): void {
    const spot = spotFor(env.pad(), pageIndex);
    if (!spot || env.busy()) return;
    const pan = env.pan();
    const margin = 28;
    const y = margin - spot.y;
    const x = spot.x + pan.x < 8 || spot.x + pan.x > env.host.clientWidth - 40 ? margin - spot.x : pan.x;
    if (Math.abs(y - pan.y) < 2 && Math.abs(x - pan.x) < 2) return;
    glideTo(x, y);
  }
  return { follow, stop };
}
