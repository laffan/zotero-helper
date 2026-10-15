// The scroll area's layout for the viewer's modes: the CSS layout
// class each one uses (pdfviewer.css), and the scale it fits pages at.
// The modes themselves — which one is on, and switching between them —
// are viewer.ts's.
import { cropWrapper, croppedSize, type Crop } from "./crop";
import { pagedFitZoom, PAGED_PAD, SET_GAP, setPagedGap } from "./paged";
import type { LayoutMode, PageRecord, PageViewport } from "./types";
import type { FitMode } from "./viewPrefs";

export interface LayoutState {
  layoutMode: LayoutMode;
  fitMode: FitMode;
  folded: boolean;
  /** The fixed view (sets of pages) is on. */
  paged: boolean;
  /** Pages to a set in the fixed view. */
  perSet: number;
  foldedZoom: number;
  fixedZoom: number;
  /** The fixed view's trim (crop.ts), when one is in effect. */
  crop: Crop | null;
}

const LAYOUT_CLASSES = [
  "pdf-layout-fit", "pdf-layout-fixed", "pdf-layout-horizontal", "pdf-layout-folded", "pdf-layout-pagedv",
  "pdf-paged", "pdf-paged-1", "pdf-paged-2", "pdf-paged-3", "pdf-cropped",
];

export function applyLayoutClasses(area: HTMLElement, s: LayoutState): void {
  area.classList.remove(...LAYOUT_CLASSES);
  if (s.paged) {
    // Top to bottom, a grid of rows the set's size; side by side, the
    // usual row, with sets spaced apart by CSS.
    area.classList.add(
      s.layoutMode === "vertical" ? "pdf-layout-pagedv" : "pdf-layout-horizontal",
      "pdf-paged",
      `pdf-paged-${s.perSet}`,
    );
    area.style.setProperty("--pdf-paged-cols", String(s.perSet));
  } else if (s.folded) area.classList.add("pdf-layout-folded");
  else if (s.layoutMode === "vertical") {
    area.classList.add(s.fitMode === "fit" ? "pdf-layout-fit" : "pdf-layout-fixed");
  } else if (s.layoutMode === "horizontal") area.classList.add("pdf-layout-horizontal");
  else area.classList.add("pdf-layout-fixed");
  // A reading crop applies in every view but the folded one (crop.ts).
  if (s.crop && !s.folded) area.classList.add("pdf-cropped");
}

/** CSS px per PDF unit for the mode, from page 1's scale-1 viewport —
 *  trimmed by a reading crop, so what is left of a page is what fits. */
export function fitZoom(area: HTMLElement, page1: PageViewport, s: LayoutState): number {
  const first = croppedSize(page1, s.crop);
  const pad = 40;
  const gap = 12;
  if (s.paged) return pagedFitZoom(area, first, PAGED_PAD, s.perSet);
  if (s.layoutMode === "vertical") {
    const availW = area.clientWidth - pad;
    if (s.folded) return (availW / first.width) * s.foldedZoom;
    if (s.fitMode === "fit-2") return (availW - gap - 4) / (first.width * 2);
    if (s.fitMode === "fit-3") return (availW - gap * 2 - 4) / (first.width * 3);
    return availW / first.width;
  }
  if (s.layoutMode === "horizontal") return (area.clientHeight - pad) / first.height;
  return s.fixedZoom;
}

/** Size a page's wrapper at `scale` — and, in the fixed view, close up
 *  the room its trimmed edges would take (crop.ts). */
export function sizePage(p: PageRecord, scale: number, crop: Crop | null): void {
  const w = Math.round(p.viewport.width * scale);
  const h = Math.round(p.viewport.height * scale);
  p.wrapper.style.width = `${w}px`;
  p.wrapper.style.height = `${h}px`;
  cropWrapper(p.wrapper, w, h, crop);
}

/** The fixed view's spacing, from page 1's (trimmed) size at this
 *  scale: a set is n pages across side by side, one page tall top to
 *  bottom. */
export function sizePagedGap(area: HTMLElement, pages: PageRecord[], scale: number, s: LayoutState): void {
  const vp = pages[0] ? croppedSize(pages[0].viewport, s.crop) : null;
  const horiz = s.layoutMode === "horizontal";
  const n = s.perSet;
  const size = !vp ? 0 : horiz ? n * vp.width * scale + (n - 1) * SET_GAP : vp.height * scale;
  setPagedGap(area, s.paged && Boolean(vp), horiz, size);
}
