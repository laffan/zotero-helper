// The stroke being drawn, before it is an annotation: one canvas over
// the visible pages, drawn a segment at a time as the pen moves.
//
// What keeps the pen's ink under its tip:
//  - Each sample draws only the curve from the last one (a quadratic
//    through the midpoints, so the line is smooth without being
//    redrawn) — the cost per sample is the same at the end of a long
//    stroke as at its start, and WebKit uploads only the small region
//    that changed.
//  - The canvas is allocated when ink mode starts and kept until it
//    ends. Allocating a large canvas is slow on iPad (Hush measured
//    strokes dropped outright when the backing store was made mid-
//    gesture), so a stroke never waits for one; only a resize of the
//    viewer reallocates it.
//  - It covers the viewer, not a page, and does nothing between
//    strokes; at pen-up the stroke moves into the page's SVG
//    (layer.ts) and its region here is cleared in the same frame.
//  - `desynchronized` asks for the low-latency path where the browser
//    has one; WebKit ignores it.

export interface LiveStroke {
  /** Pen width in CSS pixels. */
  width: number;
  color: string;
}

const MAX_DPR = 2;

export function createLiveLayer(host: HTMLElement, area: HTMLElement) {
  const canvas = document.createElement("canvas");
  canvas.className = "pdf-ink-live";
  const ctx = canvas.getContext("2d", { desynchronized: true } as CanvasRenderingContext2DSettings)!;
  const cursor = document.createElement("div");
  cursor.className = "pdf-ink-cursor";
  const marquee = document.createElement("div");
  marquee.className = "pdf-ink-marquee";
  let dpr = 1;
  // The canvas's place in the viewport, read once per stroke.
  let originX = 0;
  let originY = 0;
  let pts: number[] = [];
  let dirty: [number, number, number, number] | null = null;
  let half = 0;

  /** Back the canvas at the viewer's size; a no-op when it already is
   *  (assigning `width` always clears and may reallocate). */
  function attach(): void {
    if (!canvas.isConnected) host.append(canvas, cursor, marquee);
    canvas.style.left = `${area.offsetLeft}px`;
    canvas.style.top = `${area.offsetTop}px`;
    canvas.style.width = `${area.clientWidth}px`;
    canvas.style.height = `${area.clientHeight}px`;
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.round(area.clientWidth * dpr);
    const h = Math.round(area.clientHeight * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  /** Let the backing store go (ink mode ended). */
  function detach(): void {
    canvas.width = canvas.height = 0;
    canvas.remove();
    cursor.remove();
    marquee.remove();
  }

  function grow(x: number, y: number): void {
    if (!dirty) dirty = [x, y, x, y];
    else {
      if (x < dirty[0]) dirty[0] = x;
      if (y < dirty[1]) dirty[1] = y;
      if (x > dirty[2]) dirty[2] = x;
      if (y > dirty[3]) dirty[3] = y;
    }
  }

  function begin(s: LiveStroke, clientX: number, clientY: number): void {
    if (canvas.width !== Math.round(area.clientWidth * dpr) || canvas.height !== Math.round(area.clientHeight * dpr)) attach();
    const r = canvas.getBoundingClientRect();
    originX = r.left;
    originY = r.top;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    half = s.width / 2 + 2;
    const x = clientX - originX;
    const y = clientY - originY;
    pts = [x, y];
    dirty = null;
    grow(x, y);
    ctx.beginPath();
    ctx.arc(x, y, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function extend(clientX: number, clientY: number): void {
    const x = clientX - originX;
    const y = clientY - originY;
    const n = pts.length;
    if (n >= 2 && Math.abs(x - pts[n - 2]) < 0.25 && Math.abs(y - pts[n - 1]) < 0.25) return;
    pts.push(x, y);
    grow(x, y);
    const m = pts.length;
    ctx.beginPath();
    if (m === 4) {
      // The first segment: to the midpoint, where the curves take over.
      ctx.moveTo(pts[0], pts[1]);
      ctx.lineTo((pts[0] + x) / 2, (pts[1] + y) / 2);
    } else {
      const [x0, y0, x1, y1] = pts.slice(m - 6, m - 2);
      ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
      ctx.quadraticCurveTo(x1, y1, (x1 + x) / 2, (y1 + y) / 2);
    }
    ctx.stroke();
  }

  /** The last half-segment, so the line reaches the pen's last place. */
  function finish(): void {
    const m = pts.length;
    if (m < 4) return;
    ctx.beginPath();
    ctx.moveTo((pts[m - 4] + pts[m - 2]) / 2, (pts[m - 3] + pts[m - 1]) / 2);
    ctx.lineTo(pts[m - 2], pts[m - 1]);
    ctx.stroke();
  }

  /** Wipe what the stroke drew — only its own region. */
  function clear(): void {
    if (dirty) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(dirty[0] - half, dirty[1] - half, dirty[2] - dirty[0] + half * 2, dirty[3] - dirty[1] + half * 2);
    }
    dirty = null;
    pts = [];
  }

  /** The eraser's circle (or none), in client coordinates. */
  function showCursor(clientX: number | null, clientY = 0, diameter = 0): void {
    if (clientX === null || !cursor.isConnected) {
      cursor.style.display = "none";
      return;
    }
    const hr = host.getBoundingClientRect();
    cursor.style.display = "block";
    cursor.style.width = cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate(${clientX - hr.left - diameter / 2}px, ${clientY - hr.top - diameter / 2}px)`;
  }

  /** The select tool's rectangle, between two client points. */
  function showMarquee(a: [number, number] | null, b: [number, number] = [0, 0]): void {
    if (!a || !marquee.isConnected) {
      marquee.style.display = "none";
      return;
    }
    const hr = host.getBoundingClientRect();
    marquee.style.display = "block";
    marquee.style.left = `${Math.min(a[0], b[0]) - hr.left}px`;
    marquee.style.top = `${Math.min(a[1], b[1]) - hr.top}px`;
    marquee.style.width = `${Math.abs(b[0] - a[0])}px`;
    marquee.style.height = `${Math.abs(b[1] - a[1])}px`;
  }

  return { attach, detach, begin, extend, finish, clear, showCursor, showMarquee };
}

export type LiveLayer = ReturnType<typeof createLiveLayer>;
