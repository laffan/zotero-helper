// Page raster policy — which pages hold a live canvas, at what
// resolution, and when they let go of it. Ported from Hush's
// src/pdf/pdf-viewer-render.js.
//
// Two constraints pull against each other: memory must stay bounded
// (an iPad webview is killed for hoarding canvases) and scrolling must
// stay cheap (evicting per frame re-rasterises constantly). So:
//
//  - The scroll path does no DOM reads: page offsets are cached once per
//    geometry change and the visible range is a binary search over them.
//  - Rendering is a small priority queue — visible pages first, then the
//    buffer by distance — drained with limited concurrency and rebuilt
//    on every update; renders whose page left the window are cancelled.
//  - Rendered pages are kept until a canvas-byte budget or a page-count
//    cap is exceeded, and eviction runs only when scrolling goes idle.
//  - Canvas resolution is capped per page (iOS has hard canvas limits).
//  - `scheduleSettle()` is the crisp pass after a zoom or resize: in the
//    meantime existing rasters are only CSS-stretched.
import type { LayoutMode, PageRecord, PDFDocumentProxy, PDFPageProxy } from "./types";

const RENDER_BUFFER = 2; // pages rendered beyond the visible range
const VISIBLE_MARGIN = 200; // px of scroll slack counted as "visible"
const SETTLE_MS = 200; // quiet period before the crisp re-render
const EVICT_IDLE_MS = 300; // quiet period before over-budget eviction

const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iP(ad|hone|od)/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** Ceiling on canvas pixels per page. */
export const MAX_CANVAS_PIXELS = IS_IOS ? 8_000_000 : 16_777_216;

const KEEP_BUDGET_BYTES = IS_IOS ? 192_000_000 : 512_000_000;
const KEEP_MAX_PAGES = IS_IOS ? 24 : 48;
const MAX_CONCURRENT_RENDERS = IS_IOS ? 1 : 2;

/** Clamp a render scale so the page stays under MAX_CANVAS_PIXELS. */
export function capRenderScale(scale: number, viewport1: { width: number; height: number }): number {
  const px = viewport1.width * viewport1.height * scale * scale;
  return px > MAX_CANVAS_PIXELS ? scale * Math.sqrt(MAX_CANVAS_PIXELS / px) : scale;
}

function isCancelError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  return Boolean(
    err && (err.name === "RenderingCancelledException" || /cancelled/i.test(err.message || "")),
  );
}

export interface RendererEnv {
  getPages: () => PageRecord[];
  getPdfDoc: () => PDFDocumentProxy | null;
  getEffectiveZoom: () => number;
  getLayoutMode: () => LayoutMode;
  isFolded: () => boolean;
  isDestroyed: () => boolean;
  /** Annotation, link and text layers join the page here. */
  onPageRendered: (idx: number, page: PDFPageProxy) => void;
  /** After each render-set update (the page indicator). */
  onUpdate?: () => void;
}

interface Geometry {
  pages: PageRecord[];
  count: number;
  horiz: boolean;
  starts: Float64Array;
  sizes: Float64Array;
}

