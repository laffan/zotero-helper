// The Apple Pencil out of ink mode: a finger, only a more precise one.
//
// Left to WebKit, the Pencil isn't a finger on the iPad: it has gestures
// of its own over text (Scribble's, and selections that start at once),
// which fought the viewer's own handling of selections made by touch —
// highlighting with the Pencil was erratic. So once the Pencil has been
// seen on the pages, its touches are cancelled here (`touchType`
// "stylus", as ink mode cancels them) and what a finger does is done
// for it from its pointer events:
//
// - a drag scrolls the pages, and coasts when let go; in the paged view
//   a swipe turns one set, as a finger's does; pinched, the magnifier
//   pans (magnify.ts takes the Pencil as it takes a finger);
// - a press held still (HOLD_MS) selects the word under it, and moving
//   on without lifting carries the selection's moving end along —
//   letter by letter, where a finger goes word by word: the precision a
//   finger hasn't got (textHit.ts places it, keeping to a line over the
//   gaps between lines). The selection bar comes up as for any;
// - a tap is a click where it landed (a highlight, a link, a button —
//   and on the pages, the end of a selection, selectionBar.ts).
//
// Ink mode (`pdf-ink-active` on the scroll area) takes the Pencil back:
// it writes. The first touch of the Pencil in a session is WebKit's
// own, since nothing cancels a touch that has begun; from then on,
// every touch on the pages waits for a non-passive touchstart listener
// — kept to those who use a Pencil.
import { textPositionAt, type TextPos } from "./textHit";

/** How long the Pencil is held still to select, ms; how far it may
 *  stray and still be a tap or a hold, CSS px; how far a swipe in the
 *  paged view goes to turn a set. */
