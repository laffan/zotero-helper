// Trimmed reading: holding Control (⌃) with the pointer over the pages
// makes their edges grabbable — Control on every platform, so ⌘ stays
// free for ⌘-clicks and shortcuts. Dragging one trims that margin off
// every page; letting go of the key lays the pages out again with the
// trimmed size as their bounds, so the pages fit the view by what is
// left and the margins' room goes to the text.
//
// Holding the key again shows the pages whole (the trim drawn over
// them) for the next adjustment — drag an edge back out, or press
// Reset Reading Crop, which appears while the key is held. The trim
// applies in every view but the folded one, which shows strips of the
// pages its own way, and never to the thumbnails. It is kept with the
// PDF's view (viewState.ts), on this device, and never touches the file.
//
// The page wrappers keep their full size, so everything that reads a
// page's geometry (the text layer, annotations, search hits, the
// place kept across a relayout) works unchanged. A trimmed page is
// drawn clipped (clip-path), and negative margins — sized here, per
// page — close up the room its trimmed edges would take; matching
// negative scroll margins make scrolling to a page (and the fixed
// view's snapping) line up what is left. See `.pdf-cropped` in pdfviewer.css.
import type { PageRecord } from "./types";

/** Fractions of the page trimmed off each edge. */
export interface Crop {
  t: number;
  r: number;
  b: number;
  l: number;
}

type Edge = keyof Crop;

/** What a trim must leave of the page, each way. */
const MIN_LEFT = 0.25;
/** How near an edge (CSS px) a press grabs it — a finger gets more. */
const GRAB_PX = 14;
const GRAB_TOUCH_PX = 28;
const EDGES: Edge[] = ["t", "r", "b", "l"];
/** ⌃ held this long, alone, starts the adjustment — so a ⌃ shortcut
 *  doesn't flash the whole pages. */
const HOLD_MS = 220;

const isNone = (c: Crop | null) => !c || c.t + c.r + c.b + c.l < 0.002;

/** A page's size with the trim taken off. */
export function croppedSize<T extends { width: number; height: number }>(vp: T, c: Crop | null) {
  if (!c) return vp;
  return { ...vp, width: vp.width * (1 - c.l - c.r), height: vp.height * (1 - c.t - c.b) };
}

/** Size a page wrapper's negative margins for the trim (none, `c`
 *  null), from its full CSS size. */
export function cropWrapper(wrapper: HTMLElement, cssW: number, cssH: number, c: Crop | null): void {
  for (const [edge, size] of [["t", cssH], ["r", cssW], ["b", cssH], ["l", cssW]] as const) {
    if (c) wrapper.style.setProperty(`--cm-${edge}`, `${-Math.round(c[edge] * size)}px`);
    else wrapper.style.removeProperty(`--cm-${edge}`);
  }
}

interface CropEnv {
  scrollArea: HTMLElement;
  /** Where the Reset button goes (over the pages). */
  host: HTMLElement;
  getPages: () => PageRecord[];
  /** A view the trim applies in (not the folded one). */
  active: () => boolean;
  initial: Crop | null;
  /** The trim in effect changed (adjusting began or ended, or reset):
   *  lay the pages out again. */
  onChange: () => void;
}

