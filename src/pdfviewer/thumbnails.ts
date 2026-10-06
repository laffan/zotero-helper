// Thumbnail grid over the whole viewer — every page at a glance, with
// Zotero's annotations painted in. Ported from Hush's
// src/pdf/pdf-viewer-thumbnails.js.
import type { Annotation } from "../lib/highlights";
import { drawAnnotations } from "./paint";
import type { PageRecord, PDFDocumentProxy } from "./types";

const THUMB_WIDTH = 180;

export interface ThumbnailEnv {
  getPages: () => PageRecord[];
  getPdfDoc: () => PDFDocumentProxy | null;
  isDestroyed: () => boolean;
  getAnnotations: () => Annotation[];
  goToPage: (n: number) => void;
  /** Told when a page pick closes the grid, so the button can follow. */
  onHide: () => void;
}

export function createThumbnailManager(root: HTMLElement, env: ThumbnailEnv) {
  let panel: HTMLDivElement | null = null;
  let visible = false;
  let observer: IntersectionObserver | null = null;

  function toggle(): boolean {
    visible = !visible;
    if (visible) show();
    else hide();
    return visible;
  }

  function show(): void {
    const pages = env.getPages();
    panel = document.createElement("div");
    panel.className = "pdf-thumbnail-overlay";
    const scroll = document.createElement("div");
    scroll.className = "pdf-thumbnail-scroll";
    panel.appendChild(scroll);

    pages.forEach((p, i) => {
      const cell = document.createElement("div");
      cell.className = "pdf-thumb-cell";
      cell.dataset.thumbIdx = String(i);
      cell.style.width = `${THUMB_WIDTH}px`;
      cell.style.height = `${Math.round((THUMB_WIDTH * p.viewport.height) / p.viewport.width)}px`;
      const placeholder = document.createElement("div");
      placeholder.className = "pdf-thumb-placeholder";
      cell.appendChild(placeholder);
      const label = document.createElement("div");
      label.className = "pdf-thumb-label";
      label.textContent = String(i + 1);
      cell.appendChild(label);
      cell.addEventListener("click", () => {
        env.goToPage(i + 1);
        visible = false;
        hide();
        env.onHide();
      });
      scroll.appendChild(cell);
    });
    root.appendChild(panel);

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const idx = parseInt(el.dataset.thumbIdx ?? "", 10);
          if (isNaN(idx)) continue;
          if (entry.isIntersecting) void renderThumb(idx, el);
          // Scrolled-away thumbnails drop their canvas, so a long PDF's
          // grid doesn't accumulate one per page browsed.
          else clearThumb(el);
        }
      },
      { root: scroll, rootMargin: "300px" },
    );
    for (const cell of Array.from(scroll.children)) observer.observe(cell);
  }

  function clearThumb(cell: HTMLElement): void {
    if (!cell.dataset.thumbRendered) return;
    delete cell.dataset.thumbRendered;
    cell.querySelector(".pdf-thumb-canvas")?.remove();
    if (!cell.querySelector(".pdf-thumb-placeholder")) {
      const placeholder = document.createElement("div");
      placeholder.className = "pdf-thumb-placeholder";
      cell.insertBefore(placeholder, cell.firstChild);
    }
  }

  function hide(): void {
    observer?.disconnect();
    observer = null;
    // Dropped rather than hidden: keeping it would pin every rendered
    // thumbnail canvas for the rest of the session.
    panel?.remove();
    panel = null;
  }

  async function renderThumb(idx: number, cell: HTMLElement): Promise<void> {
    const pdfDoc = env.getPdfDoc();
    if (!pdfDoc || env.isDestroyed() || cell.dataset.thumbRendered) return;
    cell.dataset.thumbRendered = "1";
    try {
      const page = await pdfDoc.getPage(idx + 1);
      if (env.isDestroyed()) return;
      const scale = THUMB_WIDTH / page.getViewport({ scale: 1 }).width;
      const svp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(svp.width);
      canvas.height = Math.round(svp.height);
      canvas.className = "pdf-thumb-canvas";
      await page.render({ canvas, viewport: svp, background: "#ffffff" }).promise;
      if (env.isDestroyed() || !cell.isConnected || !cell.dataset.thumbRendered) return;

      const ctx = canvas.getContext("2d");
      if (ctx) drawAnnotations(ctx, svp, env.getAnnotations(), idx);
      cell.querySelector(".pdf-thumb-placeholder")?.remove();
      cell.insertBefore(canvas, cell.firstChild);
    } catch (e) {
      console.error(`Failed to render thumbnail ${idx + 1}:`, e);
    }
  }

  function destroy(): void {
    hide();
    visible = false;
  }

  return { toggle, destroy };
}
