// Text extraction from PDFs via LiteParse (LlamaIndex's local parser,
// WASM build) — spatial parsing gives sensible reading order even on
// multi-column layouts. Runs entirely in the webview, so it works
// identically on desktop and iPad. OCR stays off: scanned PDFs yield
// empty text and callers report that instead of hanging.
//
// What goes to a model is cut at a page's end, never inside one, and
// says which pages it holds and of how many (`PdfText`), so that what
// is sent can be stated exactly — "pp. 1–37 of 212" — rather than as
// "cut short". The caps themselves are the callers' (lib/ai/context.ts).
import wasmUrl from "@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm?url";
import __wbg_init, { LiteParse } from "@llamaindex/liteparse-wasm";

let ready: Promise<unknown> | null = null;

/** A PDF's text as sent: pages `from`–`to` of `total`, each after its
 *  page marker. */
export interface PdfText {
  text: string;
  /** The pages in `text`, 1-based, inclusive (`to` < `from`: none). */
  from: number;
  to: number;
  /** The pages the PDF has; 0 if it couldn't be counted. */
  total: number;
  /** Fewer pages are in `text` than were asked for (or the one page
   *  in it is cut): a cap was reached. */
  truncated: boolean;
}

/** The pages a `PdfText` holds, for the reader and the model: "pp.
 *  1–37 of 212" ("p. 4", "pp. 4–9" when the length isn't known). */
export function sentPages(t: Pick<PdfText, "from" | "to" | "total">): string {
  const pages = t.to <= t.from ? `p. ${t.from}` : `pp. ${t.from}–${t.to}`;
  return t.total ? `${pages} of ${t.total}` : pages;
}

/** Markdown-ish text of the first `maxPages` pages, capped in length. */
export async function extractFirstPagesText(
  data: ArrayBuffer,
  maxPages = 3,
  maxChars = 20000,
): Promise<string> {
  const pages = await parsePages(data, maxPages);
  return pages.map((p) => p.body).join("\n\n").trim().slice(0, maxChars);
}

/** How a page boundary is written into the extracted text. The model
 *  is told to cite the number from the nearest preceding marker, which
 *  is what lets an answer point at a page the reader can go and check.
 *  Counts PDF pages, not printed folios: that is what the app can
 *  render and what Zotero's `?page=` takes. */
export function pageMarker(page: number): string {
  return `[[page ${page}]]`;
}

/** The whole paper, for "Ask Full Papers", with a page marker before
 *  each page — at most `caps.pages` pages and `caps.chars` characters
 *  (the callers' guard, lib/ai/context.ts's TEXT_CAPS); null, all. */
export async function extractFullText(
  data: ArrayBuffer,
  caps: { pages: number; chars: number } | null,
): Promise<PdfText> {
  const total = await countPages(data);
  const last = total || Infinity;
  return marked(data, null, 1, last, total, caps?.pages ?? Infinity, caps?.chars ?? Infinity);
}

/** Pages `from`–`to` (1-based, inclusive) only, for Ask PDF's section or
 *  page range — each after its page marker, numbered as in the PDF —
 *  at most `maxChars` characters (null: all). */
export async function extractPageSpan(
  data: ArrayBuffer,
  from: number,
  to: number,
  maxChars: number | null,
): Promise<PdfText> {
  const total = await countPages(data);
  const last = total ? Math.min(to, total) : to;
  return marked(data, [from, last], from, last, total, last - from + 1, maxChars ?? Infinity);
}

/** Pages `from`–`last` (`range`, for a part; null, from the first),
 *  at most `maxPages` of them, whole pages only until `maxChars` — the
 *  first page cut if it alone is longer. */
async function marked(
  data: ArrayBuffer,
  range: [number, number] | null,
  from: number,
  last: number,
  total: number,
  maxPages: number,
  maxChars: number,
): Promise<PdfText> {
  const pages = await parsePages(data, maxPages, range ?? undefined);
  let text = "";
  let to = from - 1;
  let cut = false;
  for (const p of pages) {
    const chunk = `${pageMarker(p.num)}\n${p.body}`;
    const next = text ? `${text}\n\n${chunk}` : chunk;
    if (next.length > maxChars) {
      if (!text) {
        text = next.slice(0, maxChars);
        to = p.num;
      }
      cut = true;
      break;
    }
    text = next;
    to = p.num;
  }
  const end = total ? Math.min(last, total) : pages.length ? pages[pages.length - 1].num : to;
  return { text: text.trim(), from, to, total, truncated: cut || to < end };
}

/** The PDF's page count, read by pdf.js from its page tree (no page is
 *  parsed); 0 if it can't be read. A copy goes to pdf.js, whose worker
 *  may take the buffer it is handed. */
async function countPages(data: ArrayBuffer): Promise<number> {
  try {
    const [{ getPdfjs }, { PDFJS_ASSETS }] = await Promise.all([
      import("../pdfviewer/pdfjs"),
      import("./pdfjsAssets"),
    ]);
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), ...PDFJS_ASSETS }).promise;
    try {
      return doc.numPages;
    } finally {
      await doc.loadingTask.destroy().catch(() => {});
    }
  } catch {
    return 0;
  }
}

/** Each page's text and its number. `range`: only these pages (1-based,
 *  inclusive), numbered so. */
async function parsePages(
  data: ArrayBuffer,
  maxPages: number,
  range?: [number, number],
): Promise<{ num: number; body: string }[]> {
  ready ??= __wbg_init({ module_or_path: wasmUrl });
  await ready;
  const parser = new LiteParse({
    ...(Number.isFinite(maxPages) ? { maxPages } : {}),
    ocrEnabled: false,
    imageMode: "off",
    extractImages: false,
    outputFormat: "markdown",
    quiet: true,
    ...(range ? { targetPages: `${range[0]}-${range[1]}` } : {}),
  });
  const result = await parser.parse(new Uint8Array(data));
  return result.pages.map((p, i) => ({
    num: (range?.[0] ?? 1) + i,
    body: p.markdown || p.text || "",
  }));
}
