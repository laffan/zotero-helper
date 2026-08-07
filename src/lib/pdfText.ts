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
  ready ??= __wbg_init({ module_or_path: wasmUrl });
  await ready;
  const parser = new LiteParse({
    maxPages,
    ocrEnabled: false,
    imageMode: "off",
    extractImages: false,
    outputFormat: "markdown",
    quiet: true,
  });
  const result = await parser.parse(new Uint8Array(data));
  const text = result.pages
    .map((p) => p.markdown || p.text || "")
    .join("\n\n")
    .trim();
  return text.slice(0, maxChars);
}
