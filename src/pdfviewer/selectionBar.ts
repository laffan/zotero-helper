// The small bar over a text selection in the pages: Zotero's eight
// colours, which highlight (or underline) the passage in that colour,
// then three icons — Copy (the text), Add to notes (a quote with a link
// back to its page) and, with an AI service connected, Look up (a
// definition of at most 50 words, shown over the bar, lookupPopup.ts) —
// and the AI's sparkles, which open a short conversation explaining the
// passage.
//
// Highlight vs underline is a switch at the bar's left, remembered
// between selections — the swatches then make whichever it is set to,
// the way Zotero's reader keeps its active tool. Flipping it keeps the
// bar and the selection: it only changes what the colours make.
//
// A tap anywhere on the pages dismisses the selection, and the bar
// with it, the moment the finger (or button) lifts. Left to itself the
// browser doesn't manage that: everything on a page but its words is
// unselectable, and WebKit and Blink leave a selection alone when
// unselectable content is pressed — so a tap in a margin did nothing —
// and on iPad a tap on text cleared it only after the tap gestures had
// been told apart.
//
// Pressing the bar must not lose what it acts on. On the iPad — a finger,
// or a trackpad's pointer — the press can end the selection before the
// button hears its release (the system's text interaction takes the tap
// as one outside the selection), and the click it would end in may never
// come. So:
// - the passage the bar acts on is taken as the press begins (`held`),
//   and kept while the bar is pressed, however long, and a moment after;
// - its buttons act on the release of a press over them, from any
//   pointer (`onRelease`), the click only for the keyboard;
// - once a button has acted and the bar has gone, the click the tap
//   still ends in is swallowed (`swallowClicks`): it would land on
//   whatever lay under the bar — often the highlight just made above the
//   next passage — opening its editor, whose handles keep the page's text
//   from being selected, so the next try did nothing.
//
// On the iPad the system's own selection furniture is in the way: its
// handles stand a finger's width above the first line and below the
// last, taking the touches around them. So where fingers select, the
// bar keeps its distance from the passage (`TOUCH_GAP`). The system's
// menu is dismissed from lib/pencil.ts.
import { copyText } from "../lib/clipboard";
import { ANNOTATION_COLORS, colorLetter } from "../lib/highlights";
import { rangeText } from "./annotate";
import { COPY_ICON, HIGHLIGHT_ICON, LOOKUP_ICON, NOTE_ICON, SPARKLES_ICON, UNDERLINE_ICON } from "./icons";
import { createLookupPopup } from "./lookupPopup";
import { textRects } from "./textHit";

export type MarkType = "highlight" | "underline";

export interface SelectionBarHandlers {
  /** Quote the selected text into the notes. */
  onQuote?: (text: string, page: number) => void;
  /** Mark the selected passage; absent hides the swatches. */
  onAnnotate?: (range: Range, type: MarkType, color: string) => void;
  /** May this selection be marked? False hides the swatches. */
  canAnnotate?: (range: Range) => boolean;
  /** Ask the AI to explain the passage; shown while `canExplain`. */
  onExplain?: (text: string, page: number, range: Range) => void;
  canExplain?: () => boolean;
  /** Look the passage up (a definition); shown while `canExplain`. */
  onLookup?: (text: string, page: number, range: Range) => Promise<string>;
}

const MODE_KEY = "zh-pdf-mark-type";
/** How far the bar stands from the passage, CSS px: with a pointer, and
 *  where the system's selection handles are (clear of their knobs and
 *  the touches they take). */
const GAP = 8;
const TOUCH_GAP = 30;
const fingers = () =>
  document.documentElement.classList.contains("ipados") || window.matchMedia?.("(pointer: coarse)").matches;

/** How long after a press the bar keeps what it acts on, and swallows
 *  the click the press ends in, ms. */
const GRACE_MS = 450;

/** `act` on the release of a press on `btn` — any pointer — over it, or
 *  on a click no such press led to (the keyboard). Never twice for one
 *  press. */
function onRelease(btn: HTMLElement, act: () => void): void {
  let down = -1;
  let actedAt = -Infinity;
  btn.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    down = e.pointerId;
  });
  btn.addEventListener("pointercancel", () => (down = -1));
  btn.addEventListener("pointerup", (e) => {
    if (e.pointerId !== down) return;
    down = -1;
    const r = btn.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) return;
    actedAt = performance.now();
    act();
  });
  btn.addEventListener("click", () => {
    if (performance.now() - actedAt > 700) act();
  });
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

const storedMode = (): MarkType => (stored(MODE_KEY) === "underline" ? "underline" : "highlight");

/** The box around the selected lines, built from the range's per-line
 *  boxes: only boxes the size of a line of text, within the visible
 *  pages, count, so a stray box (a line break, a layer) can't stretch
 *  it and land the bar on top of the passage. */
