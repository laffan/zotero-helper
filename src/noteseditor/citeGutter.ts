// A link icon at the left edge of the line being written. Pressing it
// cites the page the PDF viewer is showing at the head of the line:
//
//   Example note text
//   → [p. 22](zotero://open-pdf/library/items/6M6B2TX9?page=22) - Example note text
//
// The link goes after any list, quote or heading marker (`- `, `> `,
// `## `), and a line that already starts with a page link has that link
// replaced rather than gaining a second. The icon only shows while the
// PDF is open beside the notes, and only once the writer has put the
// caret somewhere.
//
// Pressed and dragged out onto the pages instead — a dashed line running
// from it to the pointer, as from the notepad's quote button
// (NotepadBody.tsx), whose line this borrows — and let go over a
// highlight or a spot on a page, it heads the line with a link to that:
// the highlight itself (the pill takes its colour, and going there
// selects it), or the page the spot is on. Let go anywhere else, nothing
// happens.
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";

/** Where the icon's links come from: `[p. N](zotero://…)`, or null when
 *  there is nothing to link to (no PDF open for these notes; a point off
 *  the pages). */
export interface CiteSource {
  /** The page in view. */
  page: () => string | null;
  /** What is at a client point: a highlight, or the page there. */
  at: (x: number, y: number) => string | null;
}

export const setCiteEnabled = StateEffect.define<boolean>();

const citeEnabled = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(setCiteEnabled)) return e.value;
    return v;
  },
});

/** Has the writer placed a caret yet? Until then the editor's selection
 *  is the default one at the top, which isn't "the line being typed". */
const caretPlaced = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => v || (tr.selection !== undefined && tr.isUserEvent("select")) || tr.docChanged,
});

