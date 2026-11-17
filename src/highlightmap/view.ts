// The Highlight Map's canvas: moved as the notepad's is (notepad/
// surface.ts) — one layer under one transform, set once a frame however
// many moves arrive, over the pad's faint dot grid, which moves with it —
// and zoomed, which the pad isn't. The cards are DOM in the layer, laid
// out by CSS (HighlightMap.tsx); this module only moves them.
//
// Who does what: a finger, or the mouse, dragged anywhere but on a
// button or a field pans; a wheel or a trackpad's two fingers pan. Two
// fingers pinch; a trackpad's pinch zooms — WebKit's gesture events on a
// Mac, a wheel with ctrlKey elsewhere (and ⌘ or Ctrl with a wheel) —
// each about the point between the fingers or under the pointer. A press
// that pans is not a tap: the click it would end in is stopped before it
// reaches a card. On the iPad a pinch arrives twice, as pointers and as
// gesture events; while fingers are down the gesture events are only
// kept from zooming the page.
//
// `show` glides (350ms, easing out — the pad's follow.ts) to put a card
// in the middle of the view: the search's way round its matches. It
// keeps the zoom, unless the card wouldn't be readable (below
// READABLE_Z) or wouldn't fit. With the notepad over the canvas's
// right, the middle is the middle of what it leaves.

export interface MapView {
  x: number;
  y: number;
  z: number;
}

export interface MapViewEnv {
  /** The view moved; `done` once a gesture, a wheel's burst or a glide
   *  is over — the view to keep. */
  moved: (v: MapView, done: boolean) => void;
  /** How much of the canvas's right is covered (the notepad over it,
   *  MapNotepad.tsx), px: what is kept in view, fitted and shown keeps
   *  to the rest. */
  covered?: () => number;
}

const MIN_Z = 0.05;
const MAX_Z = 3;
/** Below this zoom a card's words are too small to read. */
const READABLE_Z = 0.45;
/** Room kept round what the view fits or shows, px. */
const MARGIN = 24;
/** At least this much of the map stays in view, px. */
const KEEP_PX = 60;
/** CSS px within which a press is still a tap. */
const TAP_PX = 6;
const GLIDE_MS = 350;
/** The dot grid's spacing at zoom 1 (notepad.css's), and its least. */
const GRID_PX = 20;
const GRID_MIN_PX = 10;
/** How long after a pan its click is still stopped, ms. */
const SWALLOW_MS = 400;
/** The most of a wheel's delta one event zooms by (×e^0.25 ≈ 1.28). */
const WHEEL_ZOOM_MAX = 25;
/** A wheel's burst is over after this long without one, ms. */
const WHEEL_DONE_MS = 300;

/** Where a press goes on as itself: no pan from these. */
const OWN_PRESS = "button, input, textarea, select, a[href], [contenteditable], .hlmap-controls";

/** WebKit's GestureEvent (Safari's own; not in the DOM's types). */
interface GestureLike extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

