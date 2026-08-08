// Render the first page of a PDF to a downsampled JPEG for AI metadata
// extraction. ~1568px on the long edge is the sweet spot for Claude
// vision: titles/authors/abstract stay readable while the image costs
// only ~2.5k input tokens.
import * as pdfjs from "pdfjs-dist";

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
): void {
  for (const ann of annotations) {
    if (ann.pageIndex !== 0) continue;
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
  const task = pdfjs.getDocument({ data });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
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
    if (annotations.length) {
      drawAnnotations(ctx, viewport, scale, annotations);
    }

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const comma = dataUrl.indexOf(",");
    if (comma < 0 || !dataUrl.startsWith("data:image/jpeg")) {
      throw new Error("JPEG encoding failed");
    }
    return dataUrl.slice(comma + 1);
  } finally {
    void task.destroy();
  }
}
