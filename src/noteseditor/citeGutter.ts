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
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";

/** Returns `[p. N](zotero://…)` for the page in view, or null when no
 *  PDF is open for these notes. */
export type CiteSource = () => string | null;

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

class CiteMarker extends GutterMarker {
  toDOM(): Node {
    const el = document.createElement("span");
    el.className = "cm-cite-marker";
    el.title = "Link this line to the page in view";
    el.innerHTML = LINK_ICON;
    return el;
  }
}
const marker = new CiteMarker();

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
  return [
    citeEnabled,
    caretPlaced,
    gutter({
      class: "cm-cite-gutter",
      lineMarker(view, line) {
        const { state } = view;
        if (!state.field(citeEnabled) || !state.field(caretPlaced)) return null;
        return activeLineFrom(state) === line.from ? marker : null;
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
          // Keep focus and the caret where they are.
          event.preventDefault();
          const link = source();
          if (link) citeLine(view, line.from, link);
          return true;
        },
      },
    }),
    EditorView.theme({
      ".cm-cite-gutter": { width: "22px" },
      // Level with the line's first row, not the middle of a wrapped
      // paragraph.
      ".cm-cite-gutter .cm-gutterElement": {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "5px",
      },
      ".cm-cite-marker": {
        display: "inline-flex",
        color: "var(--text-dim)",
        opacity: "0.45",
        cursor: "pointer",
        transition: "opacity 0.12s, color 0.12s",
      },
      ".cm-cite-marker:hover": { opacity: "1", color: "var(--accent)" },
    }),
  ];
}
