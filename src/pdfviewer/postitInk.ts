// Writing on a post-it (postits.ts): the Pencil — or a mouse dragged —
// writes on the paper, and erases with the eraser on (lib/penTool.ts,
// shared with ink mode and the notepad: the Pencil's double-tap) or a
// pen's eraser end, which takes out every stroke it passes over. A
// mouse's click without a drag writes nothing; a Pencil's tap is a dot.
//
// The rules are the pages' ink's (ink/input.ts, ink/layer.ts), at a
// post-it's size. The paper's kept strokes are an <svg> in its own
// points, stretched with it through every zoom. The stroke under the
// pen is drawn on a canvas over the paper, one segment a sample, with
// nothing read from the layout after the box at pen-down; at pen-up
// the stroke is kept (smoothed as Zotero smooths ink) and stays on the
// canvas, and the strokes of a word join the SVG together once the pen
// has rested (SETTLE_MS) — so nothing in the document changes between
// a letter's strokes. The canvas lies in the paper and moves with the
// page, so a scroll needs no settling. Every gesture is reported to
// lib/penActivity.ts, which the page renders and the push wait on.
import { penDown, penHeard, penUp } from "../lib/penActivity";
import { isErasing } from "../lib/penTool";
import { POSTIT_INK, POSTIT_PEN } from "../lib/postits";
import { hitsPaths, pathD, smoothPath } from "./ink/geometry";

/** The strokes of a word join the SVG once the pen rests this long. */
const SETTLE_MS = 600;
/** A gesture that has heard nothing for this long has lost its end. */
const STALE_MS = 1500;
/** A pen's eraser button (PointerEvent.buttons). */
const ERASER_BUTTON = 32;
/** How near the eraser takes a stroke, in the paper's points. */
const ERASE_REACH = 4;
/** A mouse press that moves less than this, CSS px, is a click. */
const CLICK_PX = 3;

const IS_IOS =
  /iP(ad|hone|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const round2 = (v: number) => Math.round(v * 100) / 100;
const SVG_NS = "http://www.w3.org/2000/svg";

/** A post-it, as the pen sees it. */
export interface PenTarget {
  id: string;
  el: HTMLElement;
  /** The paper's size, in points. */
  w: number;
  h: number;
  strokes: number[][];
  /** A stroke was kept, or strokes erased. */
  changed: () => void;
}

/** A post-it's strokes, drawn into its <svg> afresh. */
export function drawPostItInk(svg: SVGSVGElement, strokes: number[][], w: number, h: number): void {
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.replaceChildren(...strokes.map(strokePath));
}

function strokePath(s: number[]): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathD(s));
  return path;
}

interface Live {
  target: PenTarget;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  box: DOMRect;
  /** CSS px per point. */
  k: number;
  /** Kept strokes still only on the canvas. */
  parked: number[][];
}

interface Gesture {
  id: number;
  target: PenTarget;
  erase: boolean;
  mouse: boolean;
  box: DOMRect;
  k: number;
  /** The stroke, in the paper's points. */
  pts: number[];
  startX: number;
  startY: number;
  moved: boolean;
}

