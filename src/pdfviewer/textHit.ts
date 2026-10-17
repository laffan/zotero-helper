// Places in a page's text layer, found from a point on the screen —
// what a ⌘-click (sentenceMark.ts) and a highlight's handles
// (highlightHandles.ts) both start from.
//
// The browser's own caret-from-point is asked first. Over the gaps
// between lines (or the text layer's `.endOfContent`) it answers with
// the end of the page or nothing at all, so a point that isn't over a
// word falls back to the nearest span on its line — never to some
// place on another line.

export interface TextPos {
  node: Text;
  offset: number;
}

type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(x: number, y: number): TextPos | null {
  const doc = document as CaretDoc;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p?.offsetNode instanceof Text) return { node: p.offsetNode, offset: p.offset };
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r?.startContainer instanceof Text) return { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}

/** The spans of a layer with text — the words, not `.endOfContent`. */
function textSpans(layer: HTMLElement): HTMLElement[] {
  return Array.from(layer.querySelectorAll<HTMLElement>("span")).filter(
    (s) => !s.classList.contains("markedContent") && s.firstChild instanceof Text && s.textContent,
  );
}

/** The place in `layer` under a client point: the caret there when it
 *  lands in this layer's words, else the nearer end of the closest span
 *  on that line. Null when no line of text is at that height. */
export function textPositionAt(layer: HTMLElement, x: number, y: number): TextPos | null {
  const hit = caretAt(x, y);
  if (hit && layer.contains(hit.node) && hit.node.parentElement?.closest(".endOfContent") == null) {
    // Only trust it where the point is really on that span's line.
    const r = hit.node.parentElement?.getBoundingClientRect();
    if (r && y >= r.top - 2 && y <= r.bottom + 2) return hit;
  }
  let best: { span: HTMLElement; d: number; r: DOMRect } | null = null;
  for (const span of textSpans(layer)) {
    const r = span.getBoundingClientRect();
    if (y < r.top || y > r.bottom) continue;
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (!best || d < best.d) best = { span, d, r };
  }
  if (!best) return null;
  const node = best.span.firstChild as Text;
  if (x <= best.r.left) return { node, offset: 0 };
  if (x >= best.r.right) return { node, offset: node.length };
  // Inside the span but the caret missed it: by proportion.
  const k = (x - best.r.left) / best.r.width;
  return { node, offset: Math.round(k * node.length) };
}

/** A layer's words as one string — a line break counts as a space —
 *  with where each text node starts in it. */
export function layerText(layer: HTMLElement): { text: string; nodes: Text[]; starts: number[] } {
  let text = "";
  const nodes: Text[] = [];
  const starts: number[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof HTMLBRElement) text += " ";
    else if (n instanceof Text && !n.parentElement?.closest(".endOfContent")) {
      nodes.push(n);
      starts.push(text.length);
      text += n.data;
    }
  }
  return { text, nodes, starts };
}

/** A text node position as an index into layerText's string. */
export function indexOf(t: ReturnType<typeof layerText>, pos: TextPos): number {
  const i = t.nodes.indexOf(pos.node);
  return i < 0 ? -1 : t.starts[i] + pos.offset;
}

/** The text between two indices of layerText's string, as a Range. */
export function rangeOf(t: ReturnType<typeof layerText>, from: number, to: number): Range | null {
  const at = (index: number, end: boolean): TextPos | null => {
    for (let i = t.nodes.length - 1; i >= 0; i--) {
      const s = t.starts[i];
      // An end on a node's start belongs to the node before it.
      if (index > s || (index === s && !end) || i === 0) {
        return { node: t.nodes[i], offset: Math.max(0, Math.min(t.nodes[i].length, index - s)) };
      }
    }
    return null;
  };
  const a = at(from, false);
  const b = at(to, true);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r.collapsed ? null : r;
}
