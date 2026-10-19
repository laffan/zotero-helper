// The notepad's minimap (NotepadBody.tsx, the bar's map icon): a narrow
// column at the pad's left showing the whole of it small — the strokes,
// the links as bars in their colours — with the part in view outlined.
// A tap on it, or a drag, brings that part into view.
//
// Drawn in the canvas's own coordinates under one transform, so when
// only the view moves (a pan, the pad following the PDF) just the
// outline and the transform change; the strokes are drawn again only
// when the pad does. What it fits is the pad's contents and the view
// together, so the outline never leaves it; a tap on the map's empty
// part below takes the view no further than half its height past that.
import type { Notepad } from "./model";
import { pathD, type NotepadSurface, type SurfaceChange } from "./surface";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Room around the drawing, px. */
const MARGIN = 5;

type Box = [number, number, number, number];

export function createMinimap(el: HTMLElement, surface: NotepadSurface, pad: () => Notepad) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "notepad-minimap-svg");
  const g = document.createElementNS(SVG_NS, "g");
  const strokes = document.createElementNS(SVG_NS, "g");
  strokes.setAttribute("class", "notepad-minimap-strokes");
  const links = document.createElementNS(SVG_NS, "g");
  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "notepad-minimap-frame");
  frame.setAttribute("vector-effect", "non-scaling-stroke");
  g.append(strokes, links, frame);
  svg.appendChild(g);
  el.appendChild(svg);

  // The contents' extent, and the current fit (canvas → map).
  let content: Box | null = null;
  let fit = { s: 1, tx: 0, ty: 0 };
  // What the fit takes in.
  let world: Box = [0, 0, 0, 0];
  // While a drag on the map is under way the fit holds still, or the
  // map would slide beneath the finger as the view leaves the contents.
  let dragging = false;

  function drawContent(): void {
    strokes.replaceChildren();
    links.replaceChildren();
    let box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (x0: number, y0: number, x1: number, y1: number) => {
      box = [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)];
    };
    for (const s of pad().strokes) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", pathD(s.points));
      p.setAttribute("vector-effect", "non-scaling-stroke");
      if (s.color) p.style.stroke = s.color;
      strokes.appendChild(p);
      for (let i = 0; i + 1 < s.points.length; i += 2) grow(s.points[i], s.points[i + 1], s.points[i], s.points[i + 1]);
    }
    for (const b of surface.linkBoxes()) {
      const r = document.createElementNS(SVG_NS, "rect");
      r.setAttribute("x", String(b.x));
      r.setAttribute("y", String(b.y));
      r.setAttribute("width", String(b.w));
      r.setAttribute("height", String(b.h));
      r.setAttribute("rx", "4");
      r.style.fill = b.color;
      links.appendChild(r);
      grow(b.x, b.y, b.x + b.w, b.y + b.h);
    }
    content = Number.isFinite(box[0]) ? box : null;
  }

  function place(): void {
    const v = surface.view();
    frame.setAttribute("x", String(v.x));
    frame.setAttribute("y", String(v.y));
    frame.setAttribute("width", String(v.w));
    frame.setAttribute("height", String(v.h));
    if (dragging) return;
    let [x0, y0, x1, y1] = [v.x, v.y, v.x + v.w, v.y + v.h];
    if (content) [x0, y0, x1, y1] = [Math.min(x0, content[0]), Math.min(y0, content[1]), Math.max(x1, content[2]), Math.max(y1, content[3])];
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    world = [x0, y0, x1, y1];
    const s = Math.min((w - 2 * MARGIN) / (x1 - x0), (h - 2 * MARGIN) / (y1 - y0));
    fit = { s, tx: (w - (x1 - x0) * s) / 2 - x0 * s, ty: MARGIN - y0 * s };
    g.setAttribute("transform", `translate(${fit.tx} ${fit.ty}) scale(${s})`);
  }

  // Changes come in bursts (every move of a pan): drawn once a frame.
  let queued: SurfaceChange | null = null;
  const onChange = (what: SurfaceChange) => {
    if (queued === "content") return;
    const first = queued === null;
    queued = what;
    if (!first) return;
    requestAnimationFrame(() => {
      if (queued === "content") drawContent();
      queued = null;
      place();
    });
  };
  const unwatch = surface.watch(onChange);
  const resize = new ResizeObserver(() => place());
  resize.observe(el);

  /** A point on the map, on the canvas — kept within half a view of
   *  what the map draws. */
  const toCanvas = (e: PointerEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    const v = surface.view();
    const x = (e.clientX - r.left - fit.tx) / fit.s;
    const y = (e.clientY - r.top - fit.ty) / fit.s;
    return [
      Math.max(world[0] + v.w / 2, Math.min(x, world[2] - v.w / 2)),
      Math.max(world[1] + v.h / 2, Math.min(y, world[3] + v.h / 2)),
    ];
  };
  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    dragging = true;
    surface.panTo(...toCanvas(e), false);
    const move = (ev: PointerEvent) => surface.panTo(...toCanvas(ev), false);
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      surface.panTo(...toCanvas(ev), true);
      dragging = false;
      place();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  el.addEventListener("pointerdown", onDown);

  drawContent();
  place();

  return {
    destroy(): void {
      unwatch();
      resize.disconnect();
      el.removeEventListener("pointerdown", onDown);
      svg.remove();
    },
  };
}
