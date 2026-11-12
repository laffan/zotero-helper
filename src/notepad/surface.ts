// The notepad's canvas: the Pencil writes, a finger pans, and a finger
// tap on a note goes back to where in the PDF the reader was when it was
// written. Links dragged onto the pad sit on it as chips (links.ts).
// `clear` empties the pad (NotepadBody asks first); undo brings it back.
// Plain DOM, with no React render while the pen is down. The ink is a
// canvas (ink.ts): a sample draws one curve onto it, and the pen costs
// the same on a full pad as on an empty one — it reads no layout (the
// canvas's box is read once, as a press begins) and nothing is drawn
// again. Over the canvas, a layer that pans with it holds the notes'
// labels, the links' chips and the lasso's loop and frame.
//
// The pen writes in the ink of the theme (`--notepad-ink`, kept as an
// empty colour, so a stroke follows the appearance) or in red
// (`RED_INK`); `setColor` picks which, for the strokes after it.
//
// Who does what: the Pencil (`pointerType` "pen") writes — a tap is a
// dot — or, with the eraser on (the Pencil's double-tap, the bar's
// eraser, or the eraser end of a pen that has one), takes out every
// stroke it passes over. A finger pans, and taps. A mouse (a Mac, no
// Pencil) writes with a drag and taps with a click; a wheel or trackpad
// pans. Any of them held still where it came down (HOLD_MS) draws a
// lasso instead, which selects what it encloses (lasso.ts); with the
// lasso as the tool, the Pencil and the mouse draw one at once. The
// eraser is shared with the pages' ink mode (lib/penTool.ts, through
// NotepadBody). Strokes
// written while the reader stays on one page are one note (model.ts),
// which remembers the reader's place when it began; turning to another
// page — even to come straight back — starts the next. Each note shows
// its page, small, above it.
//
// What the pen sets off waits for it. Its gestures are reported to
// lib/penActivity.ts, which holds the pages' renders (and the pad's
// save and minimap) while it writes; and a finished stroke moves only
// its own note's label (from the note's box, kept as it grows), where
// every other change redraws the labels and the links' chips.
//
// A gesture always ends. Its end is heard on the window, whatever
// element it reaches; a pen coming down while one is still open ends
// that one first (a pen can't be down twice), as does any press once
// the open one has heard nothing for STALE_MS. Otherwise a lost
// pointer-up left the pad deaf to the Pencil until it was closed.
//
// Following the PDF (`follow`, the bar's branch): as the reader turns
// pages, the pad pans to the part of it about that page — its notes and
// links, or, for a page with none, where they would fall between those
// of the pages around it — on the supposition that the pad is written
// from top to bottom as the PDF is read.
//
// Several views may show one pad (model.ts shares it): each pans on its
// own, and `render` redraws one when another has changed the pad.
// `watch` tells a minimap (minimap.ts) when the view moves or the pad
// changes.
import { penDown, penHeard, penUp } from "../lib/penActivity";
import type { PagePlace, PlaceTarget } from "../pdfviewer/places";
import { touches } from "./geometry";
import { spotFor } from "./follow";
import { createPadInk, strokeBox } from "./ink";
import { createLasso } from "./lasso";
import { capture, createLinkChips } from "./links";
import { newId, type Note, type Notepad, type NoteLink, type NoteStroke } from "./model";

const SVG_NS = "http://www.w3.org/2000/svg";
const PEN_WIDTH = 2;
/** The pen's other ink: reading mode's red. */
export const RED_INK = "#ff5f57";
/** CSS px within which a tap lands on a stroke, and a press is a tap
 *  (or held still, for the lasso). */
const HIT_PX = 12;
const TAP_PX = 6;
const STILL_PX = 4;
/** How long a press is held still to draw a lasso, ms (Hush's). */
const HOLD_MS = 500;
/** A gesture that has heard nothing for this long has lost its end. */
const STALE_MS = 1500;
/** How long the pad takes to glide to the part about a page, ms. */
const GLIDE_MS = 350;
/** The eraser's reach, CSS px. */
const ERASE_PX = 10;
/** A pen's eraser button (PointerEvent.buttons). */
const ERASER_BUTTON = 32;

