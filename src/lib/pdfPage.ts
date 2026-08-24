// Render a PDF page to a downsampled JPEG.
//
// Two callers with different needs: AI metadata extraction wants page 1
// at ~1568px on the long edge (the sweet spot for Claude vision —
// titles/authors/abstract stay readable while the image costs only
// ~2.5k input tokens), and the citation page viewer wants an arbitrary
// page big enough for a person to read.
import * as pdfjs from "pdfjs-dist";
import { locateQuote, type HighlightRect, type TextRun } from "./pdfHighlight";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const TARGET_LONG_EDGE = 1568;
const JPEG_QUALITY = 0.8;

/** A Zotero annotation to paint over the page. Zotero keeps its own
 *  annotations in its database rather than in the PDF bytes, so nothing
 *  pdf.js draws will include them — we paint them ourselves. */
export interface ThumbAnnotation {
  type: string; // highlight | underline | note | image | ink
  color: string;
  pageIndex: number;
  rects: number[][];
  paths: number[][];
}

/** Paint Zotero's page-1 marks onto the rendered page. Positions are in
 *  raw PDF user space; the viewport transform maps them to canvas pixels
 *  while honouring the crop-box origin and any page rotation (a plain
 *  height-minus-y flip is wrong on cropped pages). */
function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  viewport: { convertToViewportPoint: (x: number, y: number) => number[] },
  scale: number,
  annotations: ThumbAnnotation[],
  pageIndex: number,
): void {
  for (const ann of annotations) {
    if (ann.pageIndex !== pageIndex) continue;
    if (ann.type === "ink" && ann.paths.length) {
      ctx.strokeStyle = ann.color || "#ff0000";
      ctx.lineWidth = Math.max(0.5, scale);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const pts of ann.paths) {
        if (!pts || pts.length < 4) continue;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          const [px, py] = viewport.convertToViewportPoint(pts[i], pts[i + 1]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    } else if (ann.rects.length) {
      ctx.fillStyle = ann.color || "#ffff00";
      ctx.globalAlpha = 0.3;
      for (const r of ann.rects) {
        if (!Array.isArray(r) || r.length < 4) continue;
        const [ax, ay] = viewport.convertToViewportPoint(r[0], r[1]);
        const [bx, by] = viewport.convertToViewportPoint(r[2], r[3]);
        ctx.fillRect(
          Math.min(ax, bx),
          Math.min(ay, by),
          Math.abs(bx - ax),
          Math.abs(by - ay),
        );
      }
      ctx.globalAlpha = 1;
    }
  }
}

/** Returns bare base64 JPEG data (no data: prefix) of page 1, with any
 *  Zotero annotations painted on top. */
export async function renderFirstPageJpeg(
  data: ArrayBuffer,
  longEdge = TARGET_LONG_EDGE,
  quality = JPEG_QUALITY,
  annotations: ThumbAnnotation[] = [],
): Promise<string> {
  return renderPageJpeg(data, 1, longEdge, quality, annotations);
}

/** Pages to try around the cited one before widening to the whole
 *  document. Off-by-a-couple is the common case — a cover page the
 *  extractor counted differently, a citation drifting to the facing
 *  page — so it is worth checking cheaply first. */
const NEARBY = [0, -1, 1, -2, 2, -3, 3];

/** Cap on how much of a long document to sweep for a passage. Each
 *  page's text layer is quick, but a 400-page book should not lock the
 *  dialog up looking for a sentence that may not be there. */
const MAX_SCAN = 80;

/** Order to look for a quoted passage in: the cited page, its
 *  neighbours, then the rest of the document from the front. */
function searchOrder(cited: number, pages: number): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const add = (n: number) => {
    if (n >= 1 && n <= pages && !seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  };
  for (const d of NEARBY) add(cited + d);
  for (let n = 1; n <= pages && order.length < MAX_SCAN; n++) add(n);
  return order.slice(0, MAX_SCAN);
}

/** One page as a `data:` URL, ready to drop into an <img>.
 *
 *  When a passage is given it — not the cited page number — decides
 *  what gets rendered. The number is treated as a hint and searched
 *  around, because it is the part of a citation a model most easily
 *  gets wrong: a paper whose running head reads "CONSUMING WITH OTHERS
 *  507" invites citing the printed folio however plainly the prompt
 *  asks for the marker, and a reader sent to page 507 of a 19-page PDF
 *  is worse off than one sent nowhere. The words are the model's own
 *  and can be checked; the number can't be.
 *
 *  `rendered` is the page actually shown and `found` whether the
 *  passage turned up, so the caller can say when the two disagree. */
export async function renderPageDataUrl(
  data: ArrayBuffer,
  pageNumber: number,
  longEdge: number,
  quote = "",
): Promise<{
  url: string;
  pages: number;
  rendered: number;
  found: boolean;
  /** Where the highlight sits down the page, 0–1, so the viewer can
   *  scroll to it. A passage two thirds down a page is otherwise
   *  "highlighted" somewhere the reader cannot see. */
  focusY: number;
}> {
  const task = pdfjs.getDocument({ data: data.slice(0) });
  try {
    const doc = await task.promise;
    const pages = doc.numPages;
    const cited = Math.min(Math.max(1, pageNumber), pages);

    let rendered = cited;
    let marks: HighlightRect[] = [];
    let page = await doc.getPage(cited);

    if (quote.trim()) {
      const order = searchOrder(cited, pages);
      // Two sweeps. The first will only accept the passage entire, so a
      // page holding all of it wins over an earlier page holding a
      // piece. Only if no page has the whole thing does the second
      // sweep take the largest piece it can find, which is what a quote
      // the extractor spliced out of two parts of a page leaves behind.
      let found: { n: number; rects: HighlightRect[]; words: number } | null =
        null;
      for (const strict of [true, false]) {
        for (const n of order) {
          const hit = await quoteRects(await doc.getPage(n), quote, strict);
          if (hit.rects.length === 0) continue;
          if (strict) {
            found = { n, ...hit };
            break;
          }
          // Partial: keep looking, and keep the best.
          if (!found || hit.words > found.words) found = { n, ...hit };
        }
        if (found) break;
      }
      if (found) {
        rendered = found.n;
        page = await doc.getPage(found.n);
        marks = found.rects;
      }
    }

    const jpeg = await renderPage(page, longEdge, JPEG_QUALITY, [], marks);
    return {
      url: `data:image/jpeg;base64,${jpeg}`,
      pages,
      rendered,
      found: marks.length > 0,
      focusY: topOfHighlight(page, marks),
    };
  } finally {
    void task.destroy();
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Where a quotation sits on the page, in PDF user space, and how much
 *  of it was found there. */
async function quoteRects(
  page: any,
  quote: string,
  strict: boolean,
): Promise<{ rects: HighlightRect[]; words: number }> {
  try {
    const content = await page.getTextContent();
    const runs: TextRun[] = (content.items ?? [])
      .filter((it: any) => typeof it.str === "string")
      .map((it: any) => ({
        str: it.str as string,
        x: it.transform[4] as number,
        y: it.transform[5] as number,
        width: it.width as number,
        height: it.height as number,
        eol: Boolean(it.hasEOL),
      }));
    return locateQuote(runs, quote, strict);
  } catch {
    // A page with no text layer (a scan) simply cannot be highlighted.
    return { rects: [], words: 0 };
  }
}

/** Paint the located passage. Multiply keeps the words readable through
 *  the wash, the way a real highlighter does. */
function drawHighlights(
  ctx: CanvasRenderingContext2D,
  viewport: { convertToViewportPoint: (x: number, y: number) => number[] },
  scale: number,
  rects: HighlightRect[],
): void {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#ffe14d";
  for (const r of rects) {
    const [x, y] = viewport.convertToViewportPoint(r.x, r.y + r.h);
    ctx.fillRect(x, y, r.w * scale, r.h * scale);
  }
  ctx.restore();
}

async function renderPageJpeg(
  data: ArrayBuffer,
  pageNumber: number,
  longEdge: number,
  quality: number,
  annotations: ThumbAnnotation[],
): Promise<string> {
  const task = pdfjs.getDocument({ data });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    return await renderPage(page, longEdge, quality, annotations, []);
  } finally {
    void task.destroy();
  }
}

/** How far down the page the topmost highlight sits, as a fraction.
 *  Rects are in PDF user space, where y counts up from the bottom, so
 *  the page's own viewport does the flip. */
function topOfHighlight(page: any, marks: HighlightRect[]): number {
  if (marks.length === 0) return 0;
  const base = page.getViewport({ scale: 1 });
  let top = Infinity;
  for (const r of marks) {
    const [, y] = base.convertToViewportPoint(r.x, r.y + r.h);
    top = Math.min(top, y);
  }
  return Math.max(0, Math.min(1, top / base.height));
}

/** Rasterize one already-loaded page. */
async function renderPage(
  page: any,
  longEdge: number,
  quality: number,
  annotations: ThumbAnnotation[],
  highlights: HighlightRect[],
): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const scale = longEdge / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // White background: PDFs are transparent where nothing is painted,
  // which would otherwise turn black in JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvas, viewport }).promise;
  if (highlights.length) {
    drawHighlights(ctx, viewport, scale, highlights);
  }
  if (annotations.length) {
    drawAnnotations(ctx, viewport, scale, annotations, page.pageNumber - 1);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.startsWith("data:image/jpeg")) {
    throw new Error("JPEG encoding failed");
  }
  return dataUrl.slice(comma + 1);
}
