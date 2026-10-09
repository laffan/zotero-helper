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
  // Touch: iOS draws its own copy/look-up menu above a selection, so the
  // bar goes below it there.
  const touch = window.matchMedia("(hover: none)").matches;

  const button = (cls: string, title: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.title = title;
    bar.appendChild(b);
    return b;
  };

  const modeBtns: Record<MarkType, HTMLButtonElement> | null = handlers.onAnnotate
    ? {
        highlight: button("pdf-mark-mode", "Highlight"),
        underline: button("pdf-mark-mode", "Underline"),
      }
    : null;
  const swatches: HTMLButtonElement[] = [];
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
    for (const c of ANNOTATION_COLORS) {
      const s = button("pdf-mark-swatch", "");
      s.style.setProperty("--swatch", c.hex);
      s.addEventListener("click", () => {
        if (current) handlers.onAnnotate?.(current.range, mode, c.hex);
        window.getSelection()?.removeAllRanges();
        hide();
      });
      swatches.push(s);
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
    swatches.forEach((s, i) => {
      s.title = `${mode === "underline" ? "Underline" : "Highlight"} in ${ANNOTATION_COLORS[i].name.toLowerCase()}`;
    });
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
    const r = range.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    bar.style.display = "";
    const left = Math.min(
      Math.max(8, r.left - host.left + r.width / 2 - bar.offsetWidth / 2),
      host.width - bar.offsetWidth - 8,
    );
    const above = r.top - host.top - bar.offsetHeight - 8;
    const below = r.bottom - host.top + 8;
    bar.style.left = `${left}px`;
    bar.style.top = `${touch || above < 8 ? below : above}px`;
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
