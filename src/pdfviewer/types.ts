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
  /** Scale-1 viewport. Seeded from page 1 until the page first renders. */
  viewport: PageViewport;
  realViewport: boolean;
  rendered: boolean;
  rendering: boolean;
  cancelled?: boolean;
  canvas: HTMLCanvasElement | null;
  renderedZoom: number | null;
  renderTask?: RenderTask | null;
  canvasBytes?: number;
  /** Canvas + overlay layers, at paint-time CSS size. */
  contentEl: HTMLDivElement | null;
  contentW: number;
  contentH: number;
  linkAnnots?: LinkAnnot[];
}
