// The small bar over a text selection in the pages: Zotero's eight
// colours, which highlight (or underline) the passage in that colour,
// and "Add to notes", which quotes it into the notes with a link back
// to its page.
//
// Highlight vs underline is a switch at the bar's left, remembered
// between selections — the swatches then make whichever it is set to,
// the way Zotero's reader keeps its active tool.
import { ANNOTATION_COLORS } from "../lib/highlights";
import { rangeText } from "./annotate";
import { HIGHLIGHT_ICON, UNDERLINE_ICON } from "./icons";

export type MarkType = "highlight" | "underline";

export interface SelectionBarHandlers {
  /** Quote the selected text into the notes. */
  onQuote?: (text: string, page: number) => void;
  /** Mark the selected passage; absent hides the swatches. */
  onAnnotate?: (range: Range, type: MarkType, color: string) => void;
}

const MODE_KEY = "zh-pdf-mark-type";

function storedMode(): MarkType {
  try {
    return localStorage.getItem(MODE_KEY) === "underline" ? "underline" : "highlight";
  } catch {
    return "highlight";
  }
}

/** The box around the selected lines, built from the range's per-line
 *  boxes: only boxes the size of a line of text, within the visible
 *  pages, count, so a stray box (a line break, a layer) can't stretch
 *  it and land the bar on top of the passage. */
function selectionBox(
  range: Range,
  area: HTMLElement,
): { left: number; top: number; right: number; bottom: number } | null {
  const view = area.getBoundingClientRect();
  const boxes = Array.from(range.getClientRects()).filter(
    (b) => b.width >= 1 && b.height >= 1 && b.bottom > view.top && b.top < view.bottom,
  );
  if (!boxes.length) return null;
  const heights = boxes.map((b) => b.height).sort((a, b) => a - b);
  const line = heights[Math.floor(heights.length / 2)];
  const text = boxes.filter((b) => b.height <= line * 3);
  return {
    left: Math.min(...text.map((b) => b.left)),
    top: Math.max(view.top, Math.min(...text.map((b) => b.top))),
    right: Math.max(...text.map((b) => b.right)),
    bottom: Math.min(view.bottom, Math.max(...text.map((b) => b.bottom))),
  };
}

export function createSelectionBar(
  scrollArea: HTMLElement,
  root: HTMLElement,
  handlers: SelectionBarHandlers,
) {
  const bar = document.createElement("div");
  bar.className = "pdf-selection-bar";
  bar.style.display = "none";
  root.appendChild(bar);

  let mode = storedMode();
  let current: { text: string; page: number; range: Range } | null = null;
  let hideTimer = 0;

  const button = (cls: string, title?: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    if (title) b.title = title;
    bar.appendChild(b);
    return b;
  };

  const modeBtns: Record<MarkType, HTMLButtonElement> | null = handlers.onAnnotate
    ? {
        highlight: button("pdf-mark-mode", "Highlight"),
        underline: button("pdf-mark-mode", "Underline"),
      }
    : null;
  if (modeBtns) {
    modeBtns.highlight.innerHTML = HIGHLIGHT_ICON;
    modeBtns.underline.innerHTML = UNDERLINE_ICON;
    for (const m of ["highlight", "underline"] as const) {
      modeBtns[m].addEventListener("click", () => {
        mode = m;
        try {
          localStorage.setItem(MODE_KEY, m);
        } catch {
          /* storage unavailable */
        }
        paintMode();
      });
    }
    const sep = document.createElement("span");
    sep.className = "pdf-selection-bar-sep";
    bar.appendChild(sep);
    for (const color of ANNOTATION_COLORS) {
      const s = button("pdf-mark-swatch");
      s.style.setProperty("--swatch", color);
      s.addEventListener("click", () => {
        if (current) handlers.onAnnotate?.(current.range, mode, color);
        window.getSelection()?.removeAllRanges();
        hide();
      });
    }
  }
  if (modeBtns && handlers.onQuote) {
    const sep = document.createElement("span");
    sep.className = "pdf-selection-bar-sep";
    bar.appendChild(sep);
  }
  if (handlers.onQuote) {
    const quote = button("pdf-selection-quote", "Quote this in the notes, with a link back to the page");
    quote.textContent = "Add to notes";
    quote.addEventListener("click", () => {
      if (current) handlers.onQuote?.(current.text, current.page);
      window.getSelection()?.removeAllRanges();
      hide();
    });
  }

  function paintMode(): void {
    if (!modeBtns) return;
    modeBtns.highlight.classList.toggle("active", mode === "highlight");
    modeBtns.underline.classList.toggle("active", mode === "underline");
    bar.classList.toggle("underline", mode === "underline");
  }
  paintMode();

  function hide(): void {
    clearTimeout(hideTimer);
    bar.style.display = "none";
    current = null;
  }

  function check(): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      // A tap on the bar can collapse the selection before its click
      // arrives; keep what was selected for a moment so the tap counts.
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, 300);
      return;
    }
    const range = sel.getRangeAt(0);
    const anchor = range.commonAncestorContainer;
    const el = anchor instanceof Element ? anchor : anchor.parentElement;
    if (!el || !scrollArea.contains(el)) return hide();
    const text = rangeText(range);
    const wrapper = (range.startContainer.parentElement ?? el).closest<HTMLElement>(".pdf-page-wrapper");
    if (!text || !wrapper) return hide();
    clearTimeout(hideTimer);
    current = { text, page: Number(wrapper.dataset.pageIndex ?? 0) + 1, range: range.cloneRange() };
    const r = selectionBox(range, scrollArea);
    if (!r) return hide();
    const host = root.getBoundingClientRect();
    bar.style.display = "";
    const left = Math.min(
      Math.max(8, (r.left + r.right) / 2 - host.left - bar.offsetWidth / 2),
      host.width - bar.offsetWidth - 8,
    );
    // Above the passage on every platform, clear of what is being
    // marked; below it only when its first line is at the very top of
    // the view.
    const above = r.top - host.top - bar.offsetHeight - 8;
    const below = r.bottom - host.top + 8;
    bar.style.left = `${left}px`;
    bar.style.top = `${above < 8 ? below : above}px`;
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
  // Keep the selection alive while the bar is pressed.
  bar.addEventListener("pointerdown", (e) => e.preventDefault());

  return {
    destroy(): void {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      document.removeEventListener("selectionchange", schedule);
      bar.remove();
    },
  };
}
