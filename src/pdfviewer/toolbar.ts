// The viewer's bottom bar, built as plain DOM and handed back as a flat
// record so viewer.ts can wire every handler in one place. No state
// lives here (ported from Hush's src/pdf/pdf-toolbar-build.js).
import type { LayoutMode } from "./types";
import type { FitMode } from "./viewPrefs";
import {
  CONTINUOUS_ICON,
  FILTER_ICON,
  FIXED_ICON,
  FIT_ONE_ICON,
  FIT_THREE_ICON,
  FIT_TWO_ICON,
  FOLD_ICON,
  HORIZONTAL_ICON,
  READING_ICON,
  THUMBNAIL_ICON,
  VERTICAL_ICON,
} from "./icons";
import { PEN_ICON } from "./ink/icons";

/** `shortcut`: the keyboard shortcut the button stands for — an action
 *  id from lib/shortcuts/bindings.ts, or a fixed combo ("mod+=") — shown
 *  after its tooltip (tooltips.ts), as currently bound. */
function btn(cls: string, text: string, title: string, shortcut?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.title = title;
  if (shortcut) b.dataset.shortcut = shortcut;
  return b;
}

function svgBtn(cls: string, title: string, svg: string, shortcut?: string): HTMLButtonElement {
  const b = btn(cls, "", title, shortcut);
  b.innerHTML = svg;
  return b;
}

function group(cls: string, ...children: HTMLElement[]): HTMLSpanElement {
  const g = document.createElement("span");
  g.className = cls;
  g.append(...children);
  return g;
}

export function buildPdfToolbar() {
  const toolbar = document.createElement("div");
  toolbar.className = "pdf-zoom-toolbar";

  // − and + as one group, the zoom (or fit) they set to their right.
  const zoomOutBtn = btn("pdf-toggle-option pdf-zoom-step", "−", "Zoom out", "mod+-");
  const zoomInBtn = btn("pdf-toggle-option pdf-zoom-step", "+", "Zoom in", "mod+=");
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "pdf-zoom-label";
  zoomLabel.textContent = "Fit";
  const zoomWrap = group("pdf-toolbar-section", group("pdf-toggle-group", zoomOutBtn, zoomInBtn), zoomLabel);

  const scrollHBtn = svgBtn("pdf-toggle-option active", "Horizontal scroll", HORIZONTAL_ICON, "pdfHorizontal");
  const scrollVBtn = svgBtn("pdf-toggle-option", "Vertical scroll", VERTICAL_ICON, "pdfVertical");
  const scrollToggleWrap = group("pdf-toggle-group", scrollHBtn, scrollVBtn);

  const fitOneBtn = svgBtn("pdf-toggle-option active", "Fit one page", FIT_ONE_ICON, "pdfFit1");
  const fitTwoBtn = svgBtn("pdf-toggle-option", "Fit two pages", FIT_TWO_ICON, "pdfFit2");
  const fitThreeBtn = svgBtn("pdf-toggle-option", "Fit three pages", FIT_THREE_ICON, "pdfFit3");
  const fitToggleWrap = group("pdf-toggle-group", fitOneBtn, fitTwoBtn, fitThreeBtn);
  fitToggleWrap.style.display = "none";

  // A fixed set of pages (as many as the fit buttons say), swiped
  // through, or the pages as one strip.
  const fixedBtn = svgBtn("pdf-toggle-option", "Paged — one, two or three pages at a time; swipe to turn", FIXED_ICON, "pdfFixed");
  const continuousBtn = svgBtn("pdf-toggle-option active", "Continuous — the pages as one strip", CONTINUOUS_ICON, "pdfContinuous");
  const pageModeWrap = group("pdf-toggle-group pdf-page-mode", fixedBtn, continuousBtn);

  // Folded view is always offered — entering it switches to vertical
  // scroll at single-page width. The filter shows only while folded.
  const foldBtn = svgBtn("pdf-zoom-btn pdf-fold-btn", "Folded view — collapse to annotated regions", FOLD_ICON, "pdfFolded");
  const foldFilterBtn = svgBtn("pdf-zoom-btn pdf-fold-filter-btn", "Filter fold annotations", FILTER_ICON, "pdfFoldFilters");
  foldFilterBtn.style.display = "none";
  const foldWrap = group("pdf-toolbar-section", foldBtn, foldFilterBtn);

  const pageIndicator = document.createElement("span");
  pageIndicator.className = "pdf-page-indicator";

  const zoteroLink = document.createElement("a");
  zoteroLink.className = "pdf-zotero-link";
  zoteroLink.textContent = "Open in Zotero ↗";
  zoteroLink.style.display = "none";

  const thumbnailBtn = svgBtn("pdf-zoom-btn pdf-thumbnail-btn", "Thumbnail view", THUMBNAIL_ICON, "pdfThumbnails");
  // Reading mode: the pages fill the window (the red dot at its top
  // left, or Escape, brings everything back).
  const readingBtn = svgBtn("pdf-zoom-btn pdf-reading-btn", "Reading mode — the pages fill the screen", READING_ICON, "pdfReadingMode");
  readingBtn.style.display = "none";

  // Ink mode: draw with the Pencil (or a mouse), as Zotero's pen does.
  const inkBtn = svgBtn("pdf-zoom-btn pdf-ink-btn", "Draw — the Pencil writes, a finger scrolls", PEN_ICON, "pdfInk");

  // Sections, spaced apart by the bar (pdfviewer.css): the thumbnails
  // and reading mode; pages per screen; scroll direction; fixed / continuous; folding;
  // zoom; drawing (ink mode's tools join the bar after it, ink/bar.ts).
  toolbar.append(
    group("pdf-toolbar-section", thumbnailBtn, readingBtn),
    fitToggleWrap, scrollToggleWrap,
    pageModeWrap, foldWrap,
    zoomWrap,
    inkBtn,
    pageIndicator, zoteroLink,
  );

  return {
    toolbar,
    zoomOutBtn, zoomLabel, zoomInBtn,
    scrollHBtn, scrollVBtn,
    fitOneBtn, fitTwoBtn, fitThreeBtn, fitToggleWrap,
    pageModeWrap, fixedBtn, continuousBtn,
    foldBtn, foldFilterBtn,
    pageIndicator, zoteroLink, thumbnailBtn, readingBtn, inkBtn,
  };
}
export type PdfToolbar = ReturnType<typeof buildPdfToolbar>;

