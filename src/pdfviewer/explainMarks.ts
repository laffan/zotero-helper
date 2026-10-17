// The passages the AI has explained (lib/ai/explain.ts), marked in a
// dashed pink outline (--explain-mark) where they are in the pages, and a tap on
// one opens its explainer again — in reading mode too, where there is no
// sidebar to find it in.
//
// The marks are drawn like an AI citation's (citeMark.ts): an overlay on
// the page wrapper in percentages of the page, so they need no raster
// and follow every zoom. They are the app's own and never written to
// Zotero. A page drawn for the first time may adopt its own size
// (pageSizes.ts), so its marks are placed again then.
import { pageBoxAt } from "./annotate";
import type { PageRecord } from "./types";

export interface ExplainMark {
  id: string;
  pageIndex: number;
  /** In PDF user space, as a highlight's rects. */
  rects: number[][];
}

export interface ExplainMarksEnv {
  getPages: () => PageRecord[];
  /** The mark `id` was tapped. */
  open: (id: string) => void;
  /** Taps are ignored right now (a selection just dismissed). */
  ignore: () => boolean;
}

/** A rect in PDF space, as fractions of its page. */
function frac(p: PageRecord, r: number[]): { x: number; y: number; w: number; h: number } {
  const vp = p.viewport;
  const [x1, y1] = vp.convertToViewportPoint(r[0], r[1]);
  const [x2, y2] = vp.convertToViewportPoint(r[2], r[3]);
  return {
    x: Math.min(x1, x2) / vp.width,
    y: Math.min(y1, y2) / vp.height,
    w: Math.abs(x2 - x1) / vp.width,
    h: Math.abs(y2 - y1) / vp.height,
  };
}

export function createExplainMarks(scrollArea: HTMLElement, env: ExplainMarksEnv) {
  let marks: ExplainMark[] = [];

  function drawPage(idx: number): void {
    const p = env.getPages()[idx];
    if (!p) return;
    p.wrapper.querySelector(".pdf-explain-marks")?.remove();
    const here = marks.filter((m) => m.pageIndex === idx);
    if (!here.length) return;
    const layer = document.createElement("div");
    layer.className = "pdf-explain-marks";
    for (const m of here) {
      for (const r of m.rects) {
        const f = frac(p, r);
        const box = document.createElement("div");
        box.className = "pdf-explain-mark";
        box.style.left = `${f.x * 100}%`;
        box.style.top = `${f.y * 100}%`;
        box.style.width = `${f.w * 100}%`;
        box.style.height = `${f.h * 100}%`;
        layer.appendChild(box);
      }
    }
    p.wrapper.appendChild(layer);
  }

  /** The mark under a client point, if any (the last one drawn wins). */
  function markAt(target: Element, x: number, y: number): ExplainMark | null {
    const at = pageBoxAt(target);
    const p = at ? env.getPages()[at.pageIndex] : undefined;
    if (!at || !p) return null;
    const box = at.box.getBoundingClientRect();
    const fx = (x - box.left) / box.width;
    const fy = (y - box.top) / box.height;
    let hit: ExplainMark | null = null;
    for (const m of marks) {
      if (m.pageIndex !== at.pageIndex) continue;
      const inside = m.rects.some((r) => {
        const f = frac(p, r);
        return fx >= f.x && fx <= f.x + f.w && fy >= f.y && fy <= f.y + f.h;
      });
      if (inside) hit = m;
    }
    return hit;
  }

  // Ahead of the highlights' own taps (annotate.ts), which would open
  // the editor of a highlight beneath.
  scrollArea.addEventListener("click", (e) => {
    if (!marks.length || env.ignore()) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const target = e.target as Element;
    if (target.closest("a, button")) return;
    const m = markAt(target, e.clientX, e.clientY);
    if (!m) return;
    e.stopImmediatePropagation();
    env.open(m.id);
  });

  return {
    /** Replace the marks. */
    set(next: ExplainMark[]): void {
      const pages = new Set([...marks, ...next].map((m) => m.pageIndex));
      marks = next;
      for (const idx of pages) drawPage(idx);
    },
    /** A page was drawn (perhaps at its own size, at last). */
    pageRendered(idx: number): void {
      if (marks.some((m) => m.pageIndex === idx)) drawPage(idx);
    },
  };
}
