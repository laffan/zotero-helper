// Night vision's colour flags. In night vision (lib/nightVision.ts) the
// whole app is drawn in shades of red, and the highlight colours —
// told apart by hue — look alike. So while it is on, each highlight and
// underline on a page gets a tiny flag in its colour carrying the
// colour's letter (`colorLetter`: Y, R, G, B, P, M, O, Gy — the same
// letters the colour dots show then).
//
// A flag is kept off the text where it can be. It is attached where the
// passage meets a line break, so it lies in the margin or a column's
// gutter rather than over words:
//   1. the left edge of the first of the passage's lines that starts a
//      line of text (its first line, if the passage begins a line; else
//      its second, which always does);
//   2. else the right edge of the first line that ends a line of text
//      (a one-line passage running to the line's end);
//   3. else (one line, words on both sides) in the margin at the start
//      of that line of text, level with the passage.
// "A line of text" is a run of the page's text items without a gap
// wider than a line's height, so the other column of a two-column page
// doesn't count. Flags that would meet are moved apart along the line.
// With no text to go by (a scan), a flag goes at the passage's left
// edge.
//
// Drawn like the passage marks (passageMarks.ts): a layer on the page
// wrapper in percentages of the page, so it follows every zoom, and
// SVG, so the letter scales with its flag. Built only while night vision
// is on (the page's text is read for it then), and shown only then
// (nightvision.css). The folded view and the thumbnails have none.
import { annotationPosition, colorLetter, rectsOnPage, type Annotation } from "../lib/highlights";
import { textItems } from "../lib/pdfQuote";
import { isPostItPart } from "../lib/postits";
import type { PageRecord, PageViewport, PDFDocumentProxy } from "./types";

export interface ColorFlagsEnv {
  getPages: () => PageRecord[];
  getPdfDoc: () => PDFDocumentProxy | null;
  getAnnotations: () => Annotation[];
}

/** A box in the page's scale-1 viewport units (x right, y down). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A text item as four corners in PDF user space. */
type Quad = number[];

const LAYER = "pdf-color-flags";
const SVG = "http://www.w3.org/2000/svg";

const nightVisionOn = () => document.documentElement.classList.contains("night-vision");

function boxOf(vp: PageViewport, pts: number[]): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const [x, y] = vp.convertToViewportPoint(pts[i], pts[i + 1]);
    xs.push(x);
    ys.push(y);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const overlapY = (a: Box, b: Box) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
const meets = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A passage's rects as lines, top to bottom. */
function linesOf(boxes: Box[]): Box[] {
  const lines: Box[] = [];
  for (const b of [...boxes].sort((p, q) => p.y - q.y || p.x - q.x)) {
    const l = lines.find((m) => overlapY(m, b) > 0.5 * Math.min(m.h, b.h));
    if (!l) {
      lines.push({ ...b });
      continue;
    }
    const x2 = Math.max(l.x + l.w, b.x + b.w);
    const y2 = Math.max(l.y + l.h, b.y + b.h);
    l.x = Math.min(l.x, b.x);
    l.y = Math.min(l.y, b.y);
    l.w = x2 - l.x;
    l.h = y2 - l.y;
  }
  return lines;
}

/** How far the line of text through `line` runs to the left and right:
 *  its text items, joined while the gap between them is under a line's
 *  height. */
function runOf(line: Box, text: Box[]): { start: number; end: number } {
  const on = text.filter((t) => overlapY(t, line) > 0.3 * Math.min(t.h, line.h));
  const reach = line.h;
  let start = line.x;
  let end = line.x + line.w;
  for (let moved = true; moved; ) {
    moved = false;
    for (const t of on) {
      if (t.x < start && t.x + t.w >= start - reach) {
        start = t.x;
        moved = true;
      }
      if (t.x + t.w > end && t.x <= end + reach) {
        end = t.x + t.w;
        moved = true;
      }
    }
  }
  return { start, end };
}

/** A text item's corners: along its baseline by its width, up by its
 *  height, from its origin. */
function quadOf(it: { transform?: number[]; width?: number; height?: number; str?: string }): Quad | null {
  const t = it.transform;
  if (!t || !it.str?.trim()) return null;
  const [a, b, c, d, e, f] = t;
  const w = Number(it.width) || 0;
  const h = Number(it.height) || Math.hypot(c, d);
  const along = Math.hypot(a, b) || 1;
  const up = Math.hypot(c, d) || 1;
  const ux = (a / along) * w;
  const uy = (b / along) * w;
  const vx = (c / up) * h;
  const vy = (d / up) * h;
  return [e, f, e + ux, f + uy, e + vx, f + vy, e + ux + vx, f + uy + vy];
}

