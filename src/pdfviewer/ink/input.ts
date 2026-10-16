// The pen on the pages: which contacts draw, erase or select, and
// turning them into page coordinates.
//
// The rule is Hush's: the Apple Pencil (and a mouse, on the desktop)
// draws; a finger never does — it keeps scrolling and zooming the pages
// natively, so reading and writing need no mode switch beyond the pen
// itself. `PointerEvent.pointerType` tells them apart reliably in
// WKWebView. Stopping the Pencil from scrolling or selecting text takes
// its touch events: a non-passive touchstart / touchmove listener
// cancels only touches whose `touchType` is "stylus", so a finger's
// scroll stays on the fast path. Those listeners exist only while ink
// mode is on — a non-passive touch listener makes every scroll wait on
// the main thread, which reading shouldn't pay for.
//
// Per sample, the pen path does no layout reads and no allocation
// beyond the point itself: the page's box is read once at pen-down,
// samples are kept as client coordinates and drawn straight onto the
// live canvas, and only at pen-up are they converted to PDF points.
// Coalesced events (the samples between frames) are used where they
// are reliable; on iOS, as in Hush and tldraw, they are not.
import { pageBoxAt } from "../annotate";
import type { PageRecord } from "../types";
import type { Rect } from "./geometry";
import type { LiveLayer } from "./live";

export type InkTool = "pen" | "eraser" | "select";
type Pt = [number, number];

