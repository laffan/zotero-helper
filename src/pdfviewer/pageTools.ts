// What the viewer adds to Hush's for taking notes.
//
// - Page hover buttons. Hush puts two in a page's right-hand corners: an
//   "open in Zotero" pop-out at the bottom and a bookmark at the top.
//   The pop-out is kept; the bookmark slot becomes "cite this page in
//   the notes", which is what a bookmark is for when the notes are the
//   thing being written.
// - A text layer, so passages can be selected — Hush's viewer has none.
//   pdf.js lays transparent text over the raster where the words are.
// - A small "Add to notes" bubble over any selection in the pages, which
//   quotes the passage into the notes with a link back to its page.
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

/** The "Add to notes" bubble over a selection inside `scrollArea`. */
export function createSelectionNoter(
  scrollArea: HTMLElement,
  root: HTMLElement,
  onQuote: (text: string, page: number) => void,
) {
  const bubble = document.createElement("button");
  bubble.type = "button";
  bubble.className = "pdf-selection-note";
  bubble.textContent = "Add to notes";
  bubble.style.display = "none";
  root.appendChild(bubble);

  let current: { text: string; page: number } | null = null;
  let hideTimer = 0;
  // Touch: iOS draws its own copy/look-up menu above a selection, so the
  // bubble goes below it there.
  const touch = window.matchMedia("(hover: none)").matches;

  const hide = () => {
    clearTimeout(hideTimer);
    bubble.style.display = "none";
    current = null;
  };

  function check(): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      // A tap on the bubble can collapse the selection before its click
      // arrives; keep what was selected for a moment so the tap counts.
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, 300);
      return;
    }
    const range = sel.getRangeAt(0);
    const anchor = range.commonAncestorContainer;
    const el = anchor instanceof Element ? anchor : anchor.parentElement;
    if (!el || !scrollArea.contains(el)) return hide();
    const text = sel.toString().replace(/\s+/g, " ").trim();
    const wrapper = (range.startContainer.parentElement ?? el).closest<HTMLElement>(".pdf-page-wrapper");
    if (!text || !wrapper) return hide();
    clearTimeout(hideTimer);
    current = { text, page: Number(wrapper.dataset.pageIndex ?? 0) + 1 };
    const r = range.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    bubble.style.display = "";
    const left = Math.min(Math.max(8, r.left - host.left + r.width / 2 - bubble.offsetWidth / 2), host.width - bubble.offsetWidth - 8);
    const above = r.top - host.top - bubble.offsetHeight - 8;
    const below = r.bottom - host.top + 8;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${touch || above < 8 ? below : above}px`;
  }

  // Selection settles on pointer release; keyboard selection (shift +
  // arrows) arrives as selectionchange.
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(check, 120);
  };
  document.addEventListener("selectionchange", schedule);
  scrollArea.addEventListener("scroll", hide, { passive: true });
  bubble.addEventListener("pointerdown", (e) => e.preventDefault());
  bubble.addEventListener("click", () => {
    if (current) onQuote(current.text, current.page);
    window.getSelection()?.removeAllRanges();
    hide();
  });

  return {
    destroy(): void {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      document.removeEventListener("selectionchange", schedule);
      bubble.remove();
    },
  };
}
