// Ink on the pages, drawn as SVG over each page rather than into its
// raster.
//
// Highlights are painted into the pdf.js raster (paint.ts), so a new
// one costs a re-render of its page. That is fine for a highlight now
// and then and hopeless for handwriting, where strokes arrive a few
// times a second: each would re-rasterise the page, text layer and all.
// So on the pages ink lives in one <svg> per page — a stroke is one
// <path> appended, an erase rebuilds one annotation's group, and
// because the SVG is sized by its viewBox it follows every zoom and
// relayout without being redrawn. (The thumbnails and the folded view
// still paint ink into their rasters; nothing is drawn there.)
//
// A stroke the pen has just finished is not drawn here at once. It is
// already on the live canvas (live.ts), in the pixels the pen drew, and
// stays there while the writing goes on: the page's new drawing waits
// (`park`) until the pen rests, or until anything else needs it
// (`settle` — an erasure, a selection, a scroll, a relayout). Adding a
// path makes the browser lay out and paint the page's SVG again, a cost
// that grows with the ink on the page and that would otherwise land in
// the twentieth of a second before the letter's next stroke; and with
// nothing changed in the page, the next pen-down's read of the page's
// box finds no layout to do.
//
// The SVG's outer group maps PDF user space onto the page through the
// page's own viewport transform, so paths go in as Zotero stores them
// and a CropBox origin or /Rotate is honoured, as in paint.ts.
import type { PageRecord } from "../types";
import { inkStrokeColor, pathD, type Rect } from "./geometry";

const SVG_NS = "http://www.w3.org/2000/svg";

/** One ink annotation as the layer (and the session) sees it. */
export interface InkAnn {
  key: string;
  pageIndex: number;
  color: string;
  width: number;
  paths: number[][];
  /** The position as stored (JSON), which is also what tells two
   *  versions of an annotation apart. */
  pos: string;
  editable: boolean;
  bounds?: Rect | null;
}

interface Drawn {
  g: SVGGElement;
  color: string;
  width: number;
  pos: string;
  paths: number[][];
}

interface PageSvg {
  wrapper: HTMLElement;
  svg: SVGSVGElement;
  root: SVGGElement;
  chrome: SVGGElement;
  matrix: string;
  drawn: Map<string, Drawn>;
}

function el<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