export function createPostItPen(env: { writing?: () => void; erased?: (t: PenTarget) => void }) {
  // This layer's pen, to lib/penActivity.ts.
  const me = {};
  let live: Live | null = null;
  let g: Gesture | null = null;
  let heardAt = 0;
  let settleTimer = 0;

  /** The parked strokes into the SVG; the canvas goes. */
  function settle(): void {
    window.clearTimeout(settleTimer);
    const l = live;
    if (!l) return;
    live = null;
    const svg = l.target.el.querySelector<SVGSVGElement>(".pdf-postit-ink");
    if (svg) for (const s of l.parked) svg.appendChild(strokePath(s));
    l.canvas.remove();
    l.target.el.classList.remove("writing");
  }

  /** The canvas for writing on `target`, the size its box is now. */
  function liveFor(target: PenTarget, box: DOMRect): Live | null {
    const k = box.width / target.w;
    const same = live?.target.id === target.id && Math.abs(live.box.width - box.width) <= 0.5 && Math.abs(live.box.height - box.height) <= 0.5;
    if (live && !same) settle();
    if (live) {
      live.target = target;
      live.box = box;
      return live;
    }
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-postit-live";
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = POSTIT_INK;
    ctx.lineWidth = POSTIT_PEN * k;
    (target.el.querySelector(".pdf-postit-sheet") ?? target.el).appendChild(canvas);
    live = { target, canvas, ctx, box, k, parked: [] };
    return live;
  }

  const local = (gs: Gesture, x: number, y: number): [number, number] => [
    (x - gs.box.left) / gs.k,
    (y - gs.box.top) / gs.k,
  ];

  /** Take out the strokes within reach of a point. */
  function eraseAt(gs: Gesture, x: number, y: number): void {
    const t = gs.target;
    const kept = t.strokes.filter((s) => !hitsPaths([s], POSTIT_PEN, x, y, ERASE_REACH));
    if (kept.length === t.strokes.length) return;
    t.strokes = kept;
    const svg = t.el.querySelector<SVGSVGElement>(".pdf-postit-ink");
    if (svg) drawPostItInk(svg, kept, t.w, t.h);
    t.changed();
    env.erased?.(t);
  }

  function sample(e: PointerEvent): void {
    const gs = g;
    if (!gs) return;
    const [x, y] = local(gs, e.clientX, e.clientY);
    gs.moved ||= Math.hypot(e.clientX - gs.startX, e.clientY - gs.startY) > CLICK_PX;
    if (gs.erase) return eraseAt(gs, x, y);
    const n = gs.pts.length;
    const ctx = live?.ctx;
    if (ctx && n >= 2) {
      ctx.beginPath();
      ctx.moveTo(gs.pts[n - 2] * gs.k, gs.pts[n - 1] * gs.k);
      ctx.lineTo(x * gs.k, y * gs.k);
      ctx.stroke();
    }
    gs.pts.push(x, y);
  }

  function onMove(e: PointerEvent): void {
    if (!g || e.pointerId !== g.id) return;
    heardAt = performance.now();
    penHeard(heardAt);
    e.preventDefault();
    const list = !IS_IOS && typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    if (list.length) for (const c of list) sample(c);
    else sample(e);
  }

  function onUp(e: PointerEvent): void {
    if (!g || e.pointerId !== g.id) return;
    end();
  }

  /** The gesture over: its stroke kept (a mouse's click keeps none). */
  function end(): void {
    const gs = g;
    if (!gs) return;
    g = null;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
    penUp(me);
    env.writing?.();
    if (gs.erase || (gs.mouse && !gs.moved) || !gs.pts.length) {
      if (live && !live.parked.length) settle();
      if (live?.target.id !== gs.target.id) gs.target.el.classList.remove("writing");
      return;
    }
    const stroke = smoothPath(gs.pts).map(round2);
    gs.target.strokes = [...gs.target.strokes, stroke];
    if (live?.target.id === gs.target.id) {
      live.parked.push(stroke);
      // A dot: the canvas has no segment for it yet.
      if (gs.pts.length === 2) {
        live.ctx.beginPath();
        live.ctx.moveTo(gs.pts[0] * gs.k, gs.pts[1] * gs.k);
        live.ctx.lineTo(gs.pts[0] * gs.k, gs.pts[1] * gs.k);
        live.ctx.stroke();
      }
    }
    gs.target.changed();
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settle, SETTLE_MS);
  }

  return {
    /** A pen (or the mouse) pressed on `target`'s paper. */
    down(target: PenTarget, e: PointerEvent): void {
      // A pen can't be down twice: one left open ends first.
      if (g) end();
      window.clearTimeout(settleTimer);
      const box = target.el.getBoundingClientRect();
      const erase = isErasing() || (e.buttons & ERASER_BUTTON) !== 0;
      const k = box.width / target.w;
      if (erase) settle();
      else if (!liveFor(target, box)) return;
      g = { id: e.pointerId, target, erase, mouse: e.pointerType === "mouse", box, k, pts: [], startX: e.clientX, startY: e.clientY, moved: false };
      // Being written on: the paper more opaque until the writing settles.
      target.el.classList.add("writing");
      heardAt = performance.now();
      penDown(me);
      env.writing?.();
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
      sample(e);
    },
    /** Is `id` being written on, or its strokes still parked? */
    busy: (id: string): boolean =>
      (g !== null && g.target.id === id && performance.now() - heardAt < STALE_MS) || live?.target.id === id,
    settle,
    destroy(): void {
      end();
      settle();
    },
  };
}

export type PostItPen = ReturnType<typeof createPostItPen>;
