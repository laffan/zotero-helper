// Handles on a highlight (or underline) while its editor is open: one
// at the start of the passage, one at its end, as the system's own
// selection handles look. Dragging one moves that end through the
// text — the other end stays put — with the new extent drawn as it
// goes; letting go writes the new passage (its rects, its text and its
// sort index) as an edit of the same annotation, so its colour, comment
// and key are kept.
//
// While they show, the page's text can't be selected: on the iPad a
// press held on a handle, or a drag from it over the words, otherwise
// starts the system's own selection — its magnifier, then its menu —
// whatever the handle's own touch says.
//
// The handles sit in the page's wrapper, placed in percentages of the
// page from the annotation's own rects, so they stay on the passage
// through a zoom or a re-render. Where the dragged end lands is found in
// the text layer (textHit.ts): over the gap between lines it stays
// where it last was on a line, rather than jumping to the page's end.
import { annotationPosition, type Annotation } from "../lib/highlights";
import { textPositionAt, textRects, type TextPos } from "./textHit";
import type { PageRecord } from "./types";

export interface HandlesEnv {
  getPages: () => PageRecord[];
  /** The element spanning the whole page `idx` as shown — its wrapper,
   *  or a fold opened to its page. */
  pageBox: (idx: number) => HTMLElement | null;
  /** Write the passage `range` as `a`'s new extent. */
  commit: (a: Annotation, range: Range) => void;
}

