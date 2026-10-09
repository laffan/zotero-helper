// The PDF viewer beside the notes — a port of Hush's
// src/pdf/pdf-viewer.js, built as plain DOM under one root element and
// driven from React by ReaderPane.
//
// Layout modes: horizontal scroll (pages fit to height, the default),
// vertical scroll (fit one, two or three pages across), fixed zoom
// (wrapping rows), and the folded view. A relayout only resizes page
// wrappers and CSS-stretches existing rasters; the renderer's settle
// pass re-renders crisp once the geometry stops moving.
//
// Left out from Hush: pane suspend/resume (there is one viewer here, not
// a desk of panes), Hush's bookmarks (see pageTools.ts for what took
// their place) and Extract Annotations (pdf.js already paints a file's
// own annotations into the page).
import type { Annotation } from "../lib/highlights";
import { PDFJS_ASSETS } from "../lib/pdfjsAssets";
import { annotationAtPoint, draftFromRange, type AnnotationDraft } from "./annotate";
import { createAnnotationLayer } from "./annotations";
import { createAnnotationPopover } from "./annotPopover";
import { createFoldLayer } from "./folds";
import { createLinkLayerManager } from "./links";
import { attachPageHoverButtons, attachTextLayer } from "./pageTools";
import { drawAnnotations, pageSignatures } from "./paint";
import { getPdfjs } from "./pdfjs";
import { createPageRenderer } from "./render";
import { createPdfSearch } from "./search";
import { createSelectionBar, type MarkType } from "./selectionBar";
import { createThumbnailManager } from "./thumbnails";
import { buildPdfToolbar } from "./toolbar";
import type { LayoutMode, PageRecord, PDFDocumentProxy } from "./types";

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
type FitMode = "fit" | "fit-2" | "fit-3";

// The layout last chosen, so the next PDF opens the same way. Without
// one, a portrait viewer (an iPad upright) starts in vertical fit: the
// horizontal default fits pages to the height, which crops them there.
const VIEW_KEY = "zh-pdf-view";
interface ViewPrefs {
  layoutMode: LayoutMode;
  fitMode: FitMode;
  fixedZoom: number;
}
function loadViewPrefs(): ViewPrefs | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    return v && typeof v.layoutMode === "string" ? (v as ViewPrefs) : null;
  } catch {
    return null;
  }
}
function saveViewPrefs(v: ViewPrefs): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export interface PdfViewerOptions {
  /** Open the PDF in Zotero at a page (toolbar link, page pop-out). */
  onOpenInZotero?: (page: number) => void;
  /** Cite a page in the notes (page hover button). */
  onCitePage?: (page: number) => void;
  /** Quote selected text into the notes. */
  onQuote?: (text: string, page: number) => void;
  /** Send a shelf annotation to the notes. */
  onInsertAnnotation?: (a: Annotation) => void;
  /** Make, change and delete annotations; absent, they are read-only. */
  annotate?: AnnotationWriter;
}

export interface AnnotationWriter {
  create: (draft: AnnotationDraft, type: MarkType, color: string) => void;
  update: (key: string, patch: { color?: string; comment?: string }) => void;
  remove: (key: string) => void;
  canEdit: (a: Annotation) => boolean;
}

