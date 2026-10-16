// Pages of a size of their own — the cover sheet a journal or JSTOR
// prepends, a scanned insert, a fold-out — brought to the size of the
// rest.
//
// Everything in the viewer is laid out from one page's size: the fit
// modes fit it, and every page waits at its size until it is drawn
// (opening a book isn't a walk over every page). That page was page 1,
// so a large cover made every other page small. Now a few pages are
// sampled as the PDF opens and the median one is the document's
// typical page, which fits and seeds the layout; and any page whose
// area is far from it (OUTLIER_AREA) is scaled to fit the typical
// page's box.
//
// The scaling is done by giving such a page a viewport at a scale of
// its own (`norm`) and treating that as its scale-1 viewport, which is
// what the rest of the viewer reads a page's size from. So its wrapper,
// text layer, highlights, ink, links and search hits all agree with
// each other unchanged; only what renders it — the page raster, the
// folds' strips, the text layers — multiplies `norm` in, through
// `pageViewport`.
import type { PageRecord, PageViewport, PDFDocumentProxy, PDFPageProxy } from "./types";

/** Pages within this factor of the typical page's area are left at
 *  their own size: a landscape page, a slightly larger plate. */
const OUTLIER_AREA = 1.6;
/** How many pages to sample: the first few (where inserted pages are)
 *  and as many spread through the document. */
const SAMPLE_HEAD = 6;
const SAMPLE_SPREAD = 6;

/** The document's typical page (scale 1), from a sample of its pages,
 *  and the sampled pages' own viewports. */
export async function sampleTypicalPage(
  doc: PDFDocumentProxy,
): Promise<{ typical: PageViewport; known: Map<number, PageViewport> }> {
  const n = doc.numPages;
  const idx = new Set<number>();
  for (let i = 0; i < Math.min(n, SAMPLE_HEAD); i++) idx.add(i);
  for (let k = 1; k <= SAMPLE_SPREAD; k++) idx.add(Math.min(n - 1, Math.floor((k * n) / (SAMPLE_SPREAD + 1))));
  const known = new Map<number, PageViewport>();
  await Promise.all(
    [...idx].map((i) =>
      doc
        .getPage(i + 1)
        .then((page) => known.set(i, page.getViewport({ scale: 1 })))
        .catch(() => undefined),
    ),
  );
  const byArea = [...known.values()].sort((a, b) => a.width * a.height - b.width * b.height);
  const typical = byArea[Math.floor(byArea.length / 2)] ?? (await doc.getPage(1)).getViewport({ scale: 1 });
  return { typical, known };
}

/** A page's viewport as the viewer uses it: its own, or — for a page
 *  far from the typical size — scaled to fit the typical page's box. */
export function normalizedViewport(raw: PageViewport, typical: PageViewport | null): { viewport: PageViewport; norm: number } {
  if (!typical) return { viewport: raw, norm: 1 };
  const ratio = (raw.width * raw.height) / (typical.width * typical.height);
  if (ratio <= OUTLIER_AREA && ratio >= 1 / OUTLIER_AREA) return { viewport: raw, norm: 1 };
  const norm = Math.min(typical.width / raw.width, typical.height / raw.height);
  return { viewport: raw.clone({ scale: norm }), norm };
}

/** Learn a page's real size the first time it is drawn (until then it
 *  waits at the typical page's). True when that changed its size. */
export function adoptViewport(p: PageRecord, page: PDFPageProxy, typical: PageViewport | null): boolean {
  if (p.realViewport) return false;
  const { viewport, norm } = normalizedViewport(page.getViewport({ scale: 1 }), typical);
  const differed =
    Math.abs(viewport.width - p.viewport.width) > 0.5 || Math.abs(viewport.height - p.viewport.height) > 0.5;
  p.realViewport = true;
  p.viewport = viewport;
  p.norm = norm;
  return differed;
}

/** The pdf.js viewport to draw a page at `scale` CSS px per unit of its
 *  (normalised) viewport. */
export function pageViewport(page: PDFPageProxy, p: PageRecord | undefined, scale: number, offsetY?: number): PageViewport {
  return page.getViewport({ scale: scale * (p?.norm ?? 1), ...(offsetY !== undefined ? { offsetY } : {}) });
}
