// The reader's place, kept: where the reader is in the document, as
// the reader left it, whatever the pages' scroll offset says.
//
// The offset can't be trusted on the iPad. Going to the background,
// iPadOS lays the app out at its multitasking sizes for snapshots (and
// the status bar plugin toggles the band at the top as the window's
// geometry changes), the native scroll view behind the scroll area can
// move or clamp its offset, and coming back the page may be shown
// before it has its size again. Measured from the pages at any of
// those moments, the place came back as page 1, the last page, or
// somewhere between — never where it was left.
//
// So the place is a record of its own, and only the reader moves it: a
// scroll counts while the view is undisturbed. A resize, the app being
// hidden, and the moments after it comes back disturb it; a touch, a
// pointer or a wheel on the pages ends a disturbance (the reader has
// taken over). During one, a relayout puts back the kept place, and
// the view's reports use it. Once it is over, the view is put back on
// the place if anything moved it, and the activity log says so.
//
// Resizes themselves (watchResize below): fitted pages are laid out
// again after a short debounce, never while the app is hidden — the
// relayout waits for it to come back — and the paged view's set is put
// back, centred, since the browser may settle on the neighbouring set
// and WebKit may not snap again at all.
import { restoreAnchor, viewAnchor, type ViewAnchor } from "./anchor";
import type { PageRecord } from "./types";
import type { FoldAnchor, SavedView } from "./viewState";

/** The place: in the pages (unfolded), or in the folds. */
export type Place = { at: ViewAnchor } | { fold: FoldAnchor };

/** After a resize, scrolls don't count for this long. */
const RESIZE_SETTLE_MS = 300;
/** After the app comes back, the same — iPadOS may still be resizing. */
const RETURN_SETTLE_MS = 700;

export interface PlaceEnv {
  area: HTMLElement;
  getPages: () => PageRecord[];
  isFolded: () => boolean;
  /** The folded view's own anchors (folds.ts). */
  folds: { viewAnchor: () => FoldAnchor | null; restoreAnchor: (a: FoldAnchor) => boolean };
  log?: (msg: string) => void;
  /** The view's size changed: cached page geometry is stale. */
  geometryChanged: () => void;
  /** The pages are fitted to the view, so a resize lays them out again. */
  fitsView: () => boolean;
  /** Lay the pages out again; false when the view had no room for them
   *  and they were left as they were. */
  relayout: () => boolean;
  /** The paged view's set on screen (its first page, 1-based). */
  shownSet: () => number;
  isPaged: () => boolean;
  horizontal: () => boolean;
  goToPage: (n: number) => void;
}

const hidden = () => document.visibilityState === "hidden";

/** A place in words, for the log. */
function describe(p: Place | null): string {
  if (!p) return "nowhere";
  if ("at" in p) return `p. ${p.at.idx + 1} (${Math.round(p.at.frac * 100)}% in)`;
  return `p. ${p.fold.pageIndex + 1}'s fold ${(p.fold.nth ?? 0) + 1}`;
}

function samePlace(a: Place | null, b: Place | null): boolean {
  if (!a || !b) return a === b;
  if ("at" in a && "at" in b) return a.at.idx === b.at.idx && Math.abs(a.at.frac - b.at.frac) < 0.01;
  if ("fold" in a && "fold" in b) {
    const x = a.fold;
    const y = b.fold;
    return x.pageIndex === y.pageIndex && x.nth === y.nth && Math.abs(x.frac - y.frac) < 0.01;
  }
  return false;
}

