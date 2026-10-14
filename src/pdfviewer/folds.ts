// Folded view — the document collapsed to just the regions that carry
// annotations. Each fold shows the full page width but only a line or
// two above and below the annotation; a corner toggle reveals the whole
// page, and a filter popup (foldFilter.ts) picks which (type, colour)
// pairs make folds.
// Ported from Hush's src/pdf/pdf-viewer-folds.js.
//
// Hush seeds the filter with red highlights and red handwriting, its
// "come back to this" convention. A library without any red marks would
// open on an empty view, so here the filter falls back to everything.
// Marks made in this viewer always fold, whatever the filter: someone
// who has just highlighted a passage expects to find it there.
//
// Scrolling folds has to cost about what scrolling pages does, though a
// screen of folds touches many more pages. So a fold draws only its own
// strip of the page (the whole page once it is expanded), renders queue
// up nearest-first under the page renderer's concurrency limit, a strip
// is kept until it is well out of view (scrolling back doesn't redraw),
// and a fold's text layer is laid only when a pointer reaches it.
//
// Reading in the folded view for an hour must cost no more than reading
// in it for a minute. So what a fold leaves behind is let go as it goes
// out of reach: its raster, its text layer (only the last few laid are
// kept), and what pdf.js holds for its page (the parsed page and its
// decoded images, which pdf.js keeps until told to clean up — for a
// scanned book, megabytes a page).
import { annotationPosition, type Annotation } from "../lib/highlights";
import { drawAnnotations } from "./paint";
import { COLLAPSE_ICON, EXPAND_ICON } from "./icons";
import { renderTextLayer } from "./pageTools";
import { createFoldFilterPopup } from "./foldFilter";
import {
  annotationExtent,
  availableCombos,
  computeFolds,
  defaultFilter,
  foldedPages,
  type FoldSpec,
} from "./foldSpecs";
import { capRenderScale, MAX_CONCURRENT_RENDERS, releaseCanvas } from "./render";
import type { PageRecord, PDFDocumentProxy, PDFPageProxy } from "./types";
import type { FoldAnchor } from "./viewState";

interface Fold extends FoldSpec {
  wrapper: HTMLDivElement;
  inner: HTMLDivElement;
  toggle: HTMLButtonElement;
  scale: number;
  cssW: number;
  pageCssH: number;
  foldCssH: number;
  rendered: boolean;
  rendering: boolean;
  expanded: boolean;
  /** The raster is of the whole page (drawn while expanded). */
  full: boolean;
  /** The text layer is laid (or being laid). */
  text: boolean;
}

/** Strips are dropped only this far out of view, so a short scroll
 *  back finds them still drawn. */
const KEEP_MARGIN = "1500px";
/** Text layers kept at once. Each is the whole page's words, one
 *  element apiece, and on a touch screen every fold a scroll starts on
 *  gets one; the oldest go first. */
const MAX_TEXT_LAYERS = 6;
/** How long after a fold lets go before its page's pdf.js data does. */
const RELEASE_DELAY_MS = 1000;

/** Adopt a page's real size; pages are seeded from page 1's until they
 *  are drawn. True when it differed. */
function adoptRealViewport(p: PageRecord, page: PDFPageProxy): boolean {
  if (p.realViewport) return false;
  const vp1 = page.getViewport({ scale: 1 });
  const differed =
    Math.abs(vp1.width - p.viewport.width) > 0.5 || Math.abs(vp1.height - p.viewport.height) > 0.5;
  p.realViewport = true;
  p.viewport = vp1;
  return differed;
}

export interface FoldEnv {
  getPages: () => PageRecord[];
  getPdfDoc: () => PDFDocumentProxy | null;
  getAnnotations: () => Annotation[];
  getEffectiveZoom: () => number;
  isDestroyed: () => boolean;
  /** Lay selectable text over the folds. */
  selectable?: boolean;
  /** The filter was changed by hand. */
  onFilterChange?: () => void;
}

