// The pen on the pages: which contacts draw, erase or select, and
// turning them into page coordinates.
//
// Only the Apple Pencil (a pen, `pointerType` "pen") draws. A finger, a
// mouse or a trackpad does in ink mode what it does out of it — scroll
// and zoom the pages, select text and highlight it, tap a highlight or a
// link — so reading and writing need no mode switch beyond the pen in
// hand; except that a finger landing on a drawing (or on what is
// selected) is the select tool: it selects that drawing and drags it.
// `PointerEvent.pointerType` tells them apart reliably in WKWebView. Out
// of ink mode, the Pencil is a finger like any other.
//
// A gesture holds a lot while it lasts — every touch is cancelled, page
// renders wait — so it must always end. Its end is heard on the window
// too (a page re-rendered under the pen takes the element it went down
// on with it), a new pen-down ends one left open, and one that has heard
// nothing for STALE_MS stops holding anything (it isn't ended: a Pencil
// resting mid-stroke may say nothing for a while, then carry on). Stopping the Pencil from scrolling or selecting text takes
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
/** Screen pixels within which a tap selects a line — a finger's reach
 *  is wider. */
const SELECT_REACH_PX = 8;
const FINGER_REACH_PX = 16;
/** A gesture that has heard nothing for this long has lost its end. */
const STALE_MS = 1500;
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
  /** Would a press here take hold of a drawing (or the selection)? */
  grabbable: (pageIndex: number, at: Pt, reach: number) => boolean;
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
  /** The latest place, for ending a gesture whose end was lost. */
  lastClient: Pt;
  finger: boolean;
}

