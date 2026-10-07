// Find in the open PDF — what the toolbar's search box does while a PDF
// is open.
//
// Each page's text comes from pdf.js's text content (a scan's OCR layer
// included), read once per document and kept. Hits are drawn as boxes
// in an overlay on the page wrapper, positioned in percentages of the
// page, so they need no rendered raster, survive eviction and follow
// every zoom. Pages are searched in order and the count grows as they
// are read, so a long book shows its first hits at once.
import type { PageRecord, PDFDocumentProxy } from "./types";

interface TextItem {
  str: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
  height: number;
}

/** One page's text, joined, with where each item starts in it. */
interface PageText {
  text: string;
  items: TextItem[];
  starts: number[];
  width: number;
  height: number;
  /** Maps PDF user space to the scale-1 viewport. */
  transform: number[];
}

/** A hit: its page and its boxes, as fractions of the page. */
interface Hit {
  page: number; // 0-based
  rects: { x: number; y: number; w: number; h: number }[];
}

export interface SearchStatus {
  query: string;
  total: number;
  /** 1-based index of the current hit; 0 when there is none. */
  current: number;
  /** Every page has been read. */
  done: boolean;
}

export interface SearchEnv {
  getPdfDoc: () => PDFDocumentProxy | null;
  getPages: () => PageRecord[];
  /** Bring a hit into view: its page index and the hit's vertical
   *  position on the page (0–1). */
  reveal: (page: number, x: number, y: number) => void;
  isDestroyed: () => boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function applyTransform(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function createPdfSearch(env: SearchEnv) {
  const texts = new Map<number, PageText>();
  let hits: Hit[] = [];
  let current = -1;
  let query = "";
  let token = 0;
  let listener: ((s: SearchStatus) => void) | null = null;
  let done = true;

  async function pageText(i: number): Promise<PageText | null> {
    const cached = texts.get(i);
    if (cached) return cached;
    const doc = env.getPdfDoc();
    if (!doc) return null;
    const page = await doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = (content.items as unknown[]).filter(
      (it): it is TextItem => typeof (it as TextItem).str === "string",
    );
    let text = "";
    const starts: number[] = [];
    for (const it of items) {
      starts.push(text.length);
      text += it.str;
      // Line ends become spaces, so a phrase broken across lines is
      // still one phrase.
      if (it.hasEOL && !/\s$/.test(it.str)) text += " ";
    }
    const pt = { text, items, starts, width: vp.width, height: vp.height, transform: vp.transform };
    texts.set(i, pt);
    return pt;
  }

  /** The item holding character `pos`: the last one starting at or before it. */
  function itemAt(pt: PageText, pos: number): number {
    let lo = 0;
    let hi = pt.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pt.starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Boxes for characters [from, to) of a page — one per text item the
   *  match runs through, the item's width shared out by character. */
  function rectsFor(pt: PageText, from: number, to: number): Hit["rects"] {
    const out: Hit["rects"] = [];
    for (let k = itemAt(pt, from); k < pt.items.length && pt.starts[k] < to; k++) {
      const it = pt.items[k];
      const len = it.str.length;
      if (!len) continue;
      const a = Math.max(0, from - pt.starts[k]) / len;
      const b = Math.min(len, to - pt.starts[k]) / len;
      if (b <= a) continue;
      const [ta, tb, tc, td, tx, ty] = it.transform;
      // Along the baseline, in the item's own direction.
      const dirX = Math.hypot(ta, tb) || 1;
      const ux = ta / dirX;
      const uy = tb / dirX;
      const fontH = it.height || Math.hypot(tc, td);
      const corners = [
        [tx + ux * it.width * a, ty + uy * it.width * a],
        [tx + ux * it.width * b, ty + uy * it.width * b],
      ].flatMap(([x, y]) => [
        // A little below the baseline for descenders, up to the cap.
        applyTransform(pt.transform, x + uy * fontH * 0.22, y - ux * fontH * 0.22),
        applyTransform(pt.transform, x - uy * fontH * 0.98, y + ux * fontH * 0.98),
      ]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      out.push({
        x: x0 / pt.width,
        y: y0 / pt.height,
        w: (Math.max(...xs) - x0) / pt.width,
        h: (Math.max(...ys) - y0) / pt.height,
      });
    }
    return out;
  }

  function status(): SearchStatus {
    return { query, total: hits.length, current: current + 1, done };
  }
  const notify = () => listener?.(status());

  function clearOverlays(): void {
    for (const p of env.getPages()) p.wrapper.querySelector(".pdf-search-hits")?.remove();
  }

  function paintPage(page: number): void {
    const wrapper = env.getPages()[page]?.wrapper;
    if (!wrapper) return;
    wrapper.querySelector(".pdf-search-hits")?.remove();
    const layer = document.createElement("div");
    layer.className = "pdf-search-hits";
    hits.forEach((h, idx) => {
      if (h.page !== page) return;
      for (const r of h.rects) {
        const box = document.createElement("div");
        box.className = idx === current ? "pdf-search-hit current" : "pdf-search-hit";
        box.style.left = `${r.x * 100}%`;
        box.style.top = `${r.y * 100}%`;
        box.style.width = `${r.w * 100}%`;
        box.style.height = `${r.h * 100}%`;
        layer.appendChild(box);
      }
    });
    if (layer.childElementCount) wrapper.appendChild(layer);
  }

  function select(idx: number): void {
    const prev = hits[current]?.page;
    current = idx;
    const hit = hits[idx];
    if (prev != null && prev !== hit?.page) paintPage(prev);
    if (!hit) return notify();
    paintPage(hit.page);
    const r = hit.rects[0];
    env.reveal(hit.page, r ? r.x + r.w / 2 : 0.5, r ? r.y + r.h / 2 : 0);
    notify();
  }

  /** Search for `q` (case-insensitive; any run of spaces in it matches
   *  any whitespace). The first hit is shown as soon as it is found. */
  async function search(q: string): Promise<void> {
    const my = ++token;
    query = q.trim();
    hits = [];
    current = -1;
    clearOverlays();
    const doc = env.getPdfDoc();
    if (!query || !doc) {
      done = true;
      return notify();
    }
    done = false;
    notify();
    const re = new RegExp(query.split(/\s+/).map(escapeRe).join("\\s+"), "gi");
    for (let i = 0; i < doc.numPages; i++) {
      const pt = await pageText(i).catch(() => null);
      if (my !== token || env.isDestroyed()) return;
      if (!pt) continue;
      let found = false;
      for (const m of pt.text.matchAll(re)) {
        if (!m[0]) continue;
        hits.push({ page: i, rects: rectsFor(pt, m.index ?? 0, (m.index ?? 0) + m[0].length) });
        found = true;
      }
      if (found) {
        paintPage(i);
        if (current < 0) select(0);
        else notify();
      }
    }
    done = true;
    notify();
  }

  /** Move to the next (1) or previous (-1) hit, wrapping round. */
  function step(dir: 1 | -1): void {
    if (!hits.length) return;
    select((current + dir + hits.length) % hits.length);
  }

  function clear(): void {
    void search("");
  }

  return {
    search,
    step,
    clear,
    onChange: (fn: ((s: SearchStatus) => void) | null) => {
      listener = fn;
    },
  };
}
