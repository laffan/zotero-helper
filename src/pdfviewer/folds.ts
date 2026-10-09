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
import { annotationPosition, type Annotation } from "../lib/highlights";
import { pdfPointToViewport } from "./annotations";
import { drawAnnotations } from "./paint";
import { COLLAPSE_ICON, EXPAND_ICON } from "./icons";
import { capRenderScale } from "./render";
import type { PageRecord, PageViewport, PDFDocumentProxy } from "./types";

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
}

export interface FoldEnv {
  getPages: () => PageRecord[];
  getPdfDoc: () => PDFDocumentProxy | null;
  getAnnotations: () => Annotation[];
  getEffectiveZoom: () => number;
  isDestroyed: () => boolean;
}

export function createFoldLayer(scrollArea: HTMLElement, env: FoldEnv) {
  let enabled = false;
  let folds: Fold[] = [];
  let observer: IntersectionObserver | null = null;
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
    for (const f of folds) f.wrapper.remove();
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
        rendered: false, rendering: false, expanded: false,
      };
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleExpand(fold);
      });
      wrapper.dataset.foldIndex = String(folds.length);
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
  }

  function setupObserver(): void {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = parseInt((entry.target as HTMLElement).dataset.foldIndex ?? "", 10);
          const f = folds[idx];
          if (!f) continue;
          if (!entry.isIntersecting) {
            // Each fold holds a full-page canvas; scrolled-away ones are
            // dropped. Expanded folds stay — the reader opened those.
            if (f.rendered && !f.expanded) {
              f.inner.innerHTML = "";
              f.rendered = false;
            }
            continue;
          }
          for (const g of [folds[idx - 1], f, folds[idx + 1]]) if (g) void renderFold(g);
        }
      },
      { root: scrollArea, rootMargin: "300px" },
    );
    for (const f of folds) observer.observe(f.wrapper);
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
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({
        scale: capRenderScale(fold.scale * dpr, page.getViewport({ scale: 1 })),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.className = "pdf-page-canvas";
      canvas.style.width = `${fold.cssW}px`;
      canvas.style.height = `${fold.pageCssH}px`;
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      if (!enabled || env.isDestroyed() || !fold.wrapper.isConnected) return;
      // Every annotation on the page, not only the filtered ones, so a
      // revealed page reads exactly like the normal view.
      const ctx = canvas.getContext("2d");
      if (ctx) drawAnnotations(ctx, viewport, env.getAnnotations(), fold.pageIndex);
      fold.inner.innerHTML = "";
      fold.inner.appendChild(canvas);
      fold.rendered = true;
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
    destroy: disable,
  };
}
