// The PDF viewer beside the notes — a port of Hush's
// src/pdf/pdf-viewer.js, built as plain DOM under one root element and
// driven from React by ReaderPane.
//
// Layout modes: horizontal scroll (pages fit to height, the default),
// vertical scroll (fit one, two or three pages across), fixed zoom
// (wrapping rows), and the folded view. Either scroll direction can
// also be "fixed": a set of one to three pages at a time, swiped
// through set by set (paged.ts). Outside the folded view, the pages'
// edges are trimmed if the reader has trimmed them (crop.ts). A
// relayout only resizes page wrappers and CSS-stretches existing
// rasters; the renderer's settle pass re-renders crisp once the
// geometry stops moving.
//
// Left out from Hush: pane suspend/resume (there is one viewer here, not
// a desk of panes), Hush's bookmarks (see pageTools.ts for what took
// their place), Extract Annotations (pdf.js already paints a file's
// own annotations into the page) and the annotation shelf (the
// Highlights tab beside the viewer lists the same annotations).
import type { Annotation } from "../lib/highlights";
import { PDFJS_ASSETS } from "../lib/pdfjsAssets";
import {
  centerPagePoint, pageFracAtCenter, restoreAnchor, scrollToPageFraction, scrollToPagePoint, viewAnchor, watchResize,
} from "./anchor";
import { createAnnotating } from "./annotating";
import { createAnnotationLayer } from "./annotations";
import { createBookmarkPrompt, markBookmarkedPages, type PageBookmark } from "./bookmarks";
import { createCiteMark } from "./citeMark";
import type { ExplainMark } from "./explainMarks";
import { createViewerCommands } from "./commands";
import { createReadingCrop } from "./crop";
import { createFoldLayer } from "./folds";
import { createInkTool } from "./ink";
import { attachViewerKeys } from "./keys";
import { applyLayoutClasses, fitZoom, sizePage, sizePagedGap } from "./layout";
import { createLinkLayerManager } from "./links";
import { createMagnifier, PLAIN } from "./magnify";
import { readOutline, type OutlineEntry } from "./outline";
import { attachTextLayer, createPageRecords } from "./pageTools";
import { sampleTypicalPage } from "./pageSizes";
import { changedPages, drawAnnotations } from "./paint";
import { attachPagedWheel } from "./paged";
import { getPdfjs } from "./pdfjs";
import { placeAtPoint, placeInView } from "./places";
import { createReadingProgress } from "./readingProgress";
import { createPageRenderer } from "./render";
import { createPdfSearch } from "./search";
import { createThumbnailManager } from "./thumbnails";
import { buildPdfToolbar, syncToolbar } from "./toolbar";
import { attachTooltips } from "./tooltips";
import type { LayoutMode, PageRecord, PageViewport, PDFDocumentProxy } from "./types";
import { loadViewPrefs, saveViewPrefs, type FitMode } from "./viewPrefs";
import type { PdfViewerOptions } from "./viewerOptions";
import { createViewReporter, initialLayout, type FoldAnchor, type SavedView } from "./viewState";