function flagEl(f: Box, side: "left" | "right", color: string, letter: string, vp: PageViewport): SVGSVGElement {
  // A tab 10 units high, 8 wide for one letter (11 for two), square on
  // the side it is attached by and rounded on the other.
  const vw = letter.length > 1 ? 11 : 8;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", `pdf-color-flag pdf-color-flag-${side}`);
  svg.setAttribute("viewBox", `0 0 ${vw} 10`);
  svg.style.left = `${(f.x / vp.width) * 100}%`;
  svg.style.top = `${(f.y / vp.height) * 100}%`;
  svg.style.width = `${(f.w / vp.width) * 100}%`;
  svg.style.height = `${(f.h / vp.height) * 100}%`;
  const r = 2.5;
  const path = document.createElementNS(SVG, "path");
  path.setAttribute(
    "d",
    side === "left"
      ? `M${vw} 0.5H${r + 0.5}A${r} ${r} 0 0 0 0.5 ${r + 0.5}V${9.5 - r}A${r} ${r} 0 0 0 ${r + 0.5} 9.5H${vw}Z`
      : `M0 0.5H${vw - r - 0.5}A${r} ${r} 0 0 1 ${vw - 0.5} ${r + 0.5}V${9.5 - r}A${r} ${r} 0 0 1 ${vw - r - 0.5} 9.5H0Z`,
  );
  path.setAttribute("fill", color);
  const text = document.createElementNS(SVG, "text");
  text.setAttribute("x", String(vw / 2));
  text.setAttribute("y", "7.6");
  text.setAttribute("text-anchor", "middle");
  text.textContent = letter;
  svg.append(path, text);
  return svg;
}

export function createColorFlags(env: ColorFlagsEnv) {
  // Each page's text, read once (and only in night vision).
  const texts = new Map<number, Promise<Quad[]>>();
  // A page's latest draw; an older one still reading its text gives way.
  const tokens = new Map<number, number>();

  function pageText(idx: number): Promise<Quad[]> {
    let t = texts.get(idx);
    if (!t) {
      const doc = env.getPdfDoc();
      t = doc
        ? doc
            .getPage(idx + 1)
            .then((page) => textItems(page))
            .then((items) => items.map(quadOf).filter((q): q is Quad => q !== null))
            .catch(() => [])
        : Promise.resolve([]);
      texts.set(idx, t);
    }
    return t;
  }

  /** The highlights and underlines with rects on page `idx`. */
  function marksOn(idx: number): { a: Annotation; rects: number[][] }[] {
    const out: { a: Annotation; rects: number[][] }[] = [];
    for (const a of env.getAnnotations()) {
      if ((a.type !== "highlight" && a.type !== "underline") || isPostItPart(a)) continue;
      const rects = rectsOnPage(annotationPosition(a), idx)?.filter((r) => Array.isArray(r) && r.length >= 4);
      if (rects?.length) out.push({ a, rects });
    }
    return out;
  }

  async function drawPage(idx: number): Promise<void> {
    const token = (tokens.get(idx) ?? 0) + 1;
    tokens.set(idx, token);
    const marks = nightVisionOn() ? marksOn(idx) : [];
    if (!marks.length) {
      env.getPages()[idx]?.wrapper.querySelector(`:scope > .${LAYER}`)?.remove();
      return;
    }
    const quads = await pageText(idx);
    const p = env.getPages()[idx];
    if (tokens.get(idx) !== token || !p || !nightVisionOn()) return;
    const vp = p.viewport;
    const text = quads.map((q) => boxOf(vp, q));
    const placed: Box[] = [];
    const layer = document.createElement("div");
    layer.className = LAYER;
    for (const { a, rects } of marks) {
      const lines = linesOf(rects.map((r) => boxOf(vp, r)));
      if (!lines.length) continue;
      const color = a.color || "#ffd400";
      const letter = colorLetter(color);
      const runs = lines.map((l) => runOf(l, text));
      const tol = (l: Box) => 0.25 * l.h;
      let at = lines.findIndex((l, i) => runs[i].start >= l.x - tol(l));
      let side: "left" | "right" = "left";
      if (at < 0) {
        at = lines.findIndex((l, i) => runs[i].end <= l.x + l.w + tol(l));
        if (at >= 0) side = "right";
      }
      const line = lines[Math.max(0, at)];
      const h = line.h;
      const w = h * (letter.length > 1 ? 1.1 : 0.8);
      const gap = 0.08 * h;
      const edge = at < 0 ? runs[0].start : line.x;
      const f: Box = { x: side === "left" ? edge - gap - w : line.x + line.w + gap, y: line.y, w, h };
      // Apart from the flags already placed, outwards along the line.
      for (let n = 0; n < 8 && placed.some((q) => meets(q, f)); n++) f.x += (side === "left" ? -1 : 1) * (w + gap);
      f.x = Math.min(Math.max(0, f.x), vp.width - w);
      placed.push(f);
      layer.appendChild(flagEl(f, side, color, letter, vp));
    }
    p.wrapper.querySelector(`:scope > .${LAYER}`)?.remove();
    p.wrapper.appendChild(layer);
  }

  const drawn = () => env.getPages().flatMap((p, i) => (p.rendered ? [i] : []));
  const redrawAll = () => {
    for (const i of drawn()) void drawPage(i);
  };

  // Night vision turned on or off: flags for the pages drawn, or none.
  let was = nightVisionOn();
  const watch = new MutationObserver(() => {
    const now = nightVisionOn();
    if (now !== was) {
      was = now;
      if (now) redrawAll();
      else for (const p of env.getPages()) p.wrapper.querySelector(`:scope > .${LAYER}`)?.remove();
    }
  });
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  return {
    /** A page was drawn (perhaps at its own size, at last). */
    pageRendered(idx: number): void {
      if (nightVisionOn()) void drawPage(idx);
    },
    /** The annotations changed. */
    sync(): void {
      if (nightVisionOn()) redrawAll();
    },
    destroy(): void {
      watch.disconnect();
    },
  };
}