const IS_IOS =
  /iP(ad|hone|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
/** A pen's eraser button (PointerEvent.buttons). */
const ERASER_BUTTON = 32;
/** Screen pixels within which a tap selects a line. */
const SELECT_REACH_PX = 8;
/** Pen smoothing (see `smooth`): the share of the way to a new sample
 *  a slow pen moves, and the speed (CSS px per sample) from which a
 *  sample is taken as it is. */
const SMOOTH_MIN = 0.45;
const SMOOTH_SPEED = 12;

export interface InkInputEnv {
  scrollArea: HTMLElement;
  getPages: () => PageRecord[];
  live: LiveLayer;
  tool: () => InkTool;
  /** The pen's colour (as drawn) and width, in PDF points. */
  penStyle: () => { color: string; width: number };
  eraserSize: () => number;
  /** A gesture starts and ends: one step of undo. */
  begin: () => void;
  end: () => void;
  stroke: (pageIndex: number, points: number[]) => void;
  erase: (pageIndex: number, from: Pt | null, to: Pt) => void;
  /** Select: a press at a point; true when it took hold of the
   *  selection (to move it) rather than starting a rectangle. */
  press: (pageIndex: number, at: Pt, reach: number) => boolean;
  drag: (dx: number, dy: number) => void;
  drop: (dx: number, dy: number) => void;
  sweep: (pageIndex: number, rect: Rect | null) => void;
  /** A press off the pages. */
  pressOutside: () => void;
}

interface Gesture {
  id: number;
  mode: InkTool;
  idx: number;
  p: PageRecord;
  rect: DOMRect;
  /** CSS pixels per PDF point. */
  k: number;
  client: number[];
  start: Pt;
  last: Pt | null;
  grabbed: boolean;
  startClient: Pt;
}

export function attachInkInput(env: InkInputEnv) {
  const { scrollArea: area, live } = env;
  let on = false;
  let g: Gesture | null = null;

  function toPdf(gs: Gesture, cx: number, cy: number): Pt {
    const fx = Math.min(1, Math.max(0, (cx - gs.rect.left) / gs.rect.width));
    const fy = Math.min(1, Math.max(0, (cy - gs.rect.top) / gs.rect.height));
    const vp = gs.p.viewport;
    const [x, y] = vp.convertToPdfPoint(fx * vp.width, fy * vp.height);
    return [x, y];
  }

  function onDown(e: PointerEvent): void {
    if (!on || e.pointerType === "touch") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest("button, input, textarea, .pdf-annot-popover, .pdf-selection-bar")) return;
    e.preventDefault();
    e.stopPropagation();
    if (g) return;
    const at = pageBoxAt(target);
    const p = at ? env.getPages()[at.pageIndex] : null;
    if (!at || !p) {
      env.pressOutside();
      return;
    }
    const mode: InkTool = e.buttons & ERASER_BUTTON ? "eraser" : env.tool();
    const rect = at.box.getBoundingClientRect();
    const gs: Gesture = {
      id: e.pointerId,
      mode,
      idx: at.pageIndex,
      p,
      rect,
      k: rect.width / p.viewport.width,
      client: [e.clientX, e.clientY],
      start: [0, 0],
      last: null,
      grabbed: false,
      startClient: [e.clientX, e.clientY],
    };
    gs.start = toPdf(gs, e.clientX, e.clientY);
    g = gs;
    try {
      area.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    if (mode === "pen") {
      env.begin();
      const s = env.penStyle();
      live.begin({ color: s.color, width: Math.max(0.5, s.width * gs.k) }, e.clientX, e.clientY);
    } else if (mode === "eraser") {
      env.begin();
      env.erase(gs.idx, null, gs.start);
      gs.last = gs.start;
      live.showCursor(e.clientX, e.clientY, env.eraserSize() * gs.k);
    } else {
      gs.grabbed = env.press(gs.idx, gs.start, SELECT_REACH_PX / gs.k);
    }
  }

  /** A light touch of smoothing, the same for the line drawn live and
   *  the one kept: each point goes only part of the way to the pen's
   *  sample — less of the way the slower the pen moves, so a slow
   *  stroke loses the hand's tremor while a fast one doesn't trail
   *  behind the tip (a simple form of the "1€ filter"). */
  function smooth(gs: Gesture, x: number, y: number): Pt {
    const n = gs.client.length;
    const px = gs.client[n - 2];
    const py = gs.client[n - 1];
    const a = Math.min(1, SMOOTH_MIN + Math.hypot(x - px, y - py) / SMOOTH_SPEED);
    return [px + (x - px) * a, py + (y - py) * a];
  }

  function samples(e: PointerEvent): PointerEvent[] {
    if (IS_IOS || typeof e.getCoalescedEvents !== "function") return [e];
    const list = e.getCoalescedEvents();
    return list.length ? list : [e];
  }

  function onMove(e: PointerEvent): void {
    if (!g) {
      // A Pencil hovering (iPad Pro) or a mouse: show where the eraser
      // would land.
      if (on && e.pointerType !== "touch" && env.tool() === "eraser") {
        const at = pageBoxAt(e.target as Element);
        const p = at ? env.getPages()[at.pageIndex] : null;
        if (at && p) live.showCursor(e.clientX, e.clientY, env.eraserSize() * (at.box.offsetWidth / p.viewport.width));
        else live.showCursor(null);
      }
      return;
    }
    if (e.pointerId !== g.id) return;
    if (g.mode === "pen") {
      for (const s of samples(e)) {
        const [x, y] = smooth(g, s.clientX, s.clientY);
        g.client.push(x, y);
        live.extend(x, y);
      }
    } else if (g.mode === "eraser") {
      for (const s of samples(e)) {
        const pt = toPdf(g, s.clientX, s.clientY);
        env.erase(g.idx, g.last, pt);
        g.last = pt;
      }
      live.showCursor(e.clientX, e.clientY, env.eraserSize() * g.k);
    } else {
      const pt = toPdf(g, e.clientX, e.clientY);
      if (g.grabbed) env.drag(pt[0] - g.start[0], pt[1] - g.start[1]);
      else live.showMarquee(g.startClient, [e.clientX, e.clientY]);
    }
  }

  function onUp(e: PointerEvent): void {
    if (!g || e.pointerId !== g.id) return;
    const gs = g;
    g = null;
    if (gs.mode === "pen") {
      // The line ends where the pen left the page, not just short of it.
      const n = gs.client.length;
      if (n > 2 && Math.hypot(e.clientX - gs.client[n - 2], e.clientY - gs.client[n - 1]) > 0.5) {
        gs.client.push(e.clientX, e.clientY);
        live.extend(e.clientX, e.clientY);
      }
      live.finish();
      const pts: number[] = [];
      for (let i = 0; i + 1 < gs.client.length; i += 2) pts.push(...toPdf(gs, gs.client[i], gs.client[i + 1]));
      // The stroke joins the page's SVG, then leaves the live canvas —
      // in the same task, so no frame shows it twice or not at all.
      env.stroke(gs.idx, pts);
      env.end();
      live.clear();
    } else if (gs.mode === "eraser") {
      env.end();
      if (e.pointerType === "mouse" || e.type === "pointercancel") live.showCursor(null);
    } else {
      const pt = toPdf(gs, e.clientX, e.clientY);
      if (gs.grabbed) env.drop(pt[0] - gs.start[0], pt[1] - gs.start[1]);
      else {
        live.showMarquee(null);
        const tap = Math.hypot(e.clientX - gs.startClient[0], e.clientY - gs.startClient[1]) < 4;
        env.sweep(gs.idx, tap ? null : [
          Math.min(gs.start[0], pt[0]), Math.min(gs.start[1], pt[1]),
          Math.max(gs.start[0], pt[0]), Math.max(gs.start[1], pt[1]),
        ]);
      }
    }
  }

  function onLeave(e: PointerEvent): void {
    if (!g && e.pointerType !== "touch") live.showCursor(null);
  }

  /** The Pencil mustn't scroll the pages or start a text selection —
   *  nor, while it is down, may a hand resting on the screen. */
  function onTouch(e: TouchEvent): void {
    if (g) {
      e.preventDefault();
      return;
    }
    for (const t of Array.from(e.changedTouches)) {
      if ((t as Touch & { touchType?: string }).touchType === "stylus") {
        e.preventDefault();
        return;
      }
    }
  }

  area.addEventListener("pointerdown", onDown, true);
  area.addEventListener("pointermove", onMove);
  area.addEventListener("pointerup", onUp);
  area.addEventListener("pointercancel", onUp);
  area.addEventListener("pointerleave", onLeave);

  function setEnabled(next: boolean): void {
    if (next === on) return;
    on = next;
    if (on) {
      area.addEventListener("touchstart", onTouch, { passive: false });
      area.addEventListener("touchmove", onTouch, { passive: false });
    } else {
      area.removeEventListener("touchstart", onTouch);
      area.removeEventListener("touchmove", onTouch);
      g = null;
    }
  }

  function destroy(): void {
    setEnabled(false);
    area.removeEventListener("pointerdown", onDown, true);
    area.removeEventListener("pointermove", onMove);
    area.removeEventListener("pointerup", onUp);
    area.removeEventListener("pointercancel", onUp);
    area.removeEventListener("pointerleave", onLeave);
  }

  return { setEnabled, destroy, busy: () => g !== null };
}
