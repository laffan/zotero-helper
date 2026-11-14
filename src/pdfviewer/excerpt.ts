// Parts of the open PDF taken out of it: some of its pages as a PDF of
// their own (the reader's Share this page / pages / section,
// ReaderShare.tsx), and a region of one page drawn as an image (the
// notepad's clip, src/notepad/clip.ts).
//
// The pages are cut by pdf.js itself (`extractPages`, which writes a new
// document from the open one's objects), so nothing is drawn and the
// text stays text. A clip is drawn afresh from the PDF at a resolution
// of its own — the page's raster on screen may be stretched, stale or
// not drawn at all — with the reader's highlights painted in, as on the
// pages; and a second time as dark pages draw it (darkPages.ts), for a
// clip pinned in the dark theme.
import type { Annotation } from "../lib/highlights";
import { darkPagesCopy } from "./darkPages";
import { drawAnnotations } from "./paint";
import type { PageRecord, PDFDocumentProxy } from "./types";

/** PDF points to image pixels a clip is drawn at, and the most pixels
 *  its longer side may have (it is kept in the notepad's file). */
const CLIP_SCALE = 3;
const CLIP_MAX_PX = 1800;

export interface ClipImage {
  /** A JPEG, as a data URL — and the same white on black. */
  src: string;
  dark: string;
  /** Its size in PDF points: how large it shows at first. */
  width: number;
  height: number;
  /** The PDF height (y up) of its top: the place it links back to. */
  top: number;
}

export interface ExcerptEnv {
  getPdfDoc: () => PDFDocumentProxy | null;
  getPages: () => PageRecord[];
  getAnnotations: () => Annotation[];
}

export function createExcerpts(env: ExcerptEnv) {
  /** A new PDF of pages `indices` (0-based) of the open one; null with
   *  none open. */
  async function extractPages(indices: number[]): Promise<Uint8Array | null> {
    const doc = env.getPdfDoc();
    if (!doc || !indices.length) return null;
    return doc.extractPages([{ document: null, includePages: indices }]);
  }

  /** Page `pageIndex`'s region `box` — fractions of the page as shown,
   *  [left, top, right, bottom] — as an image. */
  async function clipImage(pageIndex: number, box: [number, number, number, number]): Promise<ClipImage | null> {
    const doc = env.getPdfDoc();
    const p = env.getPages()[pageIndex];
    if (!doc || !p) return null;
    const page = await doc.getPage(pageIndex + 1);
    // The page as the viewer lays it out (its own size brought to the
    // typical page's, pageSizes.ts), in points.
    const norm = p.norm ?? 1;
    const base = page.getViewport({ scale: norm });
    const [l, t, r, b] = box;
    const w = (r - l) * base.width;
    const h = (b - t) * base.height;
    if (w < 2 || h < 2) return null;
    const scale = Math.min(CLIP_SCALE, CLIP_MAX_PX / Math.max(w, h));
    const viewport = page.getViewport({
      scale: norm * scale,
      offsetX: -l * base.width * scale,
      offsetY: -t * base.height * scale,
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    try {
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      const ctx = canvas.getContext("2d");
      if (ctx) drawAnnotations(ctx, viewport, env.getAnnotations(), pageIndex);
      const top = Math.round(base.convertToPdfPoint(0, t * base.height)[1]);
      const inverted = darkPagesCopy(canvas);
      const dark = inverted.toDataURL("image/jpeg", 0.9);
      inverted.width = inverted.height = 0;
      return { src: canvas.toDataURL("image/jpeg", 0.9), dark, width: Math.round(w), height: Math.round(h), top };
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  return { extractPages, clipImage };
}