function selectionBox(
  range: Range,
  area: HTMLElement,
): { left: number; top: number; right: number; bottom: number } | null {
  const view = area.getBoundingClientRect();
  const boxes = textRects(range).filter(
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
  // What a moment's message ("Copied") says, over the bar's buttons.
  const status = document.createElement("span");
  status.className = "pdf-selection-bar-status";

  type Passage = { text: string; page: number; range: Range };
  let mode = storedMode();
  // The selection the bar is for, and — from a press on the bar until
  // it has acted — that passage as the press found it.
  let current: Passage | null = null;
  let held: Passage | null = null;
  const target = () => current ?? held;
  let hideTimer = 0;
  let flashTimer = 0;
  // Until when a selection that has gone leaves the bar up: Infinity
  // while the bar is pressed (or kept after the mode switch), a moment
  // after a release.
  let keepUntil = 0;
  let kept = false;
  // When a tap last dismissed the selection (that tap is not a click).
  let dismissedAt = 0;
  // Clicks outside the bar until then are the end of a press the bar
  // has answered (see the module comment).
  let swallowUntil = 0;

  const button = (cls: string, title?: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    if (title) b.title = title;
    bar.appendChild(b);
    return b;
  };

  /** The bar has acted and goes, the selection with it. */
  function done(): void {
    swallowUntil = performance.now() + GRACE_MS;
    dismissedAt = performance.now();
    window.getSelection()?.removeAllRanges();
    hide();
  }

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
      onRelease(modeBtns[m], () => {
        mode = m;
        store(MODE_KEY, m);
        paintMode();
        keep();
      });
    }
    const sep = document.createElement("span");
    sep.className = "pdf-selection-bar-sep";
    bar.appendChild(sep);
    for (const color of ANNOTATION_COLORS) {
      const s = button("pdf-mark-swatch");
      s.style.setProperty("--swatch", color);
      s.dataset.letter = colorLetter(color);
      onRelease(s, () => {
        const t = target();
        if (t) handlers.onAnnotate?.(t.range, mode, color);
        done();
      });
    }
  }
  if (modeBtns) {
    const sep = document.createElement("span");
    sep.className = "pdf-selection-bar-sep";
    bar.appendChild(sep);
  }
  const copy = button("pdf-selection-icon", "Copy");
  copy.innerHTML = COPY_ICON;
  onRelease(copy, () => {
    const t = target();
    if (!t) return;
    // Said on the bar, which then goes: the text was copied, or not.
    flash("Copying…");
    void copyText(t.text).then((ok) => {
      flash(ok ? "Copied" : "Couldn't copy");
      clearTimeout(flashTimer);
      flashTimer = window.setTimeout(done, ok ? 650 : 1400);
    });
  });
  if (handlers.onQuote) {
    const quote = button("pdf-selection-icon", "Add to notes — a quote with a link back to the page");
    quote.innerHTML = NOTE_ICON;
    onRelease(quote, () => {
      const t = target();
      if (t) handlers.onQuote?.(t.text, t.page);
      done();
    });
  }
  const lookup = handlers.onLookup ? button("pdf-selection-icon", "Look up — a short definition") : null;
  const definition = createLookupPopup(root);
  if (lookup) {
    lookup.innerHTML = LOOKUP_ICON;
    onRelease(lookup, () => {
      const t = target();
      if (!t) return;
      const answer = handlers.onLookup!(t.text, t.page, t.range);
      definition.show(t.text, answer, bar.getBoundingClientRect());
      keep();
    });
  }
  const explain = handlers.onExplain ? button("pdf-selection-explain", "Ask the AI to explain this passage") : null;
  if (explain) {
    explain.innerHTML = SPARKLES_ICON;
    onRelease(explain, () => {
      const t = target();
      if (t) handlers.onExplain?.(t.text, t.page, t.range);
      done();
    });
  }
  bar.appendChild(status);

  function paintMode(): void {
    if (!modeBtns) return;
    modeBtns.highlight.classList.toggle("active", mode === "highlight");
    modeBtns.underline.classList.toggle("active", mode === "underline");
    bar.classList.toggle("underline", mode === "underline");
  }
  paintMode();

  /** Show `text` over the bar's buttons (until it hides). */
  function flash(text: string): void {
    status.textContent = text;
    bar.classList.add("flashing");
    keepUntil = Infinity;
  }

  /** The bar stays for what it holds — the mode switched, a look-up
   *  shown — even should the press have ended the selection, which is
   *  put back (now, and once the iPad's tap has settled). */
  function keep(): void {
    const t = target();
    if (!t) return;
    current = t;
    kept = true;
    keepUntil = Infinity;
    const restore = () => {
      const sel = window.getSelection();
      if (!sel || current !== t || !(sel.isCollapsed || !sel.rangeCount)) return;
      try {
        sel.removeAllRanges();
        sel.addRange(t.range);
      } catch {
        /* the passage is gone from the page: the bar still acts on it */
      }
    };
    restore();
    window.setTimeout(restore, 250);
  }

  function hide(): void {
    clearTimeout(hideTimer);
    clearTimeout(flashTimer);
    bar.style.display = "none";
    bar.classList.remove("flashing");
    current = null;
    held = null;
    kept = false;
    keepUntil = 0;
    definition.hide();
  }

  function check(): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      // A press on the bar can end the selection before its button
      // hears the release: the bar stays while it is pressed (or kept),
      // and a moment after, so the press counts. Otherwise the bar goes
      // with the selection.
      const wait = keepUntil - performance.now();
      if (wait <= 0) return hide();
      clearTimeout(hideTimer);
      if (wait !== Infinity) hideTimer = window.setTimeout(check, wait + 10);
      return;
    }
    const range = sel.getRangeAt(0);
    const anchor = range.commonAncestorContainer;
    const el = anchor instanceof Element ? anchor : anchor.parentElement;
    if (!el || !scrollArea.contains(el)) return kept ? undefined : hide();
    const text = rangeText(range);
    const wrapper = (range.startContainer.parentElement ?? el).closest<HTMLElement>(
      ".pdf-page-wrapper, .pdf-fold-wrapper",
    );
    if (!text || !wrapper) return hide();
    const quoteOnly = Boolean(handlers.canAnnotate && !handlers.canAnnotate(range));
    if (quoteOnly && !handlers.onQuote) return hide();
    bar.classList.toggle("quote-only", quoteOnly);
    const ai = handlers.canExplain?.() !== false;
    if (explain) explain.style.display = ai ? "" : "none";
    if (lookup) lookup.style.display = ai ? "" : "none";
    clearTimeout(hideTimer);
    const page = Number(wrapper.dataset.pageIndex ?? 0) + 1;
    // A selection other than the one kept lets go of keeping it.
    if (kept && current && rangeText(current.range) !== text) {
      kept = false;
      keepUntil = 0;
      definition.hide();
    }
    current = { text, page, range: range.cloneRange() };
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
    const gap = fingers() ? TOUCH_GAP : GAP;
    const above = r.top - host.top - bar.offsetHeight - gap;
    const below = r.bottom - host.top + gap;
    bar.style.left = `${left}px`;
    bar.style.top = `${above < 8 ? below : above}px`;
  }

  // Selection settles on pointer release; keyboard selection (shift +
  // arrows) arrives as selectionchange. A selection that has gone is
  // acted on at once; one still being made, once it pauses.
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    const sel = window.getSelection();
    if (current && (!sel || sel.isCollapsed)) check();
    else timer = window.setTimeout(check, 120);
  };
  document.addEventListener("selectionchange", schedule);
  scrollArea.addEventListener("scroll", hide, { passive: true });
  // A press on the bar: keep the selection where the browser lets us,
  // and what it holds whatever happens to the selection meanwhile.
  bar.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    held = current;
    keepUntil = Infinity;
  });
  const barReleased = () => {
    if (!kept && !bar.classList.contains("flashing")) keepUntil = performance.now() + GRACE_MS;
    if (bar.style.display !== "none") window.setTimeout(check, GRACE_MS + 10);
  };
  bar.addEventListener("pointerup", barReleased);
  bar.addEventListener("pointercancel", barReleased);
  const swallowClicks = (e: MouseEvent) => {
    if (performance.now() > swallowUntil || bar.contains(e.target as Node)) return;
    swallowUntil = 0;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener("click", swallowClicks, true);

  // A tap on the pages while something is selected (or the bar is up):
  // clear it. Left alone are drags (scrolling, or selecting afresh), long
  // presses (a new selection on iPad), shift-clicks (extending this one)
  // and the later clicks of a double or triple click (selecting a word
  // or a line). Where the browser has already dropped the selection
  // itself (a click on text, on the Mac), only the bar is left to go —
  // the caret it put there is what a double click grows into a word.
  let press: { x: number; y: number; at: number; id: number; armed: boolean } | null = null;
  let lastTap = { x: 0, y: 0, at: 0 };
  const onDown = (e: PointerEvent) => {
    press = null;
    if (!e.isPrimary || e.button !== 0) return;
    const now = performance.now();
    const repeat = now - lastTap.at < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 10;
    const sel = window.getSelection();
    const selected = Boolean(sel && !sel.isCollapsed && sel.anchorNode && scrollArea.contains(sel.anchorNode));
    press = { x: e.clientX, y: e.clientY, at: now, id: e.pointerId, armed: (selected || kept) && !repeat && !e.shiftKey };
  };
  const onUp = (e: PointerEvent) => {
    const d = press;
    press = null;
    if (!d || d.id !== e.pointerId) return;
    const now = performance.now();
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || now - d.at > 400) return;
    lastTap = { x: e.clientX, y: e.clientY, at: now };
    if (!d.armed) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    dismissedAt = now;
    hide();
  };
  const onCancel = () => (press = null);
  scrollArea.addEventListener("pointerdown", onDown);
  scrollArea.addEventListener("pointerup", onUp);
  scrollArea.addEventListener("pointercancel", onCancel);

  return {
    /** Did a tap just dismiss the selection (or the bar act)? Its click
     *  is then not a click on whatever lay under it (a highlight, say). */
    justDismissed: () => performance.now() - dismissedAt < 600,

    destroy(): void {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      clearTimeout(flashTimer);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("click", swallowClicks, true);
      bar.remove();
      definition.destroy();
    },
  };
}
