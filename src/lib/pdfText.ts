// Text extraction from PDFs via LiteParse (LlamaIndex's local parser,
// WASM build) — spatial parsing gives sensible reading order even on
// multi-column layouts. Runs entirely in the webview, so it works
// identically on desktop and iPad. OCR stays off: scanned PDFs yield
// empty text and callers report that instead of hanging.
import wasmUrl from "@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm?url";
import __wbg_init, { LiteParse } from "@llamaindex/liteparse-wasm";

let ready: Promise<unknown> | null = null;

/** Markdown-ish text of the first `maxPages` pages, capped in length. */
export async function extractFirstPagesText(
  data: ArrayBuffer,
  maxPages = 3,
  maxChars = 20000,
): Promise<string> {
  return parsePages(data, maxPages, maxChars);
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
 *  each page. The caps are a guard against a book-length PDF quietly
 *  turning one question into a very expensive one — 80 pages of parsed
 *  text is roughly 30K tokens, and the caller tells the user when a
 *  work was cut short. */
export async function extractFullText(
  data: ArrayBuffer,
  maxPages = 80,
  maxChars = 120000,
): Promise<{ text: string; truncated: boolean }> {
  const text = await parsePages(data, maxPages, maxChars + 1, true);
  return {
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}

/** The text around page `page` (1-based) of a `total`-page PDF, for an
 *  explainer asked with its context (lib/ai/explain.ts): the whole PDF
 *  when it is no longer than `span` pages, else the `span` pages
 *  centred on `page` — each after its page marker, and capped in length
 *  as the full text is. `from`–`to` are the pages it covers. */
export async function extractTextAround(
  data: ArrayBuffer,
  page: number,
  total: number,
  span = 80,
  maxChars = 120000,
): Promise<{ text: string; truncated: boolean; from: number; to: number }> {
  const from = total <= span ? 1 : Math.max(1, Math.min(page - Math.floor(span / 2), total - span + 1));
  const to = Math.min(total, from + span - 1);
  const text = await parsePages(data, span, maxChars + 1, true, total <= span ? undefined : [from, to]);
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars, from, to };
}

/** `range`: only these pages (1-based, inclusive), numbered so. */
async function parsePages(
  data: ArrayBuffer,
  maxPages: number,
  maxChars: number,
  marked = false,
  range?: [number, number],
): Promise<string> {
  ready ??= __wbg_init({ module_or_path: wasmUrl });
  await ready;
  const parser = new LiteParse({
    maxPages,
    ocrEnabled: false,
    imageMode: "off",
    extractImages: false,
    outputFormat: "markdown",
    quiet: true,
    ...(range ? { targetPages: `${range[0]}-${range[1]}` } : {}),
  });
  const result = await parser.parse(new Uint8Array(data));
  const text = result.pages
    .map((p, i) => {
      const body = p.markdown || p.text || "";
      return marked ? `${pageMarker((range?.[0] ?? 1) + i)}\n${body}` : body;
    })
    .join("\n\n")
    .trim();
  return text.slice(0, maxChars);
}