export function createMapView(host: HTMLElement, layer: HTMLElement, env: MapViewEnv) {
  let v: MapView = { x: MARGIN, y: MARGIN, z: 1 };
  // The layer's own size (a transform doesn't change it), kept by a
  // ResizeObserver so a pan reads no layout.
  let size = { w: layer.offsetWidth, h: layer.offsetHeight };
  /** The width of the canvas left uncovered. */
  const shownW = () => Math.max(0, host.clientWidth - (env.covered?.() ?? 0));

  let frame = 0;
  const paint = () => {
    frame = 0;
    layer.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    let step = GRID_PX * v.z;
    while (step < GRID_MIN_PX) step *= 2;
    host.style.backgroundSize = `${step}px ${step}px`;
    host.style.backgroundPosition = `${v.x}px ${v.y}px`;
  };
  /** Some of the map stays in view, wherever it is pushed. */
  const keep = (n: MapView): MapView => {
    const W = shownW();
    const H = host.clientHeight;
    // Folded away, there is no view to keep anything in.
    if (!W || !H) return n;
    const k = Math.min(KEEP_PX, size.w * n.z, size.h * n.z);
    return {
      z: n.z,
      x: Math.min(W - k, Math.max(k - size.w * n.z, n.x)),
      y: Math.min(H - k, Math.max(k - size.h * n.z, n.y)),
    };
  };
  function apply(n: MapView, done: boolean): void {
    v = keep(n);
    if (!frame) frame = requestAnimationFrame(paint);
    env.moved(v, done);
  }

  /** A client point, in the host's px. */
  const local = (cx: number, cy: number): [number, number] => {
    const r = host.getBoundingClientRect();
    return [cx - r.left, cy - r.top];
  };
  /** Zoom to `z`, the map's point under host point (px, py) staying put. */
  const zoomAround = (z: number, px: number, py: number, done: boolean) => {
    const nz = clampZ(z);
    const mx = (px - v.x) / v.z;
    const my = (py - v.y) / v.z;
    apply({ z: nz, x: px - mx * nz, y: py - my * nz }, done);
  };

  // --- the glide ---------------------------------------------------------------
  let glide = 0;
  const stop = () => {
    cancelAnimationFrame(glide);
    glide = 0;
  };
  function glideTo(to: MapView): void {
    stop();
    const from = { ...v };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / GLIDE_MS);
      const k = 1 - (1 - t) ** 3;
      apply(
        { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k },
        t === 1,
      );
      glide = t < 1 ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  }

  // --- presses -----------------------------------------------------------------
  const pointers = new Map<number, { x: number; y: number; touch: boolean }>();
  let pan: { id: number; from: [number, number]; moved: boolean } | null = null;
  let pinch: { a: number; b: number; d0: number; z0: number; mx: number; my: number } | null = null;
  // The press that just ended panned: its click is not a tap.
  let swallowClick = false;
  const touchesDown = () => [...pointers.values()].some((p) => p.touch);

  const startPinch = () => {
    const [a, b] = [...pointers.keys()];
    const pa = pointers.get(a)!;
    const pb = pointers.get(b)!;
    const [px, py] = local((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    pinch = {
      a,
      b,
      d0: Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y)),
      z0: v.z,
      mx: (px - v.x) / v.z,
      my: (py - v.y) / v.z,
    };
    if (pan) pan.moved = true;
  };

  function onDown(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as Element).closest?.(OWN_PRESS)) return;
    stop();
    swallowClick = false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, touch: e.pointerType === "touch" });
    if (e.pointerType === "mouse") e.preventDefault();
    if (pointers.size === 1) pan = { id: e.pointerId, from: [e.clientX, e.clientY], moved: false };
    else if (pointers.size === 2) startPinch();
  }

  function onMove(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch) {
      const pa = pointers.get(pinch.a);
      const pb = pointers.get(pinch.b);
      if (!pa || !pb) return;
      const [px, py] = local((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
      const z = clampZ((pinch.z0 * Math.hypot(pa.x - pb.x, pa.y - pb.y)) / pinch.d0);
      apply({ z, x: px - pinch.mx * z, y: py - pinch.my * z }, false);
      return;
    }
    if (!pan || pan.id !== e.pointerId) return;
    if (!pan.moved && Math.hypot(e.clientX - pan.from[0], e.clientY - pan.from[1]) <= TAP_PX) return;
    if (!pan.moved) {
      pan.moved = true;
      host.classList.add("panning");
    }
    apply({ ...v, x: v.x + dx, y: v.y + dy }, false);
  }

  function onUp(e: PointerEvent): void {
    if (!pointers.delete(e.pointerId)) return;
    const moved = Boolean(pinch || pan?.moved);
    if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) {
      pinch = null;
      // The finger left down carries on panning, from where it is.
      const [rest] = [...pointers.entries()];
      pan = rest ? { id: rest[0], from: [rest[1].x, rest[1].y], moved: true } : null;
    } else if (pan?.id === e.pointerId) pan = null;
    if (pointers.size) return;
    host.classList.remove("panning");
    if (moved) {
      // WebKit may yet send a slight drag's click, a moment later.
      swallowClick = true;
      window.setTimeout(() => (swallowClick = false), SWALLOW_MS);
      env.moved(v, true);
    }
  }

  const onClick = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  };

  let wheelTimer = 0;
  // A trackpad's pinch as WebKit's gesture events, under way.
  let gesture: { z0: number; px: number; py: number } | null = null;
  function onWheel(e: WheelEvent): void {
    if ((e.target as Element).closest?.("input, textarea")) return;
    e.preventDefault();
    stop();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1;
    if (e.ctrlKey || e.metaKey) {
      // The same pinch, reported both ways: the gesture events have it.
      if (gesture) return;
      // A trackpad's pinch sends small steps; a mouse's notch, ±100 or
      // so, is held to a quarter-size step.
      const d = Math.max(-WHEEL_ZOOM_MAX, Math.min(WHEEL_ZOOM_MAX, e.deltaY * unit));
      zoomAround(v.z * Math.exp(-d * 0.01), ...local(e.clientX, e.clientY), false);
    } else apply({ ...v, x: v.x - e.deltaX * unit, y: v.y - e.deltaY * unit }, false);
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => env.moved(v, true), WHEEL_DONE_MS);
  }
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    if (touchesDown()) return;
    const g = e as GestureLike;
    // About the pointer, or the middle where WebKit gives no point.
    const [px, py] = Number.isFinite(g.clientX) ? local(g.clientX, g.clientY) : [host.clientWidth / 2, host.clientHeight / 2];
    gesture = { z0: v.z, px, py };
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    if (gesture && !touchesDown()) zoomAround(gesture.z0 * (e as GestureLike).scale, gesture.px, gesture.py, false);
  };
  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    if (!gesture) return;
    gesture = null;
    env.moved(v, true);
  };

  host.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  host.addEventListener("click", onClick, true);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("gesturestart", onGestureStart);
  host.addEventListener("gesturechange", onGestureChange);
  host.addEventListener("gestureend", onGestureEnd);
  const resize = new ResizeObserver(() => {
    size = { w: layer.offsetWidth, h: layer.offsetHeight };
  });
  resize.observe(layer);

  /** The view that fits the whole map, centred (never past 100%). */
  const fitted = (): MapView => {
    const W = shownW();
    const H = host.clientHeight;
    const z = clampZ(Math.min(1, (W - 2 * MARGIN) / Math.max(1, size.w), (H - 2 * MARGIN) / Math.max(1, size.h)));
    return { z, x: (W - size.w * z) / 2, y: Math.max(MARGIN, (H - size.h * z) / 2) };
  };

  return {
    view: (): MapView => ({ ...v }),
    /** Put the view at `n` (as it was left), at once. */
    set(n: MapView): void {
      stop();
      size = { w: layer.offsetWidth, h: layer.offsetHeight };
      apply({ ...n, z: clampZ(n.z) }, false);
    },
    /** A first look: the map's top left, as wide as fits in [50%, 100%]. */
    home(): void {
      size = { w: layer.offsetWidth, h: layer.offsetHeight };
      const z = clampZ(Math.min(1, Math.max(0.5, (shownW() - 2 * MARGIN) / Math.max(1, size.w))));
      // Kept only once there is a view to have looked at.
      apply({ z, x: MARGIN, y: MARGIN }, host.clientWidth > 0);
    },
    fit: () => glideTo(keep(fitted())),
    /** Zoom by `f` about the view's middle (the bar's − and +), or to
     *  100% (`f` null). */
    zoom(f: number | null): void {
      const W = shownW() / 2;
      const H = host.clientHeight / 2;
      const z = clampZ(f === null ? 1 : v.z * f);
      const mx = (W - v.x) / v.z;
      const my = (H - v.y) / v.z;
      glideTo(keep({ z, x: W - mx * z, y: H - my * z }));
    },
    /** Glide to put `el` (in the layer) in the middle of the view. */
    show(el: HTMLElement): void {
      const r = el.getBoundingClientRect();
      const lr = layer.getBoundingClientRect();
      const w = r.width / v.z;
      const h = r.height / v.z;
      const x0 = (r.left - lr.left) / v.z;
      const y0 = (r.top - lr.top) / v.z;
      const W = shownW();
      const H = host.clientHeight;
      let z = v.z < READABLE_Z ? 1 : v.z;
      z = clampZ(Math.min(z, (W - 2 * MARGIN) / Math.max(1, w)));
      const tall = h * z > H - 2 * MARGIN;
      glideTo(
        keep({
          z,
          x: W / 2 - (x0 + w / 2) * z,
          y: tall ? MARGIN - y0 * z : H / 2 - (y0 + h / 2) * z,
        }),
      );
    },
    destroy(): void {
      stop();
      cancelAnimationFrame(frame);
      window.clearTimeout(wheelTimer);
      resize.disconnect();
      host.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      host.removeEventListener("click", onClick, true);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("gesturestart", onGestureStart);
      host.removeEventListener("gesturechange", onGestureChange);
      host.removeEventListener("gestureend", onGestureEnd);
    },
  };
}

export type MapViewControl = ReturnType<typeof createMapView>;
