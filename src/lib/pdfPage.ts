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

/** Returns bare base64 JPEG data (no data: prefix) of page 1. */
export async function renderFirstPageJpeg(data: ArrayBuffer): Promise<string> {
  const task = pdfjs.getDocument({ data });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = TARGET_LONG_EDGE / Math.max(base.width, base.height);
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

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const comma = dataUrl.indexOf(",");
    if (comma < 0 || !dataUrl.startsWith("data:image/jpeg")) {
      throw new Error("JPEG encoding failed");
    }
    return dataUrl.slice(comma + 1);
  } finally {
    void task.destroy();
  }
}
