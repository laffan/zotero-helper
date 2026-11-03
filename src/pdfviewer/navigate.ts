// Going somewhere in the document: a page (in the paged view, the set
// holding it; folded, its folds), a place on a page (an outline
// entry's), a point on a page (a search hit, a cited passage).
//
// A smooth move is a navigation — the reader's, even when it lands
// seconds after the click or the keystroke that asked for it (a search
// through a long book, a cited passage found, a page reached once the
// PDF has loaded) — so it tells place.ts that the scrolls to come are
// the reader's. An instant move is the layout's own (a mode switch, the
// place put back) and says nothing.
import { scrollToPageFraction, scrollToPagePoint } from "./anchor";
import type { PageRecord } from "./types";

export interface NavigatorEnv {
  area: HTMLElement;
  getPages: () => PageRecord[];
  isFolded: () => boolean;
  /** The folded view's own way to a page (folds.ts). */
  foldsGoToPage: (n: number) => void;
  isPaged: () => boolean;
  /** Pages to a set in the paged view. */
  perSet: () => number;
  horizontal: () => boolean;
  /** Before a point is shown: out of the folded view, unmagnified. */
  unfold: () => void;
  /** The reader is going somewhere: the scrolls that follow are theirs. */
  intend: () => void;
}

export function createNavigator(env: NavigatorEnv) {
  const { area } = env;

  /** Page `n` (1-based) at the start of the view. */
  function goToPage(n: number, smooth = true): void {
    if (smooth) env.intend();
    if (env.isFolded()) return env.foldsGoToPage(n);
    const pages = env.getPages();
    let idx = Math.max(0, Math.min(n - 1, pages.length - 1));
    // Fixed: the set holding the page, by its first page (its snap
    // point; scroll-padding centres the set).
    if (env.isPaged()) idx -= idx % env.perSet();
    const w = pages[idx]?.wrapper;
    if (!w) return;
    const behavior = smooth ? "smooth" : "auto";
    if (env.horizontal()) w.scrollIntoView({ behavior, inline: "start", block: "nearest" });
    else w.scrollIntoView({ behavior, block: "start" });
  }

  /** A place on a page: `top` in PDF user space (y up), null for the
   *  page's top. Side by side, pages are whole, so only the page counts. */
  function goToPosition(pageIndex: number, top: number | null): void {
    const p = env.getPages()[pageIndex];
    if (!p) return;
    env.intend();
    if (top == null || env.isFolded() || env.horizontal() || env.isPaged()) goToPage(pageIndex + 1);
    else scrollToPagePoint(area, p, top);
  }

  /** A search hit or a cited passage: page index, then a point on it (0–1). */
  function revealPoint(idx: number, x: number, y: number): void {
    env.intend();
    env.unfold();
    if (env.isPaged()) return goToPage(idx + 1);
    const w = env.getPages()[idx]?.wrapper;
    if (w) scrollToPageFraction(area, w, x, y);
  }

  return { goToPage, goToPosition, revealPoint };
}
