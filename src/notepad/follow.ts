// Following the PDF (surface.ts's `follow`, the bar's scroll link):
// where on the pad the notes about a page are — on the supposition that
// the pad is written from top to bottom as the PDF is read.
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