export function createPlaceKeeper(env: PlaceEnv) {
  const { area } = env;
  const hasPages = () => env.getPages().length > 0;
  /** The place as the pages show it now. */
  function measure(): Place | null {
    const fold = env.isFolded() ? env.folds.viewAnchor() : null;
    const at = env.isFolded() ? null : viewAnchor(area, env.getPages(), env.horizontal());
    return fold ? { fold } : at ? { at } : null;
  }
  /** Put the view at `p` in the current layout — the paged view on the
   *  set holding it. */
  function restore(p: Place): void {
    if ("fold" in p) return void (env.isFolded() && env.folds.restoreAnchor(p.fold));
    if (env.isFolded()) return;
    if (env.isPaged()) env.goToPage(p.at.idx + 1 + (p.at.frac > 0.5 ? 1 : 0));
    else restoreAnchor(area, env.getPages(), env.horizontal(), p.at);
  }
  let place: Place | null = null;
  /** Until when scrolls aren't the reader's. */
  let calmAt = 0;
  let settleTimer = 0;
  let measureRaf = 0;
  /** A resize's relayout waiting for the app to come back. */
  let waiting = false;

  const disturbed = () => hidden() || waiting || performance.now() < calmAt;

  /** The pages show what the reader did: take the place from them —
   *  in the next frame, once a mode change has laid them out. */
  function note(): void {
    if (measureRaf) return;
    measureRaf = requestAnimationFrame(() => {
      measureRaf = 0;
      if (!disturbed() && hasPages()) place = measure() ?? place;
    });
  }

  function disturb(ms: number): void {
    calmAt = Math.max(calmAt, performance.now() + ms);
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settle, Math.max(0, calmAt - performance.now()) + 20);
  }

  /** The disturbance is over: put the view back on the place. */
  function settle(): void {
    settleTimer = 0;
    if (hidden()) return; // coming back disturbs again
    if (disturbed()) return disturb(0);
    if (!place || !hasPages()) return;
    const shown = measure();
    if (samePlace(shown, place)) return;
    restore(place);
    env.log?.(`put back at ${describe(place)}; the pages had moved to ${describe(shown)}`);
  }

  // The reader's own hand ends a disturbance: what it does next counts.
  const takeOver = () => {
    if (hidden()) return;
    calmAt = 0;
    window.clearTimeout(settleTimer);
    settleTimer = 0;
  };
  const inputs = ["pointerdown", "touchstart", "wheel"] as const;
  for (const t of inputs) area.addEventListener(t, takeOver, { passive: true, capture: true });

  // --- resizes ---------------------------------------------------------------
  let timer: number | null = null;
  let lead: number | null = null;
  const run = () => {
    const set = lead;
    lead = null;
    if (!env.relayout()) {
      lead = set;
      return;
    }
    if (env.horizontal() && area.scrollTop) area.scrollTop = 0;
    if (env.isPaged() && set) env.goToPage(set);
  };
  const observer = new ResizeObserver(() => {
    if (!hasPages()) return;
    if (hidden()) env.log?.(`resized while hidden: ${area.clientWidth}×${area.clientHeight}`);
    disturb(RESIZE_SETTLE_MS);
    lead ??= env.shownSet();
    // A container resize can re-wrap rows, so cached geometry is stale
    // either way; fit-mode geometry follows behind a short debounce.
    env.geometryChanged();
    if (!env.fitsView()) {
      lead = null;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      if (hidden()) waiting = true;
      else run();
    }, 80);
  });
  observer.observe(area);

  // --- the background ----------------------------------------------------------
  const onVisibility = () => {
    if (hidden()) {
      env.log?.(`app hidden at ${describe(place)}`);
      return;
    }
    const size = `${area.clientWidth}×${area.clientHeight}`;
    env.log?.(`app back at ${size}; the pages show ${describe(hasPages() ? measure() : null)}`);
    disturb(RETURN_SETTLE_MS);
    if (waiting) {
      waiting = false;
      if (hasPages() && env.fitsView()) run();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    /** A scroll, or a mode change: the place follows, unless disturbed. */
    note,
    /** Whether the pages' offset is in doubt just now. */
    disturbed,
    /** The place for the saved view (viewState.ts): the kept one while
     *  disturbed, else the pages'. */
    saved: (): Pick<SavedView, "at" | "foldAt"> => {
      const kept = disturbed() && place && ("fold" in place) === env.isFolded() ? place : null;
      const p = kept ?? measure();
      return p && "at" in p ? { at: p.at } : p ? { foldAt: p.fold } : {};
    },
    /** The kept place in the pages (unfolded) while the pages' offset is
     *  in doubt — what a relayout then keeps, rather than the offset. */
    heldAt: (): ViewAnchor | null => (disturbed() && place && "at" in place ? place.at : null),
    destroy: () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      for (const t of inputs) area.removeEventListener(t, takeOver, { capture: true });
      if (timer) clearTimeout(timer);
      window.clearTimeout(settleTimer);
      cancelAnimationFrame(measureRaf);
    },
  };
}