const HOLD_MS = 450;
const SLOP_PX = 6;
const SWIPE_PX = 30;
const WORD = /[\p{L}\p{N}\p{M}'’-]/u;

/** What handles a press itself — a highlight's handles, the bars and
 *  popovers, buttons, links, fields: there the Pencil only taps. */
const OWN_PRESS = ".pdf-annot-handle, .pdf-selection-bar, .pdf-annot-popover, .pdf-lookup, button, a";
/** Fields (a highlight's comment) keep the Pencil's own touch: a click
 *  from script can't put the caret in one. */
const FIELD = "input, textarea, select, [contenteditable='true']";

/** A Pencil has been used on the pages this session. */
let pencilSeen = false;

const isStylus = (t: Touch) => (t as Touch & { touchType?: string }).touchType === "stylus";
const inking = (area: HTMLElement) => area.classList.contains("pdf-ink-active");

/** The text layer under a client point. */
function layerAt(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest(".pdf-page-wrapper")?.querySelector<HTMLElement>(".textLayer") ?? null;
}

/** Does `a` come before `b` in the document? */
function before(a: TextPos, b: TextPos): boolean {
  if (a.node === b.node) return a.offset < b.offset;
  return Boolean(a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** The word around a place in the text, as its two ends. */
function wordAt(p: TextPos): [TextPos, TextPos] {
  const s = p.node.data;
  let a = p.offset;
  let b = p.offset;
  while (a > 0 && WORD.test(s[a - 1])) a--;
  while (b < s.length && WORD.test(s[b])) b++;
  return [{ node: p.node, offset: a }, { node: p.node, offset: b }];
}

export function attachPencilFinger(area: HTMLElement, stepPage: (dir: 1 | -1) => void): void {
  type Press = {
    id: number;
    x0: number;
    y0: number;
    x: number;
    y: number;
    t: number;
    vx: number;
    vy: number;
    /** `tap`: on something that handles its own presses — a tap is
     *  its click, a drag is left to it. */
    mode: "wait" | "tap" | "pan" | "select" | "none";
    hold: number;
    word: [TextPos, TextPos] | null;
  };
  let g: Press | null = null;
  let coastRaf = 0;

  function onTouch(e: TouchEvent): void {
    if (inking(area) || (e.target as Element).closest?.(FIELD)) return;
    if (Array.from(e.changedTouches).some(isStylus)) e.preventDefault();
  }

  function stopCoast(): void {
    cancelAnimationFrame(coastRaf);
    coastRaf = 0;
  }

  function onDown(e: PointerEvent): void {
    if (e.pointerType !== "pen" || inking(area) || (e.target as Element).closest?.(FIELD)) return;
    if (!pencilSeen) {
      // The first touch is WebKit's; the ones after it are a finger's.
      pencilSeen = true;
      area.addEventListener("touchstart", onTouch, { passive: false });
      return;
    }
    if (g) end("pointercancel");
    stopCoast();
    const now = performance.now();
    const own = Boolean((e.target as Element).closest?.(OWN_PRESS));
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: now, vx: 0, vy: 0, mode: own ? "tap" : "wait", hold: 0, word: null };
    const press = g;
    if (!own) press.hold = window.setTimeout(() => startSelect(press), HOLD_MS);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }

  /** Held still: the word under the Pencil, selected. */
  function startSelect(press: Press): void {
    if (g !== press || press.mode !== "wait") return;
    const layer = layerAt(press.x0, press.y0);
    const pos = layer && textPositionAt(layer, press.x0, press.y0);
    if (!pos) {
      press.mode = "none";
      return;
    }
    press.mode = "select";
    press.word = wordAt(pos);
    const [a, b] = press.word;
    window.getSelection()?.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
  }

  /** The selection carried to a client point: from the far end of the
   *  word first selected to the place under the Pencil. */
  function extend(press: Press, x: number, y: number): void {
    const [a, b] = press.word!;
    const layer = layerAt(x, y) ?? a.node.parentElement?.closest<HTMLElement>(".textLayer") ?? null;
    const pos = layer && textPositionAt(layer, x, y);
    if (!pos) return;
    const sel = window.getSelection();
    if (before(pos, a)) sel?.setBaseAndExtent(b.node, b.offset, pos.node, pos.offset);
    else if (before(b, pos)) sel?.setBaseAndExtent(a.node, a.offset, pos.node, pos.offset);
    else sel?.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
  }

  function onMove(e: PointerEvent): void {
    if (!g || e.pointerId !== g.id) return;
    const now = performance.now();
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const dt = Math.max(1, now - g.t);
    // Velocity, smoothed over the last few moves, for the coast.
    g.vx = 0.7 * (dx / dt) + 0.3 * g.vx;
    g.vy = 0.7 * (dy / dt) + 0.3 * g.vy;
    Object.assign(g, { x: e.clientX, y: e.clientY, t: now });
    if (g.mode === "wait" || g.mode === "tap") {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= SLOP_PX) return;
      if (g.mode === "tap") {
        g.mode = "none";
        return;
      }
      window.clearTimeout(g.hold);
      // Pinched, the magnifier pans the pages itself.
      g.mode = area.classList.contains("pdf-magnified") ? "none" : "pan";
    }
    if (g.mode === "select") extend(g, e.clientX, e.clientY);
    else if (g.mode === "pan" && !area.classList.contains("pdf-paged")) {
      area.scrollLeft -= dx;
      area.scrollTop -= dy;
    }
  }

  function onUp(e: PointerEvent): void {
    if (g && e.pointerId === g.id) end(e.type);
  }

  function end(type: string): void {
    const press = g;
    if (!press) return;
    g = null;
    window.clearTimeout(press.hold);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
    if (type !== "pointerup") return;
    if (press.mode === "wait" || press.mode === "tap") {
      // A tap: a click where it landed.
      const target = document.elementFromPoint(press.x, press.y);
      target?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: press.x, clientY: press.y, detail: 1 }),
      );
      return;
    }
    if (press.mode !== "pan") return;
    if (area.classList.contains("pdf-paged")) {
      // A swipe turns one set, whichever way the pages run.
      const d = area.classList.contains("pdf-layout-horizontal") ? press.x - press.x0 : press.y - press.y0;
      if (Math.abs(d) > SWIPE_PX) stepPage(d < 0 ? 1 : -1);
      return;
    }
    coast(press);
  }

  /** Let go while moving: the pages carry on, slowing. */
  function coast(press: Press): void {
    let { vx, vy } = press;
    if (performance.now() - press.t > 80 || Math.hypot(vx, vy) < 0.05) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      area.scrollLeft -= vx * dt;
      area.scrollTop -= vy * dt;
      const decay = Math.pow(0.995, dt);
      vx *= decay;
      vy *= decay;
      coastRaf = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    coastRaf = requestAnimationFrame(step);
  }

  if (pencilSeen) area.addEventListener("touchstart", onTouch, { passive: false });
  area.addEventListener("pointerdown", onDown);
  // A finger, or the Pencil again, stops a coast.
  area.addEventListener("pointerdown", (e) => e.pointerType !== "pen" && stopCoast());
}
