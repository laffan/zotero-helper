// What the viewer adds to Hush's for taking notes.
//
// - Page hover buttons, as in Hush: an "open in Zotero" pop-out at the
//   bottom right of a page and a bookmark at the top right. A bookmark
//   is named as it is made (bookmarks.ts) and kept by the app
//   (lib/bookmarks.ts) — Zotero has no such thing.
// - A text layer, so passages can be selected — Hush's viewer has none.
//   pdf.js lays transparent text over the raster where the words are.
//
// The bar over a selection (marks and "Add to notes") is selectionBar.ts.
import { BOOKMARK_ICON, POPOUT_ICON } from "./icons";
import { getPdfjs } from "./pdfjs";
import type { PageRecord, PDFPageProxy } from "./types";

export interface PageButtonHandlers {
  onOpenInZotero?: (page: number) => void;
  /** The bookmark button, pressed: its page (1-based) and itself, to
   *  place the naming box by. */
  onBookmarkPage?: (page: number, button: HTMLElement) => void;
}

export function attachPageHoverButtons(
  wrapper: HTMLElement,
  pageNum: number,
  handlers: PageButtonHandlers,
): void {
  const make = (cls: string, title: string, svg: string, fn: (n: number, b: HTMLElement) => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.title = title;
    b.innerHTML = svg;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn(pageNum, b);
    });
    wrapper.appendChild(b);
    return b;
  };
  const zBtn = handlers.onOpenInZotero
    ? make("pdf-page-zotero-btn", `Open page ${pageNum} in Zotero`, POPOUT_ICON, handlers.onOpenInZotero)
    : null;
  const nBtn = handlers.onBookmarkPage
    ? make("pdf-page-bookmark-btn", `Bookmark page ${pageNum}`, BOOKMARK_ICON, handlers.onBookmarkPage)
    : null;
  if (!zBtn && !nBtn) return;
  wrapper.addEventListener("mousemove", (e) => {
    const r = wrapper.getBoundingClientRect();
    const nearRight = r.right - e.clientX < 100;
    zBtn?.classList.toggle("visible", nearRight && r.bottom - e.clientY < 100);
    nBtn?.classList.toggle("visible", nearRight && e.clientY - r.top < 100);
  });
  wrapper.addEventListener("mouseleave", () => {
    zBtn?.classList.remove("visible");
    nBtn?.classList.remove("visible");
  });
}

/** One page record per page, each with its wrapper (a placeholder and
 *  the hover buttons) in `scrollArea`. Every page starts at page 1's
 *  size, `viewport`; the others adopt their real size on first render,
 *  so opening a book isn't a serial walk over every page. */
export function createPageRecords(
  scrollArea: HTMLElement,
  count: number,
  viewport: PageRecord["viewport"],
  buttons: PageButtonHandlers,
): PageRecord[] {
  const pages: PageRecord[] = [];
  for (let i = 0; i < count; i++) {
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page-wrapper";
    wrapper.dataset.pageIndex = String(i);
    const placeholder = document.createElement("div");
    placeholder.className = "pdf-page-placeholder";
    wrapper.appendChild(placeholder);
    attachPageHoverButtons(wrapper, i + 1, buttons);
    scrollArea.appendChild(wrapper);
    pages.push({
      wrapper,
      viewport,
      realViewport: i === 0,
      rendered: false,
      rendering: false,
      canvas: null,
      renderedZoom: null,
      contentEl: null,
      contentW: 0,
      contentH: 0,
    });
  }
  return pages;
}

/** Lay pdf.js's selectable text over a freshly rendered page. It joins
 *  the content box, so it stretches with the raster and is dropped with
 *  it on eviction. */
export async function attachTextLayer(p: PageRecord, page: PDFPageProxy): Promise<void> {
  const host = p.contentEl;
  if (!host || !p.renderedZoom) return;
  await renderTextLayer(host, page, p.renderedZoom, () => p.contentEl === host);
}

/** The text layer itself, over `host` (a page drawn at `scale` CSS px
 *  per PDF unit) — a page's content box, or a fold of the folded view.
 *  `current` says whether `host` still shows this page once pdf.js has
 *  loaded. */
export async function renderTextLayer(
  host: HTMLElement,
  page: PDFPageProxy,
  scale: number,
  current: () => boolean = () => host.isConnected,
): Promise<void> {
  const { TextLayer } = await getPdfjs();
  if (!current()) return; // evicted or re-rendered meanwhile
  host.querySelector(".textLayer")?.remove();
  const div = document.createElement("div");
  div.className = "textLayer";
  div.style.setProperty("--total-scale-factor", String(scale));
  div.style.setProperty("--scale-round-x", "1px");
  div.style.setProperty("--scale-round-y", "1px");
  host.appendChild(div);
  try {
    await new TextLayer({
      textContentSource: page.streamTextContent(),
      container: div,
      viewport: page.getViewport({ scale }),
    }).render();
  } catch {
    // A page with no usable text (a scan) simply isn't selectable.
    div.remove();
  }
}
