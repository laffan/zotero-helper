// The viewer's bottom bar, built as plain DOM and handed back as a flat
// record so viewer.ts can wire every handler in one place. No state
// lives here (ported from Hush's src/pdf/pdf-toolbar-build.js).
import {
  FILTER_ICON,
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
    foldBtn, foldFilterBtn,
    pageIndicator, zoteroLink,
  );

  return {
    toolbar,
    zoomOutBtn, zoomLabel, zoomInBtn,
    scrollHBtn, scrollVBtn,
    fitOneBtn, fitTwoBtn, fitThreeBtn, fitToggleWrap,
    foldBtn, foldFilterBtn,
    pageIndicator, zoteroLink, thumbnailBtn,
  };
}
