// Passages the app keeps marked in the pages, of two kinds: those the
// AI has explained (lib/ai/explain.ts), in a dashed pink outline
// (--explain-mark), a tap on one opening its explainer again; and words
// looked up (lib/ai/lookup.ts), with a dashed pink underline, a tap on
// one showing its definition above it. Both work in reading mode too,
// where there is no sidebar to find them in.
//
// The marks are drawn like an AI citation's (citeMark.ts): an overlay on
// the page wrapper in percentages of the page, so they need no raster
// and follow every zoom. They are the app's own and never written to
// Zotero. A page drawn for the first time may adopt its own size
// (pageSizes.ts), so its marks are placed again then.
import { pageBoxAt } from "./annotate";
import type { PageRecord } from "./types";

export interface PassageMark {
  id: string;
  pageIndex: number;
  /** In PDF user space, as a highlight's rects. */
  rects: number[][];
}
/** An explained passage, and a word looked up, as the pages mark them. */
export type ExplainMark = PassageMark;
export type WordMark = PassageMark;

export interface PassageMarksEnv {
  /** Which marks: their classes are `pdf-<kind>-marks` (the layer) and
   *  `pdf-<kind>-mark` (each box). */
  kind: "explain" | "word";
  getPages: () => PageRecord[];
  /** The mark `id` was tapped; `at` is its box on screen. */
  open: (id: string, at: DOMRect) => void;
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

export function createPassageMarks(scrollArea: HTMLElement, env: PassageMarksEnv) {
  let marks: PassageMark[] = [];
  const layerClass = `pdf-${env.kind}-marks`;

  function drawPage(idx: number): void {
    const p = env.getPages()[idx];
    if (!p) return;
    p.wrapper.querySelector(`.${layerClass}`)?.remove();
    const here = marks.filter((m) => m.pageIndex === idx);
    if (!here.length) return;
    const layer = document.createElement("div");
    layer.className = layerClass;
    for (const m of here) {
      for (const r of m.rects) {
        const f = frac(p, r);
        const box = document.createElement("div");
        box.className = `pdf-${env.kind}-mark`;
        box.dataset.markId = m.id;
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
  function markAt(target: Element, x: number, y: number): PassageMark | null {
    if (!marks.length) return null;
    const at = pageBoxAt(target);
    const p = at ? env.getPages()[at.pageIndex] : undefined;
    if (!at || !p) return null;
    const box = at.box.getBoundingClientRect();
    const fx = (x - box.left) / box.width;
    const fy = (y - box.top) / box.height;
    let hit: PassageMark | null = null;
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

  /** Where mark `m` is on screen: the union of its boxes. */
  function boxOf(m: PassageMark): DOMRect {
    const boxes = Array.from(
      env.getPages()[m.pageIndex]?.wrapper.querySelectorAll<HTMLElement>(`.${layerClass} > *`) ?? [],
    ).filter((b) => b.dataset.markId === m.id);
    const rs = boxes.map((b) => b.getBoundingClientRect());
    if (!rs.length) return new DOMRect();
    const left = Math.min(...rs.map((r) => r.left));
    const top = Math.min(...rs.map((r) => r.top));
    return new DOMRect(left, top, Math.max(...rs.map((r) => r.right)) - left, Math.max(...rs.map((r) => r.bottom)) - top);
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
    env.open(m.id, boxOf(m));
  });

  return {
    /** Replace the marks. */
    set(next: PassageMark[]): void {
      const pages = new Set([...marks, ...next].map((m) => m.pageIndex));
      marks = next;
      for (const idx of pages) drawPage(idx);
    },
    /** Is there a mark under this client point? */
    at: (target: Element, x: number, y: number) => markAt(target, x, y) !== null,
    /** A page was drawn (perhaps at its own size, at last). */
    pageRendered(idx: number): void {
      if (marks.some((m) => m.pageIndex === idx)) drawPage(idx);
    },
  };
}
