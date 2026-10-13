// Folded view — the document collapsed to just the regions that carry
// annotations. Each fold shows the full page width but only a line or
// two above and below the annotation; a corner toggle reveals the whole
// page, and a filter popup picks which (type, colour) pairs make folds.
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
import { annotationPosition, type Annotation } from "../lib/highlights";
import { pdfPointToViewport } from "./annotations";
import { drawAnnotations } from "./paint";
import { COLLAPSE_ICON, EXPAND_ICON } from "./icons";
import { renderTextLayer } from "./pageTools";
import { capRenderScale, MAX_CONCURRENT_RENDERS, releaseCanvas } from "./render";
import type { PageRecord, PageViewport, PDFDocumentProxy } from "./types";
import type { FoldAnchor } from "./viewState";

const FOLD_PAD = 28; // page units (~2 text lines) above/below the annotation
const MERGE_GAP = 16; // merge folds whose padded regions come this close

const TYPE_LABELS: Record<string, string> = {
  highlight: "Highlights",
  underline: "Underlines",
  ink: "Handwriting",
  note: "Notes",
  image: "Areas",
  text: "Text boxes",
};
const TYPE_ORDER = ["highlight", "underline", "ink", "note", "image", "text"];

/** Zotero red is #ff6666; accept the red family without catching
 *  orange (#f19837) or magenta (#e56eee). */
function isRed(color: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((color || "").trim());
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const r = v >> 16;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return r >= 180 && g < 140 && b < 140;
}

