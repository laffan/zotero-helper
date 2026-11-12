// The notepad's ink (surface.ts): every stroke on the pad, and the one
// under the pen, on a single canvas the size of the view.
//
// The rule it is built to: what the pen costs must not depend on how
// much has been written. The ink used to be one <svg> of a <path> per
// stroke, the stroke under the pen growing by having its whole `d`
// set again at every sample. Each sample then cost in proportion to
// the pad: the SVG was laid out again (a walk over every stroke, to
// measure it, forced at once by the next sample's read of the canvas's
// box), and painted again (WebKit is reported to paint an SVG's
// elements whether or not they are in view). After a few pages of
// notes the pen could not be kept up with.
//
// Here a stroke is pixels once it is drawn. A sample draws the one
// curve from the last sample to itself and nothing else, as the pages'
// live stroke does (pdfviewer/ink/live.ts); at pen-up there is nothing
// to do, since the stroke is already where it stays. The pad is drawn
// from its strokes only when the view changes — a pan, a resize, an
// erasure, a move — and then only the strokes in view (each one's box
// and outline are kept with its points).
//
// The canvas is allocated when the view is made and when it is sized,
// never while the pen is writing: allocating a backing store mid-stroke
// costs the iPad the stroke's samples.
import { bounds } from "./geometry";
import type { NoteStroke } from "./model";

const MAX_DPR = 2;

interface Shape {
  box: [number, number, number, number];
  path: Path2D;
}
// A stroke's outline and box, by its points: a stroke moved or cut gets
// a new array of them, and so a new shape.
const shapes = new WeakMap<number[], Shape>();

/** The curve drawn through the points: midpoint quadratics, the same
 *  line the pen draws sample by sample. */
function outline(pts: number[]): Path2D {
  const path = new Path2D();
  const n = pts.length;
  path.moveTo(pts[0], pts[1]);
  if (n < 4) path.lineTo(pts[0] + 0.01, pts[1]);
  else {
    for (let i = 2; i + 3 < n; i += 2) path.quadraticCurveTo(pts[i], pts[i + 1], (pts[i] + pts[i + 2]) / 2, (pts[i + 1] + pts[i + 3]) / 2);
    path.lineTo(pts[n - 2], pts[n - 1]);
  }
  return path;
}

function shapeOf(pts: number[]): Shape {
  let s = shapes.get(pts);
  if (!s) shapes.set(pts, (s = { box: bounds(pts), path: outline(pts) }));
  return s;
}

/** A stroke's box on the canvas, and its line to stroke (kept with its
 *  points). */
export const strokeBox = (s: NoteStroke): [number, number, number, number] => shapeOf(s.points).box;
export const strokeLine = (s: NoteStroke): Path2D => shapeOf(s.points).path;