export function attachInkInput(env: InkInputEnv) {
  const { scrollArea: area, live } = env;
  let on = false;
  let g: Gesture | null = null;
  let heardAt = 0;
  const fresh = () => g !== null && performance.now() - heardAt < STALE_MS;

  /** The page under a client point, as a gesture would see it. */
  function gestureAt(target: Element | null, x: number, y: number, id: number, mode: InkTool, finger: boolean): Gesture | null {
    const at = target ? pageBoxAt(target) : null;
    const p = at ? env.getPages()[at.pageIndex] : null;
    if (!at || !p) return null;
    const rect = at.box.getBoundingClientRect();
    const gs: Gesture = {
      id, mode, idx: at.pageIndex, p, rect,
      k: rect.width / p.viewport.width,
      client: [x, y], start: [0, 0], last: null, grabbed: false,
      startClient: [x, y], lastClient: [x, y], finger,
    };
    gs.start = toPdf(gs, x, y);
    return gs;
  }

  /** Would a finger here land on a drawing? */
  function fingerGrabs(x: number, y: number): Gesture | null {
    const gs = gestureAt(document.elementFromPoint(x, y), x, y, -1, "select", true);
    return gs && env.grabbable(gs.idx, gs.start, FINGER_REACH_PX / gs.k) ? gs : null;
  }

  function toPdf(gs: Gesture, cx: number, cy: number): Pt {
    const fx = Math.min(1, Math.max(0, (cx - gs.rect.left) / gs.rect.width));
    const fy = Math.min(1, Math.max(0, (cy - gs.rect.top) / gs.rect.height));
    const vp = gs.p.viewport;
    const [x, y] = vp.convertToPdfPoint(fx * vp.width, fy * vp.height);
    return [x, y];
  }

  function onDown(e: PointerEvent): void {
    if (!on) return;
    const target = e.target as Element;
    if (target.closest("button, input, textarea, .pdf-annot-popover, .pdf-selection-bar")) return;
    // A finger on a drawing selects and drags it; anywhere else it is
    // left to scroll, select text, tap.
    if (e.pointerType === "touch") {
      if (!e.isPrimary || fresh()) return;
      const gs = fingerGrabs(e.clientX, e.clientY);
      if (!gs) {
        // Left to scroll or select text — or, if it lifts where it
        // landed, a tap off the drawing, which lets go of it.
        fingerTap = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() };
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      abandon();
      start({ ...gs, id: e.pointerId });
      g!.grabbed = env.press(gs.idx, gs.start, FINGER_REACH_PX / gs.k);
      return;
    }
    if (e.pointerType !== "pen") return;
    e.preventDefault();
    e.stopPropagation();
    // A pen can't be down twice: one still open lost its end.
    abandon();
    const mode: InkTool = e.buttons & ERASER_BUTTON ? "eraser" : env.tool();
    const gs = gestureAt(target, e.clientX, e.clientY, e.pointerId, mode, false);
    if (!gs) {
      env.pressOutside();
      return;
    }
    start(gs);
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

  function start(gs: Gesture): void {
    g = gs;
    heardAt = performance.now();
    try {
      area.setPointerCapture(gs.id);
    } catch {
      /* the pointer is already gone */
    }
  }

  /** End a gesture left open — its end was lost — where it last was. */
  function abandon(): void {
    if (g) finish(g, g.lastClient[0], g.lastClient[1], true);
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
      if (on && e.pointerType === "pen" && env.tool() === "eraser") {
        const at = pageBoxAt(e.target as Element);
        const p = at ? env.getPages()[at.pageIndex] : null;
        if (at && p) live.showCursor(e.clientX, e.clientY, env.eraserSize() * (at.box.offsetWidth / p.viewport.width));
        else live.showCursor(null);
      }
      return;
    }
    if (e.pointerId !== g.id) return;
    heardAt = performance.now();
    g.lastClient = [e.clientX, e.clientY];
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

  let fingerTap: { id: number; x: number; y: number; at: number } | null = null;
  function onUp(e: PointerEvent): void {
    const tap = fingerTap;
    if (tap && e.pointerId === tap.id) {
      fingerTap = null;
      const still = Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8 && performance.now() - tap.at < 400;
      if (on && still && e.type === "pointerup") env.pressOutside();
    }
    if (g && e.pointerId === g.id) finish(g, e.clientX, e.clientY, e.type === "pointercancel");
  }

  function finish(gs: Gesture, ex: number, ey: number, cancelled: boolean): void {
    if (g !== gs) return;
    g = null;
    penUpAt = performance.now();
    if (gs.mode === "pen") {
      // The line ends where the pen left the page, not just short of it.
      const n = gs.client.length;
      if (n > 2 && Math.hypot(ex - gs.client[n - 2], ey - gs.client[n - 1]) > 0.5) {
        gs.client.push(ex, ey);
        live.extend(ex, ey);
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
      if (cancelled) live.showCursor(null);
    } else {
      const pt = toPdf(gs, ex, ey);
      if (gs.grabbed) env.drop(pt[0] - gs.start[0], pt[1] - gs.start[1]);
      else {
        live.showMarquee(null);
        const tap = Math.hypot(ex - gs.startClient[0], ey - gs.startClient[1]) < 4;
        env.sweep(gs.idx, tap ? null : [
          Math.min(gs.start[0], pt[0]), Math.min(gs.start[1], pt[1]),
          Math.max(gs.start[0], pt[0]), Math.max(gs.start[1], pt[1]),
        ]);
      }
    }
  }

  function onLeave(e: PointerEvent): void {
    if (!g && e.pointerType === "pen") live.showCursor(null);
  }

  /** A pen gesture can end in a click (a desktop pen does; the iPad's
   *  cancelled touches don't): it isn't a press on the link or the
   *  highlight under the stroke. */
  let penUpAt = -Infinity;
  function onClick(e: MouseEvent): void {
    if (performance.now() - penUpAt > 400) return;
    penUpAt = -Infinity;
    e.preventDefault();
    e.stopPropagation();
  }
  area.addEventListener("click", onClick, true);

  /** The Pencil mustn't scroll the pages or start a text selection —
   *  nor, while it is down, may a hand resting on the screen; nor may a
   *  finger that has landed on a drawing to move it. */
  function onTouch(e: TouchEvent): void {
    if (fresh()) {
      e.preventDefault();
      return;
    }
    // Before its pointerdown, perhaps: a finger landing on a drawing.
    if (e.type === "touchstart" && e.touches.length === 1) {
      const t = e.touches[0];
      if (fingerGrabs(t.clientX, t.clientY)) {
        e.preventDefault();
        return;
      }
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
  // Heard on the window, before anything else: the end of a gesture
  // must arrive even when the element it began on has gone.
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
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
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
    area.removeEventListener("pointerleave", onLeave);
    area.removeEventListener("click", onClick, true);
  }

  return { setEnabled, destroy, busy: fresh };
}
