// Find a quoted passage in an open PDF — the search behind an AI
// citation's eye button, which opens the PDF in the reader at the
// passage (pdfviewer/citeMark.ts paints it there).
//
// The words decide, not the cited page number: the number is treated
// as a hint and searched around, because it is the part of a citation
// a model most easily gets wrong. A paper whose running head reads
// "CONSUMING WITH OTHERS 507" invites citing the printed folio however
// plainly the prompt asks for the marker, and a reader sent to page 507
// of a 19-page PDF is worse off than one sent nowhere. The words are
// the model's own and can be checked; the number can't be.
//
// It takes the viewer's own document rather than loading one, so the
// search costs no second parse of the file.
import {
  locateQuote,
  toWords,
  type HighlightRect,
  type QuoteHit,
  type TextRun,
} from "./pdfHighlight";

/** How many pages to sweep before giving up. Each page's text layer is
 *  a few milliseconds, but a thousand-page scan should not lock the
 *  reader up looking for a sentence that may not be there. The report
 *  says when a sweep was cut short, so a miss on a very long document
 *  is not mistaken for a passage that isn't there. */
const MAX_SCAN = 400;

/** Pages to look in, nearest the cited one first, spiralling out to
 *  cover the whole document.
 *
 *  It used to check a few neighbours and then sweep from page 1, capped
 *  at 80 pages — which quietly meant that on anything book-length, a
 *  passage past page 80 was never looked at unless the cited number
 *  happened to be within three of it. A model reading a printed folio
 *  off a book page is never within three. */
function searchOrder(cited: number, pages: number): number[] {
  const order: number[] = [];
  const seen = new Set<number>();
  const add = (n: number) => {
    if (n >= 1 && n <= pages && !seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  };
  add(cited);
  for (let d = 1; d <= pages && order.length < MAX_SCAN; d++) {
    add(cited - d);
    add(cited + d);
  }
  return order.slice(0, MAX_SCAN);
}

/** What a search did, for the activity log. A miss is only useful if
 *  you can tell *why* — the passage is not in this PDF, or the pages
 *  have no text layer, or the sweep ran out before reaching it. */
export interface QuoteReport {
  quoteWords: number;
  citedPage: number;
  pages: number;
  scanned: number;
  foundPage: number | null;
  matchedWords: number;
  exact: boolean;
  /** Longest run found anywhere, accepted or not, and where. */
  bestRun: number;
  bestRunPage: number | null;
  /** Words the text layer yielded across the sweep. Zero means scans. */
  textWords: number;
  /** Why the text layer came back empty, when it failed rather than
   *  simply being absent. */
  textError?: string;
  /** True when MAX_SCAN cut the sweep short of the whole document. */
  truncated: boolean;
}

/** Where the passage is: its page (1-based) and its boxes there, as
 *  fractions of the page (0–1, from the top left) so they can sit over
 *  the page at any zoom. */
export interface QuotePlace {
  page: number;
  rects: { x: number; y: number; w: number; h: number }[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Turn pdf.js text items into runs we can measure. Marked-content
 *  items carry no string and are skipped. */
function toRuns(items: any[]): TextRun[] {
  return items
    .filter((it: any) => typeof it.str === "string")
    .map((it: any) => ({
      str: it.str as string,
      x: it.transform[4] as number,
      y: it.transform[5] as number,
      width: it.width as number,
      height: it.height as number,
      eol: Boolean(it.hasEOL),
    }));
}

/** The page's text items.
 *
 *  `getTextContent()` is the obvious call, and it consumes its chunk
 *  stream with `for await` — which needs async iteration over a
 *  ReadableStream, the one part of this that some WebKit builds don't
 *  have. Where it's missing the call throws before a single item is
 *  read, on every page, and the page looks exactly like a scan. So a
 *  failure falls back to pumping the same stream through a reader,
 *  which is plain ES2018 and works anywhere. */
async function textItems(page: any): Promise<any[]> {
  try {
    const content = await page.getTextContent();
    return content.items ?? [];
  } catch (e) {
    const stream = page.streamTextContent?.();
    if (!stream?.getReader) throw e;
    const reader = stream.getReader();
    const items: any[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value?.items) items.push(...value.items);
    }
    return items;
  }
}

/** Where a quotation sits on the page, in PDF user space, and how much
 *  of it was found there. `error` is set when the page's text couldn't
 *  be read at all — the difference between a scanned page and a text
 *  layer this build of pdf.js failed on, which the log has to be able
 *  to tell apart. */
async function quoteRects(
  page: any,
  quote: string,
): Promise<QuoteHit & { error?: string }> {
  try {
    return locateQuote(toRuns(await textItems(page)), quote);
  } catch (e) {
    // A page with no text layer (a scan) simply cannot be highlighted;
    // neither can one whose text layer threw. Say which.
    console.warn(`Highlight: text layer failed on page ${page.pageNumber}`, e);
    return {
      rects: [],
      words: 0,
      exact: false,
      bestRun: 0,
      pageWords: 0,
      error: String(e),
    };
  }
}

/** PDF user-space boxes (y up from the bottom) as fractions of the
 *  page. The page's own viewport does the flip, honouring the crop-box
 *  origin and any rotation. */
function toFractions(page: any, rects: HighlightRect[]): QuotePlace["rects"] {
  const vp = page.getViewport({ scale: 1 });
  return rects.map((r) => {
    const [ax, ay] = vp.convertToViewportPoint(r.x, r.y + r.h);
    const [bx, by] = vp.convertToViewportPoint(r.x + r.w, r.y);
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    return {
      x: x / vp.width,
      y: y / vp.height,
      w: Math.abs(bx - ax) / vp.width,
      h: Math.abs(by - ay) / vp.height,
    };
  });
}

/** Look for `quote` in `doc`, starting at `citedPage` and spiralling
 *  out. `place` is null when no stretch of it turned up anywhere. */
export async function findQuote(
  doc: { numPages: number; getPage: (n: number) => Promise<any> },
  quote: string,
  citedPage: number,
): Promise<{ place: QuotePlace | null; report: QuoteReport }> {
  const pages = doc.numPages;
  const cited = Math.min(Math.max(1, citedPage), pages);
  let best: { n: number; page: any; hit: QuoteHit } | null = null;
  let bestRun = 0;
  let bestRunPage: number | null = null;
  let textWords = 0;
  let scanned = 0;
  let textError: string | undefined;

  for (const n of searchOrder(cited, pages)) {
    const page = await doc.getPage(n);
    const hit = await quoteRects(page, quote);
    scanned++;
    textWords += hit.pageWords;
    textError ??= hit.error;
    if (hit.bestRun > bestRun) {
      bestRun = hit.bestRun;
      bestRunPage = n;
    }
    if (hit.rects.length === 0) continue;
    // The whole passage settles it; a piece of it is worth keeping
    // while a better page might still turn up.
    if (hit.exact) {
      best = { n, page, hit };
      break;
    }
    if (!best || hit.words > best.hit.words) best = { n, page, hit };
  }

  return {
    place: best ? { page: best.n, rects: toFractions(best.page, best.hit.rects) } : null,
    report: {
      quoteWords: toWords(quote).length,
      citedPage,
      pages,
      scanned,
      foundPage: best ? best.n : null,
      matchedWords: best ? best.hit.words : 0,
      exact: best ? best.hit.exact : false,
      bestRun,
      bestRunPage,
      textWords,
      textError,
      truncated: scanned < pages,
    },
  };
}
