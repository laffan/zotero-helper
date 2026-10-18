// The notepad's canvas: the Pencil writes, a finger pans, and a finger
// tap on a note goes back to where in the PDF the reader was when it was
// written. Links dragged onto the pad sit on it as chips — a link icon
// and the page, or the whole of the highlight's text — dragged to move,
// tapped to go there. Plain DOM, as the viewer's ink is
// (src/pdfviewer/ink/): a stroke is an SVG path that grows sample by
// sample, with no React render while the pen is down.
//
// Who does what: the Pencil (`pointerType` "pen") writes — a tap is a
// dot — or, with the eraser on (the Pencil's double-tap, the pad's
// eraser button, or the eraser end of a pen that has one), takes out
// every stroke it passes over. A finger pans, and taps. A mouse (a Mac,
// no Pencil) writes with a drag and taps with a click; a wheel or
// trackpad pans. Strokes written while the reader stays on one page are
// one note (model.ts), which remembers the reader's place when it began;
// turning to another page — even to come straight back — starts the
// next. Each note shows its page, small, above it.
//
// Following the PDF (`follow`, the bar's eye): as the reader turns
// pages, the pad pans to the part of it about that page — its notes and
// links, or, for a page with none, where they would fall between those
// of the pages around it — on the supposition that the pad is written
// from top to bottom as the PDF is read.
//
// Several views may show one pad (model.ts shares it): each pans on its
// own, and `render` redraws one when another has changed the pad.
import type { PagePlace, PlaceTarget } from "../pdfviewer/places";
import { linkLabel, newId, type Note, type Notepad, type NoteLink, type NoteStroke } from "./model";

const SVG_NS = "http://www.w3.org/2000/svg";
const PEN_WIDTH = 2;
/** CSS px within which a tap lands on a stroke, and a press is a tap. */
const HIT_PX = 12;
const TAP_PX = 6;
/** The eraser's reach, CSS px. */
const ERASE_PX = 10;
/** A pen's eraser button (PointerEvent.buttons). */
const ERASER_BUTTON = 32;