const LINK_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3"/><path d="M7.5 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1"/><path d="M8.5 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/></svg>`;

/** Line height of the notes (theme.ts), and the heading sizes, so the
 *  icon can sit in the middle of the line's first row — where the
 *  caret is — rather than of a wrapped paragraph. */
const LINE_HEIGHT = 1.65;
const HEADING_SCALE = [1.45, 1.25, 1.1];

/** CSS px the pointer moves before a press is a drag. */
const DRAG_PX = 4;
const SVG_NS = "http://www.w3.org/2000/svg";

/** The dashed line of a drag, from the icon to the pointer — the
 *  notepad's (`.notepad-link-line`, notepad.css). */
function dragLine(x1: number, y1: number) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "notepad-link-line");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(SVG_NS, "line");
  const dot = document.createElementNS(SVG_NS, "circle");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  dot.setAttribute("r", "5");
  svg.append(line, dot);
  return {
    to(x: number, y: number): void {
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(y));
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      if (!svg.isConnected) document.body.appendChild(svg);
    },
    remove: () => svg.remove(),
  };
}

/** A press on the icon: let go where it began, the line is linked to
 *  the page in view; dragged out and let go over the pages, to what is
 *  there. The listeners are the window's, so the press is followed
 *  wherever it goes, and whatever becomes of the icon meanwhile. */
function startPress(view: EditorView, el: HTMLElement, source: CiteSource, e: PointerEvent): void {
  if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
  const { state } = view;
  if (!state.field(citeEnabled)) return;
  const lineFrom = activeLineFrom(state);
  const r = el.getBoundingClientRect();
  const line = dragLine(r.left + r.width / 2, r.top + r.height / 2);
  const x0 = e.clientX;
  const y0 = e.clientY;
  const id = e.pointerId;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    moved ||= Math.hypot(ev.clientX - x0, ev.clientY - y0) > DRAG_PX;
    if (!moved) return;
    el.classList.add("linking");
    line.to(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    line.remove();
    el.classList.remove("linking");
    if (ev.type === "pointercancel") return;
    const link = moved ? source.at(ev.clientX, ev.clientY) : source.page();
    if (link && lineFrom <= view.state.doc.length) citeLine(view, lineFrom, link);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

class CiteMarker extends GutterMarker {
  /** `scale`: the line's font size relative to body text. */
  constructor(
    readonly scale: number,
    readonly source: CiteSource,
  ) {
    super();
  }
  eq(other: CiteMarker): boolean {
    return other.scale === this.scale && other.source === this.source;
  }
  toDOM(view: EditorView): Node {
    const el = document.createElement("span");
    el.className = "cm-cite-marker";
    el.title = "Link this line to the page in view — or drag onto a highlight or a place on the page";
    el.style.height = `${this.scale * LINE_HEIGHT}em`;
    el.innerHTML = LINK_ICON;
    el.addEventListener("pointerdown", (e) => startPress(view, el, this.source, e));
    return el;
  }
}

/** Block markers a page link should follow rather than precede. */
const PREFIX = /^\s*(?:(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+|>\s?))*/;
/** A page link already heading the line, with its separator. */
const EXISTING = /^\[p\.[^\]]*\]\(zotero:\/\/open-pdf\/[^)\s]*\)(?:\s+-\s*|\s*)/;

/** Put `link` at the head of line `pos` is on. */
export function citeLine(view: EditorView, pos: number, link: string): void {
  const line = view.state.doc.lineAt(pos);
  const prefix = PREFIX.exec(line.text)?.[0] ?? "";
  const rest = line.text.slice(prefix.length);
  const existing = EXISTING.exec(rest)?.[0] ?? "";
  const from = line.from + prefix.length;
  view.dispatch({
    changes: { from, to: from + existing.length, insert: `${link} - ` },
    userEvent: "input.cite",
  });
}

function activeLineFrom(state: EditorState): number {
  return state.doc.lineAt(state.selection.main.head).from;
}

export function citeGutter(source: CiteSource) {
  const marker = new CiteMarker(1, source);
  const headingMarkers = HEADING_SCALE.map((k) => new CiteMarker(k, source));
  const markerFor = (text: string): CiteMarker => {
    const level = /^(#{1,6})\s/.exec(text)?.[1].length ?? 0;
    return headingMarkers[level - 1] ?? marker;
  };
  return [
    citeEnabled,
    caretPlaced,
    gutter({
      class: "cm-cite-gutter",
      lineMarker(view, line) {
        const { state } = view;
        if (!state.field(citeEnabled) || !state.field(caretPlaced)) return null;
        return activeLineFrom(state) === line.from
          ? markerFor(state.doc.lineAt(line.from).text)
          : null;
      },
      lineMarkerChange: (u) =>
        u.selectionSet ||
        u.docChanged ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(setCiteEnabled))) ||
        u.startState.field(caretPlaced) !== u.state.field(caretPlaced),
      initialSpacer: () => marker,
      domEventHandlers: {
        mousedown(view, line, event) {
          const { state } = view;
          if (!state.field(citeEnabled) || activeLineFrom(state) !== line.from) return false;
          // Keep focus and the caret where they are; the press itself
          // is the icon's (startPress).
          event.preventDefault();
          return true;
        },
      },
    }),
    EditorView.theme({
      ".cm-cite-gutter": { width: "22px" },
      // Level with the line's first row, not the middle of a wrapped
      // paragraph: the marker is one row tall and centres the icon.
      // (No padding here — under the app's border-box sizing it would
      // give CodeMirror's zero-height spacer a height and push every
      // marker below its line.)
      ".cm-cite-gutter .cm-gutterElement": {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
      },
      ".cm-cite-marker": {
        display: "inline-flex",
        alignItems: "center",
        color: "var(--text-dim)",
        opacity: "0.45",
        cursor: "pointer",
        transition: "opacity 0.12s, color 0.12s",
        // A finger's drag is the link's, not a scroll or a selection.
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      },
      ".cm-cite-marker:hover, .cm-cite-marker.linking": { opacity: "1", color: "var(--accent)" },
    }),
  ];
}
