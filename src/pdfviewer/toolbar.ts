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
  THUMBNAIL_ICON,
  VERTICAL_ICON,
} from "./icons";

function btn(cls: string, text: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.title = title;
  return b;
}

function svgBtn(cls: string, title: string, svg: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.title = title;
  b.innerHTML = svg;
  return b;
}

export function buildPdfToolbar() {
  const toolbar = document.createElement("div");
  toolbar.className = "pdf-zoom-toolbar";

  const zoomOutBtn = btn("pdf-zoom-btn", "−", "Zoom out");
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "pdf-zoom-label";
  zoomLabel.textContent = "Fit";
  const zoomInBtn = btn("pdf-zoom-btn", "+", "Zoom in");

  const scrollToggleWrap = document.createElement("span");
  scrollToggleWrap.className = "pdf-toggle-group";
  const scrollHBtn = svgBtn("pdf-toggle-option active", "Horizontal scroll", HORIZONTAL_ICON);
  const scrollVBtn = svgBtn("pdf-toggle-option", "Vertical scroll", VERTICAL_ICON);
  scrollToggleWrap.append(scrollHBtn, scrollVBtn);

  const fitToggleWrap = document.createElement("span");
  fitToggleWrap.className = "pdf-toggle-group";
  fitToggleWrap.style.display = "none";
  const fitOneBtn = svgBtn("pdf-toggle-option active", "Fit one page", FIT_ONE_ICON);
  const fitTwoBtn = svgBtn("pdf-toggle-option", "Fit two pages", FIT_TWO_ICON);
  const fitThreeBtn = svgBtn("pdf-toggle-option", "Fit three pages", FIT_THREE_ICON);
  fitToggleWrap.append(fitOneBtn, fitTwoBtn, fitThreeBtn);

  // A fixed set of pages (as many as the fit buttons say), swiped
  // through, or the pages as one strip.
  const pageModeWrap = document.createElement("span");
  pageModeWrap.className = "pdf-toggle-group pdf-page-mode";
  const fixedBtn = svgBtn("pdf-toggle-option", "Fixed — one, two or three pages at a time; swipe to turn", FIXED_ICON);
  const continuousBtn = svgBtn("pdf-toggle-option active", "Continuous — the pages as one strip", CONTINUOUS_ICON);
  pageModeWrap.append(fixedBtn, continuousBtn);

  // Folded view is always offered — entering it switches to vertical
  // scroll at single-page width. The filter shows only while folded.
  const foldBtn = svgBtn("pdf-zoom-btn pdf-fold-btn", "Folded view — collapse to annotated regions", FOLD_ICON);
  const foldFilterBtn = svgBtn("pdf-zoom-btn pdf-fold-filter-btn", "Filter fold annotations", FILTER_ICON);
  foldFilterBtn.style.display = "none";

  const pageIndicator = document.createElement("span");
  pageIndicator.className = "pdf-page-indicator";

  const zoteroLink = document.createElement("a");
  zoteroLink.className = "pdf-zotero-link";
  zoteroLink.textContent = "Open in Zotero ↗";
  zoteroLink.style.display = "none";

  const thumbnailBtn = svgBtn("pdf-zoom-btn pdf-thumbnail-btn", "Thumbnail view", THUMBNAIL_ICON);

  toolbar.append(
    thumbnailBtn,
    zoomOutBtn, zoomLabel, zoomInBtn,
    scrollToggleWrap, fitToggleWrap,
    pageModeWrap, foldBtn, foldFilterBtn,
    pageIndicator, zoteroLink,
  );

  return {
    toolbar,
    zoomOutBtn, zoomLabel, zoomInBtn,
    scrollHBtn, scrollVBtn,
    fitOneBtn, fitTwoBtn, fitThreeBtn, fitToggleWrap,
    pageModeWrap, fixedBtn, continuousBtn,
    foldBtn, foldFilterBtn,
    pageIndicator, zoteroLink, thumbnailBtn,
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