interface Frac {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The first and last line of the passage, in fractions of the page. */
function ends(a: Annotation, p: PageRecord): [Frac, Frac] | null {
  const pos = annotationPosition(a);
  const rects = pos?.rects;
  // A passage running onto the next page has no handles (yet).
  if (!rects?.length || pos?.nextPageRects?.length) return null;
  const vp = p.viewport;
  const lines = rects.map((r) => {
    const [x1, y1] = vp.convertToViewportPoint(r[0], r[1]);
    const [x2, y2] = vp.convertToViewportPoint(r[2], r[3]);
    return {
      left: Math.min(x1, x2) / vp.width,
      right: Math.max(x1, x2) / vp.width,
      top: Math.min(y1, y2) / vp.height,
      bottom: Math.max(y1, y2) / vp.height,
    };
  });
  const byOrder = lines.slice().sort((a, b) => a.top - b.top || a.left - b.left);
  return [byOrder[0], byOrder[byOrder.length - 1]];
}

/** The word boundary nearest a place — a passage is moved by words, as
 *  Zotero's reader and the system's selection handles move it. */
function toWord(pos: TextPos): TextPos {
  const text = pos.node.data;
  let best = pos.offset;
  let bestD = Infinity;
  for (let i = 0; i <= text.length; i++) {
    const edge = i === 0 || i === text.length || /\s/.test(text[i]) !== /\s/.test(text[i - 1]);
    if (edge && Math.abs(i - pos.offset) < bestD) {
      best = i;
      bestD = Math.abs(i - pos.offset);
    }
  }
  return { node: pos.node, offset: best };
}

export function createHighlightHandles(env: HandlesEnv) {
  const start = document.createElement("button");
  const end = document.createElement("button");
  start.type = end.type = "button";
  start.className = "pdf-annot-handle pdf-annot-handle-start";
  end.className = "pdf-annot-handle pdf-annot-handle-end";
  start.setAttribute("aria-label", "Move the start of the highlight");
  end.setAttribute("aria-label", "Move the end of the highlight");
  const preview = document.createElement("div");
  preview.className = "pdf-annot-handle-preview";

  let shown: { a: Annotation; box: HTMLElement; lines: [Frac, Frac] } | null = null;
  let drag: {
    which: "start" | "end";
    id: number;
    fixed: TextPos;
    moving: TextPos | null;
    from: { x: number; y: number };
    line: { x: number; y: number };
    layer: HTMLElement;
  } | null = null;
  let clearTimer = 0;

  function place(): void {
    if (!shown) return;
    const [first, last] = shown.lines;
    const put = (h: HTMLElement, x: number, top: number, bottom: number) => {
      h.style.left = `${x * 100}%`;
      h.style.top = `${top * 100}%`;
      h.style.height = `${(bottom - top) * 100}%`;
    };
    put(start, first.left, first.top, first.bottom);
    put(end, last.right, last.top, last.bottom);
    shown.box.append(start, end);
  }

  function show(a: Annotation): void {
    const pos = annotationPosition(a);
    const p = pos ? env.getPages()[pos.pageIndex] : undefined;
    const box = pos ? env.pageBox(pos.pageIndex) : null;
    const lines = p ? ends(a, p) : null;
    if (!p || !box || !lines || !box.querySelector(".textLayer")) return hide();
    if (shown && shown.box !== box) shown.box.classList.remove("pdf-annot-editing");
    shown = { a, box, lines };
    box.classList.add("pdf-annot-editing");
    place();
  }

  function clearPreview(): void {
    clearTimeout(clearTimer);
    preview.replaceChildren();
    preview.remove();
  }

  function hide(): void {
    if (drag) return;
    shown?.box.classList.remove("pdf-annot-editing");
    shown = null;
    start.remove();
    end.remove();
    clearPreview();
  }

  /** The passage between the fixed end and where the dragged one is. */
  function rangeNow(): Range | null {
    if (!drag?.moving) return null;
    const r = document.createRange();
    const { fixed, moving } = drag;
    const order = fixed.node === moving.node
      ? fixed.offset - moving.offset
      : fixed.node.compareDocumentPosition(moving.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    const [a, b] = order <= 0 ? [fixed, moving] : [moving, fixed];
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r.collapsed ? null : r;
  }

  function drawPreview(range: Range | null): void {
    if (!shown) return;
    const box = shown.box.getBoundingClientRect();
    preview.replaceChildren();
    const rects = (range ? textRects(range) : []).filter((r) => r.width >= 0.5 && r.height >= 0.5);
    const heights = rects.map((r) => r.height).sort((a, b) => a - b);
    const line = heights[Math.floor(heights.length / 2)] ?? 0;
    for (const cr of rects) {
      if (cr.height > line * 3) continue;
      const d = document.createElement("div");
      d.style.left = `${((cr.left - box.left) / box.width) * 100}%`;
      d.style.top = `${((cr.top - box.top) / box.height) * 100}%`;
      d.style.width = `${(cr.width / box.width) * 100}%`;
      d.style.height = `${(cr.height / box.height) * 100}%`;
      preview.appendChild(d);
    }
    preview.style.setProperty("--handle-color", shown.a.color || "#ffd400");
    shown.box.appendChild(preview);
  }

  function onDown(e: PointerEvent): void {
    if (!shown || !e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    const which = e.currentTarget === start ? "start" : "end";
    const layer = shown.box.querySelector<HTMLElement>(".textLayer");
    if (!layer) return;
    const box = shown.box.getBoundingClientRect();
    const [first, last] = shown.lines;
    const at = (f: Frac, x: number) => ({ x: box.left + x * box.width, y: box.top + ((f.top + f.bottom) / 2) * box.height });
    // The far end, a pixel inside its first or last character.
    const other = which === "start" ? at(last, last.right) : at(first, first.left);
    const fixed = textPositionAt(layer, other.x + (which === "start" ? -1 : 1), other.y);
    if (!fixed) return;
    const line = which === "start" ? at(first, first.left) : at(last, last.right);
    drag = { which, id: e.pointerId, fixed, moving: null, from: { x: e.clientX, y: e.clientY }, line, layer };
    shown.box.classList.add("pdf-handle-dragging");
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id || !shown) return;
    e.preventDefault();
    const x = drag.line.x + e.clientX - drag.from.x;
    const y = drag.line.y + e.clientY - drag.from.y;
    const pos = textPositionAt(drag.layer, x, y);
    if (pos) drag.moving = toWord(pos);
    drawPreview(rangeNow());
    // The handle follows the finger.
    const h = drag.which === "start" ? start : end;
    const box = shown.box.getBoundingClientRect();
    h.style.left = `${((x - box.left) / box.width) * 100}%`;
    h.style.top = `${((y - box.top) / box.height) * 100 - parseFloat(h.style.height) / 2}%`;
  }

  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id || !shown) return;
    const range = rangeNow();
    // Nor does a drag leave a selection (and its menu) behind.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && shown.box.contains(sel.anchorNode)) sel.removeAllRanges();
    drag = null;
    shown.box.classList.remove("pdf-handle-dragging");
    if (range) {
      env.commit(shown.a, range);
      // Until the edit comes back as the annotation's new rects.
      clearTimer = window.setTimeout(() => {
        clearPreview();
        place();
      }, 1500);
    } else {
      clearPreview();
      place();
    }
  }

  for (const h of [start, end]) {
    h.addEventListener("pointerdown", onDown);
    h.addEventListener("pointermove", onMove);
    h.addEventListener("pointerup", onUp);
    h.addEventListener("pointercancel", onUp);
    // Not a click on the highlight beneath (its editor stays as it is).
    h.addEventListener("click", (e) => e.stopPropagation());
    // A press held on a handle is a drag, not the iPad's long press on
    // the text beneath — which would select a word and bring up the
    // system's selection menu.
    h.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  }

  return {
    show,
    hide,
    /** The annotations changed: follow this one's new extent. */
    sync(list: Annotation[]): void {
      if (!shown || drag) return;
      const fresh = list.find((x) => x.key === shown!.a.key);
      if (!fresh) return hide();
      if (fresh === shown.a) return;
      clearPreview();
      show(fresh);
    },
    destroy: () => {
      drag = null;
      hide();
    },
  };
}
