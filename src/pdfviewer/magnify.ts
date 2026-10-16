// Pinch to magnify the pages — and only the pages.
//
// Left to itself, a pinch on the iPad zoomed the whole app, bars and
// all. Now the app never zooms (index.html's viewport, and main.tsx
// cancelling WebKit's gesture app-wide), and a pinch over the pages
// magnifies them like a loupe: a transform on the scroll area, so the
// layout — fit, the paged sets, the zoom level the bar sets — is never
// touched, and pinching back out leaves everything where it was.
//
// While magnified:
//  - One finger (or a trackpad's two-finger scroll, a wheel) pans the
//    magnified view; at its edge the pan carries on as a scroll of the
//    pages beneath (not in the paged view, whose set stays put). A
//    finger's pan coasts on when let go, as a scroll does.
//  - The Pencil still writes (ink mode reads only the pen).
//  - Pages in view are redrawn sharper once the pinch settles (the
//    renderer asks `resolutionFor`), within the renderer's per-page
//    pixel cap.
// Any change of layout (a mode, a zoom step, a new PDF) ends it.
//
// The pinch arrives as WebKit's gesture events (the iPad and the Mac
// app; they don't make scrolling wait on the page, as a non-passive
// touch listener would) or, in other browsers, as a ctrl-wheel (a
// trackpad pinch). The fingers' midpoint comes from passive touch
// listeners, which WebKit's gesture events don't carry on iOS.

const MAX_SCALE = 5;
/** Below this, a pinch ends unmagnified. */
const SNAP_BELOW = 1.06;
/** Resolutions pages are redrawn at, so a small change of pinch doesn't
 *  redraw everything. */
const RES_STEPS = [1, 1.5, 2, 3, 4];
const SETTLE_MS = 180;

export interface MagnifyEnv {
  area: HTMLElement;
  /** The box the magnified pages are clipped to. */
  host: HTMLElement;
  /** May a pan past the edge scroll the pages (not in the paged view)? */
  canScroll: () => boolean;
  /** The magnification has settled at `scale`: redraw for it. */
  onSettle: (scale: number) => void;
}

