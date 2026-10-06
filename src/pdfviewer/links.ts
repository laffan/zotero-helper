// The PDF's own links — table-of-contents rows, "see Section 4"
// cross-references, DOIs in the bibliography — laid over each rendered
// page as clickable boxes. Internal links navigate in place; external
// ones open in the system browser. Ported from Hush's
// src/pdf/pdf-viewer-links.js.
import { openUrl } from "@tauri-apps/plugin-opener";
import { pdfPointToViewport } from "./annotations";
import type { LinkAnnot, PageRecord, PDFDocumentProxy, PDFPageProxy } from "./types";

async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

export interface LinkEnv {
  getPdfDoc: () => PDFDocumentProxy | null;
  getPages: () => PageRecord[];
  goToPage: (n: number) => void;
  isDestroyed: () => boolean;
}

export function createLinkLayerManager(env: LinkEnv) {
  /** A link's destination as a 1-based page number. */
  async function resolveDestPage(annot: LinkAnnot): Promise<number | null> {
    const pdfDoc = env.getPdfDoc();
    if (!pdfDoc) return null;
    try {
      let dest = annot.dest;
      if (typeof dest === "string") dest = (await pdfDoc.getDestination(dest)) ?? undefined;
      if (!Array.isArray(dest) || dest[0] == null) return null;
      const ref = dest[0];
      const idx =
        typeof ref === "object"
          ? await pdfDoc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0])
          : Number(ref);
      return idx >= 0 ? idx + 1 : null;
    } catch {
      return null;
    }
  }

  function onLinkClick(annot: LinkAnnot, e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    if (annot.url) {
      void openExternal(annot.url);
      return;
    }
    void resolveDestPage(annot).then((n) => {
      if (n != null && !env.isDestroyed()) env.goToPage(n);
    });
  }

  /** Build the overlay for page `idx` after it renders. */
  async function attach(idx: number, page: PDFPageProxy): Promise<void> {
    const p = env.getPages()[idx];
    if (!p?.contentEl) return;
    if (!p.linkAnnots) {
      try {
        const annots = (await page.getAnnotations({ intent: "display" })) as Array<
          LinkAnnot & { subtype?: string }
        >;
        p.linkAnnots = annots.filter(
          (a) => a.subtype === "Link" && Array.isArray(a.rect) && (a.url || a.dest),
        );
      } catch {
        p.linkAnnots = [];
      }
      if (env.isDestroyed()) return;
    }
    if (!p.linkAnnots.length || !p.contentEl?.isConnected) return;
    p.contentEl.querySelector(".pdf-link-layer")?.remove();

    const layer = document.createElement("div");
    layer.className = "pdf-link-layer";
    const z = p.renderedZoom || 1;
    for (const a of p.linkAnnots) {
      const [x1, y1, x2, y2] = a.rect;
      const [ax, ay] = pdfPointToViewport(p.viewport, x1, y1);
      const [bx, by] = pdfPointToViewport(p.viewport, x2, y2);
      const el = document.createElement("a");
      el.className = "pdf-link";
      el.style.left = `${Math.min(ax, bx) * z}px`;
      el.style.top = `${Math.min(ay, by) * z}px`;
      el.style.width = `${Math.abs(bx - ax) * z}px`;
      el.style.height = `${Math.abs(by - ay) * z}px`;
      el.href = a.url || "#";
      if (a.url) el.title = a.url;
      el.addEventListener("click", (e) => onLinkClick(a, e));
      layer.appendChild(el);
    }
    p.contentEl.appendChild(layer);
  }

  return { attach };
}
