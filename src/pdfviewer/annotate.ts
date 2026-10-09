// Turning a text selection into the position Zotero records for a
// highlight or underline, and finding the annotation under a tap.
//
// Zotero's position is `{ pageIndex, rects }`, the rects in PDF user
// space (y up), one per line of text — what paint.ts already draws. Its
// sortIndex is `page|offset|top`: the page index, the character offset
// of the passage on its page, and the distance of its first line from
// the top of the page in PDF points (zotero/reader's formatSortIndex).
// Zotero counts characters with its own text extraction; here they are
// counted in pdf.js's text layer, which can differ by a few characters.
// That only matters for the order of annotations within one page.
import { annotationPosition, type Annotation } from "../lib/highlights";
import type { PageRecord } from "./types";

export interface AnnotationDraft {
  pageIndex: number;
  rects: number[][];
  text: string;
  sortIndex: string;
  pageLabel: string;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Per-span boxes → one box per line. Boxes on the same line overlap
 *  vertically by at least half their height and sit close together;
 *  the closeness test keeps the two columns of a page apart. */
function mergeLines(boxes: Box[]): Box[] {
  const lines: Box[] = [];
  const sorted = boxes.slice().sort((a, b) => a.top - b.top || a.left - b.left);
  for (const b of sorted) {
    const h = b.bottom - b.top;
    const line = lines.find((l) => {
      const overlap = Math.min(l.bottom, b.bottom) - Math.max(l.top, b.top);
      const minH = Math.min(h, l.bottom - l.top);
      const gap = Math.max(b.left - l.right, l.left - b.right);
      return overlap >= minH / 2 && gap <= Math.max(h, l.bottom - l.top);
    });
    if (line) {
      line.left = Math.min(line.left, b.left);
      line.right = Math.max(line.right, b.right);
      line.top = Math.min(line.top, b.top);
      line.bottom = Math.max(line.bottom, b.bottom);
    } else lines.push({ ...b });
  }
  return lines;
}

/** The words in a range of the text layer. pdf.js ends each line with
 *  a <br>, which Range.toString() drops, running the last word of one
 *  line into the first of the next; Zotero joins lines with a space. */
export function rangeText(range: Range): string {
  const frag = range.cloneContents();
  for (const br of Array.from(frag.querySelectorAll("br"))) br.replaceWith(" ");
  return (frag.textContent ?? "").replace(/\s+/g, " ").trim();
}

function formatSortIndex(pageIndex: number, offset: number, top: number): string {
  const pad = (n: number, w: number) => String(Math.max(0, Math.floor(n))).slice(0, w).padStart(w, "0");
  return [pad(pageIndex, 5), pad(offset, 6), pad(top, 5)].join("|");
}

/** The draft annotation for `range`, or null when it isn't text in the
 *  pages. A selection running onto a later page is cut at the end of
 *  the page it starts on — a Zotero annotation lives on one page. */
export function draftFromRange(
  range: Range,
  pages: PageRecord[],
  pageLabels: string[] | null,
): AnnotationDraft | null {
  const startEl =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const wrapper = startEl?.closest<HTMLElement>(".pdf-page-wrapper");
  const pageIndex = Number(wrapper?.dataset.pageIndex ?? NaN);
  const p = pages[pageIndex];
  const layer = p?.contentEl?.querySelector<HTMLElement>(".textLayer");
  if (!wrapper || !p || !layer || !layer.contains(range.startContainer)) return null;

  const r = range.cloneRange();
  if (!layer.contains(r.endContainer)) r.setEnd(layer, layer.childNodes.length);
  const text = rangeText(r);
  if (!text) return null;

  // Screen boxes → scale-1 viewport units → PDF user space. The wrapper
  // is the page at its displayed size, whatever CSS stretch the content
  // box is under.
  const wr = wrapper.getBoundingClientRect();
  const k = p.viewport.width / wr.width;
  const boxes: Box[] = [];
  for (const cr of Array.from(r.getClientRects())) {
    const left = Math.max(cr.left, wr.left);
    const right = Math.min(cr.right, wr.right);
    const top = Math.max(cr.top, wr.top);
    const bottom = Math.min(cr.bottom, wr.bottom);
    if (right - left < 0.5 || bottom - top < 0.5) continue;
    boxes.push({
      left: (left - wr.left) * k,
      right: (right - wr.left) * k,
      top: (top - wr.top) * k,
      bottom: (bottom - wr.top) * k,
    });
  }
  if (!boxes.length) return null;
  const rects = mergeLines(boxes).map((b) => {
    const [x1, y1] = p.viewport.convertToPdfPoint(b.left, b.bottom);
    const [x2, y2] = p.viewport.convertToPdfPoint(b.right, b.top);
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].map(round3);
  });

  const before = document.createRange();
  before.setStart(layer, 0);
  before.setEnd(r.startContainer, r.startOffset);
  const offset = before.toString().replace(/\s+/g, "").length;
  const vb = p.viewport.viewBox;
  const top = vb[3] - vb[1] - Math.max(...rects.map((x) => x[3]));

  return {
    pageIndex,
    rects,
    text,
    sortIndex: formatSortIndex(pageIndex, offset, top),
    pageLabel: pageLabels?.[pageIndex] || String(pageIndex + 1),
  };
}

/** The highlight or underline under a point on a page, given as
 *  fractions (0–1) of the page's width and height; where several
 *  overlap, the last in reading order wins, as it is painted on top. */
export function annotationAtPoint(
  p: PageRecord,
  pageIndex: number,
  fx: number,
  fy: number,
  annotations: Annotation[],
): Annotation | null {
  const [x, y] = p.viewport.convertToPdfPoint(fx * p.viewport.width, fy * p.viewport.height);
  const slop = 1.5;
  let hit: Annotation | null = null;
  for (const a of annotations) {
    if (a.type !== "highlight" && a.type !== "underline") continue;
    const pos = annotationPosition(a);
    if (pos?.pageIndex !== pageIndex || !pos.rects) continue;
    const inside = pos.rects.some(
      (r) =>
        x >= Math.min(r[0], r[2]) - slop &&
        x <= Math.max(r[0], r[2]) + slop &&
        y >= Math.min(r[1], r[3]) - slop &&
        y <= Math.max(r[1], r[3]) + slop,
    );
    if (inside) hit = a;
  }
  return hit;
}
