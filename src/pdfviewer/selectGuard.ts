// A guard against a selection in the pages leaping to the edge of the
// page. Selecting with a finger on the iPad, the moving end sometimes
// jumps in one step from the line under the finger to the very start or
// end of the page's text — selecting the rest of the page, or all that
// came before — and the selection has to be started again. WebKit
// resolves a point it can't place on a line (between two lines, over a
// gap the text layer's `.endOfContent` doesn't cover) to the nearest
// position in the layer as a whole, which for absolutely placed spans
// is one of its ends (textSelect.ts has the longer story).
//
// So each change to a selection in a text layer is compared with the
// one before. When one end stays put and the other has moved more than
// a few lines in a single step, landing within the first or last spans
// of a page, it is taken for that leap and the selection is put back as
// it was; the next move of the finger carries on from there. So is the
// moving end flipping over to the far side of where the selection
// began, more than five lines away, in one step (the selection
// suddenly running upwards from its start). A real
// drag reaches the end of a page a line or two at a time, so it is
// never caught, and neither is crossing onto the next page from the end
// of this one. Selections made by the keyboard, by a triple click (the
// whole block), or by the app itself are left alone.

interface Snap {
  anchor: [Node, number];
  focus: [Node, number];
  start: [Node, number];
  end: [Node, number];
}

/** Lines a single step may move the end before it is suspect. */
const MAX_LINES = 3;
/** …and past the selection's start (dragging back over it, a paragraph
 *  break can make one step of the finger two lines and a gap). */
const MAX_FLIP_LINES = 5;
/** Spans at each end of a page's text that count as its edge. */
const EDGE_SPANS = 2;

let last: Snap | null = null;
let ignoreNext = false;
let keyAt = -Infinity;
let tripleAt = -Infinity;

function snap(sel: Selection, range: Range): Snap {
  return {
    anchor: [sel.anchorNode!, sel.anchorOffset],
    focus: [sel.focusNode!, sel.focusOffset],
    start: [range.startContainer, range.startOffset],
    end: [range.endContainer, range.endOffset],
  };
}

const same = (a: [Node, number], b: [Node, number]) => a[0] === b[0] && a[1] === b[1];

const layerOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>(".textLayer") ?? null;

function textSpans(layer: HTMLElement): Element[] {
  return Array.from(layer.querySelectorAll("span")).filter((s) => s.firstChild instanceof Text);
}

/** Is this place at the start or the end of its layer's text? */
function edgeOf(layer: HTMLElement, [node, offset]: [Node, number]): "start" | "end" | null {
  if (node === layer) {
    if (offset <= 1) return "start";
    return offset >= layer.childNodes.length - 1 ? "end" : null;
  }
  if (node instanceof Element && node.classList.contains("endOfContent")) {
    if (node === layer.lastElementChild) return "end";
    return node === layer.firstElementChild ? "start" : null;
  }
  const span = (node instanceof Element ? node : node.parentElement)?.closest("span");
  if (!span) return null;
  const spans = textSpans(layer);
  const i = spans.indexOf(span);
  if (i < 0) return null;
  if (i < EDGE_SPANS) return "start";
  return i >= spans.length - EDGE_SPANS ? "end" : null;
}

/** Where a place is on the screen, and the height of its line. */
function placeOf([node, offset]: [Node, number]): { y: number; h: number } | null {
  let el: Element | null = null;
  if (node instanceof Text) {
    const r = document.createRange();
    r.setStart(node, Math.min(offset, node.length));
    r.collapse(true);
    const b = r.getBoundingClientRect();
    if (b.height > 0) return { y: b.top + b.height / 2, h: b.height };
    el = node.parentElement;
  } else if (node instanceof Element) {
    // `.endOfContent` sits beside the span the selection ends at.
    el = node.classList.contains("endOfContent")
      ? node.previousElementSibling
      : (node.childNodes[offset] as Element | undefined) ?? node.lastElementChild;
    if (el && !(el instanceof Element)) el = node;
  }
  const b = el?.getBoundingClientRect();
  return b && b.height > 0 ? { y: b.top + b.height / 2, h: b.height } : null;
}

/** Did the moving end leap, from `before` to `after`? */
function leapt(before: [Node, number], after: [Node, number], forward: boolean): boolean {
  const layer = layerOf(after[0]);
  if (!layer) return false;
  const edge = edgeOf(layer, after);
  if (!edge) return false;
  const prevLayer = layerOf(before[0]);
  if (prevLayer && prevLayer !== layer) {
    // Onto the next page from the end of this one (or back): a drag
    // across the page break.
    return edgeOf(prevLayer, before) !== (forward ? "end" : "start");
  }
  const a = placeOf(before);
  const b = placeOf(after);
  if (!a || !b) return false;
  return Math.abs(b.y - a.y) > MAX_LINES * Math.max(a.h, b.h, 4);
}

/** Did the moving end (the focus) cross to the other side of the fixed
 *  one (the anchor), far, in one step? */
function flipped(prev: Snap, now: Snap): boolean {
  const wasAfter = same(prev.start, prev.anchor);
  const isAfter = same(now.start, now.anchor);
  if (wasAfter === isAfter) return false;
  const a = placeOf(prev.focus);
  const b = placeOf(now.focus);
  if (!a || !b) return false;
  return Math.abs(b.y - a.y) > MAX_FLIP_LINES * Math.max(a.h, b.h, 4);
}

function onSelectionChange(): void {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed || !sel.anchorNode) {
    last = null;
    return;
  }
  const range = sel.getRangeAt(0);
  if (!layerOf(range.startContainer) && !layerOf(range.endContainer)) {
    last = null;
    return;
  }
  const now = snap(sel, range);
  const prev = last;
  last = now;
  if (ignoreNext) {
    ignoreNext = false;
    return;
  }
  const t = performance.now();
  if (!prev || t - keyAt < 400 || t - tripleAt < 600) return;
  const startMoved = !same(prev.start, now.start);
  const endMoved = !same(prev.end, now.end);
  let suspect = false;
  if (startMoved !== endMoved) {
    suspect = endMoved ? leapt(prev.end, now.end, true) : leapt(prev.start, now.start, false);
  } else if (startMoved && same(prev.anchor, now.anchor)) suspect = flipped(prev, now);
  if (!suspect) return;
  ignoreNext = true;
  last = prev;
  try {
    sel.setBaseAndExtent(prev.anchor[0], prev.anchor[1], prev.focus[0], prev.focus[1]);
  } catch {
    ignoreNext = false;
  }
}

let listening = false;

/** Watch selections in the pages' text layers (once per window). */
export function guardSelections(): void {
  if (listening) return;
  listening = true;
  // The guard's own check runs before textSelect's (registered first).
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("keydown", () => (keyAt = performance.now()), true);
  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.detail >= 3) tripleAt = performance.now();
    },
    true,
  );
}

/** Whether the selection just now was put back (textSelect then leaves
 *  `.endOfContent` where it was). */
export const justReverted = () => ignoreNext;
