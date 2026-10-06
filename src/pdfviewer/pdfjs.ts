// One lazily loaded pdf.js for the viewer and its thumbnail / fold
// renderers, sharing the worker setup src/lib/pdfPage.ts uses.
import type * as PdfJs from "pdfjs-dist";

let loading: Promise<typeof PdfJs> | null = null;

export function getPdfjs(): Promise<typeof PdfJs> {
  loading ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return loading;
}