export function createPageRenderer(scrollArea: HTMLElement, env: RendererEnv) {
  let updateRaf = 0;
  let settleTimer: number | null = null;
  let idleTimer: number | null = null;
  let geom: Geometry | null = null;
  let renderedBytes = 0;
  let queue: number[] = [];
  let inFlight = 0;
  const inFlightIdx = new Set<number>();
  let lastRange: [number, number] | null = null;

  function invalidateGeometry(): void {
    geom = null;
  }

  function ensureGeometry(): Geometry {
    const pages = env.getPages();
    if (geom && geom.pages === pages && geom.count === pages.length) return geom;
    const horiz = env.getLayoutMode() === "horizontal";
    const starts = new Float64Array(pages.length);
    const sizes = new Float64Array(pages.length);
    for (let i = 0; i < pages.length; i++) {
      const w = pages[i].wrapper;
      starts[i] = horiz ? w.offsetLeft : w.offsetTop;
      sizes[i] = horiz ? w.offsetWidth : w.offsetHeight;
    }
    geom = { pages, count: pages.length, horiz, starts, sizes };
    return geom;
  }

  /** Rightmost index whose start ≤ pos. */
  function indexAt(g: Geometry, pos: number): number {
    let lo = 0;
    let hi = g.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (g.starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function visibleRange(): [number, number] | null {
    const g = ensureGeometry();
    if (!g.count) return null;
    const size = g.horiz ? scrollArea.clientWidth : scrollArea.clientHeight;
    if (!size) return null;
    const start = (g.horiz ? scrollArea.scrollLeft : scrollArea.scrollTop) - VISIBLE_MARGIN;
    const end = start + size + VISIBLE_MARGIN * 2;
    const last = indexAt(g, end);
    if (g.starts[last] > end) return null;
    let first = last;
    // Walk left while the preceding page still reaches into the window
    // (also covers fit-2/3 rows, whose members share a start).
    while (first > 0 && g.starts[first - 1] + g.sizes[first - 1] >= start) first--;
    while (first < last && g.starts[first] + g.sizes[first] < start) first++;
    return [first, last];
  }

  /** 1-based page number at the viewport's centre. */
  function pageAtViewCenter(): number {
    const g = ensureGeometry();
    if (!g.count) return 1;
    const mid = g.horiz
      ? scrollArea.scrollLeft + scrollArea.clientWidth / 2
      : scrollArea.scrollTop + scrollArea.clientHeight / 2;
    return indexAt(g, mid) + 1;
  }

  function update(): void {
    if (env.isDestroyed() || env.isFolded()) return;
    const range = visibleRange();
    if (!range) return;
    lastRange = range;
    const pages = env.getPages();
    const [first, last] = range;
    const rFrom = Math.max(0, first - RENDER_BUFFER);
    const rTo = Math.min(pages.length - 1, last + RENDER_BUFFER);
    const wanted: number[] = [];
    for (let i = first; i <= last; i++) wanted.push(i);
    for (let b = 1; b <= RENDER_BUFFER; b++) {
      if (last + b <= rTo) wanted.push(last + b);
      if (first - b >= rFrom) wanted.push(first - b);
    }
    queue = wanted.filter((i) => {
      const p = pages[i];
      return p && !p.rendered && !p.rendering;
    });
    for (const i of [...inFlightIdx]) {
      if (i < rFrom || i > rTo) clearPage(i);
    }
    pump();
    if (renderedBytes > KEEP_BUDGET_BYTES * 1.5) evictOverBudget();
    scheduleIdleEvict();
    env.onUpdate?.();
  }

  function scheduleUpdate(): void {
    if (updateRaf) return;
    updateRaf = requestAnimationFrame(() => {
      updateRaf = 0;
      update();
    });
  }

  function pump(): void {
    while (inFlight < MAX_CONCURRENT_RENDERS && queue.length) {
      const idx = queue.shift()!;
      const p = env.getPages()[idx];
      if (!p || p.rendered || p.rendering) continue;
      inFlight++;
      inFlightIdx.add(idx);
      renderPage(idx)
        .catch(() => {})
        .finally(() => {
          inFlight--;
          inFlightIdx.delete(idx);
          pump();
        });
    }
  }

  function scheduleSettle(): void {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      if (env.isDestroyed() || env.isFolded()) return;
      const scale = env.getEffectiveZoom();
      const pages = env.getPages();
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        if (p.rendered && Math.abs((p.renderedZoom ?? scale) - scale) > 0.001) clearPage(i);
      }
      update();
    }, SETTLE_MS);
  }

  /** Trim the farthest-from-view rendered pages once over budget. Pages
   *  inside the render window are never evicted. */
  function evictOverBudget(): void {
    if (!lastRange) return;
    const pages = env.getPages();
    const rendered: number[] = [];
    for (let i = 0; i < pages.length; i++) if (pages[i].rendered) rendered.push(i);
    if (renderedBytes <= KEEP_BUDGET_BYTES && rendered.length <= KEEP_MAX_PAGES) return;
    const [first, last] = lastRange;
    const rFrom = first - RENDER_BUFFER;
    const rTo = last + RENDER_BUFFER;
    const dist = (i: number) => (i < first ? first - i : i > last ? i - last : 0);
    rendered.sort((a, b) => dist(b) - dist(a));
    let count = rendered.length;
    for (const i of rendered) {
      if (i >= rFrom && i <= rTo) break;
      clearPage(i);
      count--;
      if (renderedBytes <= KEEP_BUDGET_BYTES * 0.9 && count <= KEEP_MAX_PAGES) break;
    }
  }

  function scheduleIdleEvict(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      idleTimer = null;
      evictOverBudget();
    }, EVICT_IDLE_MS);
  }

  async function renderPage(idx: number): Promise<void> {
    const pages = env.getPages();
    const p = pages[idx];
    if (!p || p.rendered || p.rendering || env.isDestroyed() || env.isFolded()) return;
    const pdfDoc = env.getPdfDoc();
    if (!pdfDoc) return;
    p.rendering = true;
    p.cancelled = false;
    p.wrapper.querySelector(".pdf-page-placeholder")?.classList.add("loading");
    try {
      const page = await pdfDoc.getPage(idx + 1);
      if (env.isDestroyed() || p.cancelled || pages !== env.getPages()) return;

      // Wrappers are seeded from page 1's size; adopt the real
      // dimensions the first time the page actually renders.
      if (!p.realViewport) {
        const vp1 = page.getViewport({ scale: 1 });
        p.realViewport = true;
        if (
          Math.abs(vp1.width - p.viewport.width) > 0.5 ||
          Math.abs(vp1.height - p.viewport.height) > 0.5
        ) {
          p.viewport = vp1;
          const s = env.getEffectiveZoom();
          p.wrapper.style.width = `${Math.round(vp1.width * s)}px`;
          p.wrapper.style.height = `${Math.round(vp1.height * s)}px`;
          invalidateGeometry();
        } else {
          p.viewport = vp1;
        }
      }

      const scale = env.getEffectiveZoom();
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: capRenderScale(scale * dpr, p.viewport) });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.className = "pdf-page-canvas";

      const task = page.render({ canvas, viewport, background: "#ffffff" });
      p.renderTask = task;
      await task.promise;
      p.renderTask = null;
      if (env.isDestroyed() || p.cancelled || pages !== env.getPages()) return;

      // The canvas lives inside a content box sized at paint-time CSS
      // px; overlay layers join it there, so a later CSS stretch scales
      // the whole sandwich together.
      const cssW = Math.round(p.viewport.width * scale);
      const cssH = Math.round(p.viewport.height * scale);
      const content = document.createElement("div");
      content.className = "pdf-page-content";
      content.style.width = `${cssW}px`;
      content.style.height = `${cssH}px`;
      content.appendChild(canvas);
      p.wrapper.querySelector(".pdf-page-placeholder")?.remove();
      p.contentEl?.remove();
      p.wrapper.insertBefore(content, p.wrapper.firstChild);
      p.contentEl = content;
      p.contentW = cssW;
      p.contentH = cssH;
      p.rendered = true;
      p.renderedZoom = scale;
      p.canvas = canvas;
      p.canvasBytes = canvas.width * canvas.height * 4;
      renderedBytes += p.canvasBytes;
      const curW = parseFloat(p.wrapper.style.width) || cssW;
      if (Math.abs(curW - cssW) > 0.5) content.style.transform = `scale(${curW / cssW})`;
      env.onPageRendered(idx, page);
    } catch (e) {
      if (!isCancelError(e)) console.error(`Failed to render page ${idx + 1}:`, e);
    } finally {
      p.rendering = false;
      p.renderTask = null;
      if (!p.rendered) {
        p.wrapper.querySelector(".pdf-page-placeholder")?.classList.remove("loading");
      }
    }
  }

  function clearPage(idx: number): void {
    const p = env.getPages()[idx];
    if (!p) return;
    if (p.rendering) {
      p.cancelled = true;
      try {
        p.renderTask?.cancel();
      } catch {
        /* already finished */
      }
    }
    if (!p.rendered && !p.contentEl) return;
    p.contentEl?.remove();
    p.contentEl = null;
    p.canvas = null;
    p.contentW = 0;
    p.contentH = 0;
    if (p.rendered) renderedBytes -= p.canvasBytes || 0;
    p.canvasBytes = 0;
    if (!p.wrapper.querySelector(".pdf-page-placeholder")) {
      const placeholder = document.createElement("div");
      placeholder.className = "pdf-page-placeholder";
      p.wrapper.insertBefore(placeholder, p.wrapper.firstChild);
    }
    p.rendered = false;
    p.renderedZoom = null;
  }

  function clearAll(): void {
    const pages = env.getPages();
    for (let i = 0; i < pages.length; i++) clearPage(i);
    renderedBytes = 0;
  }

  /** Forget everything about the current document — before a (re)load
   *  swaps the pages array out. */
  function reset(): void {
    queue = [];
    lastRange = null;
    renderedBytes = 0;
    invalidateGeometry();
    if (idleTimer) clearTimeout(idleTimer);
    if (settleTimer) clearTimeout(settleTimer);
    idleTimer = null;
    settleTimer = null;
  }

  function destroy(): void {
    if (updateRaf) cancelAnimationFrame(updateRaf);
    updateRaf = 0;
    reset();
  }

  return {
    update,
    scheduleUpdate,
    scheduleSettle,
    clearPage,
    clearAll,
    reset,
    destroy,
    invalidateGeometry,
    pageAtViewCenter,
  };
}

export type PageRenderer = ReturnType<typeof createPageRenderer>;
