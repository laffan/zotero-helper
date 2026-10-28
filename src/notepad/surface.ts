// The notepad's canvas: the Pencil writes, a finger pans, and a finger
// tap on a note goes back to where in the PDF the reader was when it was
// written. Links dragged onto the pad sit on it as chips (links.ts).
// `clear` empties the pad (NotepadBody asks first); undo brings it back.
// Plain DOM, as the viewer's ink is (src/pdfviewer/ink/): a stroke is an
// SVG path that grows sample by sample, with no React render while the
// pen is down.
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
import type { PagePlace, PlaceTarget } from "../pdfviewer/places";
import { bounds, pathD, touches } from "./geometry";
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
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "notepad-strokes");
  const labels = document.createElement("div");
  labels.className = "notepad-labels";
  layer.append(svg, labels);
  host.appendChild(layer);

  const paths = new Map<string, SVGPathElement>();
  const chips = new Map<string, HTMLElement>();
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

  // The dot grid behind (notepad.css) moves with the canvas.
  const applyPan = () => {
    layer.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
    host.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
    tell("view");
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

  function dropStroke(id: string): void {
    paths.get(id)?.remove();
    paths.delete(id);
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

  /** Each note's page, small, above its first line; and the links. */
  function drawLabels(): void {
    const pad = env.pad();
    labels.replaceChildren();
    chips.clear();
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
    pathOf: (id) => paths.get(id),
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
      paths.get(s.id)?.setAttribute("d", pathD(s.points));
    }
    for (const l of pad.links) {
      if (!linkIds.includes(l.id)) continue;
      l.x = Math.round(l.x + dx);
      l.y = Math.round(l.y + dy);
    }
    drawLabels();
  }

  /** Take strokes and links off the pad (a selection's Delete, a link's). */
  function removeItems(strokes: NoteStroke[], links: NoteLink[]): void {
    const pad = env.pad();
    pad.strokes = pad.strokes.filter((s) => !strokes.includes(s));
    pad.links = pad.links.filter((l) => !links.includes(l));
    for (const s of strokes) dropStroke(s.id);
    history.push({ kind: "remove", strokes, notes: dropEmptyNotes(), links });
    drawLabels();
    env.changed();
  }

  function render(): void {
    lasso.clear();
    svg.replaceChildren();
    paths.clear();
    for (const s of env.pad().strokes) drawStroke(s);
    drawLabels();
    applyPan();
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
    for (const s of hit) {
      dropStroke(s.id);
      step.strokes.push(s);
    }
    pad.strokes = pad.strokes.filter((s) => !hit.includes(s));
    step.notes.push(...dropEmptyNotes());
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
      | { kind: "write"; pts: number[]; path: SVGPathElement; mouse: boolean }
      | { kind: "erase"; step: { strokes: NoteStroke[]; notes: Note[] } }
      // `panning` once the finger has gone past a tap's reach; `cleared`
      // when its press let go of a selection, so its tap does no more.
      | { kind: "pan"; panning: boolean; cleared: boolean }
      | { kind: "lasso" }
      | { kind: "move" }
    );
  let g: Gesture | null = null;
  let heardAt = 0;

  /** Held still for HOLD_MS where it came down: a lasso from there. */
  function armHold(gs: Gesture): void {
    gs.hold = window.setTimeout(() => {
      if (g !== gs || (gs.kind !== "write" && gs.kind !== "pan")) return;
      if (gs.kind === "write") gs.path.remove();
      g = { ...gs, kind: "lasso", hold: 0 };
      lasso.begin(...toCanvas(gs.from[0], gs.from[1]));
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
    heardAt = performance.now();
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
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("stroke-width", String(PEN_WIDTH));
    if (color) path.style.stroke = color;
    svg.appendChild(path);
    g = { ...press, kind: "write", pts: [x, y], path, mouse: e.pointerType === "mouse" };
    path.setAttribute("d", pathD(g.pts));
    armHold(g);
  }

  function onMove(e: PointerEvent): void {
    if (!g || e.pointerId !== g.id) return;
    heardAt = performance.now();
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
      g.path.setAttribute("d", pathD(g.pts));
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
    window.clearTimeout(done.hold);
    const tap =
      type === "pointerup" && Math.hypot(cx - done.from[0], cy - done.from[1]) < TAP_PX && performance.now() - done.t0 < HOLD_MS;
    if (done.kind === "lasso") {
      lasso.finish();
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
      done.path.remove();
      tapOn(cx, cy);
      return;
    }
    if (type === "pointercancel" && done.pts.length < 4) {
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
    const stroke: NoteStroke = { id: newId("s"), points: pts, width: PEN_WIDTH, color, note };
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
    for (const l of pad.links) spans.push({ page: l.target.pageIndex, x0: l.x, y0: l.y, y1: l.y + (l.h ?? 24) });
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
        dropStroke(step.id);
        dropEmptyNotes();
      } else {
        pad.strokes.push(...step.strokes);
        pad.notes.push(...step.notes);
        if (step.kind !== "erase") pad.links.push(...step.links);
        for (const s of step.strokes) drawStroke(s);
      }
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
      if (g) window.clearTimeout(g.hold);
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