export function createMagnifier(env: MagnifyEnv) {
  const { area, host } = env;
  let s = 1;
  let tx = 0;
  let ty = 0;
  let settleTimer = 0;

  const magnified = () => s > 1;

  function apply(): void {
    area.style.transform = magnified() ? `translate(${tx}px, ${ty}px) scale(${s})` : "";
    area.classList.toggle("pdf-magnified", magnified());
  }

  /** The scroll area's untransformed top-left, in client coordinates. */
  function origin(): { x: number; y: number } {
    const h = host.getBoundingClientRect();
    return { x: h.left + area.offsetLeft, y: h.top + area.offsetTop };
  }

  /** Keep the magnified box covering the view; return what of a pan
   *  the box couldn't take. */
  function clamp(): { x: number; y: number } {
    const w = area.offsetWidth;
    const h = area.offsetHeight;
    const cx = Math.min(0, Math.max(w * (1 - s), tx));
    const cy = Math.min(0, Math.max(h * (1 - s), ty));
    const over = { x: tx - cx, y: ty - cy };
    tx = cx;
    ty = cy;
    return over;
  }

  function settleSoon(): void {
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      if (s < SNAP_BELOW) reset();
      else env.onSettle(s);
    }, SETTLE_MS);
  }

  /** Magnify to `next`, keeping `local` (a point of the unmagnified
   *  area) under the client point `at`. */
  function zoomTo(next: number, local: { x: number; y: number }, at: { x: number; y: number }): void {
    s = Math.min(MAX_SCALE, Math.max(1, next));
    const o = origin();
    tx = at.x - o.x - s * local.x;
    ty = at.y - o.y - s * local.y;
    clamp();
    apply();
  }

  function toLocal(at: { x: number; y: number }): { x: number; y: number } {
    const o = origin();
    return { x: (at.x - o.x - tx) / s, y: (at.y - o.y - ty) / s };
  }

  /** Pan by a client-pixel delta; past the edge, scroll beneath. */
  function pan(dx: number, dy: number): void {
    tx += dx;
    ty += dy;
    const over = clamp();
    apply();
    if (env.canScroll() && (over.x || over.y)) {
      area.scrollLeft -= over.x / s;
      area.scrollTop -= over.y / s;
    }
  }

  // --- the pinch ----------------------------------------------------------
  // Where the fingers are (touch), else the pointer (trackpad).
  let fingers: { x: number; y: number } | null = null;
  let pointer = { x: 0, y: 0 };
  const onTouch = (e: TouchEvent) => {
    const t = e.touches;
    fingers = t.length >= 2 ? { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 } : null;
  };
  area.addEventListener("touchstart", onTouch, { passive: true });
  area.addEventListener("touchmove", onTouch, { passive: true });
  area.addEventListener("touchend", onTouch, { passive: true });

  type GestureEvent = Event & { scale: number; clientX?: number; clientY?: number };
  let pinch: { s0: number; local: { x: number; y: number }; left: number; top: number } | null = null;
  const centre = (e: GestureEvent) =>
    fingers ?? (typeof e.clientX === "number" ? { x: e.clientX, y: e.clientY! } : pointer);

  function onGestureStart(ev: Event): void {
    const e = ev as GestureEvent;
    e.preventDefault();
    stopCoast();
    clearTimeout(settleTimer);
    pinch = { s0: s, local: toLocal(centre(e)), left: area.scrollLeft, top: area.scrollTop };
  }
  function onGestureChange(ev: Event): void {
    const e = ev as GestureEvent;
    e.preventDefault();
    if (!pinch) return;
    // Two fingers would also scroll the pages natively; the pinch moves
    // them instead.
    area.scrollLeft = pinch.left;
    area.scrollTop = pinch.top;
    zoomTo(pinch.s0 * e.scale, pinch.local, centre(e));
  }
  function onGestureEnd(ev: Event): void {
    ev.preventDefault();
    pinch = null;
    settleSoon();
  }
  area.addEventListener("gesturestart", onGestureStart);
  area.addEventListener("gesturechange", onGestureChange);
  area.addEventListener("gestureend", onGestureEnd);

  // A trackpad pinch elsewhere arrives as a ctrl-wheel; while magnified,
  // a plain wheel (a trackpad's two-finger scroll) pans. Captured, so
  // the paged view's wheel doesn't also turn the page.
  function onWheel(e: WheelEvent): void {
    pointer = { x: e.clientX, y: e.clientY };
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      zoomTo(s * Math.exp(-e.deltaY * 0.01), toLocal(pointer), pointer);
      settleSoon();
    } else if (magnified()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pan(-e.deltaX, -e.deltaY);
      settleSoon();
    }
  }
  area.addEventListener("wheel", onWheel, { capture: true, passive: false });

  // --- one finger pans, and coasts -----------------------------------------
  let drag: { id: number; x: number; y: number; t: number; vx: number; vy: number } | null = null;
  let coastRaf = 0;
  function stopCoast(): void {
    cancelAnimationFrame(coastRaf);
    coastRaf = 0;
  }
  function onPointerDown(e: PointerEvent): void {
    pointer = { x: e.clientX, y: e.clientY };
    if (!magnified() || e.pointerType !== "touch") return;
    stopCoast();
    // A second finger is the pinch's.
    drag = drag ? null : { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 };
  }
  function onPointerMove(e: PointerEvent): void {
    pointer = { x: e.clientX, y: e.clientY };
    if (!drag || e.pointerId !== drag.id || pinch) return;
    const now = performance.now();
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const dt = Math.max(1, now - drag.t);
    // Velocity, smoothed over the last few moves, for the coast.
    drag.vx = 0.7 * (dx / dt) + 0.3 * drag.vx;
    drag.vy = 0.7 * (dy / dt) + 0.3 * drag.vy;
    Object.assign(drag, { x: e.clientX, y: e.clientY, t: now });
    pan(dx, dy);
  }
  function onPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    let { vx, vy } = drag;
    const stale = performance.now() - drag.t > 80;
    drag = null;
    if (stale || Math.hypot(vx, vy) < 0.05) return settleSoon();
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      pan(vx * dt, vy * dt);
      const decay = Math.pow(0.995, dt);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) > 0.02) coastRaf = requestAnimationFrame(step);
      else {
        coastRaf = 0;
        settleSoon();
      }
    };
    coastRaf = requestAnimationFrame(step);
  }
  area.addEventListener("pointerdown", onPointerDown, true);
  area.addEventListener("pointermove", onPointerMove);
  area.addEventListener("pointerup", onPointerUp);
  area.addEventListener("pointercancel", onPointerUp);

  /** Back to the pages as laid out. */
  function reset(): void {
    stopCoast();
    clearTimeout(settleTimer);
    drag = null;
    pinch = null;
    if (!magnified()) return;
    s = 1;
    tx = ty = 0;
    apply();
    env.onSettle(1);
  }

  /** The resolution a page should be drawn at: magnified, and in view. */
  function resolutionFor(wrapper: HTMLElement): number {
    if (!magnified()) return 1;
    const r = wrapper.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    if (r.right < h.left || r.left > h.right || r.bottom < h.top || r.top > h.bottom) return 1;
    return RES_STEPS.reduce((best, x) => (x <= s + 0.25 ? x : best), 1);
  }

  return {
    reset,
    /** The view resized: keep the magnified box over it. */
    refit: () => {
      if (!magnified()) return;
      clamp();
      apply();
    },
    scale: () => s,
    resolutionFor,
    destroy(): void {
      stopCoast();
      clearTimeout(settleTimer);
    },
  };
}

export type Magnifier = ReturnType<typeof createMagnifier>;
