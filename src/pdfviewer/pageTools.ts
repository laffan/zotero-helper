// What the viewer adds to Hush's for taking notes.
//
// - Page hover buttons. Hush puts two in a page's right-hand corners: an
//   "open in Zotero" pop-out at the bottom and a bookmark at the top.
//   The pop-out is kept; the bookmark slot becomes "cite this page in
//   the notes", which is what a bookmark is for when the notes are the
//   thing being written.
// - A text layer, so passages can be selected — Hush's viewer has none.
//   pdf.js lays transparent text over the raster where the words are.
//
// The bar over a selection (marks and "Add to notes") is selectionBar.ts.
import { POPOUT_ICON, PAGE_NOTE_ICON } from "./icons";
import { getPdfjs } from "./pdfjs";
import type { PageRecord, PDFPageProxy } from "./types";

export interface PageButtonHandlers {
  onOpenInZotero?: (page: number) => void;
  onCitePage?: (page: number) => void;
}

export function attachPageHoverButtons(
  wrapper: HTMLElement,
  pageNum: number,
  handlers: PageButtonHandlers,
): void {
  const make = (cls: string, title: string, svg: string, fn: (n: number) => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.title = title;
    b.innerHTML = svg;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn(pageNum);
    });
    wrapper.appendChild(b);
    return b;
  };
  const zBtn = handlers.onOpenInZotero
    ? make("pdf-page-zotero-btn", `Open page ${pageNum} in Zotero`, POPOUT_ICON, handlers.onOpenInZotero)
    : null;
  const nBtn = handlers.onCitePage
    ? make("pdf-page-note-btn", `Cite page ${pageNum} in the notes`, PAGE_NOTE_ICON, handlers.onCitePage)
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

/** Lay pdf.js's selectable text over a freshly rendered page. It joins
 *  the content box, so it stretches with the raster and is dropped with
 *  it on eviction. */
export async function attachTextLayer(p: PageRecord, page: PDFPageProxy): Promise<void> {
  const host = p.contentEl;
  if (!host || !p.renderedZoom) return;
  const { TextLayer } = await getPdfjs();
  if (p.contentEl !== host) return; // evicted or re-rendered meanwhile
  host.querySelector(".textLayer")?.remove();
  const div = document.createElement("div");
  div.className = "textLayer";
  div.style.setProperty("--total-scale-factor", String(p.renderedZoom));
  div.style.setProperty("--scale-round-x", "1px");
  div.style.setProperty("--scale-round-y", "1px");
  host.appendChild(div);
  try {
    await new TextLayer({
      textContentSource: page.streamTextContent(),
      container: div,
      viewport: page.getViewport({ scale: p.renderedZoom }),
    }).render();
  } catch {
    // A page with no usable text (a scan) simply isn't selectable.
    div.remove();
  }
}
