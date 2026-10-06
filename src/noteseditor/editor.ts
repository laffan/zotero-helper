// The notes editor: CodeMirror 6 with Markdown parsed by lezer (GFM —
// tables, strikethrough, task lists), rendered in place (livePreview),
// Zotero links as pills (zoteroLinks), and the page-cite icon on the
// line being written (citeGutter).
//
// Plain DOM, like the PDF viewer; NotesEditor.tsx mounts it.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { citeGutter, setCiteEnabled, type CiteSource } from "./citeGutter";
import { livePreview } from "./livePreview";
import { notesHighlight, notesTheme } from "./theme";
import { zoteroLinks, type LinkHandlers } from "./zoteroLinks";

export interface NotesEditorOptions extends LinkHandlers {
  doc: string;
  placeholder: string;
  onChange: (text: string) => void;
  cite: CiteSource;
}

/** Put `md` at the caret as a paragraph of its own (at the end when the
 *  writer hasn't placed a caret), leaving the caret after it. */
function insertParagraph(view: EditorView, md: string, atEnd: boolean): void {
  const { state } = view;
  const sel = state.selection.main;
  let start = atEnd ? state.doc.length : sel.from;
  const end = atEnd ? state.doc.length : sel.to;
  // A list item or quote just started and still empty (`- `, `> `) is
  // where the caret landed after Enter, not something to keep.
  const line = state.doc.lineAt(start);
  if (start === line.to && /^\s*(?:[-*+]|\d+[.)]|>)\s*$/.test(line.text)) start = line.from;
  const before = state.sliceDoc(0, start);
  const after = state.sliceDoc(end);
  const trimmedBefore = before.replace(/\s+$/, "");
  const trimmedAfter = after.replace(/^\s+/, "");
  const head = trimmedBefore ? "\n\n" : "";
  const insert = `${head}${md.trim()}\n\n`;
  const from = trimmedBefore.length;
  const to = state.doc.length - trimmedAfter.length;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
    userEvent: "input.insert",
  });
}

export function createNotesEditor(parent: HTMLElement, opts: NotesEditorOptions) {
  let caretPlaced = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        history(),
        keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(notesHighlight),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: "true", autocapitalize: "sentences" }),
        placeholder(opts.placeholder),
        livePreview,
        zoteroLinks({ follow: opts.follow, annotationColor: opts.annotationColor }),
        citeGutter(opts.cite),
        notesTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
          if (u.transactions.some((tr) => tr.isUserEvent("select") || tr.isUserEvent("input"))) {
            caretPlaced = true;
          }
        }),
      ],
    }),
  });

  return {
    view,
    /** Quote, citation or link from the PDF, as its own paragraph. */
    insert(md: string): void {
      insertParagraph(view, md, !caretPlaced);
      caretPlaced = true;
      view.focus();
    },
    /** Show the cite icon (the PDF for these notes is open). */
    setCiteEnabled(on: boolean): void {
      view.dispatch({ effects: setCiteEnabled.of(on) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

export type NotesEditorHandle = ReturnType<typeof createNotesEditor>;
