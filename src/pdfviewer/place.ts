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
// So the place is a record of its own, and only the reader moves it. A
// scroll counts when the reader meant it: an input anywhere (a touch, a
// pointer, a wheel, a key) or a navigation (navigate.ts) makes the
// scrolls of the next moments the reader's, and each scroll that
// follows carries that on (momentum, a smooth scroll). And it counts
// only while the view is undisturbed: a resize, the window losing focus
// (the app switcher, Stage Manager, another app in front), the app
// being hidden, and the moments after it comes back disturb it — an
// input ends a disturbance (the reader has taken over). And while a
// finger, the Pencil or a mouse button is down, every scroll is the
// reader's, however long the press lasts and whatever else happens: a
// drag that rests a while and then goes on used to outlast the intent
// its first touch gave it, and the view went back to where the finger
// had rested as it was let go. A scroll area of another size than when the
// place was last taken is a resize too, even before the resize is
// reported: a frame delivers its scroll events first. During a
// disturbance, a relayout keeps the kept place, and the view's reports
// use it. Once it is over — and whenever a scroll nobody asked for
// leaves the pages somewhere else — the view is put back on the place,
// and the activity log says so.
//
// After a trip away, the place is also written to the scroll area
// again even when the page's own offset says it is there: a large PDF
// may come back with its layers thrown away and redrawn (the pages
// blink), and the native scroll view behind the area rebuilt, showing
// another part of the pages than the offset says, without a scroll the
// page hears of. An offset moved by a pixel and back over two frames
// makes WebKit hand the native side the position again.
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
/** An input makes the scrolls of this long the reader's… */
const INTENT_MS = 1500;
/** …and each of them carries that on this much further. */
const CHAIN_MS = 400;
/** A scroll nobody asked for is put right once scrolls stop this long. */
const STRAY_MS = 150;

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
  /** The scroll area's size when the place was last taken. */
  let size = "";
  const sizeNow = () => `${area.clientWidth}×${area.clientHeight}`;
  /** Until when scrolls aren't the reader's, whatever the intent. */
  let calmAt = 0;
  /** Until when scrolls are the reader's. */
  let intentUntil = 0;
  /** The window has lost focus (and not had it back). */
  let blurred = false;
  let settleTimer = 0;
  let strayTimer = 0;
  let measureRaf = 0;
  /** Whether a scroll since the last frame was the reader's. */
  let meant = false;
  /** A resize's relayout waiting for the app to come back. */
  let waiting = false;
  /** The disturbance under way is a return from away. */
  let returning = false;

  /** Mouse and Pencil presses under way, by pointer id. */
  const pressed = new Set<number>();
  /** Fingers (and the Pencil) on the screen. */
  let touches = 0;
  /** The reader is holding the pages: what they do is the place. */
  const holding = () => !hidden() && (touches > 0 || pressed.size > 0);

  const disturbed = () => !holding() && (hidden() || blurred || waiting || performance.now() < calmAt);
  const intend = (ms = INTENT_MS) => {
    intentUntil = Math.max(intentUntil, performance.now() + ms);
  };

  /** Take the place from the pages in the next frame, once a scroll or
   *  a mode change has laid them out — if the reader moved them. */
  function measureSoon(): void {
    if (measureRaf) return;
    measureRaf = requestAnimationFrame(() => {
      measureRaf = 0;
      const was = meant;
      meant = false;
      if (disturbed() || !hasPages()) return;
      if (place && sizeNow() !== size && !holding()) return disturb(RESIZE_SETTLE_MS);
      if (was) {
        place = measure() ?? place;
        size = sizeNow();
      } else strayCheck();
    });
  }

  /** The viewer laid the pages out anew (a mode, a document opened):
   *  what they show now is the place. */
  function note(): void {
    intend();
    meant = true;
    measureSoon();
  }

  /** A scroll: the reader's if they meant it, else a stray to put right. */
  function scrolled(): void {
    if (holding() || performance.now() < intentUntil) {
      intend(CHAIN_MS);
      meant = true;
    }
    measureSoon();
  }

  /** A scroll nobody asked for: once scrolls stop, put the place back
   *  if it moved the pages off it. */
  function strayCheck(): void {
    window.clearTimeout(strayTimer);
    strayTimer = window.setTimeout(() => {
      strayTimer = 0;
      if (disturbed() || holding() || performance.now() < intentUntil || !place || !hasPages()) return;
      putBack("a scroll nobody asked for");
    }, STRAY_MS);
  }

  function putBack(why: string): void {
    // The view is settled at this size: scrolls at it count again.
    size = sizeNow();
    if (!place) return;
    const shown = measure();
    if (samePlace(shown, place)) return;
    restore(place);
    env.log?.(`put back at ${describe(place)} after ${why}; the pages had moved to ${describe(shown)}`);
  }

  function disturb(ms: number): void {
    calmAt = Math.max(calmAt, performance.now() + ms);
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settle, Math.max(0, calmAt - performance.now()) + 20);
  }

  /** The disturbance is over: put the view back on the place. */
  function settle(): void {
    settleTimer = 0;
    if (hidden() || blurred) return; // coming back disturbs again
    if (disturbed()) return disturb(0);
    if (!place || !hasPages()) return;
    putBack("a disturbance");
    if (returning) resync();
    returning = false;
  }

  /** Write the offset again — a pixel off, then back in the next frame
   *  — so the native scroll view shows what the page says it does. */
  function resync(): void {
    const horiz = env.horizontal();
    const at = horiz ? area.scrollLeft : area.scrollTop;
    const set = (v: number) => (horiz ? (area.scrollLeft = v) : (area.scrollTop = v));
    set(at > 0 ? at - 1 : at + 1);
    requestAnimationFrame(() => set(at));
    env.log?.(`back at ${describe(place)}`);
  }

  // Any input anywhere — on the pages, the outline, the search field,
  // a shortcut — is the reader at work: the scrolls that follow are
  // meant, and a disturbance is over (the window is in use, whatever
  // its focus events said).
  const onInput = () => {
    if (hidden()) return;
    intend();
    calmAt = 0;
    blurred = false;
    returning = false;
    window.clearTimeout(settleTimer);
    settleTimer = 0;
  };
  const inputs = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
  for (const t of inputs) window.addEventListener(t, onInput, { passive: true, capture: true });
  // What is held down. Fingers are counted from the touch events: a
  // touch that turns into a scroll has its pointer cancelled at once,
  // while its touch events run to the lift. The lift is an input too —
  // the momentum that follows is the reader's.
  // Only presses on the pages count: one elsewhere (a pane's edge
  // being dragged) resizes the view rather than scrolls it.
  const onPages = (t: EventTarget | null) => t instanceof Node && area.contains(t);
  const onTouch = (e: TouchEvent) => {
    const was = touches;
    touches = Array.from(e.touches).filter((t) => onPages(t.target)).length;
    if (was && !touches) onInput();
  };
  const touchEnds = ["touchstart", "touchend", "touchcancel"] as const;
  for (const t of touchEnds) window.addEventListener(t, onTouch, { passive: true, capture: true });
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (e.type === "pointerdown") {
      if (onPages(e.target)) pressed.add(e.pointerId);
    } else if (pressed.delete(e.pointerId)) onInput();
  };
  const pointerEnds = ["pointerdown", "pointerup", "pointercancel"] as const;
  for (const t of pointerEnds) window.addEventListener(t, onPointer, { passive: true, capture: true });
  /** Away from the window, nothing is held (a lift may never be heard). */
  const letGo = () => {
    touches = 0;
    pressed.clear();
  };
  // The app switcher, Stage Manager, another app in front: the window
  // loses focus before (or without) the page being hidden.
  const onBlur = () => {
    letGo();
    if (blurred || hidden()) return;
    blurred = true;
    env.log?.(`window left at ${describe(place)}`);
  };
  const onFocus = () => {
    if (!blurred) return;
    blurred = false;
    returning = true;
    disturb(RETURN_SETTLE_MS);
  };
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);

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
      letGo();
      env.log?.(`app hidden at ${describe(place)}`);
      return;
    }
    const size = `${area.clientWidth}×${area.clientHeight}`;
    env.log?.(`app back at ${size}; the pages show ${describe(hasPages() ? measure() : null)}`);
    blurred = false;
    returning = true;
    disturb(RETURN_SETTLE_MS);
    if (waiting) {
      waiting = false;
      if (hasPages() && env.fitsView()) run();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    /** A scroll: the place follows it, if the reader meant it. */
    scrolled,
    /** The viewer laid the pages out anew: the place follows. */
    note,
    /** A navigation: the scrolls that follow are the reader's. */
    intend: () => intend(),
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
      for (const t of inputs) window.removeEventListener(t, onInput, { capture: true });
      for (const t of touchEnds) window.removeEventListener(t, onTouch, { capture: true });
      for (const t of pointerEnds) window.removeEventListener(t, onPointer, { capture: true });
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(strayTimer);
      if (timer) clearTimeout(timer);
      window.clearTimeout(settleTimer);
      cancelAnimationFrame(measureRaf);
    },
  };
}