interface FoldSpec {
  pageIndex: number;
  top: number;
  bottom: number;
}

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
  let popup: HTMLDivElement | null = null;
  let filterBtnRef: HTMLElement | null = null;
  let hostRef: HTMLElement | null = null;
  let lastScale: number | null = null;
  let lastAnnRef: Annotation[] | null = null;
  let lastFilterSig: string | null = null;
  // type:colour pairs marked in this viewer (see include()).
  const madeHere = new Set<string>();

  const comboKey = (a: Annotation) => `${a.type}:${(a.color || "").toLowerCase()}`;

  function availableCombos(): Map<string, { type: string; color: string; count: number }> {
    const map = new Map<string, { type: string; color: string; count: number }>();
    for (const a of env.getAnnotations()) {
      if (typeof annotationPosition(a)?.pageIndex !== "number") continue;
      const key = comboKey(a);
      const entry = map.get(key) || { type: a.type, color: (a.color || "").toLowerCase(), count: 0 };
      entry.count++;
      map.set(key, entry);
    }
    return map;
  }

  function ensureFilter(): Set<string> {
    if (filter) return filter;
    const combos = availableCombos();
    filter = new Set();
    for (const [key, c] of combos) {
      if ((c.type === "ink" || c.type === "highlight") && isRed(c.color)) filter.add(key);
    }
    for (const key of madeHere) if (combos.has(key)) filter.add(key);
    if (!filter.size) for (const key of combos.keys()) filter.add(key);
    return filter;
  }

  const filterSig = () => [...ensureFilter()].sort().join(",");

  /** Vertical extent of an annotation in top-based page units. */
  function annotationExtent(annot: Annotation, viewport: PageViewport) {
    const pos = annotationPosition(annot);
    if (!pos) return null;
    let top = Infinity;
    let bottom = -Infinity;
    const take = (x: number, y: number) => {
      const [, vy] = pdfPointToViewport(viewport, x, y);
      top = Math.min(top, vy);
      bottom = Math.max(bottom, vy);
    };
    for (const r of pos.rects ?? []) {
      if (!Array.isArray(r) || r.length < 4) continue;
      take(r[0], r[1]);
      take(r[2], r[3]);
    }
    for (const path of pos.paths ?? []) {
      if (!Array.isArray(path)) continue;
      for (let i = 1; i < path.length; i += 2) take(path[i - 1], path[i]);
    }
    return top === Infinity ? null : { top, bottom };
  }

  /** Padded, per-page-merged fold intervals for the active filter. */
  function computeFolds(): FoldSpec[] {
    const active = ensureFilter();
    const pages = env.getPages();
    const byPage = new Map<number, { top: number; bottom: number }[]>();
    for (const a of env.getAnnotations()) {
      if (!active.has(comboKey(a))) continue;
      const pos = annotationPosition(a);
      const p = pos ? pages[pos.pageIndex] : undefined;
      if (!pos || !p) continue;
      const ext = annotationExtent(a, p.viewport);
      if (!ext) continue;
      const list = byPage.get(pos.pageIndex) || [];
      list.push({
        top: Math.max(0, ext.top - FOLD_PAD),
        bottom: Math.min(p.viewport.height, ext.bottom + FOLD_PAD),
      });
      byPage.set(pos.pageIndex, list);
    }
    const out: FoldSpec[] = [];
    for (const idx of [...byPage.keys()].sort((a, b) => a - b)) {
      const list = byPage.get(idx)!.sort((a, b) => a.top - b.top);
      let cur: FoldSpec | null = null;
      for (const iv of list) {
        if (cur && iv.top <= cur.bottom + MERGE_GAP) cur.bottom = Math.max(cur.bottom, iv.bottom);
        else {
          cur = { pageIndex: idx, top: iv.top, bottom: iv.bottom };
          out.push(cur);
        }
      }
    }
    return out;
  }

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
    emptyMsg?.remove();
    emptyMsg = null;
  }

  function build(): void {
    teardownDom();
    const scale = env.getEffectiveZoom();
    const pages = env.getPages();
    const specs = computeFolds();
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

  function toggleExpand(fold: Fold): void {
    fold.expanded = !fold.expanded;
    fold.wrapper.classList.toggle("pdf-fold-expanded", fold.expanded);
    fold.wrapper.style.height = `${fold.expanded ? fold.pageCssH : fold.foldCssH}px`;
    fold.inner.style.top = fold.expanded ? "0px" : `-${Math.round(fold.top * fold.scale)}px`;
    fold.toggle.title = fold.expanded ? "Collapse to fold" : "Reveal full page";
    fold.toggle.innerHTML = fold.expanded ? COLLAPSE_ICON : EXPAND_ICON;
    // Expanded, the strip's raster is redrawn as the whole page (the
    // strip stays up until the page replaces it).
    if (fold.expanded && !fold.full) {
      fold.rendered = false;
      request(fold, true);
    }
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
  }

  /** Lay the fold's text layer, for selecting — on the first pointer
   *  over it (a mouse hovers before it presses; a finger's long press
   *  takes longer than this does). */
  function ensureText(f: Fold): void {
    if (f.text || !env.selectable || !f.rendered) return;
    f.text = true;
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
      // Pages are seeded from page 1's size until first render; adopt
      // the real one here so folds on odd-sized pages correct themselves.
      const p = env.getPages()[fold.pageIndex];
      if (p && !p.realViewport) {
        const vp1 = page.getViewport({ scale: 1 });
        const differed =
          Math.abs(vp1.width - p.viewport.width) > 0.5 ||
          Math.abs(vp1.height - p.viewport.height) > 0.5;
        p.realViewport = true;
        p.viewport = vp1;
        if (differed) {
          queueMicrotask(() => refresh(true));
          return;
        }
      }
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

  function refresh(force = false): void {
    if (!enabled) return;
    const scale = env.getEffectiveZoom();
    const annRef = env.getAnnotations();
    const sig = filterSig();
    if (!force && scale === lastScale && annRef === lastAnnRef && sig === lastFilterSig && domAlive()) return;
    lastScale = scale;
    lastAnnRef = annRef;
    lastFilterSig = sig;
    build();
  }

  function enable(): void {
    enabled = true;
    refresh(true);
  }

  function disable(): void {
    enabled = false;
    closePopup();
    teardownDom();
    lastScale = null;
    lastAnnRef = null;
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
    for (const f of folds) {
      const h = f.wrapper.offsetHeight;
      if (f.wrapper.offsetTop + h > top && h) {
        return { pageIndex: f.pageIndex, top: f.top, frac: (top - f.wrapper.offsetTop) / h };
      }
    }
    return null;
  }

  /** Scroll back to a place `viewAnchor` gave — the same fold, else the
   *  next one on or after its page. False while there are no folds. */
  function restoreAnchor(a: FoldAnchor): boolean {
    if (!folds.length) return false;
    const f =
      folds.find((x) => x.pageIndex === a.pageIndex && Math.abs(x.top - a.top) < 1) ??
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

  // --- filter popup ---------------------------------------------------------
  function attachFilterUI(filterBtn: HTMLElement, host: HTMLElement): void {
    filterBtnRef = filterBtn;
    hostRef = host;
    filterBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (popup) closePopup();
      else openPopup();
    });
  }

  function onDocPointerDown(e: PointerEvent): void {
    const t = e.target as Node;
    if (!popup || popup.contains(t) || filterBtnRef?.contains(t)) return;
    closePopup();
  }
  function onDocKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") closePopup();
  }

  function openPopup(): void {
    if (!hostRef || !filterBtnRef) return;
    const active = ensureFilter();
    popup = document.createElement("div");
    popup.className = "pdf-fold-filter-popup";
    const title = document.createElement("div");
    title.className = "pdf-fold-filter-title";
    title.textContent = "Fold annotations";
    popup.appendChild(title);

    const rank = (t: string) => (TYPE_ORDER.indexOf(t) === -1 ? 99 : TYPE_ORDER.indexOf(t));
    const combos = [...availableCombos().entries()].sort((a, b) =>
      rank(a[1].type) !== rank(b[1].type) ? rank(a[1].type) - rank(b[1].type) : a[1].color < b[1].color ? -1 : 1,
    );
    if (!combos.length) {
      const empty = document.createElement("div");
      empty.className = "pdf-fold-filter-empty";
      empty.textContent = "No annotations yet";
      popup.appendChild(empty);
    }
    for (const [key, c] of combos) {
      const row = document.createElement("label");
      row.className = "pdf-fold-filter-row";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = active.has(key);
      check.addEventListener("change", () => {
        filterCustomized = true;
        if (check.checked) active.add(key);
        else active.delete(key);
        refresh(true);
        env.onFilterChange?.();
      });
      const swatch = document.createElement("span");
      swatch.className = "pdf-fold-filter-swatch";
      swatch.style.background = c.color || "#ffff00";
      const text = document.createElement("span");
      text.textContent = TYPE_LABELS[c.type] || c.type;
      const count = document.createElement("span");
      count.className = "pdf-fold-filter-count";
      count.textContent = String(c.count);
      row.append(check, swatch, text, count);
      popup.appendChild(row);
    }
    hostRef.appendChild(popup);
    // Anchor above the toolbar at the filter button, clamped so a
    // narrow viewer can't clip it.
    const btnRect = filterBtnRef.getBoundingClientRect();
    const hostRect = hostRef.getBoundingClientRect();
    const left = Math.max(8, Math.min(btnRect.left - hostRect.left - 8, hostRect.width - popup.offsetWidth - 8));
    popup.style.left = `${left}px`;
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeydown, true);
  }

  function closePopup(): void {
    if (!popup) return;
    popup.remove();
    popup = null;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeydown, true);
  }

  return {
    enable,
    disable,
    refresh,
    onAnnotationsChanged,
    include,
    attachFilterUI,
    scrollToAnnotation,
    goToPage,
    getCurrentPage,
    viewAnchor,
    restoreAnchor,
    getFilter,
    setFilter,
    destroy: disable,
  };
}
