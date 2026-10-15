// An AI citation's passage, marked in the open PDF.
//
// The eye button on a "See on p. 12" pill opens the PDF here and asks
// for the quoted passage; lib/pdfQuote.ts finds it (the words decide
// the page, the cited number is only where the search starts) and this
// paints it and scrolls to it. The mark is drawn like a search hit — an
// overlay on the page wrapper in percentages of the page, so it needs
// no raster, survives eviction and follows every zoom — but in its own
// colour (--cite-mark), one no Zotero highlight or search hit uses, so
// it can never be mistaken for a mark of the reader's own. It is only
// ever one passage, stays until the next citation replaces it, and is
// never written anywhere.
import { findQuote, type QuoteReport } from "../lib/pdfQuote";
import type { PageRecord, PDFDocumentProxy } from "./types";

export interface CiteMarkEnv {
  getPdfDoc: () => PDFDocumentProxy | null;
  getPages: () => PageRecord[];
  /** Bring a point into view: page index, then x and y as 0–1. */
  reveal: (page: number, x: number, y: number) => void;
  goToPage: (n: number) => void;
}

export function createCiteMark(env: CiteMarkEnv) {
  let token = 0;

  function clear(): void {
    for (const p of env.getPages()) p.wrapper.querySelector(".pdf-cite-marks")?.remove();
  }

  /** Mark `quote` and scroll to it, searching out from page `page`
   *  (1-based); with no quote, or none found, just go to the page.
   *  Resolves with what the search did (null when nothing was searched,
   *  or a newer citation or document took over meanwhile). */
  async function show(quote: string, page: number): Promise<QuoteReport | null> {
    const my = ++token;
    clear();
    const doc = env.getPdfDoc();
    if (!doc || !quote.trim()) {
      env.goToPage(page);
      return null;
    }
    const { place, report } = await findQuote(doc, quote, page);
    if (my !== token || env.getPdfDoc() !== doc) return null;
    const wrapper = place && env.getPages()[place.page - 1]?.wrapper;
    if (!place || !wrapper) {
      env.goToPage(page);
      return report;
    }
    const layer = document.createElement("div");
    layer.className = "pdf-cite-marks";
    for (const r of place.rects) {
      const box = document.createElement("div");
      box.className = "pdf-cite-mark";
      box.style.left = `${r.x * 100}%`;
      box.style.top = `${r.y * 100}%`;
      box.style.width = `${r.w * 100}%`;
      box.style.height = `${r.h * 100}%`;
      layer.appendChild(box);
    }
    wrapper.appendChild(layer);
    const first = place.rects.reduce((a, b) => (b.y < a.y ? b : a));
    env.reveal(place.page - 1, first.x + first.w / 2, first.y + first.h / 2);
    return report;
  }

  return { show };
}