export function createPdfViewer(container: HTMLElement, opts: PdfViewerOptions = {}) {
  const prefs = loadViewPrefs();
  let pdfDoc: PDFDocumentProxy | null = null;
  let pages: PageRecord[] = [];
  let layoutMode: LayoutMode =
    prefs?.layoutMode ?? (container.clientHeight > container.clientWidth ? "vertical" : "horizontal");
  let fitMode: FitMode = prefs?.fitMode ?? "fit";
  let folded = false;
  let foldedZoom = 1.0; // multiplier on the folded fit-width scale
  let fixedZoom = prefs?.fixedZoom ?? 1.0;
  let destroyed = false;
  // The PDF's own page labels ("iv", "212"), which Zotero records on an
  // annotation; null when the file has none.
  let pageLabels: string[] | null = null;

  const root = document.createElement("div");
  root.className = "pdf-viewer";
  const body = document.createElement("div");
  body.className = "pdf-viewer-body";
  const scrollArea = document.createElement("div");
  scrollArea.className = "pdf-scroll-area pdf-layout-horizontal";
  // Focusable, so ← / → page through it once it has been clicked.
  scrollArea.tabIndex = 0;
  body.appendChild(scrollArea);

  const annotLayer = createAnnotationLayer(scrollArea, body, {
    getPages: () => pages,
    getEffectiveZoom: () => getEffectiveZoom(),
    getLayoutMode: () => layoutMode,
    goToPage: (n) => goToPage(n),
    scrollToFold: (a) => (folded ? foldLayer.scrollToAnnotation(a) : false),
    onInsert: opts.onInsertAnnotation,
    canEdit: opts.annotate?.canEdit,
    onEdit: (a, row) => popover?.open(a, row.getBoundingClientRect(), "left"),
  });
  const foldLayer = createFoldLayer(scrollArea, {
    getPages: () => pages,
    getPdfDoc: () => pdfDoc,
    getAnnotations: () => annotLayer.getAnnotations(),
    getEffectiveZoom: () => getEffectiveZoom(),
    isDestroyed: () => destroyed,
  });
  const linkMgr = createLinkLayerManager({
    getPdfDoc: () => pdfDoc,
    getPages: () => pages,
    goToPage: (n) => goToPage(n),
    isDestroyed: () => destroyed,
  });
  const renderer = createPageRenderer(scrollArea, {
    getPages: () => pages,
    getPdfDoc: () => pdfDoc,
    getEffectiveZoom: () => getEffectiveZoom(),
    getLayoutMode: () => layoutMode,
    isFolded: () => folded,
    isDestroyed: () => destroyed,
    paintPage: (idx, ctx, viewport) => drawAnnotations(ctx, viewport, annotLayer.getAnnotations(), idx),
    onPageRendered: (idx, page) => {
      void linkMgr.attach(idx, page);
      if (opts.onQuote || opts.annotate) void attachTextLayer(pages[idx], page);
    },
    onUpdate: () => updatePageIndicator(),
  });
  root.appendChild(body);

  const tb = buildPdfToolbar();
  root.appendChild(tb.toolbar);
  container.appendChild(root);
  foldLayer.attachFilterUI(tb.foldFilterBtn, root);
  const writer = opts.annotate;
  const selection =
    opts.onQuote || writer
      ? createSelectionBar(scrollArea, root, {
          onQuote: opts.onQuote,
          onAnnotate: writer
            ? (range, type, color) => {
                const draft = draftFromRange(range, pages, pageLabels);
                if (!draft) return;
                foldLayer.include(type, color);
                writer.create(draft, type, color);
              }
            : undefined,
        })
      : null;
  const popover = writer
    ? createAnnotationPopover(root, {
        update: (key, patch) => {
          const a = annotLayer.getAnnotations().find((x) => x.key === key);
          if (a && patch.color) foldLayer.include(a.type, patch.color);
          writer.update(key, patch);
        },
        remove: writer.remove,
        onInsert: opts.onInsertAnnotation,
      })
    : null;

  // A tap on one of this app's highlights or underlines opens its
  // editor — unless it ends a text selection or lands on a link.
  scrollArea.addEventListener("click", (e) => {
    if (!popover || !writer || folded) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const target = e.target as Element;
    if (target.closest("a, button")) return;
    const wrapper = target.closest<HTMLElement>(".pdf-page-wrapper");
    const idx = Number(wrapper?.dataset.pageIndex ?? NaN);
    const p = pages[idx];
    if (!wrapper || !p) return;
    const wr = wrapper.getBoundingClientRect();
    const fx = (e.clientX - wr.left) / wr.width;
    const fy = (e.clientY - wr.top) / wr.height;
    const a = annotationAtPoint(p, idx, fx, fy, annotLayer.getAnnotations());
    if (a && writer.canEdit(a)) popover.open(a, new DOMRect(e.clientX, e.clientY - 10, 0, 20));
  });

  if (opts.onOpenInZotero) {
    tb.zoteroLink.style.display = "";
    tb.zoteroLink.href = "#";
    tb.zoteroLink.addEventListener("click", (e) => {
      e.preventDefault();
      opts.onOpenInZotero?.(currentPage());
    });
  }

  const thumbs = createThumbnailManager(body, {
    getPages: () => pages,
    getPdfDoc: () => pdfDoc,
    isDestroyed: () => destroyed,
    getAnnotations: () => annotLayer.getAnnotations(),
    goToPage: (n) => goToPage(n),
    onHide: () => tb.thumbnailBtn.classList.remove("active"),
  });
  const search = createPdfSearch({
    getPdfDoc: () => pdfDoc,
    getPages: () => pages,
    isDestroyed: () => destroyed,
    reveal: (idx, x, y) => {
      exitFolded();
      const w = pages[idx]?.wrapper;
      if (!w) return;
      const wr = w.getBoundingClientRect();
      const ar = scrollArea.getBoundingClientRect();
      const left = scrollArea.scrollLeft + wr.left - ar.left + x * wr.width - scrollArea.clientWidth / 2;
      const top = scrollArea.scrollTop + wr.top - ar.top + y * wr.height - scrollArea.clientHeight / 3;
      scrollArea.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: "smooth" });
    },
  });

  tb.thumbnailBtn.addEventListener("click", () => {
    tb.thumbnailBtn.classList.toggle("active", thumbs.toggle());
  });

  // --- zoom & modes ---------------------------------------------------------
  // While folded, a zoom step scales the folds in place via a multiplier
  // on the folded fit-width scale rather than leaving the folded view.
  function stepZoom(dir: 1 | -1): void {
    const cur = folded ? foldedZoom : getEffectiveZoom();
    const next =
      dir > 0
        ? ZOOM_LEVELS.find((z) => z > cur + 0.01)
        : [...ZOOM_LEVELS].reverse().find((z) => z < cur - 0.01);
    if (next == null) return;
    if (folded) {
      foldedZoom = next;
      foldLayer.refresh();
      updateToolbarState();
    } else applyFixedZoom(next);
  }
  tb.zoomOutBtn.addEventListener("click", () => stepZoom(-1));
  tb.zoomInBtn.addEventListener("click", () => stepZoom(1));
  tb.scrollHBtn.addEventListener("click", () => {
    if (layoutMode === "horizontal") return;
    fitMode = "fit";
    switchLayout("horizontal");
  });
  tb.scrollVBtn.addEventListener("click", () => {
    if (layoutMode === "vertical" && !folded) return;
    switchLayout("vertical");
  });
  const fitBtn = (b: HTMLElement, mode: FitMode) =>
    b.addEventListener("click", () => {
      if (!folded && fitMode === mode && layoutMode === "vertical") return;
      fitMode = mode;
      exitFolded(true);
      if (layoutMode === "fixed") layoutMode = "vertical";
      applyLayoutClass();
      updateToolbarState();
      relayoutPages();
    });
  fitBtn(tb.fitOneBtn, "fit");
  fitBtn(tb.fitTwoBtn, "fit-2");
  fitBtn(tb.fitThreeBtn, "fit-3");

  function enterFolded(): void {
    if (folded) return;
    folded = true;
    foldedZoom = 1.0;
    layoutMode = "vertical";
    fitMode = "fit";
    applyLayoutClass();
    foldLayer.enable();
    updateToolbarState();
    updatePageIndicator();
  }

  function exitFolded(skipRelayout = false): void {
    if (!folded) return;
    folded = false;
    foldLayer.disable();
    applyLayoutClass();
    updateToolbarState();
    if (!skipRelayout) relayoutPages();
    updatePageIndicator();
  }
  tb.foldBtn.addEventListener("click", () => (folded ? exitFolded() : enterFolded()));

  // ⌘+ / ⌘- / ⌘0 while the viewer is mounted. A handler that already
  // spent the keystroke (defaultPrevented) wins.
  function onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      stepZoom(1);
    } else if (e.key === "-") {
      e.preventDefault();
      stepZoom(-1);
    } else if (e.key === "0") {
      e.preventDefault();
      exitFolded(true);
      fitMode = "fit";
      switchLayout("horizontal");
    }
  }
  window.addEventListener("keydown", onKeydown);

  // ← / → while the pages have focus: the previous or next page. Quick
  // presses count from the page last asked for, not the one the smooth
  // scroll has reached so far.
  let pageTarget: { page: number; at: number } | null = null;
  scrollArea.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (!pages.length) return;
    e.preventDefault();
    const recent = pageTarget && performance.now() - pageTarget.at < 700;
    const from = recent ? pageTarget!.page : currentPage();
    const page = Math.max(1, Math.min(pages.length, from + (e.key === "ArrowRight" ? 1 : -1)));
    pageTarget = { page, at: performance.now() };
    goToPage(page);
  });

  function getEffectiveZoom(): number {
    const first = pages[0];
    if (!first || !pdfDoc) return 1;
    const pad = 40;
    const gap = 12;
    if (layoutMode === "vertical") {
      const availW = scrollArea.clientWidth - pad;
      if (folded) return (availW / first.viewport.width) * foldedZoom;
      if (fitMode === "fit-2") return (availW - gap - 4) / (first.viewport.width * 2);
      if (fitMode === "fit-3") return (availW - gap * 2 - 4) / (first.viewport.width * 3);
      return availW / first.viewport.width;
    }
    if (layoutMode === "horizontal") {
      return (scrollArea.clientHeight - pad) / first.viewport.height;
    }
    return fixedZoom;
  }

  function updateToolbarState(): void {
    const isVert = layoutMode === "vertical";
    if (folded) {
      tb.zoomLabel.textContent =
        Math.abs(foldedZoom - 1) < 0.01 ? "Folded" : `Folded ${Math.round(foldedZoom * 100)}%`;
    } else if (layoutMode !== "fixed") {
      const labels: Record<FitMode, string> = { fit: "Fit", "fit-2": "Fit 2", "fit-3": "Fit 3" };
      tb.zoomLabel.textContent = isVert ? labels[fitMode] : "Fit";
    } else {
      tb.zoomLabel.textContent = `${Math.round(getEffectiveZoom() * 100)}%`;
    }
    tb.scrollHBtn.classList.toggle("active", layoutMode === "horizontal");
    tb.scrollVBtn.classList.toggle("active", isVert);
    tb.fitToggleWrap.style.display = isVert ? "" : "none";
    tb.fitOneBtn.classList.toggle("active", fitMode === "fit" && !folded);
    tb.fitTwoBtn.classList.toggle("active", fitMode === "fit-2");
    tb.fitThreeBtn.classList.toggle("active", fitMode === "fit-3");
    tb.foldBtn.classList.toggle("active", folded);
    tb.foldFilterBtn.style.display = folded ? "" : "none";
    if (!folded && pdfDoc) saveViewPrefs({ layoutMode, fitMode, fixedZoom });
  }

  function currentPage(): number {
    if (!pages.length) return 1;
    return folded ? foldLayer.getCurrentPage() : renderer.pageAtViewCenter();
  }

  function updatePageIndicator(): void {
    tb.pageIndicator.textContent = pages.length ? `${currentPage()} / ${pages.length}` : "";
  }

  scrollArea.addEventListener("scroll", () => {
    // The render-set update is rAF-coalesced and refreshes the page
    // indicator itself; folded mode short-circuits the renderer.
    if (folded) updatePageIndicator();
    else renderer.scheduleUpdate();
    // The editor is placed beside what it edits; once that has moved
    // away, close it (but not while its comment is being typed).
    if (popover?.isOpen() && !root.querySelector(".pdf-annot-popover textarea:focus")) popover.close();
  });

  function switchLayout(mode: "horizontal" | "vertical"): void {
    exitFolded(true);
    layoutMode = mode;
    applyLayoutClass();
    updateToolbarState();
    relayoutPages();
  }

  function applyFixedZoom(level: number): void {
    exitFolded(true);
    fixedZoom = level;
    layoutMode = "fixed";
    applyLayoutClass();
    updateToolbarState();
    relayoutPages();
  }

  function applyLayoutClass(): void {
    scrollArea.classList.remove("pdf-layout-fit", "pdf-layout-fixed", "pdf-layout-horizontal", "pdf-layout-folded");
    if (folded) scrollArea.classList.add("pdf-layout-folded");
    else if (layoutMode === "vertical") {
      scrollArea.classList.add(fitMode === "fit" ? "pdf-layout-fit" : "pdf-layout-fixed");
    } else if (layoutMode === "horizontal") scrollArea.classList.add("pdf-layout-horizontal");
    else scrollArea.classList.add("pdf-layout-fixed");
  }

  // Geometry only — rasterising lives in render.ts. A relayout resizes
  // every wrapper and stretches the existing content box; the settle
  // pass re-renders crisp once things are still.
  let relayoutGuard = false;
  function relayoutPages(): void {
    if (relayoutGuard || !pdfDoc || !pages.length) return;
    if (folded) {
      foldLayer.refresh();
      return;
    }
    relayoutGuard = true;
    try {
      const scale = getEffectiveZoom();
      for (const p of pages) {
        const cssW = Math.round(p.viewport.width * scale);
        p.wrapper.style.width = `${cssW}px`;
        p.wrapper.style.height = `${Math.round(p.viewport.height * scale)}px`;
        if (p.contentEl && p.contentW) {
          const k = cssW / p.contentW;
          p.contentEl.style.transform = Math.abs(k - 1) > 0.001 ? `scale(${k})` : "";
        }
      }
      renderer.invalidateGeometry();
      renderer.scheduleUpdate();
      renderer.scheduleSettle();
    } finally {
      relayoutGuard = false;
    }
  }

  async function loadPdf(data: ArrayBuffer | Uint8Array): Promise<void> {
    const pdfjs = await getPdfjs();
    if (destroyed) return;
    if (pdfDoc) await pdfDoc.loadingTask.destroy();
    pdfDoc = null;
    renderer.reset();
    pages = [];
    scrollArea.innerHTML = "";

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const doc = await pdfjs.getDocument({ data: bytes, ...PDFJS_ASSETS }).promise;
    if (destroyed) {
      await doc.loadingTask.destroy();
      return;
    }
    pdfDoc = doc;
    pageLabels = await doc.getPageLabels().catch(() => null);
    if (destroyed) return;
    applyLayoutClass();

    // Only page 1's size is fetched up front; the other wrappers adopt
    // their real size on first render, so opening a book isn't a serial
    // walk over every page.
    const first = await doc.getPage(1);
    if (destroyed) return;
    const defaultViewport = first.getViewport({ scale: 1 });
    for (let i = 0; i < doc.numPages; i++) {
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page-wrapper";
      wrapper.dataset.pageIndex = String(i);
      const placeholder = document.createElement("div");
      placeholder.className = "pdf-page-placeholder";
      wrapper.appendChild(placeholder);
      attachPageHoverButtons(wrapper, i + 1, {
        onOpenInZotero: opts.onOpenInZotero,
        onCitePage: opts.onCitePage,
      });
      scrollArea.appendChild(wrapper);
      pages.push({
        wrapper,
        viewport: defaultViewport,
        realViewport: i === 0,
        rendered: false,
        rendering: false,
        canvas: null,
        renderedZoom: null,
        contentEl: null,
        contentW: 0,
        contentH: 0,
      });
    }
    const scale = getEffectiveZoom();
    for (const p of pages) {
      p.wrapper.style.width = `${Math.round(p.viewport.width * scale)}px`;
      p.wrapper.style.height = `${Math.round(p.viewport.height * scale)}px`;
    }
    renderer.update();
    if (folded) foldLayer.enable();
    updateToolbarState();
    updatePageIndicator();
    // Ready for ← / →, unless the reader is already typing somewhere
    // (the search field, the notes).
    const focused = document.activeElement;
    if (!focused || focused === document.body) scrollArea.focus({ preventScroll: true });
    search.rerun();
  }

  function goToPage(n: number): void {
    if (folded) {
      foldLayer.goToPage(n);
      return;
    }
    const w = pages[Math.max(0, Math.min(n - 1, pages.length - 1))]?.wrapper;
    if (!w) return;
    if (layoutMode === "horizontal") w.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    else w.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  let resizeTimer: number | null = null;
  const resizeObserver = new ResizeObserver(() => {
    if (!pages.length) return;
    // A container resize can re-wrap rows, so cached geometry is stale
    // either way; fit-mode geometry follows behind a short debounce.
    renderer.invalidateGeometry();
    renderer.scheduleUpdate();
    if (layoutMode === "fixed") return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      relayoutPages();
    }, 80);
  });
  resizeObserver.observe(scrollArea);

  async function destroy(): Promise<void> {
    destroyed = true;
    search.onChange(null);
    resizeObserver.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    window.removeEventListener("keydown", onKeydown);
    foldLayer.destroy();
    thumbs.destroy();
    renderer.destroy();
    selection?.destroy();
    popover?.destroy();
    const doc = pdfDoc;
    pdfDoc = null;
    pages = [];
    root.remove();
    if (doc) await doc.loadingTask.destroy().catch(() => {});
  }

  return {
    loadPdf,
    destroy,
    goToPage,
    getPageCount: () => pdfDoc?.numPages ?? 0,
    /** Replace the annotations. Only pages whose annotations changed are
     *  repainted, so a sync that touched nothing here costs nothing. */
    setAnnotations: (list: Annotation[]) => {
      const before = pageSignatures(annotLayer.getAnnotations());
      const after = pageSignatures(list);
      annotLayer.setAnnotations(list);
      popover?.sync(list);
      const changed = new Set<number>();
      for (const [i, sig] of after) if (before.get(i) !== sig) changed.add(i);
      for (const i of before.keys()) if (!after.has(i)) changed.add(i);
      if (changed.size) {
        renderer.repaint(changed);
        foldLayer.onAnnotationsChanged();
      }
    },
    /** The page in view, 1-based. */
    currentPage: () => currentPage(),
    /** Scroll to an annotation by key; false when it isn't in this PDF. */
    showAnnotation: (key: string): boolean => {
      const a = annotLayer.getAnnotations().find((x) => x.key === key);
      if (!a) return false;
      annotLayer.scrollToAnnotation(a);
      return true;
    },
    toggleShelf: annotLayer.toggleShelf,
    /** Find in the document (the toolbar's search box while reading). */
    search: search.search,
    searchStep: search.step,
    searchGoTo: search.goTo,
    onSearchChange: search.onChange,
  };
}

export type PdfViewer = ReturnType<typeof createPdfViewer>;
