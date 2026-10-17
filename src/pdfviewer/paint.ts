// Zotero's annotations, painted into a page's raster.
//
// Zotero keeps annotations in its database rather than in the PDF bytes,
// so nothing pdf.js draws includes them. Hush lays them over each page
// as positioned boxes and SVG paths blended with `mix-blend-mode`; here
// they go straight into the canvas instead, for the pages, the folded
// view and the thumbnail grid alike — one painter, so a highlight that
// shows in a thumbnail shows on the page.
//
// `viewport` is the viewport the canvas was rendered with, so its
// transform maps PDF user space straight to canvas pixels, honouring a
// CropBox origin that isn't (0,0) and any /Rotate.
import { annotationPosition, pagesOf, rectsOnPage, type Annotation } from "../lib/highlights";
import { inkStrokeColor } from "./ink/geometry";
import type { PageViewport } from "./types";

/** Highlights are drawn the way a highlighter marks paper: multiplied
 *  into the page, so the words stay black under the colour. */
const HIGHLIGHT_ALPHA = 0.45;

function toCanvas(viewport: PageViewport, x: number, y: number): [number, number] {
  const [cx, cy] = viewport.convertToViewportPoint(x, y);
  return [cx, cy];
}

function box(viewport: PageViewport, r: number[]) {
  const [ax, ay] = toCanvas(viewport, r[0], r[1]);
  const [bx, by] = toCanvas(viewport, r[2], r[3]);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Paint the annotations on page `pageIndex` (0-based) into `ctx` —
 *  ink too unless `withInk` is false (the pages draw theirs over the
 *  raster, ink/layer.ts). */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  viewport: PageViewport,
  annotations: Annotation[],
  pageIndex: number,
  withInk = true,
): void {
  const scale = viewport.scale;
  for (const a of annotations) {
    if (a.type === "ink" && !withInk) continue;
    const pos = annotationPosition(a);
    // A passage may run onto the next page (`nextPageRects`).
    const rects = rectsOnPage(pos, pageIndex);
    if (!pos || (pos.pageIndex !== pageIndex && !rects)) continue;
    const color = a.color || (a.type === "ink" ? "#ff0000" : "#ffd400");
    ctx.save();
    if (a.type === "ink" && pos.paths?.length && pos.pageIndex === pageIndex) {
      // Zotero records the pen width in PDF units beside the paths, and
      // draws ink a shade darker than its colour.
      const width = Number(pos.width) || 1;
      ctx.strokeStyle = inkStrokeColor(color);
      ctx.lineWidth = Math.max(0.75, width * scale);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const pts of pos.paths) {
        if (!pts || pts.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i + 1 < pts.length; i += 2) {
          const [x, y] = toCanvas(viewport, pts[i], pts[i + 1]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else if (rects?.length) {
      for (const r of rects) {
        if (!Array.isArray(r) || r.length < 4) continue;
        const b = box(viewport, r);
        if (a.type === "underline") {
          const t = Math.max(1, 1.2 * scale);
          ctx.fillStyle = color;
          ctx.fillRect(b.x, b.y + b.h - t, b.w, t);
        } else if (a.type === "image" || a.type === "text") {
          // An area selection or a text box: outlined, not filled, so
          // the figure inside it stays as it is.
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, 1.5 * scale);
          ctx.strokeRect(b.x, b.y, b.w, b.h);
        } else if (a.type === "note") {
          // A sticky note's marker.
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(b.x, b.y, b.w, b.h);
        } else {
          ctx.globalCompositeOperation = "multiply";
          ctx.globalAlpha = HIGHLIGHT_ALPHA;
          ctx.fillStyle = color;
          ctx.fillRect(b.x, b.y, b.w, b.h);
        }
      }
    }
    ctx.restore();
  }
}

/** A string that changes when what is drawn on a page does — what
 *  decides whether a rendered page has to be repainted after a sync or
 *  an edit. Only what shows counts: a repaint replaces the page's text
 *  layer, and with it any selection being made there, so a comment
 *  edit or a new version number from Zotero mustn't cause one. */
export function pageSignatures(annotations: Annotation[], withInk = true): Map<number, string> {
  const out = new Map<number, string>();
  for (const a of annotations) {
    if (a.type === "ink" && !withInk) continue;
    const pos = (a._raw.data as Record<string, unknown>).annotationPosition;
    const part = `${a.key}:${a.type}:${a.color}:${typeof pos === "string" ? pos : JSON.stringify(pos)}`;
    for (const idx of pagesOf(annotationPosition(a))) out.set(idx, out.has(idx) ? `${out.get(idx)},${part}` : part);
  }
  return out;
}

/** The pages whose drawing differs between two lists of annotations. */
export function changedPages(before: Annotation[], after: Annotation[], withInk: boolean): Set<number> {
  const a = pageSignatures(before, withInk);
  const b = pageSignatures(after, withInk);
  const changed = new Set<number>();
  for (const [i, sig] of b) if (a.get(i) !== sig) changed.add(i);
  for (const i of a.keys()) if (!b.has(i)) changed.add(i);
  return changed;
}
