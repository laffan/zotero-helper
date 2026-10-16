// Shared shapes for the PDF viewer's modules.
import type { PageViewport, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

export type { PageViewport, PDFDocumentProxy, PDFPageProxy };

export type LayoutMode = "horizontal" | "vertical" | "fixed";

/** A link annotation pdf.js reports on a page. */
export interface LinkAnnot {
  rect: number[];
  url?: string;
  dest?: string | unknown[];
}

/** One page of the open document. The wrapper is always in the DOM
 *  (sized to the page); its content box comes and goes with rendering. */
export interface PageRecord {
  wrapper: HTMLDivElement;
  /** Scale-1 viewport. Seeded from the typical page until the page
   *  first renders; for a page far from the typical size, its own
   *  viewport scaled by `norm` (pageSizes.ts). */
  viewport: PageViewport;
  realViewport: boolean;
  /** The scale a page of its own size is drawn at (1 for most). */
  norm?: number;
  rendered: boolean;
  rendering: boolean;
  cancelled?: boolean;
  canvas: HTMLCanvasElement | null;
  renderedZoom: number | null;
  /** The extra resolution it was drawn at (a pinch, magnify.ts), and
   *  whether past the usual size cap. */
  renderedRes?: number;
  renderedDetail?: boolean;
  renderTask?: RenderTask | null;
  canvasBytes?: number;
  /** Canvas + overlay layers, at paint-time CSS size. */
  contentEl: HTMLDivElement | null;
  contentW: number;
  contentH: number;
  linkAnnots?: LinkAnnot[];
}
