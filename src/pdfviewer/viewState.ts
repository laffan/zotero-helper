// A PDF's viewer state, kept per PDF so it reopens as it was left —
// on switching to another PDF and back, and between sessions: the
// layout (scroll direction, fit, fixed sets, zoom), the folded view
// with its zoom and filter, and the place in the document, finer than
// the page. The record lives with the PDF's last page (lib/recent.ts);
// a PDF without one opens in the layout last chosen (viewPrefs.ts).
import type { ViewAnchor } from "./anchor";
import type { LayoutMode } from "./types";
import type { FitMode, ViewPrefs } from "./viewPrefs";

/** Where a folded view started: a fold (by its page and its top, in
 *  page units) and how far into it. */
export interface FoldAnchor {
  pageIndex: number;
  top: number;
  frac: number;
}

export interface SavedView extends ViewPrefs {
  folded?: boolean;
  foldedZoom?: number;
  /** The fold filter's type:colour pairs, when it was changed by hand. */
  foldFilter?: string[] | null;
  /** The place, unfolded: the first page in view and how far into it. */
  at?: ViewAnchor;
  /** The place, folded. */
  foldAt?: FoldAnchor;
}

/** The layout a viewer starts in: the PDF's own, else the last chosen,
 *  else vertical fit on a portrait viewer and horizontal otherwise. */
export function initialLayout(saved: SavedView | null, prefs: ViewPrefs | null, portrait: boolean) {
  const base = saved ?? prefs;
  const folded = Boolean(saved?.folded);
  return {
    // Folding shows the pages top to bottom at one page's width.
    layoutMode: (folded ? "vertical" : base?.layoutMode ?? (portrait ? "vertical" : "horizontal")) as LayoutMode,
    fitMode: (folded ? "fit" : base?.fitMode ?? "fit") as FitMode,
    fixedZoom: base?.fixedZoom ?? 1,
    paged: base?.paged ?? base?.single ?? false,
    folded,
    foldedZoom: saved?.foldedZoom ?? 1,
  };
}

/** Report the view a moment after it settles (scrolling changes it
 *  every frame); `flush` reports a change still waiting at once. */
export function createViewReporter(capture: () => SavedView | null, report: (v: SavedView) => void) {
  let timer = 0;
  const emit = () => {
    window.clearTimeout(timer);
    timer = 0;
    const v = capture();
    if (v) report(v);
  };
  return {
    changed: () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(emit, 400);
    },
    flush: () => {
      if (timer) emit();
    },
  };
}
