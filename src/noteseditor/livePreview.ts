// Markdown rendered in place, the way Hush's editor does it: the
// formatting marks (`#`, `**`, `_`, `` ` ``, `>`, a link's brackets and
// URL) disappear on every line except the one being edited, leaving the
// text styled by notesHighlight. Off focus, every line is rendered.
//
// Zotero links are not handled here — zoteroLinks.ts replaces those with
// pills.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

const HIDE = Decoration.replace({});

class RuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-hr-rule";
    return span;
  }
}

/** Lines the caret (or a selection) is on — the ones shown raw. */
export function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  const { doc } = view.state;
  for (const r of view.state.selection.ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

/** The link's URL, read from its URL child node. */
export function linkUrl(state: EditorState, linkFrom: number, linkTo: number): { url: string; from: number; to: number } | null {
  let found: { url: string; from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    from: linkFrom,
    to: linkTo,
    enter: (n) => {
      if (n.name === "URL" && !found) {
        found = { url: state.sliceDoc(n.from, n.to), from: n.from, to: n.to };
      }
    },
  });
  return found;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(view);
  const onActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const lineClass = (pos: number, cls: string) =>
    out.push(Decoration.line({ class: cls }).range(state.doc.lineAt(pos).from));

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (name === "Blockquote" || name === "FencedCode") {
          const cls = name === "Blockquote" ? "cm-md-quote" : "cm-md-codeblock";
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            lineClass(line.from, cls);
            pos = line.to + 1;
          }
          // Inside code blocks nothing is markup.
          return name !== "FencedCode";
        }
        if (name === "HorizontalRule") {
          lineClass(node.from, "cm-md-hr");
          if (!onActive(node.from)) {
            out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
          }
          return;
        }
        if (onActive(node.from)) return;
        if (name === "HeaderMark" || name === "QuoteMark") {
          // The mark and the space after it.
          let end = node.to;
          while (end < state.doc.length && state.sliceDoc(end, end + 1) === " ") end++;
          if (end > node.from) out.push(HIDE.range(node.from, end));
          return;
        }
        if (name === "EmphasisMark" || name === "StrikethroughMark") {
          out.push(HIDE.range(node.from, node.to));
          return;
        }
        if (name === "CodeMark" && node.node.parent?.name === "InlineCode") {
          out.push(HIDE.range(node.from, node.to));
          return;
        }
        if (name === "Link") {
          const url = linkUrl(state, node.from, node.to);
          if (!url || url.url.startsWith("zotero://")) return false;
          // `[label](url)` → the label, styled and clickable.
          const labelEnd = state.sliceDoc(node.from, node.to).indexOf("](");
          if (labelEnd < 0) return false;
          const closeBracket = node.from + labelEnd;
          out.push(HIDE.range(node.from, node.from + 1));
          out.push(
            Decoration.mark({ class: "cm-md-link", attributes: { "data-href": url.url } }).range(
              node.from + 1,
              closeBracket,
            ),
          );
          out.push(HIDE.range(closeBracket, node.to));
          return false;
        }
      },
    });
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
