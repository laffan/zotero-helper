// The scroll area's layout for the viewer's modes: the CSS layout
// class each one uses (pdfviewer.css), and the scale it fits pages at.
// The modes themselves — which one is on, and switching between them —
// are viewer.ts's.
import { pagedFitZoom } from "./paged";
import type { LayoutMode, PageViewport } from "./types";
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
}

const LAYOUT_CLASSES = [
  "pdf-layout-fit", "pdf-layout-fixed", "pdf-layout-horizontal", "pdf-layout-folded", "pdf-layout-pagedv",
  "pdf-paged", "pdf-paged-1", "pdf-paged-2", "pdf-paged-3",
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
}

/** CSS px per PDF unit for the mode, from page 1's scale-1 viewport. */
export function fitZoom(area: HTMLElement, first: PageViewport, s: LayoutState): number {
  const pad = 40;
  const gap = 12;
  if (s.paged) return pagedFitZoom(area, first, pad, s.perSet);
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
