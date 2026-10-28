// Selecting on the notepad (surface.ts), as Hush selects: a long press —
// the Pencil, a finger or the mouse held still where it came down for a
// moment — turns that press into a lasso. The loop is drawn on from
// there, dashed, and when it is let go, what it encloses is selected: a
// stroke with any point inside it, a link whose middle is. The
// selection is framed, with Delete above the frame; a drag that starts
// inside the frame moves it (the Pencil, a finger or the mouse alike),
// ⌫ deletes it, Escape lets go of it, and so does a press anywhere else
// — the Pencil then writes at once, as it does in Hush. Held, the lasso
// is borrowed for the one press; the bar's switch also has it as a tool,
// when every press of the Pencil or the mouse draws one.
//
// What is selected and then leaves the pad by any other way — erased,
// undone, cleared, changed in another view — leaves the selection too
// (`prune`, after every change); with nothing left, the frame and its
// Delete go.
import { bounds, inPolygon, pathD } from "./geometry";
import { onPress, TRASH_SVG } from "./links";
import type { Notepad, NoteLink, NoteStroke } from "./model";

const SVG_NS = "http://www.w3.org/2000/svg";
/** How far round the selection its frame is drawn, and takes a press. */
const FRAME_PAD = 8;

export interface LassoEnv {
  pad: () => Notepad;
  /** Each stroke's path, and each link's chip, as drawn. */
  pathOf: (id: string) => SVGPathElement | undefined;
  chipOf: (id: string) => HTMLElement | undefined;
  /** The selection was dragged by (dx, dy), or deleted. */
  moved: (strokes: NoteStroke[], links: NoteLink[], dx: number, dy: number) => void;
  removed: (strokes: NoteStroke[], links: NoteLink[]) => void;
}

export function createLasso(layer: HTMLElement, svg: SVGSVGElement, env: LassoEnv) {
  const loop = document.createElementNS(SVG_NS, "path");
  loop.setAttribute("class", "notepad-lasso");
  const frame = document.createElement("div");
  frame.className = "notepad-selection";
  frame.style.display = "none";
  const bar = document.createElement("div");
  bar.className = "notepad-selection-menu";
  const del = document.createElement("button");
  del.type = "button";
  del.innerHTML = `${TRASH_SVG}<span>Delete</span>`;
  onPress(del, () => remove());
  bar.appendChild(del);
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());
  frame.appendChild(bar);
  layer.appendChild(frame);

  let pts: number[] | null = null;
  let strokes: NoteStroke[] = [];
  let links: NoteLink[] = [];
  let box: [number, number, number, number] | null = null;

  function begin(x: number, y: number): void {
    clear();
    pts = [x, y];
    loop.setAttribute("d", pathD(pts));
    svg.appendChild(loop);
  }

  function extend(x: number, y: number): void {
    if (!pts) return;
    const n = pts.length;
    if (Math.hypot(x - pts[n - 2], y - pts[n - 1]) < 1) return;
    pts.push(x, y);
    loop.setAttribute("d", `${pathD(pts)}Z`);
  }

  /** The loop let go: select what it encloses. True when it caught
   *  anything. */
  function finish(): boolean {
    const poly = pts;
    pts = null;
    loop.remove();
    if (!poly || poly.length < 6) return false;
    const pad = env.pad();
    strokes = pad.strokes.filter((s) => {
      for (let i = 0; i + 1 < s.points.length; i += 2) if (inPolygon(s.points[i], s.points[i + 1], poly)) return true;
      return false;
    });
    links = pad.links.filter((l) => {
      const chip = env.chipOf(l.id);
      return inPolygon(l.x + (chip?.offsetWidth ?? 0) / 2, l.y + (chip?.offsetHeight ?? 0) / 2, poly);
    });
    if (!strokes.length && !links.length) return false;
    showFrame();
    window.addEventListener("keydown", onKey);
    return true;
  }

  /** Frame what is selected, from where it is now. */
  function showFrame(): void {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of strokes) {
      const [a, b, c, d] = bounds(s.points);
      x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
    }
    for (const l of links) {
      const chip = env.chipOf(l.id);
      x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y);
      x1 = Math.max(x1, l.x + (chip?.offsetWidth ?? 0)); y1 = Math.max(y1, l.y + (chip?.offsetHeight ?? 0));
    }
    box = [x0 - FRAME_PAD, y0 - FRAME_PAD, x1 + FRAME_PAD, y1 + FRAME_PAD];
    Object.assign(frame.style, {
      left: `${box[0]}px`,
      top: `${box[1]}px`,
      width: `${box[2] - box[0]}px`,
      height: `${box[3] - box[1]}px`,
      transform: "",
      display: "",
    });
  }

  /** Let go of the selection (and any loop being drawn). */
  function clear(): void {
    pts = null;
    loop.remove();
    strokes = [];
    links = [];
    box = null;
    frame.style.display = "none";
    window.removeEventListener("keydown", onKey);
  }

  /** Keep to what is still on the pad: frame it again, or let go. */
  function prune(): void {
    if (!box) return;
    const pad = env.pad();
    strokes = strokes.filter((s) => pad.strokes.includes(s));
    links = links.filter((l) => pad.links.includes(l));
    if (strokes.length || links.length) showFrame();
    else clear();
  }

  function remove(): void {
    if (!strokes.length && !links.length) return;
    const gone = { strokes, links };
    clear();
    env.removed(gone.strokes, gone.links);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || (e.target as Element | null)?.closest?.("input, textarea, [contenteditable]")) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      remove();
    } else if (e.key === "Escape") {
      // Before reading mode's own Escape, which would leave it.
      e.preventDefault();
      e.stopPropagation();
      clear();
    }
  }

  /** Show the selection dragged by (dx, dy) — not yet moved. */
  function drag(dx: number, dy: number): void {
    const t = `translate(${dx}px, ${dy}px)`;
    for (const s of strokes) env.pathOf(s.id)?.setAttribute("transform", `translate(${dx} ${dy})`);
    for (const l of links) {
      const chip = env.chipOf(l.id);
      if (chip) chip.style.transform = t;
    }
    frame.style.transform = t;
  }

  /** The drag let go: move the selection by (dx, dy). */
  function drop(dx: number, dy: number): void {
    for (const s of strokes) env.pathOf(s.id)?.removeAttribute("transform");
    for (const l of links) {
      const chip = env.chipOf(l.id);
      if (chip) chip.style.transform = "";
    }
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) env.moved(strokes, links, dx, dy);
    showFrame();
  }

  return {
    begin,
    extend,
    finish,
    /** A loop is being drawn. */
    drawing: () => pts !== null,
    has: () => box !== null,
    /** Is a canvas point inside the selection's frame? */
    contains: (x: number, y: number) => Boolean(box && x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]),
    drag,
    drop,
    clear,
    prune,
    remove,
    destroy(): void {
      clear();
      frame.remove();
    },
  };
}

export type NotepadLasso = ReturnType<typeof createLasso>;