export function createReadingCrop(env: CropEnv) {
  const { scrollArea } = env;
  let crop: Crop | null = isNone(env.initial) ? null : { ...env.initial! };
  let editing = false;
  let drag: { edge: Edge; wrapper: HTMLElement; id: number } | null = null;
  let holdTimer = 0;
  /** The key is down; long enough, and alone (not part of a shortcut). */
  let held = false;
  let holdReady = false;
  // Where the pointer last was: over the pages, or elsewhere (the
  // notes). Until it has been anywhere — a PDF opened from the
  // keyboard — it counts as over the pages.
  let pointerInside = true;
  let grabPx = GRAB_PX;
  /** The edge the pointer is over (or dragging), drawn on every page. */
  let hotEdge: Edge | null = null;

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "pdf-crop-reset";
  reset.textContent = "Reset Reading Crop";
  reset.style.display = "none";
  env.host.appendChild(reset);

  /** Draw the trim (while adjusting) — CSS reads these on every page. */
  function paintVars(): void {
    const c = crop ?? { t: 0, r: 0, b: 0, l: 0 };
    for (const e of ["t", "r", "b", "l"] as const) scrollArea.style.setProperty(`--crop-${e}`, String(c[e]));
    reset.style.display = editing && crop ? "" : "none";
  }

  /** The trim drawn over each page: the kept part framed, an edge
   *  line and a grip on each side. */
  function addFrames(): void {
    for (const p of env.getPages()) {
      if (p.wrapper.querySelector(".pdf-crop-frame")) continue;
      const frame = document.createElement("div");
      frame.className = "pdf-crop-frame";
      for (const e of EDGES) {
        const edge = document.createElement("div");
        edge.className = `pdf-crop-edge pdf-crop-edge-${e}`;
        edge.innerHTML = '<span class="pdf-crop-grip"></span>';
        frame.appendChild(edge);
      }
      p.wrapper.appendChild(frame);
    }
    showHot();
  }

  function setHot(edge: Edge | null): void {
    if (edge === hotEdge) return;
    hotEdge = edge;
    showHot();
  }
  function showHot(): void {
    if (hotEdge) scrollArea.dataset.cropEdge = hotEdge;
    else delete scrollArea.dataset.cropEdge;
    scrollArea.classList.toggle("pdf-crop-dragging", Boolean(drag));
    scrollArea.style.cursor = hotEdge ? (hotEdge === "l" || hotEdge === "r" ? "ew-resize" : "ns-resize") : "";
  }

  function startEditing(): void {
    if (editing || !env.active()) return;
    editing = true;
    scrollArea.classList.add("pdf-crop-editing");
    paintVars();
    env.onChange();
    addFrames();
  }

  function stopEditing(): void {
    if (!editing) return;
    editing = false;
    drag = null;
    setHot(null);
    showHot();
    scrollArea.classList.remove("pdf-crop-editing");
    scrollArea.querySelectorAll(".pdf-crop-frame").forEach((f) => f.remove());
    if (isNone(crop)) crop = null;
    paintVars();
    env.onChange();
  }

  // The key itself, not the pointer events' modifier flags: iPadOS
  // doesn't report modifiers on those reliably.
  const isHoldKey = (e: KeyboardEvent) => e.key === "Control";

  /** Held a moment, alone, over the pages: adjust. (⌃ held with the
   *  pointer over the notes leaves the pages be.) */
  const maybeStart = () => holdReady && pointerInside && env.active() && startEditing();

  function release(): void {
    held = false;
    holdReady = false;
    window.clearTimeout(holdTimer);
    if (!drag) stopEditing();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (isHoldKey(e)) {
      if (e.repeat || held) return;
      held = true;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        holdReady = held;
        maybeStart();
      }, HOLD_MS);
      return;
    }
    // A key-up can go missing on iPadOS (after a system shortcut, an
    // app switch); a keydown without ⌃ proves it's up.
    if (!e.ctrlKey) return release();
    // ⌃ with another key is a shortcut, not a trim — for the rest of
    // this hold.
    window.clearTimeout(holdTimer);
    holdReady = false;
    if (editing && !drag) stopEditing();
  }
  function onKeyup(e: KeyboardEvent): void {
    if (isHoldKey(e)) release();
  }
  /** Follow the pointer anywhere in the window: over the pages or not. */
  function onWindowPointer(e: PointerEvent): void {
    const t = e.target;
    pointerInside = t instanceof Node && (scrollArea.contains(t) || reset.contains(t));
    grabPx = e.pointerType === "mouse" ? GRAB_PX : GRAB_TOUCH_PX;
    // No hover on a touch screen: with the key held, the press itself
    // starts the adjustment (and onPointerDown may grab an edge with it).
    if (e.type === "pointerdown" && pointerInside) maybeStart();
  }
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keyup", onKeyup);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", release);
  window.addEventListener("pointermove", onWindowPointer, true);
  window.addEventListener("pointerdown", onWindowPointer, true);

  /** The trim's edge within reach of a point on a page, if any. */
  function edgeAt(wrapper: HTMLElement, x: number, y: number): Edge | null {
    const r = wrapper.getBoundingClientRect();
    const c = crop ?? { t: 0, r: 0, b: 0, l: 0 };
    const box = {
      l: r.left + c.l * r.width,
      r: r.right - c.r * r.width,
      t: r.top + c.t * r.height,
      b: r.bottom - c.b * r.height,
    };
    const inY = y > box.t - grabPx && y < box.b + grabPx;
    const inX = x > box.l - grabPx && x < box.r + grabPx;
    const near: [Edge, number][] = [];
    if (inY) near.push(["l", Math.abs(x - box.l)], ["r", Math.abs(x - box.r)]);
    if (inX) near.push(["t", Math.abs(y - box.t)], ["b", Math.abs(y - box.b)]);
    const best = near.filter(([, d]) => d <= grabPx).sort((a, b) => a[1] - b[1])[0];
    return best ? best[0] : null;
  }

  const wrapperAt = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>(".pdf-page-wrapper") : null;

  function onPointerMove(e: PointerEvent): void {
    if (!editing) return void maybeStart();
    if (drag) {
      if (e.pointerId !== drag.id) return;
      const r = drag.wrapper.getBoundingClientRect();
      const c = crop ?? { t: 0, r: 0, b: 0, l: 0 };
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      const clamp = (v: number, other: number) => Math.max(0, Math.min(1 - MIN_LEFT - other, v));
      const next = { ...c };
      if (drag.edge === "l") next.l = clamp(fx, c.r);
      else if (drag.edge === "r") next.r = clamp(1 - fx, c.l);
      else if (drag.edge === "t") next.t = clamp(fy, c.b);
      else next.b = clamp(1 - fy, c.t);
      crop = next;
      paintVars();
      return;
    }
    const w = wrapperAt(e.target);
    setHot(w ? edgeAt(w, e.clientX, e.clientY) : null);
  }

  function onPointerDown(e: PointerEvent): void {
    // On a Mac, a ⌃-click is a secondary click and may report button 2.
    if (!editing || (e.button !== 0 && !(e.button === 2 && e.ctrlKey))) return;
    const w = wrapperAt(e.target);
    const edge = w ? edgeAt(w, e.clientX, e.clientY) : null;
    // While adjusting, the pages are for adjusting: no selecting text.
    e.preventDefault();
    e.stopPropagation();
    if (!w || !edge) return;
    drag = { edge, wrapper: w, id: e.pointerId };
    setHot(edge);
    showHot();
    scrollArea.setPointerCapture?.(e.pointerId);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    swallowClick = true;
    if (e.pointerType !== "mouse") setHot(null);
    showHot();
    scrollArea.releasePointerCapture?.(e.pointerId);
    // The key let go mid-drag: done.
    if (!held) stopEditing();
  }
  scrollArea.addEventListener("pointerleave", () => !drag && setHot(null));
  // Nor does a press while adjusting reach the pages (a highlight's
  // editor, a link) as a click.
  let swallowClick = false;
  scrollArea.addEventListener(
    "click",
    (e) => {
      if (!editing && !swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  // …nor, with ⌃ held on a Mac, as a secondary click's context menu.
  scrollArea.addEventListener("contextmenu", (e) => editing && e.preventDefault(), true);
  scrollArea.addEventListener("pointermove", onPointerMove);
  scrollArea.addEventListener("pointerdown", onPointerDown, true);
  scrollArea.addEventListener("pointerup", onPointerUp);
  scrollArea.addEventListener("pointercancel", onPointerUp);

  reset.addEventListener("pointerdown", (e) => e.stopPropagation());
  reset.addEventListener("click", () => {
    crop = null;
    paintVars();
  });

  paintVars();

  return {
    /** The trim the layout uses: none while adjusting (the pages show
     *  whole) or in the folded view. */
    effective: (): Crop | null => (crop && !editing && env.active() ? crop : null),
    /** The trim set, to keep with the PDF's view. */
    get: (): Crop | null => (crop ? { ...crop } : null),
    /** Pages were laid out afresh: frame any new ones while adjusting. */
    relaidOut: () => editing && addFrames(),
    destroy(): void {
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("keyup", onKeyup);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
      window.removeEventListener("pointermove", onWindowPointer, true);
      window.removeEventListener("pointerdown", onWindowPointer, true);
      window.clearTimeout(holdTimer);
      reset.remove();
    },
  };
}