export function createInkLayer(getPages: () => PageRecord[]) {
  const svgs = new Map<number, PageSvg>();
  // The pages whose drawing waits for the pen to rest, and what each
  // is to show.
  const waiting = new Map<number, InkAnn[]>();
  let settled: () => void = () => {};

  function matrixOf(p: PageRecord): string {
    return `matrix(${p.viewport.transform.join(" ")})`;
  }

  /** The page's SVG, made (or moved to a new wrapper after a reload)
   *  on demand. */
  function pageSvg(idx: number, create: boolean): PageSvg | null {
    const p = getPages()[idx];
    if (!p) return null;
    let s = svgs.get(idx);
    if (s && s.wrapper !== p.wrapper) {
      s.svg.remove();
      svgs.delete(idx);
      s = undefined;
    }
    if (!s && create) {
      const svg = el("svg");
      svg.setAttribute("class", "pdf-ink-layer");
      svg.setAttribute("preserveAspectRatio", "none");
      const root = el("g");
      const chrome = el("g");
      chrome.setAttribute("class", "pdf-ink-chrome");
      svg.append(root, chrome);
      p.wrapper.appendChild(svg);
      s = { wrapper: p.wrapper, svg, root, chrome, matrix: "", drawn: new Map() };
      svgs.set(idx, s);
    }
    if (s) fit(s, p);
    return s ?? null;
  }

  /** The viewBox and transform for the page's viewport — which is page
   *  1's until the page first renders and reports its own. */
  function fit(s: PageSvg, p: PageRecord): void {
    const m = matrixOf(p);
    if (m === s.matrix) return;
    s.matrix = m;
    s.svg.setAttribute("viewBox", `0 0 ${p.viewport.width} ${p.viewport.height}`);
    s.root.setAttribute("transform", m);
    s.chrome.setAttribute("transform", m);
  }

  function addPath(g: SVGGElement, path: number[]): void {
    const d = pathD(path);
    if (!d) return;
    const node = el("path");
    node.setAttribute("d", d);
    g.appendChild(node);
  }

  function styleGroup(g: SVGGElement, a: InkAnn): void {
    g.setAttribute("stroke", inkStrokeColor(a.color));
    g.setAttribute("stroke-width", String(a.width));
  }

  function build(a: InkAnn): Drawn {
    const g = el("g");
    g.setAttribute("fill", "none");
    g.setAttribute("stroke-linecap", "round");
    g.setAttribute("stroke-linejoin", "round");
    styleGroup(g, a);
    for (const path of a.paths) addPath(g, path);
    return { g, color: a.color, width: a.width, pos: a.pos, paths: a.paths };
  }

  /** A page's drawing after a stroke of the pen: not yet — the stroke
   *  is on the live canvas, and stays there until `settle`. */
  function park(idx: number, list: InkAnn[]): void {
    waiting.set(idx, list);
  }

  /** Draw what waited, and say so (the live canvas is then cleared, in
   *  the same task: no frame shows a stroke twice, or not at all). */
  function settle(): void {
    if (!waiting.size) return;
    const lists = [...waiting];
    waiting.clear();
    for (const [idx, list] of lists) draw(idx, list);
    settled();
  }

  /** Bring one page's drawing in line with `list` (its ink, bottom to
   *  top) — and with it every page that waited. */
  function render(idx: number, list: InkAnn[]): void {
    if (!waiting.size) return draw(idx, list);
    waiting.set(idx, list);
    settle();
  }

  /** Unchanged annotations are left alone; one that only gained
   *  strokes at the end — the common case while writing — gets just
   *  those. */
  function draw(idx: number, list: InkAnn[]): void {
    const s = pageSvg(idx, list.length > 0);
    if (!s) return;
    const keep = new Set<string>();
    let prev: SVGGElement | null = null;
    for (const a of list) {
      keep.add(a.key);
      let d = s.drawn.get(a.key);
      if (d && (d.pos !== a.pos || d.color !== a.color)) {
        const n = d.paths.length;
        const appended =
          a.paths.length > n && d.color === a.color && d.width === a.width && d.paths.every((p, i) => p === a.paths[i]);
        if (appended) {
          for (let i = n; i < a.paths.length; i++) addPath(d.g, a.paths[i]);
          d.pos = a.pos;
          d.paths = a.paths;
        } else if (d.paths === a.paths) {
          styleGroup(d.g, a); // a new colour or width, the same lines
          Object.assign(d, { color: a.color, width: a.width, pos: a.pos });
        } else {
          const fresh = build(a);
          d.g.replaceWith(fresh.g);
          s.drawn.set(a.key, fresh);
          d = fresh;
        }
      } else if (!d) {
        d = build(a);
        s.drawn.set(a.key, d);
        if (prev) prev.after(d.g);
        else s.root.prepend(d.g);
      }
      prev = d.g;
    }
    for (const [key, d] of s.drawn) {
      if (keep.has(key)) continue;
      d.g.remove();
      s.drawn.delete(key);
    }
  }

  /** A page has rendered and may now know its real size. */
  function pageRendered(idx: number): void {
    const s = svgs.get(idx);
    const p = getPages()[idx];
    if (s && p) fit(s, p);
  }

  /** Shift annotations while they are dragged (PDF points), or put
   *  them back with 0, 0. */
  function setOffset(idx: number, keys: Iterable<string>, dx: number, dy: number): void {
    settle();
    const s = svgs.get(idx);
    if (!s) return;
    for (const k of keys) {
      const g = s.drawn.get(k)?.g;
      if (!g) continue;
      if (dx || dy) g.setAttribute("transform", `translate(${dx} ${dy})`);
      else g.removeAttribute("transform");
    }
  }

  /** Frame the selected annotations' bounds on their page (one page
   *  at a time); null clears every frame. */
  function showSelection(idx: number | null, boxes: Rect[], pad: number, dx = 0, dy = 0): void {
    for (const [i, s] of svgs) if (i !== idx) s.chrome.replaceChildren();
    if (idx === null) return;
    const s = pageSvg(idx, boxes.length > 0);
    if (!s) return;
    s.chrome.replaceChildren(
      ...boxes.map((b) => {
        const r = el("rect");
        r.setAttribute("x", String(b[0] - pad + dx));
        r.setAttribute("y", String(b[1] - pad + dy));
        r.setAttribute("width", String(b[2] - b[0] + pad * 2));
        r.setAttribute("height", String(b[3] - b[1] + pad * 2));
        r.setAttribute("class", "pdf-ink-selection");
        return r;
      }),
    );
  }

  /** Forget everything — the pages are about to be replaced. */
  function reset(): void {
    for (const s of svgs.values()) s.svg.remove();
    svgs.clear();
    if (!waiting.size) return;
    waiting.clear();
    settled();
  }

  return {
    render,
    park,
    settle,
    /** Is any page's drawing waiting? */
    parked: () => waiting.size > 0,
    /** Hear when what waited has been drawn (or dropped). */
    onSettled: (fn: () => void) => (settled = fn),
    pageRendered,
    setOffset,
    showSelection,
    reset,
    pages: () => [...svgs.keys()],
  };
}

export type InkLayer = ReturnType<typeof createInkLayer>;