export function createFoldLayer(scrollArea: HTMLElement, env: FoldEnv) {
  let enabled = false;
  let folds: Fold[] = [];
  let observer: IntersectionObserver | null = null;
  let keeper: IntersectionObserver | null = null;
  let queue: Fold[] = [];
  let running = 0;
  let emptyMsg: HTMLDivElement | null = null;
  let filter: Set<string> | null = null;
  let filterCustomized = false;
  let lastScale: number | null = null;
  let lastFilterSig: string | null = null;
  // type:colour pairs marked in this viewer (see include()).
  const madeHere = new Set<string>();
  // Folds with a text layer, oldest first.
  let texted: Fold[] = [];
  // Pages pdf.js has parsed for a fold, not yet told to let go.
  const touched = new Set<number>();
  let releaseTimer = 0;
  let rebuildTimer = 0;

  function ensureFilter(): Set<string> {
    filter ??= defaultFilter(availableCombos(env.getAnnotations()), madeHere);
    return filter;
  }

  const filterSig = () => [...ensureFilter()].sort().join(",");

  function teardownDom(): void {
    observer?.disconnect();
    observer = null;
    keeper?.disconnect();
    keeper = null;
    queue = [];
    for (const f of folds) {
      f.inner.querySelectorAll("canvas").forEach(releaseCanvas);
      f.wrapper.remove();
    }
    folds = [];
    texted = [];
    emptyMsg?.remove();
    emptyMsg = null;
    scheduleRelease();
  }

  /** Tell pdf.js to let go of the pages no fold is drawing or about to
   *  draw (all of them, with `all`: leaving the folded view). It keeps
   *  a page parsed, images decoded, until told — a drawn raster doesn't
   *  need it, only drawing it again does. */
  function releasePages(all = false): void {
    window.clearTimeout(releaseTimer);
    releaseTimer = 0;
    const pdfDoc = env.getPdfDoc();
    for (const idx of [...touched]) {
      const busy =
        !all &&
        folds.some(
          (f) => f.pageIndex === idx && (f.rendering || queue.includes(f) || (f.rendered && f.wrapper.isConnected)),
        );
      if (busy) continue;
      touched.delete(idx);
      // Deferred by pdf.js while a render of the page is still running.
      void pdfDoc?.getPage(idx + 1).then((page) => page.cleanup()).catch(() => {});
    }
  }
  function scheduleRelease(): void {
    if (releaseTimer || !touched.size) return;
    releaseTimer = window.setTimeout(() => {
      releaseTimer = 0;
      releasePages();
    }, RELEASE_DELAY_MS);
  }

  /** Rebuild once, soon — however many folds learn their page's real
   *  size in the meantime. */
  function scheduleRebuild(): void {
    if (rebuildTimer) return;
    rebuildTimer = window.setTimeout(() => {
      rebuildTimer = 0;
      refresh(true);
    }, 0);
  }

  /** Learn the real size of every page that folds, all at once. Pages
   *  start at page 1's size, so a fold on a page of another size (a
   *  JSTOR cover makes it every page) is misplaced until its page is
   *  known; learning that one fold at a time, as each draws, meant a
   *  rebuild of the whole view per page. */
  function sizeFoldPages(): void {
    const pdfDoc = env.getPdfDoc();
    const pages = env.getPages();
    if (!pdfDoc) return;
    const todo = [...foldedPages(env.getAnnotations(), ensureFilter())].filter(
      (i) => pages[i] && !pages[i].realViewport,
    );
    if (!todo.length) return;
    void Promise.all(
      todo.map((i) =>
        pdfDoc
          .getPage(i + 1)
          .then((page) => env.getPages() === pages && adoptRealViewport(pages[i], page))
          .catch(() => false),
      ),
    ).then((differed) => {
      if (differed.some(Boolean) && enabled && env.getPdfDoc() === pdfDoc) scheduleRebuild();
    });
  }

  function build(): void {
    teardownDom();
    const scale = env.getEffectiveZoom();
    const pages = env.getPages();
    const specs = computeFolds(env.getAnnotations(), pages, ensureFilter());
    if (!specs.length) {
      emptyMsg = document.createElement("div");
      emptyMsg.className = "pdf-fold-empty";
      emptyMsg.textContent = env.getAnnotations().length
        ? "No annotations match the current filter."
        : "No annotations to fold.";
      scrollArea.appendChild(emptyMsg);
      return;
    }
    for (const spec of specs) {
      const p = pages[spec.pageIndex];
      const cssW = Math.round(p.viewport.width * scale);
      const pageCssH = Math.round(p.viewport.height * scale);
      const foldCssH = Math.max(24, Math.round((spec.bottom - spec.top) * scale));

      const wrapper = document.createElement("div");
      wrapper.className = "pdf-fold-wrapper";
      wrapper.style.width = `${cssW}px`;
      wrapper.style.height = `${foldCssH}px`;
      const inner = document.createElement("div");
      inner.className = "pdf-fold-page";
      inner.style.width = `${cssW}px`;
      inner.style.height = `${pageCssH}px`;
      inner.style.top = `-${Math.round(spec.top * scale)}px`;
      wrapper.appendChild(inner);
      const label = document.createElement("span");
      label.className = "pdf-fold-page-label";
      label.textContent = `p. ${spec.pageIndex + 1}`;
      wrapper.appendChild(label);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "pdf-fold-toggle";
      toggle.title = "Reveal full page";
      toggle.innerHTML = EXPAND_ICON;
      wrapper.appendChild(toggle);

      const fold: Fold = {
        ...spec, wrapper, inner, toggle, scale, cssW, pageCssH, foldCssH,
        rendered: false, rendering: false, expanded: false, full: false, text: false,
      };
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleExpand(fold);
      });
      wrapper.dataset.foldIndex = String(folds.length);
      wrapper.dataset.pageIndex = String(spec.pageIndex);
      scrollArea.appendChild(wrapper);
      folds.push(fold);
    }
    setupObserver();
  }

  /** Open a fold to its whole page, or close it back to its strip.
   *  `instant` skips the height animation (a rebuild re-opening one). */
  function setExpanded(fold: Fold, on: boolean, instant = false): void {
    if (fold.expanded === on) return;
    fold.expanded = on;
    if (instant) fold.wrapper.style.transition = "none";
    fold.wrapper.classList.toggle("pdf-fold-expanded", on);
    fold.wrapper.style.height = `${on ? fold.pageCssH : fold.foldCssH}px`;
    fold.inner.style.top = on ? "0px" : `-${Math.round(fold.top * fold.scale)}px`;
    fold.toggle.title = on ? "Collapse to fold" : "Reveal full page";
    fold.toggle.innerHTML = on ? COLLAPSE_ICON : EXPAND_ICON;
    if (instant) {
      void fold.wrapper.offsetHeight; // apply it before the transition returns
      fold.wrapper.style.transition = "";
    }
    // Expanded, the strip's raster is redrawn as the whole page (the
    // strip stays up until the page replaces it).
    if (on && !fold.full) {
      fold.rendered = false;
      request(fold, true);
    }
  }

  /** The corner button. One page is open at a time: opening this one
   *  closes the other at once, keeping this one where it is on screen
   *  (an open page above it would otherwise pull it up). */
  function toggleExpand(fold: Fold): void {
    if (fold.expanded) return setExpanded(fold, false);
    const other = folds.find((f) => f.expanded);
    if (other) {
      const before = fold.wrapper.getBoundingClientRect().top;
      setExpanded(other, false, true);
      scrollArea.scrollTop += fold.wrapper.getBoundingClientRect().top - before;
    }
    setExpanded(fold, true);
  }

  /** Is `node` on an open (whole-page) fold? Marks can be made there. */
  const inExpanded = (node: Node | null): boolean =>
    Boolean((node instanceof Element ? node : node?.parentElement)?.closest(".pdf-fold-wrapper.pdf-fold-expanded"));

  /** Entering the folded view: centre the fold nearest a place on the
   *  pages (a page and a fraction down it), reading the document as one
   *  run of pages — on that very place when the fold shows it, else on
   *  the fold's middle. */
  function centerOn(place: { pageIndex: number; frac: number }): void {
    const pages = env.getPages();
    const heightOf = (i: number) => pages[i]?.viewport.height || 1;
    const want = place.pageIndex + place.frac;
    let best: Fold | null = null;
    let bestDist = Infinity;
    for (const f of folds) {
      const h = heightOf(f.pageIndex);
      const d = Math.max(0, f.pageIndex + f.top / h - want, want - (f.pageIndex + f.bottom / h));
      if (d < bestDist) {
        best = f;
        bestDist = d;
      }
    }
    if (!best) return;
    const y = bestDist === 0 ? place.frac * heightOf(best.pageIndex) : (best.top + best.bottom) / 2;
    const ar = scrollArea.getBoundingClientRect();
    const page = best.inner.getBoundingClientRect();
    scrollArea.scrollTop += page.top + y * best.scale - (ar.top + scrollArea.clientHeight / 2);
  }

  /** The place at the view's vertical centre, as a page and a fraction
   *  down it — on the fold there, or the nearest one, kept to the part
   *  of its page that fold shows. For leaving the folded view without
   *  losing the place. */
  function centerPlace(): { pageIndex: number; frac: number } | null {
    if (!folds.length) return null;
    const ar = scrollArea.getBoundingClientRect();
    const mid = ar.top + scrollArea.clientHeight / 2;
    let best: Fold | null = null;
    let bestDist = Infinity;
    for (const f of folds) {
      const r = f.wrapper.getBoundingClientRect();
      const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
      if (d < bestDist) {
        best = f;
        bestDist = d;
      }
      if (r.top > mid && d > bestDist) break;
    }
    if (!best) return null;
    const w = best.wrapper.getBoundingClientRect();
    const page = best.inner.getBoundingClientRect();
    if (!page.height) return null;
    const y = Math.max(w.top, Math.min(w.bottom, mid));
    return { pageIndex: best.pageIndex, frac: (y - page.top) / page.height };
  }

  /** Queue a fold's render; `first` puts it at the head of the queue. */
  function request(fold: Fold, first = false): void {
    if (fold.rendered || fold.rendering || queue.includes(fold)) return;
    if (first) queue.unshift(fold);
    else queue.push(fold);
    pump();
  }
  function pump(): void {
    while (running < MAX_CONCURRENT_RENDERS && queue.length) {
      const f = queue.shift()!;
      if (f.rendered || f.rendering || !f.wrapper.isConnected) continue;
      running++;
      void renderFold(f).finally(() => {
        running--;
        pump();
      });
    }
  }

  /** Drop a fold's raster and text (it has gone well out of view). */
  function drop(f: Fold): void {
    queue = queue.filter((q) => q !== f);
    if (!f.rendered || f.expanded) return;
    f.inner.querySelectorAll("canvas").forEach(releaseCanvas);
    f.inner.innerHTML = "";
    f.rendered = false;
    f.full = false;
    f.text = false;
    texted = texted.filter((t) => t !== f);
    scheduleRelease();
  }

  /** Lay the fold's text layer, for selecting — on the first pointer
   *  over it (a mouse hovers before it presses; a finger's long press
   *  takes longer than this does). */
  function ensureText(f: Fold): void {
    if (f.text || !env.selectable || !f.rendered) return;
    f.text = true;
    texted.push(f);
    // Let the oldest go — not the open page's, nor one the selection
    // is in.
    const sel = window.getSelection();
    for (const old of texted.slice(0, Math.max(0, texted.length - MAX_TEXT_LAYERS))) {
      const layer = old.inner.querySelector(".textLayer");
      if (old.expanded || (layer && sel?.anchorNode && layer.contains(sel.anchorNode))) continue;
      layer?.remove();
      old.text = false;
      texted = texted.filter((t) => t !== old);
    }
    const pdfDoc = env.getPdfDoc();
    if (!pdfDoc) return;
    void pdfDoc
      .getPage(f.pageIndex + 1)
      .then((page) => renderTextLayer(f.inner, page, f.scale, () => f.text && f.wrapper.isConnected))
      .catch(() => (f.text = false));
  }
  const onPointer = (e: PointerEvent) => {
    if (!enabled) return;
    const w = (e.target as Element | null)?.closest<HTMLElement>(".pdf-fold-wrapper");
    const f = w ? folds[Number(w.dataset.foldIndex)] : undefined;
    if (f) ensureText(f);
  };
  scrollArea.addEventListener("pointerover", onPointer);
  scrollArea.addEventListener("pointerdown", onPointer, true);

  function setupObserver(): void {
    // Near the view: draw (the fold itself first, then its neighbours).
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset.foldIndex);
          const f = folds[idx];
          if (!f) continue;
          request(f, true);
          for (const g of [folds[idx + 1], folds[idx - 1]]) if (g) request(g);
        }
      },
      { root: scrollArea, rootMargin: "300px" },
    );
    // Well out of view: let go. Expanded folds stay — the reader opened those.
    keeper = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const f = folds[Number((entry.target as HTMLElement).dataset.foldIndex)];
          if (f && !entry.isIntersecting) drop(f);
        }
      },
      { root: scrollArea, rootMargin: KEEP_MARGIN },
    );
    for (const f of folds) {
      observer.observe(f.wrapper);
      keeper.observe(f.wrapper);
    }
  }

  async function renderFold(fold: Fold): Promise<void> {
    if (fold.rendered || fold.rendering || !enabled || env.isDestroyed()) return;
    const pdfDoc = env.getPdfDoc();
    if (!pdfDoc) return;
    fold.rendering = true;
    try {
      const page = await pdfDoc.getPage(fold.pageIndex + 1);
      if (!enabled || env.isDestroyed() || !fold.wrapper.isConnected) return;
      // A page sizeFoldPages hasn't reached yet: its folds are placed
      // for page 1's size, so they are rebuilt (once, for all of them).
      const p = env.getPages()[fold.pageIndex];
      if (p && adoptRealViewport(p, page)) {
        scheduleRebuild();
        return;
      }
      touched.add(fold.pageIndex);
      // The strip in view, or the whole page when expanded — a strip is
      // a few lines, and drawing all of the page for it is most of what
      // made scrolling folds slow.
      const full = fold.expanded;
      const dpr = window.devicePixelRatio || 1;
      const k = capRenderScale(fold.scale * dpr, page.getViewport({ scale: 1 }));
      const top = full ? 0 : fold.top;
      const cssH = full ? fold.pageCssH : fold.foldCssH;
      const viewport = page.getViewport({ scale: k, offsetY: -Math.round(top * k) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.max(1, Math.round((cssH / fold.scale) * k));
      canvas.className = "pdf-page-canvas pdf-fold-canvas";
      canvas.style.top = `${Math.round(top * fold.scale)}px`;
      canvas.style.width = `${fold.cssW}px`;
      canvas.style.height = `${cssH}px`;
      try {
        await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      } catch (e) {
        releaseCanvas(canvas);
        throw e;
      }
      if (!enabled || env.isDestroyed() || !fold.wrapper.isConnected || full !== fold.expanded) {
        releaseCanvas(canvas);
        if (full !== fold.expanded && enabled) queueMicrotask(() => request(fold, true));
        return;
      }
      // Every annotation on the page, not only the filtered ones, so a
      // revealed page reads exactly like the normal view.
      const ctx = canvas.getContext("2d");
      if (ctx) drawAnnotations(ctx, viewport, env.getAnnotations(), fold.pageIndex);
      // Only the raster is replaced: a text layer already laid stays.
      fold.inner.querySelectorAll("canvas").forEach((c) => {
        releaseCanvas(c);
        c.remove();
      });
      fold.inner.insertBefore(canvas, fold.inner.firstChild);
      fold.rendered = true;
      fold.full = full;
      // A pointer already resting on it gets its text now.
      if (fold.wrapper.matches(":hover")) ensureText(fold);
    } catch (e) {
      console.error(`Failed to render fold on page ${fold.pageIndex + 1}:`, e);
    } finally {
      fold.rendering = false;
    }
  }

  function domAlive(): boolean {
    if (folds.length) return folds[0].wrapper.isConnected;
    return emptyMsg ? emptyMsg.isConnected : false;
  }

  // A changed annotation forces its own rebuild (onAnnotationsChanged),
  // so here only the zoom and the filter count: a resize — the iPad's
  // keyboard coming up for the notes — rebuilds nothing.
  function refresh(force = false): void {
    if (!enabled) return;
    const scale = env.getEffectiveZoom();
    const sig = filterSig();
    if (!force && scale === lastScale && sig === lastFilterSig && domAlive()) return;
    lastScale = scale;
    lastFilterSig = sig;
    // A rebuild (a mark made, the filter or the zoom changed) keeps the
    // open page open and the view where it was.
    const openPage = folds.find((f) => f.expanded)?.pageIndex ?? null;
    const anchor = viewAnchor();
    build();
    const reopen = openPage === null ? undefined : folds.find((f) => f.pageIndex === openPage);
    if (reopen) setExpanded(reopen, true, true);
    if (anchor) restoreAnchor(anchor);
    sizeFoldPages();
  }

  function enable(): void {
    enabled = true;
    refresh(true);
  }

  function disable(): void {
    enabled = false;
    popup.close();
    window.clearTimeout(rebuildTimer);
    rebuildTimer = 0;
    teardownDom();
    releasePages(true);
    lastScale = null;
    lastFilterSig = null;
  }

  /** A mark of this type and colour was just made (or recoloured) here:
   *  fold it, even under a filter set before the colour existed. */
  function include(type: string, color: string): void {
    const key = `${type}:${color.toLowerCase()}`;
    madeHere.add(key);
    filter?.add(key);
  }

  function onAnnotationsChanged(): void {
    if (!filterCustomized) filter = null;
    if (enabled) refresh(true);
  }

  /** Scroll to the fold holding an annotation. True when handled. */
  function scrollToAnnotation(annot: Annotation): boolean {
    if (!enabled || !folds.length) return false;
    const pos = annotationPosition(annot);
    if (!pos) return false;
    const p = env.getPages()[pos.pageIndex];
    const ext = p ? annotationExtent(annot, p.viewport) : null;
    let best: Fold | null = null;
    for (const f of folds) {
      if (f.pageIndex !== pos.pageIndex) continue;
      best ??= f;
      if (ext && ext.top >= f.top - 1 && ext.top <= f.bottom + 1) {
        best = f;
        break;
      }
    }
    // Filtered out: land on the nearest following fold instead of 0.
    best ??= folds.find((f) => f.pageIndex >= pos.pageIndex) || folds[folds.length - 1];
    scrollArea.scrollTo({
      top: Math.max(0, best.wrapper.offsetTop - scrollArea.clientHeight / 3),
      behavior: "smooth",
    });
    return true;
  }

  function goToPage(n: number): void {
    if (!folds.length) return;
    const target = folds.find((f) => f.pageIndex >= n - 1) || folds[folds.length - 1];
    target.wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Where the view starts: the first fold reaching into it, and how
   *  far into that fold (negative in the gap above it). */
  function viewAnchor(): FoldAnchor | null {
    const top = scrollArea.scrollTop;
    let nth = 0;
    for (let i = 0; i < folds.length; i++) {
      const f = folds[i];
      nth = i > 0 && folds[i - 1].pageIndex === f.pageIndex ? nth + 1 : 0;
      const h = f.wrapper.offsetHeight;
      if (f.wrapper.offsetTop + h > top && h) {
        return { pageIndex: f.pageIndex, top: f.top, nth, frac: (top - f.wrapper.offsetTop) / h };
      }
    }
    return null;
  }

  /** Scroll back to a place `viewAnchor` gave — the same fold (by its
   *  top, else by its place among its page's folds: the top moves when
   *  the page's real size arrives), else the next one on or after its
   *  page. False while there are no folds. */
  function restoreAnchor(a: FoldAnchor): boolean {
    if (!folds.length) return false;
    const onPage = folds.filter((x) => x.pageIndex === a.pageIndex);
    const f =
      onPage.find((x) => Math.abs(x.top - a.top) < 1) ??
      (a.nth != null ? onPage[Math.min(a.nth, onPage.length - 1)] : undefined) ??
      folds.find((x) => x.pageIndex >= a.pageIndex) ??
      folds[folds.length - 1];
    const frac = Math.max(-0.5, Math.min(1, a.frac));
    scrollArea.scrollTop = Math.max(0, f.wrapper.offsetTop + frac * f.wrapper.offsetHeight);
    return true;
  }

  /** The filter, when it was changed by hand (else it follows the
   *  annotations), and setting it so. */
  const getFilter = () => (filterCustomized && filter ? [...filter] : null);
  function setFilter(keys: string[]): void {
    filter = new Set(keys);
    filterCustomized = true;
  }

  function getCurrentPage(): number {
    if (!folds.length) return 1;
    const mid = scrollArea.scrollTop + scrollArea.clientHeight / 2;
    let cur = folds[0].pageIndex + 1;
    for (const f of folds) if (f.wrapper.offsetTop <= mid) cur = f.pageIndex + 1;
    return cur;
  }

  const popup = createFoldFilterPopup({
    combos: () => availableCombos(env.getAnnotations()),
    active: ensureFilter,
    toggle: (key, on) => {
      const active = ensureFilter();
      filterCustomized = true;
      if (on) active.add(key);
      else active.delete(key);
      refresh(true);
      env.onFilterChange?.();
    },
  });

  return {
    enable,
    disable,
    refresh,
    onAnnotationsChanged,
    include,
    attachFilterUI: popup.attach,
    scrollToAnnotation,
    goToPage,
    getCurrentPage,
    viewAnchor,
    restoreAnchor,
    inExpanded,
    centerOn,
    centerPlace,
    getFilter,
    setFilter,
    destroy: disable,
  };
}