export type PadTool = "pen" | "eraser" | "lasso";

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
  /** A press held still has borrowed the lasso (on), or let it go —
   *  for the bar's switch to show while the loop is drawn. */
  lassoBorrowed?: (on: boolean) => void;
}

type Step =
  | { kind: "stroke"; id: string }
  | { kind: "link"; id: string }
  | { kind: "erase"; strokes: NoteStroke[]; notes: Note[] }
  | { kind: "remove" | "clear"; strokes: NoteStroke[]; notes: Note[]; links: NoteLink[] }
  | { kind: "move"; strokes: string[]; links: string[]; dx: number; dy: number };

/** What a minimap is told: the view moved, or the pad changed. */
export type SurfaceChange = "view" | "content";

/** Let go of a text selection in the pages: while one stands, WebKit's
 *  text interaction may take a press elsewhere as the tap that ends it. */
function dropPageSelection(): void {
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.anchorNode?.parentElement?.closest(".textLayer")) sel.removeAllRanges();
}

export function createSurface(host: HTMLElement, env: SurfaceEnv) {
  const layer = document.createElement("div");
  layer.className = "notepad-layer";
  // The lasso's loop, as it is drawn (lasso.ts).
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "notepad-strokes");
  const labels = document.createElement("div");
  labels.className = "notepad-labels";
  layer.append(svg, labels);
  host.appendChild(layer);

  const ink = createPadInk(host, () => env.pad().strokes);
  const chips = new Map<string, HTMLElement>();
  // Each note's page label, by note.
  const noteLabels = new Map<string, HTMLElement>();
  // What undo takes back, last first.
  const history: Step[] = [];
  // The note being written: the reader's visit to its page.
  let current: { note: string; visit: number } | null = null;
  let tool: PadTool = "pen";
  // The pen's colour: "" is the theme's ink.
  let color = "";
  // This view's own pan, starting where the pad was left.
  let pan = { ...env.pad().pan };
  const watchers = new Set<(what: SurfaceChange) => void>();
  const tell = (what: SurfaceChange) => watchers.forEach((fn) => fn(what));

  // The ink, the layer over it and the dot grid behind (notepad.css)
  // move together, once a frame however many moves a pan sends.
  let panFrame = 0;
  const showPan = () => {
    panFrame = 0;
    ink.setPan(pan.x, pan.y);
    layer.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
    host.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
    tell("view");
  };
  const applyPan = () => {
    if (!panFrame) panFrame = requestAnimationFrame(showPan);
  };
  // The canvas's place in the window: read as a press begins and used
  // for all of it, so a sample reads no layout.
  let origin: { left: number; top: number } | null = null;
  /** A client point on the canvas. */
  const toCanvas = (cx: number, cy: number): [number, number] => {
    const r = origin ?? host.getBoundingClientRect();
    return [cx - r.left - pan.x, cy - r.top - pan.y];
  };

  // Each note's top left corner, kept as its strokes arrive; forgotten
  // (and measured again when asked for) at any other change.
  const noteCorner = new Map<string, [number, number]>();
  function cornerOf(id: string): [number, number] | null {
    let c = noteCorner.get(id);
    if (c) return c;
    let [x0, y0] = [Infinity, Infinity];
    for (const s of env.pad().strokes) {
      if (s.note !== id) continue;
      const b = strokeBox(s);
      x0 = Math.min(x0, b[0]);
      y0 = Math.min(y0, b[1]);
    }
    if (x0 === Infinity) return null;
    noteCorner.set(id, (c = [x0, y0]));
    return c;
  }

  /** The notes left with no strokes go too; returned, for undo. */
  function dropEmptyNotes(): Note[] {
    const pad = env.pad();
    const gone = pad.notes.filter((n) => !pad.strokes.some((s) => s.note === n.id));
    pad.notes = pad.notes.filter((n) => !gone.includes(n));
    return gone;
  }

  const linkChips = createLinkChips(host, {
    changed: () => env.changed(),
    goTo: (l) => env.goTo(l.target),
    remove: (l) => removeItems([], [l]),
  });

  /** A note's label, made or moved to the top left of its strokes;
   *  null when it has none. */
  function noteLabel(n: Note): HTMLElement | null {
    const corner = cornerOf(n.id);
    if (!corner) return null;
    const [x0, y0] = corner;
    let el = noteLabels.get(n.id);
    if (!el) {
      el = document.createElement("span");
      el.className = "notepad-note-label";
      el.textContent = `p. ${n.pageIndex + 1}`;
      noteLabels.set(n.id, el);
    }
    el.style.left = `${x0}px`;
    el.style.top = `${y0 - 16}px`;
    return el;
  }

  /** Each note's page, small, above its first line; and the links. */
  function drawLabels(): void {
    const pad = env.pad();
    labels.replaceChildren();
    chips.clear();
    noteLabels.clear();
    noteCorner.clear();
    for (const n of pad.notes) {
      const el = noteLabel(n);
      if (el) labels.appendChild(el);
    }
    for (const l of pad.links) {
      const chip = linkChips.chip(l);
      chips.set(l.id, chip);
      labels.appendChild(chip);
    }
    lasso.prune();
    tell("content");
  }

  // --- selecting (lasso.ts) ---------------------------------------------------
  const lasso = createLasso(layer, svg, {
    pad: env.pad,
    lift: (strokes, dx, dy) => ink.lift(strokes, dx, dy),
    chipOf: (id) => chips.get(id),
    moved: (strokes, links, dx, dy) => {
      shift(strokes.map((s) => s.id), links.map((l) => l.id), dx, dy);
      history.push({ kind: "move", strokes: strokes.map((s) => s.id), links: links.map((l) => l.id), dx, dy });
      env.changed();
    },
    removed: (strokes, links) => removeItems(strokes, links),
  });

  /** Move strokes and links by (dx, dy) on the canvas. */
  function shift(strokeIds: string[], linkIds: string[], dx: number, dy: number): void {
    const pad = env.pad();
    for (const s of pad.strokes) {
      if (!strokeIds.includes(s.id)) continue;
      s.points = s.points.map((v, i) => Math.round((v + (i % 2 ? dy : dx)) * 10) / 10);
    }
    for (const l of pad.links) {
      if (!linkIds.includes(l.id)) continue;
      l.x = Math.round(l.x + dx);
      l.y = Math.round(l.y + dy);
    }
    ink.redraw();
    drawLabels();
  }

  /** Take strokes and links off the pad (a selection's Delete, a link's). */
  function removeItems(strokes: NoteStroke[], links: NoteLink[]): void {
    const pad = env.pad();
    pad.strokes = pad.strokes.filter((s) => !strokes.includes(s));
    pad.links = pad.links.filter((l) => !links.includes(l));
    history.push({ kind: "remove", strokes, notes: dropEmptyNotes(), links });
    ink.redraw();
    drawLabels();
    env.changed();
  }

  function render(): void {
    lasso.clear();
    drawLabels();
    cancelAnimationFrame(panFrame);
    showPan();
    ink.drawNow();
  }

  function setTool(t: PadTool): void {
    tool = t;
    host.classList.toggle("erasing", t === "eraser");
    host.classList.toggle("lassoing", t === "lasso");
    env.toolChanged?.(t);
  }

  // --- erasing ----------------------------------------------------------------
  /** Take out every stroke within reach of a canvas point; the notes
   *  left with none go too. Gathered into `step` for undo. */
  function eraseAt(x: number, y: number, step: { strokes: NoteStroke[]; notes: Note[] }): void {
    const pad = env.pad();
    const hit = pad.strokes.filter((s) => touches(s, x, y, ERASE_PX));
    if (!hit.length) return;
    step.strokes.push(...hit);
    pad.strokes = pad.strokes.filter((s) => !hit.includes(s));
    step.notes.push(...dropEmptyNotes());
    ink.redraw();
    drawLabels();
  }

  // --- input ----------------------------------------------------------------
  /** Where a press came down (client px) and when; where it is now. */
  interface Press {
    id: number;
    from: [number, number];
    last: [number, number];
    t0: number;
    /** The lasso's timer, while the press may yet be held still. */
    hold: number;
  }
  type Gesture = Press &
    (
      | { kind: "write"; pts: number[]; mouse: boolean }
      | { kind: "erase"; step: { strokes: NoteStroke[]; notes: Note[] } }
      // `panning` once the finger has gone past a tap's reach; `cleared`
      // when its press let go of a selection, so its tap does no more.
      | { kind: "pan"; panning: boolean; cleared: boolean }
      // `borrowed`: a press held still, not the lasso tool's.
      | { kind: "lasso"; borrowed?: boolean }
      | { kind: "move" }
    );
  let g: Gesture | null = null;
  let heardAt = 0;
  // This view's pen, to lib/penActivity.ts.
  const me = {};

  /** Held still for HOLD_MS where it came down: a lasso from there. */
  function armHold(gs: Gesture): void {
    gs.hold = window.setTimeout(() => {
      if (g !== gs || (gs.kind !== "write" && gs.kind !== "pan")) return;
      if (gs.kind === "write") ink.drop();
      g = { ...gs, kind: "lasso", hold: 0, borrowed: true };
      lasso.begin(...toCanvas(gs.from[0], gs.from[1]));
      env.lassoBorrowed?.(true);
    }, HOLD_MS);
  }

  function onDown(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const pen = e.pointerType === "pen";
    if (g) {
      // A pen can't be down twice, and a gesture that has heard nothing
      // for a while has lost its end: either way it is over. Otherwise
      // this is a second finger, which the first keeps.
      if (pen || performance.now() - heardAt > STALE_MS) end(g, "pointercancel", g.last[0], g.last[1]);
      else return;
    }
    if (!pen && !e.isPrimary) return;
    e.preventDefault();
    capture(host, e.pointerId);
    dropPageSelection();
    stopGlide();
    origin = host.getBoundingClientRect();
    heardAt = performance.now();
    // A finger pans and taps; anything else writes, erases or selects.
    if (e.pointerType !== "touch") penDown(me);
    const press: Press = { id: e.pointerId, from: [e.clientX, e.clientY], last: [e.clientX, e.clientY], t0: heardAt, hold: 0 };
    const [x, y] = toCanvas(e.clientX, e.clientY);
    // A selection: dragged from inside its frame; let go of from outside.
    let cleared = false;
    if (lasso.has()) {
      if (lasso.contains(x, y)) {
        g = { ...press, kind: "move" };
        return;
      }
      lasso.clear();
      cleared = true;
    }
    if (e.pointerType === "touch") {
      g = { ...press, kind: "pan", panning: false, cleared };
      armHold(g);
      return;
    }
    if (tool === "eraser" || e.buttons & ERASER_BUTTON) {
      g = { ...press, kind: "erase", step: { strokes: [], notes: [] } };
      eraseAt(x, y, g.step);
      return;
    }
    if (tool === "lasso") {
      g = { ...press, kind: "lasso" };
      lasso.begin(x, y);
      return;
    }
    g = { ...press, kind: "write", pts: [x, y], mouse: e.pointerType === "mouse" };
    ink.begin(x, y, color, PEN_WIDTH);
    armHold(g);
  }

  function onMove(e: PointerEvent): void {
    if (!g || e.pointerId !== g.id) return;
    heardAt = performance.now();
    penHeard(heardAt);
    const [dx, dy] = [e.clientX - g.last[0], e.clientY - g.last[1]];
    g.last = [e.clientX, e.clientY];
    const away = Math.hypot(e.clientX - g.from[0], e.clientY - g.from[1]);
    if (g.hold && away > STILL_PX) {
      window.clearTimeout(g.hold);
      g.hold = 0;
    }
    const [x, y] = toCanvas(e.clientX, e.clientY);
    if (g.kind === "pan") {
      // A finger's first few pixels might still be a tap.
      if (!g.panning && away <= TAP_PX) return;
      g.panning = true;
      pan = { x: pan.x + dx, y: pan.y + dy };
      applyPan();
    } else if (g.kind === "lasso") lasso.extend(x, y);
    else if (g.kind === "move") lasso.drag(e.clientX - g.from[0], e.clientY - g.from[1]);
    else if (g.kind === "erase") eraseAt(x, y, g.step);
    else {
      const n = g.pts.length;
      if (Math.hypot(x - g.pts[n - 2], y - g.pts[n - 1]) < 0.8) return;
      g.pts.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      ink.extend(g.pts);
    }
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
    if (g && e.pointerId === g.id) end(g, e.type, e.clientX, e.clientY);
  }

  /** End gesture `done` — let go of at (cx, cy), or cancelled. */
  function end(done: Gesture, type: string, cx: number, cy: number): void {
    if (g !== done) return;
    g = null;
    origin = null;
    window.clearTimeout(done.hold);
    penUp(me);
    const tap =
      type === "pointerup" && Math.hypot(cx - done.from[0], cy - done.from[1]) < TAP_PX && performance.now() - done.t0 < HOLD_MS;
    if (done.kind === "lasso") {
      lasso.finish();
      if (done.borrowed) env.lassoBorrowed?.(false);
      return;
    }
    if (done.kind === "move") {
      // A tap on the selection lets go of it; a drag moves it.
      if (tap) lasso.clear();
      else lasso.drop(cx - done.from[0], cy - done.from[1]);
      return;
    }
    if (done.kind === "erase") {
      if (done.step.strokes.length) {
        history.push({ kind: "erase", ...done.step });
        env.changed();
      }
      return;
    }
    if (done.kind === "pan") {
      if (tap && !done.cleared) tapOn(cx, cy);
      else if (done.panning) {
        env.pad().pan = { ...pan };
        env.changed();
      }
      return;
    }
    // A click with the mouse is a tap, not a dot.
    if (done.mouse && tap) {
      ink.drop();
      tapOn(cx, cy);
      return;
    }
    if (type === "pointercancel" && done.pts.length < 4) {
      ink.drop();
      return;
    }
    ink.finish();
    finishStroke(done.pts);
  }

  /** A finished stroke joins the note being written while the reader is
   *  still on its page, or begins the next. */
  function finishStroke(pts: number[]): void {
    const pad = env.pad();
    const place = env.place();
    const visit = place?.visit ?? -1;
    let note = current && current.visit === visit && pad.notes.some((n) => n.id === current!.note) ? current.note : "";
    if (!note) {
      note = newId("note");
      pad.notes.push({ id: note, createdMs: Date.now(), pageIndex: place?.pageIndex ?? 0, top: place?.top ?? null });
      current = { note, visit };
    }
    const stroke: NoteStroke = { id: newId("s"), points: pts, width: PEN_WIDTH, color, note };
    pad.strokes.push(stroke);
    history.push({ kind: "stroke", id: stroke.id });
    // Only this note's label moves (or appears), and by this stroke's
    // box alone: rebuilding them all, and every link's chip, at each
    // pen-up cost the next stroke its start on a full pad.
    const box = strokeBox(stroke);
    const corner = noteCorner.get(note);
    if (corner) noteCorner.set(note, [Math.min(corner[0], box[0]), Math.min(corner[1], box[1])]);
    const n = pad.notes.find((x) => x.id === note);
    const el = n && noteLabel(n);
    if (el && !el.isConnected) labels.prepend(el);
    tell("content");
    env.changed();
  }

  // --- following the PDF ----------------------------------------------------
  /** Pan, smoothly, to the part of the pad about `pageIndex` — its top a
   *  little below the pad's top, its left in view. */
  function follow(pageIndex: number): void {
    const spot = spotFor(env.pad(), pageIndex);
    if (!spot || g) return;
    const margin = 28;
    const y = margin - spot.y;
    const x = spot.x + pan.x < 8 || spot.x + pan.x > host.clientWidth - 40 ? margin - spot.x : pan.x;
    if (Math.abs(y - pan.y) < 2 && Math.abs(x - pan.x) < 2) return;
    glideTo(x, y);
  }

  // A short glide (GLIDE_MS, easing out) to where the pad is going; a
  // press on the pad stops it where it is.
  let glide = 0;
  function stopGlide(): void {
    cancelAnimationFrame(glide);
    glide = 0;
  }
  function glideTo(x: number, y: number): void {
    stopGlide();
    const from = { ...pan };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / GLIDE_MS);
      const k = 1 - (1 - t) ** 3;
      pan = { x: Math.round(from.x + (x - from.x) * k), y: Math.round(from.y + (y - from.y) * k) };
      applyPan();
      glide = t < 1 ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
    applyPan();
    env.pad().pan = { ...pan };
    env.changed();
  }

  // The Pencil and a finger mustn't scroll or select anything beneath —
  // except on the menus' buttons (links.ts, lasso.ts), whose taps would
  // be cancelled with them.
  const stopTouch = (e: TouchEvent) => {
    if (!(e.target as Element).closest?.(".notepad-link-menu, .notepad-selection-menu")) e.preventDefault();
  };
  host.addEventListener("pointerdown", onDown);
  // Heard on the window, so the end of a gesture always arrives.
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
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
    /** The pen's colour from now on ("" for the theme's ink). */
    setColor(c: string): void {
      color = c;
    },
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
    /** Take back the last stroke, link, erasing, move, deletion or
     *  clearing made in this view. */
    undo(): void {
      const step = history.pop();
      if (!step) return;
      lasso.clear();
      const pad = env.pad();
      if (step.kind === "link") pad.links = pad.links.filter((l) => l.id !== step.id);
      else if (step.kind === "move") shift(step.strokes, step.links, -step.dx, -step.dy);
      else if (step.kind === "stroke") {
        pad.strokes = pad.strokes.filter((s) => s.id !== step.id);
        dropEmptyNotes();
      } else {
        pad.strokes.push(...step.strokes);
        pad.notes.push(...step.notes);
        if (step.kind !== "erase") pad.links.push(...step.links);
      }
      ink.redraw();
      drawLabels();
      env.changed();
    },
    canUndo: () => history.length > 0,
    /** Empty the pad: its strokes, notes and links (undo brings them
     *  back). */
    clear(): void {
      const pad = env.pad();
      if (!pad.strokes.length && !pad.links.length) return;
      history.push({ kind: "clear", strokes: pad.strokes, notes: pad.notes, links: pad.links });
      pad.strokes = [];
      pad.notes = [];
      pad.links = [];
      current = null;
      render();
      env.changed();
    },
    /** For a minimap: the part of the canvas in view; the links' boxes;
     *  showing a canvas point at the view's centre (`done`: the pan is
     *  kept, as a finger's is); and hearing of changes. */
    view: () => ({ x: -pan.x, y: -pan.y, w: host.clientWidth, h: host.clientHeight }),
    linkBoxes: () =>
      env.pad().links.map((l) => {
        const chip = chips.get(l.id);
        const color = l.target.kind === "annotation" ? l.target.color || "#ffd400" : RED_INK;
        return { x: l.x, y: l.y, w: chip?.offsetWidth ?? 120, h: chip?.offsetHeight ?? 24, color };
      }),
    panTo(x: number, y: number, done: boolean): void {
      pan = { x: Math.round(host.clientWidth / 2 - x), y: Math.round(host.clientHeight / 2 - y) };
      applyPan();
      if (!done) return;
      env.pad().pan = { ...pan };
      env.changed();
    },
    watch(fn: (what: SurfaceChange) => void): () => void {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    destroy(): void {
      if (g) {
        window.clearTimeout(g.hold);
        penUp(me);
      }
      stopGlide();
      cancelAnimationFrame(panFrame);
      ink.destroy();
      linkChips.closeMenu();
      lasso.destroy();
      host.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("touchstart", stopTouch);
      host.removeEventListener("touchmove", stopTouch);
      layer.remove();
    },
  };
}

export type NotepadSurface = ReturnType<typeof createSurface>;
