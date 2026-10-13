// Formatting shortcuts for the notes: ⌘I italic (`_`), ⌘B bold (`**`),
// ⌘= highlight (`==`), each a toggle, and ⌘K a link (Ctrl elsewhere).
//
// A toggle takes the format off when the selection (or the caret) is
// inside text that has it — the whole span, as the parser sees it — or
// when the selection is just inside its marks; otherwise it wraps the
// selection, or, with nothing selected, the word at the caret, or else
// puts an empty pair down with the caret between.
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type ChangeSpec, type EditorState, type SelectionRange } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

interface Format {
  mark: string;
  /** The syntax node a span of this format parses as. */
  node: string;
}

const ITALIC: Format = { mark: "_", node: "Emphasis" };
const BOLD: Format = { mark: "**", node: "StrongEmphasis" };
const HIGHLIGHT: Format = { mark: "==", node: "Highlight" };

/** The nearest node from `n` upward that `test` accepts. */
function ancestor(n: SyntaxNode | null, test: (n: SyntaxNode) => boolean): SyntaxNode | null {
  while (n && !test(n)) n = n.parent;
  return n;
}

/** The span of `node` type around [from, to], if any: its outer bounds
 *  and the length of the marks at each end. */
function spanAround(state: EditorState, f: Format, from: number, to: number) {
  const n = ancestor(syntaxTree(state).resolveInner(from, 1), (x) => x.name === f.node && x.from <= from && x.to >= to);
  const open = n?.firstChild;
  const close = n?.lastChild;
  if (!n || !open || !close || open.from === close.from) return null;
  return { from: n.from, to: n.to, openLen: open.to - open.from, closeLen: close.to - close.from };
}

/** The word around an empty selection, if the caret is in one. */
function wordAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const w = state.wordAt(pos);
  return w && w.from < pos && pos < w.to ? { from: w.from, to: w.to } : null;
}

function toggle(f: Format) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const m = f.mark;
    const tx = state.changeByRange((r: SelectionRange) => {
      // Already formatted: take the marks off the whole span.
      const span = spanAround(state, f, r.from, r.to);
      if (span) {
        const changes: ChangeSpec[] = [
          { from: span.from, to: span.from + span.openLen },
          { from: span.to - span.closeLen, to: span.to },
        ];
        const shift = (p: number) => Math.min(Math.max(p - span.openLen, span.from), span.to - span.openLen - span.closeLen);
        return { changes, range: EditorSelection.range(shift(r.anchor), shift(r.head)) };
      }
      // Marks just outside the selection, which the parser didn't pair.
      if (
        !r.empty &&
        state.sliceDoc(r.from - m.length, r.from) === m &&
        state.sliceDoc(r.to, r.to + m.length) === m
      ) {
        return {
          changes: [
            { from: r.from - m.length, to: r.from },
            { from: r.to, to: r.to + m.length },
          ],
          range: EditorSelection.range(r.from - m.length, r.to - m.length),
        };
      }
      // Wrap the selection, or the word at the caret.
      const target = r.empty ? wordAt(state, r.from) : { from: r.from, to: r.to };
      if (target) {
        return {
          changes: [
            { from: target.from, insert: m },
            { from: target.to, insert: m },
          ],
          range: r.empty
            ? EditorSelection.cursor(r.from + m.length)
            : EditorSelection.range(target.from + m.length, target.to + m.length),
        };
      }
      // An empty pair, typed into.
      return { changes: { from: r.from, insert: m + m }, range: EditorSelection.cursor(r.from + m.length) };
    });
    view.dispatch(state.update(tx, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

const URLISH = /^(https?:\/\/|zotero:\/\/|mailto:)\S+$/i;

/** ⌘K: the selection becomes a link's label, with the caret where its
 *  URL goes — or, when the selection is itself a URL, its URL, with the
 *  caret in the label. Inside a link already, its URL is selected. */
function link(view: EditorView): boolean {
  const { state } = view;
  const tx = state.changeByRange((r: SelectionRange) => {
    const url = ancestor(syntaxTree(state).resolveInner(r.from, 1), (x) => x.name === "Link")?.getChild("URL");
    if (url) return { range: EditorSelection.range(url.from, url.to) };
    const text = state.sliceDoc(r.from, r.to);
    if (r.empty) {
      return { changes: { from: r.from, insert: "[]()" }, range: EditorSelection.cursor(r.from + 1) };
    }
    if (URLISH.test(text.trim())) {
      return {
        changes: { from: r.from, to: r.to, insert: `[](${text.trim()})` },
        range: EditorSelection.cursor(r.from + 1),
      };
    }
    const insert = `[${text}]()`;
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + insert.length - 1) };
  });
  view.dispatch(state.update(tx, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
}

/** Ahead of the default keymap, so these win over anything bound there. */
export const formattingKeymap = keymap.of([
  { key: "Mod-i", run: toggle(ITALIC), preventDefault: true },
  { key: "Mod-b", run: toggle(BOLD), preventDefault: true },
  { key: "Mod-=", run: toggle(HIGHLIGHT), preventDefault: true },
  { key: "Mod-k", run: link, preventDefault: true },
]);
