// The viewer's annotations: the list painted into the pages (paint.ts
// does the drawing) and scrolling to one of them. Ported from Hush's
// src/pdf/pdf-viewer-annotations.js, less its annotation shelf — the
// Highlights tab beside the viewer already lists, filters and quotes
// them.
import { annotationPosition, type Annotation } from "../lib/highlights";
import type { LayoutMode, PageRecord, PageViewport } from "./types";

/** PDF user-space point → top-left-origin page units for a scale-1
 *  viewport. Going through the viewport's own transform honours a
 *  CropBox origin that isn't (0,0) and any /Rotate. */
export function pdfPointToViewport(viewport: PageViewport, x: number, y: number): number[] {
  return viewport.convertToViewportPoint(x, y);
}

export interface AnnotationViewer {
  getPages: () => PageRecord[];
  getEffectiveZoom: () => number;
  getLayoutMode: () => LayoutMode;
  goToPage: (n: number) => void;
  /** Folded view's navigation, when it is active. */
  scrollToFold?: (a: Annotation) => boolean;
  /** Fixed view: the page (its set) is the place, not a point on it. */
  isPaged?: () => boolean;
}

export function createAnnotationLayer(scrollArea: HTMLElement, viewer: AnnotationViewer) {
  let annotations: Annotation[] = [];

  function scrollToAnnotation(annot: Annotation): void {
    if (viewer.scrollToFold?.(annot)) return;
    const pages = viewer.getPages();
    const pos = annotationPosition(annot);
    if (!pos || viewer.isPaged?.()) {
      const n = pos ? pos.pageIndex + 1 : parseInt(annot.pageLabel, 10);
      if (!isNaN(n)) viewer.goToPage(n);
      return;
    }
    const p = pages[pos.pageIndex];
    if (!p) return;
    const scale = viewer.getEffectiveZoom();
    // Top-left of the first rect, or the first point of a drawing.
    const rect = pos.rects?.[0];
    const path = pos.paths?.[0];
    const anchor = rect ? [rect[0], rect[3]] : path && path.length >= 2 ? [path[0], path[1]] : null;
    if (!anchor) {
      p.wrapper.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const [vx, vy] = pdfPointToViewport(p.viewport, anchor[0], anchor[1]);
    if (viewer.getLayoutMode() === "horizontal") {
      const left = p.wrapper.offsetLeft + vx * scale - scrollArea.clientWidth / 3;
      scrollArea.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    } else {
      const top = p.wrapper.offsetTop + vy * scale - scrollArea.clientHeight / 3;
      scrollArea.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }

  return {
    setAnnotations: (list: Annotation[]) => {
      annotations = list;
    },
    scrollToAnnotation,
    getAnnotations: () => annotations,
  };
}