const LINK_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-1 1"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l1-1"/></svg>`;

export type PadTool = "pen" | "eraser";

export interface SurfaceEnv {
  pad: () => Notepad;
  /** This view changed the pad: save, tell the others. */
  changed: () => void;
  /** Where the reader is now (a new note's place), and which visit to
   *  that page this is: it changes each time the reader turns to
   *  another page, so a stroke after a return starts a new note. */
  place: () => (PagePlace & { visit: number }) | null;
  /** Go to a note's place, or a link's target. */
  goTo: (t: PlaceTarget) => void;
  /** The tool changed (the double-tap, the eraser end). */
  toolChanged?: (t: PadTool) => void;
}

/** Keep a pointer's events coming here, if it is still there to keep. */
function capture(el: Element, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* the pointer is already gone */
  }
}

/** A smooth path through the points (midpoint quadratics). */
function pathD(pts: number[]): string {
  if (pts.length < 2) return "";
  if (pts.length < 4) return `M${pts[0]} ${pts[1]}l0.01 0`;
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i + 3 < pts.length; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2;
    const my = (pts[i + 1] + pts[i + 3]) / 2;
    d += `Q${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  return `${d}L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
}

function bounds(pts: number[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    x1 = Math.max(x1, pts[i]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return [x0, y0, x1, y1];
}

/** Distance from (x, y) to a stroke's line. */
function distanceTo(pts: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1];
    const bx = pts[i + 2] ?? ax, by = pts[i + 3] ?? ay;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

/** Is (x, y) within `reach` of the stroke's line? */
const touches = (s: NoteStroke, x: number, y: number, reach: number) => {
  const [x0, y0, x1, y1] = bounds(s.points);
  if (x < x0 - reach || x > x1 + reach || y < y0 - reach || y > y1 + reach) return false;
  return distanceTo(s.points, x, y) <= reach;
};

type Step =
  | { kind: "stroke" | "link"; id: string }
  | { kind: "erase"; strokes: NoteStroke[]; notes: Note[] };

export function createSurface(host: HTMLElement, env: SurfaceEnv) {
  const layer = document.createElement("div");
  layer.className = "notepad-layer";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "notepad-strokes");
  const labels = document.createElement("div");
  labels.className = "notepad-labels";
  layer.append(svg, labels);
  host.appendChild(layer);

  const paths = new Map<string, SVGPathElement>();
  // What undo takes back, last first.
  const history: Step[] = [];
  // The note being written: the reader's visit to its page.
  let current: { note: string; visit: number } | null = null;
  let tool: PadTool = "pen";
  // This view's own pan, starting where the pad was left.
  let pan = { ...env.pad().pan };

  // The dot grid behind (notepad.css) moves with the canvas.
  const applyPan = () => {
    layer.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
    host.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
  };
  /** A client point on the canvas. */
  const toCanvas = (cx: number, cy: number): [number, number] => {
    const r = host.getBoundingClientRect();
    return [cx - r.left - pan.x, cy - r.top - pan.y];
  };

  function drawStroke(s: NoteStroke): void {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", pathD(s.points));
    p.setAttribute("stroke-width", String(s.width));
    if (s.color) p.style.stroke = s.color;
    svg.appendChild(p);
    paths.set(s.id, p);
  }

  /** Each note's page, small, above its first line; and the links. */
  function drawLabels(): void {
    const pad = env.pad();
    labels.replaceChildren();
    for (const n of pad.notes) {
      const pts = pad.strokes.filter((s) => s.note === n.id).flatMap((s) => s.points);
      if (!pts.length) continue;
      const [x0, y0] = bounds(pts);
      const el = document.createElement("span");
      el.className = "notepad-note-label";
      el.textContent = `p. ${n.pageIndex + 1}`;
      el.style.left = `${x0}px`;
      el.style.top = `${y0 - 16}px`;
      labels.appendChild(el);
    }
    for (const l of pad.links) labels.appendChild(linkChip(l));
  }

  function linkChip(l: NoteLink): HTMLElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = l.target.kind === "annotation" ? "notepad-link notepad-link-quote" : "notepad-link";
    el.style.left = `${l.x}px`;
    el.style.top = `${l.y}px`;
    if (l.target.kind === "annotation") el.style.setProperty("--link-color", l.target.color || "#ffd400");
    el.innerHTML = LINK_SVG;
    const text = document.createElement("span");
    text.textContent = linkLabel(l.target);
    el.appendChild(text);
    el.title = l.target.kind === "annotation" ? `Go to the highlight, p. ${l.target.pageIndex + 1}` : `Go to page ${l.target.pageIndex + 1}`;
    // Dragged to move; tapped to go.
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const from = { x: e.clientX, y: e.clientY, lx: l.x, ly: l.y };
      let moved = false;
      capture(el, e.pointerId);
      const move = (ev: PointerEvent) => {
        moved ||= Math.hypot(ev.clientX - from.x, ev.clientY - from.y) > TAP_PX;
        if (!moved) return;
        l.x = from.lx + ev.clientX - from.x;
        l.y = from.ly + ev.clientY - from.y;
        el.style.left = `${l.x}px`;
        el.style.top = `${l.y}px`;
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        if (moved) env.changed();
        else env.goTo(l.target);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
    return el;
  }

  function render(): void {
    svg.replaceChildren();
    paths.clear();
    for (const s of env.pad().strokes) drawStroke(s);
    drawLabels();
    applyPan();
  }

  function setTool(t: PadTool): void {
    tool = t;
    host.classList.toggle("erasing", t === "eraser");
    env.toolChanged?.(t);
  }

  // --- erasing ----------------------------------------------------------------
  /** Take out every stroke within reach of a canvas point; the notes
   *  left with none go too. Gathered into `step` for undo. */
  function eraseAt(x: number, y: number, step: { strokes: NoteStroke[]; notes: Note[] }): void {
    const pad = env.pad();
    const hit = pad.strokes.filter((s) => touches(s, x, y, ERASE_PX));
    if (!hit.length) return;
    for (const s of hit) {
      paths.get(s.id)?.remove();
      paths.delete(s.id);
      step.strokes.push(s);
    }
    pad.strokes = pad.strokes.filter((s) => !hit.includes(s));
    const gone = pad.notes.filter((n) => !pad.strokes.some((s) => s.note === n.id));
    step.notes.push(...gone);
    pad.notes = pad.notes.filter((n) => !gone.includes(n));
    drawLabels();
  }

  // --- input ----------------------------------------------------------------
  type Gesture =
    | { kind: "write"; id: number; pts: number[]; path: SVGPathElement; from: [number, number]; mouse: boolean; t0: number }
    | { kind: "erase"; id: number; step: { strokes: NoteStroke[]; notes: Note[] } }
    | { kind: "pan"; id: number; x: number; y: number; from: [number, number]; t0: number };
  let g: Gesture | null = null;

  function onDown(e: PointerEvent): void {
    if (g || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    capture(host, e.pointerId);
    const t0 = performance.now();
    if (e.pointerType === "touch") {
      g = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY, from: [e.clientX, e.clientY], t0 };
      return;
    }
    const [x, y] = toCanvas(e.clientX, e.clientY);
    if (tool === "eraser" || e.buttons & ERASER_BUTTON) {
      g = { kind: "erase", id: e.pointerId, step: { strokes: [], notes: [] } };
      eraseAt(x, y, g.step);
      return;
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("stroke-width", String(PEN_WIDTH));
    svg.appendChild(path);
    g = { kind: "write", id: e.pointerId, pts: [x, y], path, from: [e.clientX, e.clientY], mouse: e.pointerType === "mouse", t0 };
    path.setAttribute("d", pathD(g.pts));
  }

  function onMove(e: PointerEvent): void {
    if (!g || e.pointerId !== g.id) return;
    if (g.kind === "pan") {
      pan = { x: pan.x + e.clientX - g.x, y: pan.y + e.clientY - g.y };
      g.x = e.clientX;
      g.y = e.clientY;
      applyPan();
      return;
    }
    const [x, y] = toCanvas(e.clientX, e.clientY);
    if (g.kind === "erase") return eraseAt(x, y, g.step);
    const n = g.pts.length;
    if (Math.hypot(x - g.pts[n - 2], y - g.pts[n - 1]) < 0.8) return;
    g.pts.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
    g.path.setAttribute("d", pathD(g.pts));
  }

  /** The note whose line is under a client point. */
  function noteAt(cx: number, cy: number): string | null {
    const [x, y] = toCanvas(cx, cy);
    const pad = env.pad();
    for (let i = pad.strokes.length - 1; i >= 0; i--) {
      if (touches(pad.strokes[i], x, y, HIT_PX)) return pad.strokes[i].note;
    }
    return null;
  }

  function tapOn(cx: number, cy: number): void {
    const id = noteAt(cx, cy);
    const note = id ? env.pad().notes.find((n) => n.id === id) : null;
    if (note) env.goTo({ kind: "place", pageIndex: note.pageIndex, top: note.top });
  }

  function onUp(e: PointerEvent): void {
    if (!g || e.pointerId !== g.id) return;
    const done = g;
    g = null;
    if (done.kind === "erase") {
      if (done.step.strokes.length) {
        history.push({ kind: "erase", ...done.step });
        env.changed();
      }
      return;
    }
    const tap = Math.hypot(e.clientX - done.from[0], e.clientY - done.from[1]) < TAP_PX && performance.now() - done.t0 < 500;
    if (done.kind === "pan") {
      if (tap) tapOn(e.clientX, e.clientY);
      else {
        env.pad().pan = { ...pan };
        env.changed();
      }
      return;
    }
    // A click with the mouse is a tap, not a dot.
    if (done.mouse && tap) {
      done.path.remove();
      tapOn(e.clientX, e.clientY);
      return;
    }
    if (e.type === "pointercancel" && done.pts.length < 4) {
      done.path.remove();
      return;
    }
    finishStroke(done.pts, done.path);
  }

  /** A finished stroke joins the note being written while the reader is
   *  still on its page, or begins the next. */
  function finishStroke(pts: number[], path: SVGPathElement): void {
    const pad = env.pad();
    const place = env.place();
    const visit = place?.visit ?? -1;
    let note = current && current.visit === visit && pad.notes.some((n) => n.id === current!.note) ? current.note : "";
    if (!note) {
      note = newId("note");
      pad.notes.push({ id: note, createdMs: Date.now(), pageIndex: place?.pageIndex ?? 0, top: place?.top ?? null });
      current = { note, visit };
    }
    const stroke: NoteStroke = { id: newId("s"), points: pts, width: PEN_WIDTH, color: "", note };
    pad.strokes.push(stroke);
    paths.set(stroke.id, path);
    history.push({ kind: "stroke", id: stroke.id });
    drawLabels();
    env.changed();
  }

  // --- following the PDF ----------------------------------------------------
  /** The part of the pad about page `pageIndex`: the top of its notes
   *  and links; for a page with none, between those of the pages before
   *  and after it, as far along as the page is; past the last, just
   *  under it. Canvas coordinates, or null on an empty pad. */
  function spotFor(pageIndex: number): { x: number; y: number } | null {
    const pad = env.pad();
    const spans: { page: number; x0: number; y0: number; y1: number }[] = [];
    for (const n of pad.notes) {
      const pts = pad.strokes.filter((s) => s.note === n.id).flatMap((s) => s.points);
      if (!pts.length) continue;
      const [x0, y0, , y1] = bounds(pts);
      spans.push({ page: n.pageIndex, x0, y0, y1 });
    }
    for (const l of pad.links) spans.push({ page: l.target.pageIndex, x0: l.x, y0: l.y, y1: l.y + 24 });
    if (!spans.length) return null;
    const here = spans.filter((s) => s.page === pageIndex);
    if (here.length) return { x: Math.min(...here.map((s) => s.x0)), y: Math.min(...here.map((s) => s.y0)) };
    const before = spans.filter((s) => s.page < pageIndex);
    const after = spans.filter((s) => s.page > pageIndex);
    const a = before.length ? before.reduce((m, s) => (s.page > m.page || (s.page === m.page && s.y1 > m.y1) ? s : m)) : null;
    const b = after.length ? after.reduce((m, s) => (s.page < m.page || (s.page === m.page && s.y0 < m.y0) ? s : m)) : null;
    if (a && b) {
      const t = (pageIndex - a.page) / (b.page - a.page);
      return { x: Math.min(a.x0, b.x0), y: a.y1 + (b.y0 - a.y1) * t };
    }
    return a ? { x: a.x0, y: a.y1 + 20 } : { x: b!.x0, y: b!.y0 };
  }

  /** Pan, smoothly, to the part of the pad about `pageIndex` — its top a
   *  little below the pad's top, its left in view. */
  function follow(pageIndex: number): void {
    const spot = spotFor(pageIndex);
    if (!spot || g) return;
    const margin = 28;
    const y = margin - spot.y;
    const x = spot.x + pan.x < 8 || spot.x + pan.x > host.clientWidth - 40 ? margin - spot.x : pan.x;
    if (Math.abs(y - pan.y) < 2 && Math.abs(x - pan.x) < 2) return;
    pan = { x, y };
    host.classList.add("following");
    applyPan();
    window.setTimeout(() => host.classList.remove("following"), 400);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
    applyPan();
    env.pad().pan = { ...pan };
    env.changed();
  }

  // The Pencil and a finger mustn't scroll or select anything beneath.
  const stopTouch = (e: TouchEvent) => e.preventDefault();
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("touchstart", stopTouch, { passive: false });
  host.addEventListener("touchmove", stopTouch, { passive: false });

  render();

  return {
    /** Redraw from the pad (another view changed it). */
    render,
    follow,
    tool: () => tool,
    setTool,
    /** Add a link at the middle of what this view shows. */
    addLink(target: PlaceTarget): void {
      const pad = env.pad();
      const shift = (pad.links.length % 5) * 14;
      const link: NoteLink = {
        id: newId("link"),
        x: Math.round(host.clientWidth / 2 - pan.x - 90 + shift),
        y: Math.round(host.clientHeight / 2 - pan.y - 12 + shift),
        target,
      };
      pad.links.push(link);
      history.push({ kind: "link", id: link.id });
      drawLabels();
      env.changed();
    },
    /** Take back the last stroke, link or erasing made in this view. */
    undo(): void {
      const step = history.pop();
      if (!step) return;
      const pad = env.pad();
      if (step.kind === "link") pad.links = pad.links.filter((l) => l.id !== step.id);
      else if (step.kind === "erase") {
        pad.strokes.push(...step.strokes);
        pad.notes.push(...step.notes);
        for (const s of step.strokes) drawStroke(s);
      } else {
        pad.strokes = pad.strokes.filter((s) => s.id !== step.id);
        paths.get(step.id)?.remove();
        paths.delete(step.id);
        pad.notes = pad.notes.filter((n) => pad.strokes.some((s) => s.note === n.id));
      }
      drawLabels();
      env.changed();
    },
    canUndo: () => history.length > 0,
    destroy(): void {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("touchstart", stopTouch);
      host.removeEventListener("touchmove", stopTouch);
      layer.remove();
    },
  };
}

export type NotepadSurface = ReturnType<typeof createSurface>;
