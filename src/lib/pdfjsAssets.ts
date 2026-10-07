// Where pdf.js finds what it loads at run time (vite.config.ts serves
// and bundles them under /pdfjs/). Without `wasmUrl` the JBIG2 and
// JPEG 2000 decoders never load, and a scanned PDF — whose pages are
// exactly those images — renders blank around its OCR text. Every
// getDocument call spreads these in.
const base = (dir: string) =>
  new URL(`pdfjs/${dir}/`, typeof document !== "undefined" ? document.baseURI : "/").href;

export const PDFJS_ASSETS = {
  wasmUrl: base("wasm"),
  iccUrl: base("iccs"),
  standardFontDataUrl: base("standard_fonts"),
  cMapUrl: base("cmaps"),
  cMapPacked: true,
};