export type { AnnotationWriter, PdfViewerOptions } from "./viewerOptions";

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export function createPdfViewer(container: HTMLElement, opts: PdfViewerOptions = {}) {
  const saved = opts.initialView ?? null;
  const start = initialLayout(saved, loadViewPrefs(), container.clientHeight > container.clientWidth);
  let pdfDoc: PDFDocumentProxy | null = null;
  let pages: PageRecord[] = [];
  let layoutMode: LayoutMode = start.layoutMode;
  let fitMode: FitMode = start.fitMode;
  let folded = start.folded;
  let foldedZoom = start.foldedZoom; // multiplier on the folded fit-width scale
  let fixedZoom = start.fixedZoom;
  // Fixed sets of pages — in either scroll direction, not while folded
  // or at a fixed zoom.
  let paged = start.paged;
  // A folded place to return to, once the folds are built (they wait
  // for the annotations, which arrive after the pages).
  let pendingFoldAt: FoldAnchor | null = (folded && saved?.foldAt) || null;
  const isPaged = () => paged && !folded && layoutMode !== "fixed";
  /** Pages to a set in the fixed view: the fit buttons' one, two, three. */
  const perSet = () => (fitMode === "fit-3" ? 3 : fitMode === "fit-2" ? 2 : 1);
  /** The page in view — in the fixed view, its set's first page. */
  const leadPage = () => {
    const page = currentPage();
    return isPaged() ? page - ((page - 1) % perSet()) : page;
  };
  let destroyed = false;
  // The PDF's own page labels ("iv", "212"), which Zotero records on an
  // annotation; null when the file has none.
  let pageLabels: string[] | null = null;
  // The document's typical page, which the layout fits (pageSizes.ts).
  let typical: PageViewport | null = null;

  const root = document.createElement("div");
  root.className = "pdf-viewer";
  const body = document.createElement("div");
  body.className = "pdf-viewer-body";
  const scrollArea = document.createElement("div");
  scrollArea.className = "pdf-scroll-area pdf-layout-horizontal";
  // Focusable, so ← / → page through it once it has been clicked.
  scrollArea.tabIndex = 0;
  body.appendChild(scrollArea);
  // A pinch magnifies the pages without touching the layout; any
  // relayout ends it (applyLayoutClass, relayoutPages).
  const magnifier = createMagnifier({
    area: scrollArea,
    host: body,
    canScroll: () => !isPaged(),
    onSettle: () => renderer.refreshResolution(),
    yields: () => ink.isDrawing(),
  });

  const annotLayer = createAnnotationLayer(scrollArea, {
    getPages: () => pages,
    getEffectiveZoom: () => getEffectiveZoom(),
    getLayoutMode: () => layoutMode,
    goToPage: (n) => goToPage(n),
    scrollToFold: (a) => (folded ? foldLayer.scrollToAnnotation(a) : false),
    isPaged,
  });
  const foldLayer = createFoldLayer(scrollArea, {
    getPages: () => pages,
    getPdfDoc: () => pdfDoc,
    getAnnotations: () => annotLayer.getAnnotations(),
    getEffectiveZoom: () => getEffectiveZoom(),
    getTypical: () => typical,
    isDestroyed: () => destroyed,
    selectable: Boolean(opts.onQuote || opts.annotate),
    onFilterChange: () => viewReporter.changed(),
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
    getTypical: () => typical,
    resolutionFor: (idx) => (pages[idx] ? magnifier.resolutionFor(pages[idx].wrapper) : PLAIN),
    holdRenders: () => ink.isDrawing(),
    sizePage: (p, scale) => sizePage(p, scale, layoutState().crop),
    getLayoutMode: () => layoutMode,
    isFolded: () => folded,
    isDestroyed: () => destroyed,
    // Ink is drawn over the pages (ink/layer.ts), not into them.
    paintPage: (idx, ctx, viewport) => drawAnnotations(ctx, viewport, annotLayer.getAnnotations(), idx, false),
    onPageRendered: (idx, page) => {
      void linkMgr.attach(idx, page);
      ink.pageRendered(idx);
      annotating.pageRendered(idx);
      if (opts.onQuote || opts.annotate) void attachTextLayer(pages[idx], page);
    },
    onUpdate: () => updatePageIndicator(),
  });
  root.appendChild(body);

  const tb = buildPdfToolbar();
  root.appendChild(tb.toolbar);
  container.appendChild(root);
  // Ink mode draws on whole pages, so it leaves the folded view.
  const ink = createInkTool({
    body,
    scrollArea,
    button: tb.inkBtn,
    getPages: () => pages,
    getPageLabels: () => pageLabels,
    writer: opts.annotate,
    onStart: () => exitFolded(),
    onPenDown: () => renderer.yieldToPen(),
    onActiveChange: (on) => opts.onInkMode?.(on),
  });
  const detachTooltips = attachTooltips(tb.toolbar, root);
  foldLayer.attachFilterUI(tb.foldFilterBtn, root);
  if (saved?.foldFilter) foldLayer.setFilter(saved.foldFilter);

  // This PDF's view, for opening it the same way next time. Not while
  // a folded place is still waiting to be restored.
  const viewReporter = createViewReporter(
    () => {
      if (!reportPages || !pages.length || pendingFoldAt) return null;
      const v: SavedView = { layoutMode, fitMode, fixedZoom, paged, folded, foldedZoom, crop: cropper.get() };
      v.foldFilter = foldLayer.getFilter();
      if (folded) v.foldAt = foldLayer.viewAnchor() ?? undefined;
      else v.at = viewAnchor(scrollArea, pages, layoutMode === "horizontal") ?? undefined;
      return v;
    },
    (v) => opts.onViewChange?.(currentPage(), v),
  );
  let pageMarks: PageBookmark[] = [];
  const bookmarkPrompt = createBookmarkPrompt(root, {
    // The page's top in PDF space (its viewport may be scaled).
    create: (idx, name) => opts.onBookmark?.(idx, pages[idx]?.viewport.viewBox[3] ?? 0, name, pageLabels?.[idx]),
    rename: (id, name) => opts.onRenameBookmark?.(id, name),
    remove: (id) => opts.onRemoveBookmark?.(id),
  });
  // The reading crop: adjusting it shows the pages whole, ending the
  // adjustment lays them out trimmed — at the same place.
  const cropper = createReadingCrop({
    scrollArea,
    host: body,
    getPages: () => pages,
    // Every view but the folded one, which trims pages its own way.
    active: () => !folded,
    initial: saved?.crop ?? null,
    onChange: () => {
      // The relayout keeps the place; the fixed view also re-snaps.
      const page = leadPage();
      applyLayoutClass();
      relayoutPages();
      if (isPaged()) goToPage(page, false);
      viewReporter.changed();
    },
  });
  function restorePendingFold(): void {
    if (pendingFoldAt && folded && foldLayer.restoreAnchor(pendingFoldAt)) pendingFoldAt = null;
  }
  const annotating = createAnnotating({
    scrollArea,
    root,
    opts,
    getPages: () => pages,
    getPageLabels: () => pageLabels,
    getAnnotations: () => annotLayer.getAnnotations(),
    isFolded: () => folded,
    inExpanded: (node) => foldLayer.inExpanded(node),
    include: (type, color) => foldLayer.include(type, color),
    sentenceButton: tb.sentenceBtn,
  });

  if (opts.onReadingMode) tb.readingBtn.style.display = "";
  tb.readingBtn.addEventListener("click", () => opts.onReadingMode?.());
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
  // Reading mode's page indicator and its page picker.
  let outline: OutlineEntry[] = [];
  const progress = createReadingProgress(root, {
    openPicker: (side) => thumbs.showPicker(currentPage(), side),
    getOutline: () => outline,
    currentPage: () => currentPage(),
    goToEntry: (e) => {
      thumbs.close();
      if (e.pageIndex != null) goToPosition(e.pageIndex, e.top);
    },
  });
  // A search hit or a cited passage: page index, then a point on it (0–1).
  function revealPoint(idx: number, x: number, y: number): void {
    exitFolded();
    magnifier.reset();
    if (isPaged()) return goToPage(idx + 1);
    const w = pages[idx]?.wrapper;
    if (w) scrollToPageFraction(scrollArea, w, x, y);
  }
  const search = createPdfSearch({ getPdfDoc: () => pdfDoc, getPages: () => pages, isDestroyed: () => destroyed, reveal: revealPoint });
  const citeMark = createCiteMark({ getPdfDoc: () => pdfDoc, getPages: () => pages, reveal: revealPoint, goToPage: (n) => goToPage(n) });

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
    // Side by side, continuous pages fit the height; fixed sets keep
    // their size.
    if (!paged) fitMode = "fit";
    switchLayout("horizontal");
  });
  tb.scrollVBtn.addEventListener("click", () => {
    if (layoutMode === "vertical" && !folded) return;
    switchLayout("vertical");
  });
  const fitBtn = (b: HTMLElement, mode: FitMode) =>
    b.addEventListener("click", () => {
      if (!folded && fitMode === mode && (layoutMode === "vertical" || isPaged())) return;
      const page = leadPage();
      fitMode = mode;
      exitFolded(true);
      if (layoutMode === "fixed") layoutMode = "vertical";
      applyLayoutClass();
      updateToolbarState();
      relayoutPages();
      if (isPaged()) goToPage(page, false);
    });
  fitBtn(tb.fitOneBtn, "fit");
  fitBtn(tb.fitTwoBtn, "fit-2");
  fitBtn(tb.fitThreeBtn, "fit-3");

  function enterFolded(): void {
    if (folded) return;
    ink.setActive(false);
    // The place at the centre of the view, to centre the folds on.
    const at = pages.length ? currentPage() - 1 : -1;
    const place = pages[at] ? { pageIndex: at, frac: pageFracAtCenter(scrollArea, pages[at]) } : null;
    folded = true;
    foldedZoom = 1.0;
    layoutMode = "vertical";
    fitMode = "fit";
    // The pages are hidden while folded; their rasters (up to the
    // renderer's whole budget) would sit beside the folds' all along.
    renderer.clearAll();
    applyLayoutClass();
    foldLayer.enable();
    if (place) foldLayer.centerOn(place);
    updateToolbarState();
    updatePageIndicator();
  }

  function exitFolded(skipRelayout = false): void {
    if (!folded) return;
    // The place at the centre of the view (on the open page, if that is
    // what is in view) stays there — unless the caller places the view
    // itself, after its own relayout.
    const place = skipRelayout ? null : foldLayer.centerPlace();
    folded = false;
    foldLayer.disable();
    applyLayoutClass();
    updateToolbarState();
    if (!skipRelayout) relayoutPages();
    if (place && pages[place.pageIndex]) {
      if (isPaged()) goToPage(place.pageIndex + 1, false);
      else centerPagePoint(scrollArea, pages[place.pageIndex], place.frac, layoutMode === "horizontal");
    }
    updatePageIndicator();
  }
  tb.foldBtn.addEventListener("click", () => (folded ? exitFolded() : enterFolded()));

  // Fixed sets or continuous; either leaves the folded view. A fixed
  // zoom has no direction to swipe in, so Fixed goes to vertical fit.
  function setPageMode(on: boolean): void {
    if (!folded && on === isPaged()) return;
    const page = leadPage();
    paged = on;
    exitFolded(true);
    if (layoutMode === "fixed") layoutMode = "vertical";
    applyLayoutClass();
    updateToolbarState();
    relayoutPages();
    goToPage(page, false);
  }
  tb.fixedBtn.addEventListener("click", () => setPageMode(true));
  tb.continuousBtn.addEventListener("click", () => setPageMode(false));

  const keys = attachViewerKeys({
    stepZoom,
    resetZoom: () => {
      exitFolded(true);
      fitMode = "fit";
      switchLayout("horizontal");
    },
    pageCount: () => pages.length,
    stepSize: () => (isPaged() ? perSet() : 1),
    currentPage: () => currentPage(),
    goToPage: (n) => goToPage(n),
  });
  attachPagedWheel(scrollArea, isPaged, keys.stepPage);
  const command = createViewerCommands({ tb, scrollArea, isFolded: () => folded, stepPage: keys.stepPage });

  /** The modes, as layout.ts reads them. */
  const layoutState = () => ({
    layoutMode, fitMode, folded, paged: isPaged(), perSet: perSet(), foldedZoom, fixedZoom,
    crop: cropper.effective(),
  });
  function getEffectiveZoom(): number {
    return typical && pages.length && pdfDoc ? fitZoom(scrollArea, typical, layoutState()) : 1;
  }

  function updateToolbarState(): void {
    syncToolbar(tb, { layoutMode, fitMode, folded, paged: isPaged(), foldedZoom, zoom: getEffectiveZoom });
    if (!folded && pdfDoc) saveViewPrefs({ layoutMode, fitMode, fixedZoom, paged });
    viewReporter.changed();
  }

  function currentPage(): number {
    if (!pages.length) return 1;
    return folded ? foldLayer.getCurrentPage() : renderer.pageAtViewCenter();
  }

  let reportPages = false;
  let reportedPage = 0;
  // The set the paged view last showed — kept from before a resize
  // moves the snapping (watchResize, anchor.ts).
  let shownLead = 1;
  function updatePageIndicator(): void {
    // A fixed set of several pages shows as its range ("7–9 / 13").
    const lead = leadPage();
    shownLead = lead;
    const last = isPaged() ? Math.min(pages.length, lead + perSet() - 1) : lead;
    const shown = last > lead ? `${lead}–${last}` : String(currentPage());
    tb.pageIndicator.textContent = pages.length ? `${shown} / ${pages.length}` : "";
    progress.set(tb.pageIndicator.textContent);
    if (!reportPages || !pages.length) return;
    viewReporter.changed();
    const page = currentPage();
    if (page !== reportedPage) {
      reportedPage = page;
      opts.onPageChange?.(page);
    }
  }

  let indicatorRaf = 0;
  scrollArea.addEventListener("scroll", () => {
    // The render-set update is rAF-coalesced and refreshes the page
    // indicator itself; folded mode short-circuits the renderer, so
    // the indicator is coalesced here.
    if (!folded) renderer.scheduleUpdate();
    else if (!indicatorRaf) {
      indicatorRaf = requestAnimationFrame(() => {
        indicatorRaf = 0;
        updatePageIndicator();
      });
    }
    annotating.onScroll();
  });

  // The page at the start of the view stays there: the anchor
  // relayoutPages keeps is measured along the new direction, against
  // the old layout. (Not the page at the centre — goToPage puts a page
  // at the start, so that would creep a page on with every switch.)
  function switchLayout(mode: "horizontal" | "vertical"): void {
    const lead = folded ? null : viewAnchor(scrollArea, pages, layoutMode === "horizontal");
    const page = lead ? lead.idx + 1 + (lead.frac > 0.5 ? 1 : 0) : currentPage();
    exitFolded(true);
    layoutMode = mode;
    applyLayoutClass();
    updateToolbarState();
    relayoutPages();
    goToPage(page, false);
  }

  function applyFixedZoom(level: number): void {
    exitFolded(true);
    paged = false;
    fixedZoom = level;
    layoutMode = "fixed";
    applyLayoutClass();
    updateToolbarState();
    relayoutPages();
  }

  function applyLayoutClass(): void {
    magnifier.reset();
    applyLayoutClasses(scrollArea, layoutState());
  }

  // Geometry only — rasterising lives in render.ts. A relayout resizes
  // every wrapper and stretches the existing content box; the settle
  // pass re-renders crisp once things are still.
  let relayoutGuard = false;
  function relayoutPages(): void {
    if (relayoutGuard || !pdfDoc || !pages.length) return;
    magnifier.reset();
    if (folded) {
      foldLayer.refresh();
      return;
    }
    relayoutGuard = true;
    try {
      const anchor = viewAnchor(scrollArea, pages, layoutMode === "horizontal");
      const scale = getEffectiveZoom();
      const state = layoutState();
      for (const p of pages) {
        sizePage(p, scale, state.crop);
        if (p.contentEl && p.contentW) {
          const k = Math.round(p.viewport.width * scale) / p.contentW;
          p.contentEl.style.transform = Math.abs(k - 1) > 0.001 ? `scale(${k})` : "";
        }
      }
      sizePagedGap(scrollArea, typical, scale, state);
      cropper.relaidOut();
      if (anchor) restoreAnchor(scrollArea, pages, layoutMode === "horizontal", anchor);
      renderer.invalidateGeometry();
      renderer.scheduleUpdate();
      renderer.scheduleSettle();
    } finally {
      relayoutGuard = false;
    }
  }

  /** Open a document, at `startPage` (1-based) when given. */
  async function loadPdf(data: ArrayBuffer | Uint8Array, startPage?: number): Promise<void> {
    const pdfjs = await getPdfjs();
    if (destroyed) return;
    reportPages = false;
    if (pdfDoc) await pdfDoc.loadingTask.destroy();
    pdfDoc = null;
    renderer.reset();
    ink.reset();
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

    // The layout fits the typical page, not page 1, which is often a
    // cover sheet of another size (pageSizes.ts).
    const sample = await sampleTypicalPage(doc);
    if (destroyed) return;
    typical = sample.typical;
    pages = createPageRecords(scrollArea, doc.numPages, sample.typical, sample.known, {
      onOpenInZotero: opts.onOpenInZotero,
      onBookmarkPage: opts.onBookmark
        ? (page, button) =>
            bookmarkPrompt.open(page - 1, button, `p. ${pageLabels?.[page - 1] ?? page}`, pageMarks.find((m) => m.pageIndex === page - 1))
        : undefined,
    });
    const scale = getEffectiveZoom();
    const state = layoutState();
    for (const p of pages) sizePage(p, scale, state.crop);
    sizePagedGap(scrollArea, typical, scale, state);
    renderer.update();
    if (folded) foldLayer.enable();
    if (folded) restorePendingFold();
    else if (saved?.at && saved.at.idx < pages.length) {
      restoreAnchor(scrollArea, pages, layoutMode === "horizontal", saved.at);
    } else if (startPage && startPage > 1 && startPage <= pages.length) goToPage(startPage, false);
    updateToolbarState();
    updatePageIndicator();
    // From the next frame on, pages the reader moves to are reported.
    requestAnimationFrame(() => {
      reportPages = true;
      updatePageIndicator();
    });
    void readOutline(doc).then((o) => {
      if (destroyed || pdfDoc !== doc) return;
      outline = o;
      opts.onOutline?.(o);
    });
    // Ready for ← / →, unless the reader is already typing somewhere
    // (the search field, the notes).
    const focused = document.activeElement;
    if (!focused || focused === document.body) scrollArea.focus({ preventScroll: true });
    search.rerun();
  }

  function goToPage(n: number, smooth = true): void {
    if (folded) {
      foldLayer.goToPage(n);
      return;
    }
    let idx = Math.max(0, Math.min(n - 1, pages.length - 1));
    // Fixed: the set holding the page, by its first page (its snap
    // point; scroll-padding centres the set).
    if (isPaged()) idx -= idx % perSet();
    const w = pages[idx]?.wrapper;
    if (!w) return;
    const behavior = smooth ? "smooth" : "auto";
    if (isPaged() && layoutMode === "horizontal") w.scrollIntoView({ behavior, inline: "start", block: "nearest" });
    else if (isPaged()) w.scrollIntoView({ behavior, block: "start" });
    else if (layoutMode === "horizontal") w.scrollIntoView({ behavior, inline: "start", block: "nearest" });
    else w.scrollIntoView({ behavior, block: "start" });
  }

  /** A place on a page: `top` in PDF user space (y up), null for the
   *  page's top. Side by side, pages are whole, so only the page counts. */
  function goToPosition(pageIndex: number, top: number | null): void {
    const p = pages[pageIndex];
    if (!p) return;
    if (top == null || folded || layoutMode === "horizontal" || isPaged()) goToPage(pageIndex + 1);
    else scrollToPagePoint(scrollArea, p, top);
  }


  const stopWatchingResize = watchResize(scrollArea, {
    hasPages: () => pages.length > 0,
    geometryChanged: () => {
      renderer.invalidateGeometry();
      renderer.scheduleUpdate();
    },
    fitsView: () => layoutMode !== "fixed",
    relayout: () => relayoutPages(),
    shownSet: () => shownLead,
    isPaged,
    horizontal: () => layoutMode === "horizontal",
    goToPage: (n) => goToPage(n, false),
  });

  async function destroy(): Promise<void> {
    viewReporter.flush();
    destroyed = true;
    search.onChange(null);
    stopWatchingResize();
    keys.detach();
    magnifier.destroy();
    cropper.destroy();
    bookmarkPrompt.destroy();
    foldLayer.destroy();
    thumbs.destroy();
    progress.destroy();
    renderer.destroy();
    annotating.destroy();
    ink.destroy();
    detachTooltips();
    const doc = pdfDoc;
    pdfDoc = null;
    pages = [];
    root.remove();
    if (doc) await doc.loadingTask.destroy().catch(() => {});
    // pdf.js's text layers share a few measuring canvases and a cache
    // of font metrics across documents; with none open, let them go.
    (await getPdfjs()).TextLayer.cleanup();
  }

  return {
    loadPdf,
    destroy,
    goToPage: (n: number) => goToPage(n),
    goToPosition,
    getPageCount: () => pdfDoc?.numPages ?? 0,
    /** Replace the annotations. Only pages whose annotations changed are
     *  repainted (and ink, never), so a sync that touched nothing here
     *  costs nothing. */
    setAnnotations: (list: Annotation[]) => {
      const old = annotLayer.getAnnotations();
      annotLayer.setAnnotations(list);
      annotating.sync(list);
      ink.setAnnotations(list);
      // The pages' rasters hold everything but ink; the folds' hold ink too.
      const changed = changedPages(old, list, false);
      if (changed.size) renderer.repaint(changed);
      if (changed.size || changedPages(old, list, true).size) foldLayer.onAnnotationsChanged();
      restorePendingFold();
      if (!list.length) pendingFoldAt = null; // nothing to fold back to
    },
    /** The page in view, 1-based. */
    currentPage: () => currentPage(),
    /** The PDF's bookmarks, shown on their pages. */
    setPageBookmarks: (marks: PageBookmark[]) => {
      pageMarks = marks;
      markBookmarkedPages(pages, marks);
    },
    /** A keyboard command (lib/shortcuts/): a mode, a page or fold step. */
    command,
    /** Report a view change still waiting out its pause. */
    flushView: () => viewReporter.flush(),
    /** Scroll to an annotation by key; false when it isn't in this PDF. */
    showAnnotation: (key: string): boolean => {
      const a = annotLayer.getAnnotations().find((x) => x.key === key);
      if (!a) return false;
      annotLayer.scrollToAnnotation(a);
      return true;
    },
    /** Find in the document (the toolbar's search box while reading). */
    search: search.search,
    searchStep: search.step,
    searchGoTo: search.goTo,
    onSearchChange: search.onChange,
    /** Mark an AI citation's quoted passage and go to it (citeMark.ts). */
    showQuote: citeMark.show,
    /** Where the reader is, and what is at a point (places.ts). */
    place: () => placeInView(scrollArea, pages, currentPage() - 1),
    placeAt: (x: number, y: number) => placeAtPoint(pages, annotLayer.getAnnotations(), x, y),
    /** Mark the passages the AI has explained (explainMarks.ts). */
    setExplainMarks: (marks: ExplainMark[]) => annotating.setExplainMarks(marks),
  };
}

export type PdfViewer = ReturnType<typeof createPdfViewer>;