export function createPadInk(host: HTMLElement, strokes: () => NoteStroke[]) {
  const canvas = document.createElement("canvas");
  canvas.className = "notepad-ink";
  host.prepend(canvas);
  const ctx = canvas.getContext("2d", { desynchronized: true } as CanvasRenderingContext2DSettings)!;
  let dpr = 1;
  // The view, CSS px, and where the pad is panned to.
  let w = 0;
  let h = 0;
  let pan = { x: 0, y: 0 };
  // Strokes shown shifted (a selection being dragged), and by how much.
  let lifted: Set<NoteStroke> | null = null;
  let lift = { x: 0, y: 0 };
  // The theme's ink, for strokes kept with no colour of their own.
  let themeInk = "";
  // The pen is writing: the canvas keeps its size until it lifts.
  let writing = false;
  let frame = 0;

  // The stroke under the pen.
  let live: { pts: number[]; color: string; width: number } | null = null;

  const inkColor = (c: string) => c || (themeInk ||= getComputedStyle(host).getPropertyValue("--notepad-ink").trim() || "#000");

  /** Back the canvas at the view's size; false while it has none (a
   *  view that is hidden). */
  function fit(): boolean {
    w = host.clientWidth;
    h = host.clientHeight;
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    // Assigning a size always clears, and may reallocate.
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    return cw > 0 && ch > 0;
  }

  function style(color: string, width: number): void {
    ctx.strokeStyle = ctx.fillStyle = inkColor(color);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  /** Draw the pad again: the strokes in view, from their points. */
  function draw(): void {
    frame = 0;
    if (!canvas.width || !canvas.height) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // On whole device pixels, so a pan doesn't soften the lines.
    const tx = Math.round(pan.x * dpr);
    const ty = Math.round(pan.y * dpr);
    const [vx0, vy0, vx1, vy1] = [-pan.x - 4, -pan.y - 4, w - pan.x + 4, h - pan.y + 4];
    let color: string | null = null;
    let width = -1;
    for (const s of strokes()) {
      if (s.points.length < 2) continue;
      const { box, path } = shapeOf(s.points);
      const up = lifted?.has(s);
      const [ox, oy] = up ? [lift.x, lift.y] : [0, 0];
      if (box[2] + ox < vx0 || box[0] + ox > vx1 || box[3] + oy < vy0 || box[1] + oy > vy1) continue;
      if (s.color !== color || s.width !== width) style((color = s.color), (width = s.width));
      ctx.setTransform(dpr, 0, 0, dpr, tx + ox * dpr, ty + oy * dpr);
      ctx.stroke(path);
    }
    if (live) drawLive();
  }

  /** The stroke under the pen, whole (after a redraw beneath it). */
  function drawLive(): void {
    if (!live) return;
    penTransform();
    style(live.color, live.width);
    ctx.stroke(outline(live.pts));
  }

  const penTransform = () => ctx.setTransform(dpr, 0, 0, dpr, Math.round(pan.x * dpr), Math.round(pan.y * dpr));

  /** Draw again at the next frame. */
  function redraw(): void {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  const misfit = () => canvas.width !== Math.round(host.clientWidth * dpr) || canvas.height !== Math.round(host.clientHeight * dpr);
  // The view sized (the pad dragged by its corner, docked, shown).
  const sized = new ResizeObserver(() => {
    if (!writing && fit()) draw();
  });
  sized.observe(host);

  // The theme changed: the ink of the theme is another colour.
  const themed = () => {
    themeInk = "";
    redraw();
  };
  const watchTheme = new MutationObserver(themed);
  watchTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  scheme?.addEventListener?.("change", themed);

  fit();

  return {
    /** The pad moved under the view: drawn there at once (the caller
     *  moves it once a frame). */
    setPan(x: number, y: number): void {
      if (x === pan.x && y === pan.y) return;
      pan = { x, y };
      cancelAnimationFrame(frame);
      draw();
    },
    /** The strokes changed in some way other than the pen's writing. */
    redraw,
    /** Now, not at the next frame (the first drawing of a view). */
    drawNow(): void {
      cancelAnimationFrame(frame);
      if (fit()) draw();
    },
    /** The pen came down at a canvas point: a dot, until it moves. */
    begin(x: number, y: number, color: string, width: number): void {
      writing = true;
      live = { pts: [x, y], color, width };
      penTransform();
      style(color, width);
      ctx.beginPath();
      ctx.arc(x, y, width / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    /** The pen moved on: the one curve from its last sample. `pts` is
     *  the stroke so far, this sample its last pair. */
    extend(pts: number[]): void {
      if (!live) return;
      live.pts = pts;
      const m = pts.length;
      ctx.beginPath();
      if (m === 4) {
        // The first segment: to the midpoint, where the curves take over.
        ctx.moveTo(pts[0], pts[1]);
        ctx.lineTo((pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2);
      } else {
        ctx.moveTo((pts[m - 6] + pts[m - 4]) / 2, (pts[m - 5] + pts[m - 3]) / 2);
        ctx.quadraticCurveTo(pts[m - 4], pts[m - 3], (pts[m - 4] + pts[m - 2]) / 2, (pts[m - 3] + pts[m - 1]) / 2);
      }
      ctx.stroke();
    },
    /** The pen lifted: the last half-segment, to where it left the pad.
     *  The stroke stays as drawn. */
    finish(): void {
      const pts = live?.pts;
      live = null;
      writing = false;
      if (pts && pts.length >= 4) {
        const m = pts.length;
        ctx.beginPath();
        ctx.moveTo((pts[m - 4] + pts[m - 2]) / 2, (pts[m - 3] + pts[m - 1]) / 2);
        ctx.lineTo(pts[m - 2], pts[m - 1]);
        ctx.stroke();
      }
      // The view was sized while the pen wrote.
      if (misfit() && fit()) draw();
    },
    /** The stroke under the pen is not one after all (a hold became a
     *  lasso, a click was a tap): take it off. */
    drop(): void {
      if (!live) return;
      live = null;
      writing = false;
      cancelAnimationFrame(frame);
      if (misfit()) fit();
      draw();
    },
    /** Show `strokes` shifted by (dx, dy) — a selection being dragged —
     *  or, with none, everything where it is. */
    lift(strokes: NoteStroke[] | null, dx = 0, dy = 0): void {
      lifted = strokes?.length ? new Set(strokes) : null;
      lift = { x: dx, y: dy };
      redraw();
    },
    destroy(): void {
      cancelAnimationFrame(frame);
      sized.disconnect();
      watchTheme.disconnect();
      scheme?.removeEventListener?.("change", themed);
      canvas.width = canvas.height = 0;
      canvas.remove();
    },
  };
}

export type PadInk = ReturnType<typeof createPadInk>;