/** The viewer's modes, as the bar shows them. */
export interface ToolbarState {
  layoutMode: LayoutMode;
  fitMode: FitMode;
  folded: boolean;
  /** The fixed view (sets of pages) is on. */
  paged: boolean;
  foldedZoom: number;
  /** The scale, for the fixed-zoom label. */
  zoom: () => number;
}

/** Light the buttons for the modes in force, label the zoom, and show
 *  only the controls that apply. */
export function syncToolbar(tb: PdfToolbar, s: ToolbarState): void {
  const isVert = s.layoutMode === "vertical";
  if (s.folded) {
    tb.zoomLabel.textContent =
      Math.abs(s.foldedZoom - 1) < 0.01 ? "Folded" : `Folded ${Math.round(s.foldedZoom * 100)}%`;
  } else if (s.layoutMode !== "fixed") {
    const labels: Record<FitMode, string> = { fit: "Fit", "fit-2": "Fit 2", "fit-3": "Fit 3" };
    tb.zoomLabel.textContent = isVert || s.paged ? labels[s.fitMode] : "Fit";
  } else {
    tb.zoomLabel.textContent = `${Math.round(s.zoom() * 100)}%`;
  }
  tb.scrollHBtn.classList.toggle("active", s.layoutMode === "horizontal");
  tb.scrollVBtn.classList.toggle("active", isVert);
  tb.fitToggleWrap.style.display = isVert || s.paged ? "" : "none";
  tb.pageModeWrap.classList.toggle("vertical", s.layoutMode !== "horizontal");
  tb.fixedBtn.classList.toggle("active", s.paged);
  tb.continuousBtn.classList.toggle("active", !s.folded && !s.paged);
  tb.fitOneBtn.classList.toggle("active", s.fitMode === "fit" && !s.folded);
  tb.fitTwoBtn.classList.toggle("active", s.fitMode === "fit-2");
  tb.fitThreeBtn.classList.toggle("active", s.fitMode === "fit-3");
  tb.foldBtn.classList.toggle("active", s.folded);
  tb.foldFilterBtn.style.display = s.folded ? "" : "none";
}
