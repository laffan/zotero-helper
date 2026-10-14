// The notes editor: CodeMirror 6 with Markdown parsed by lezer (GFM —
// tables, strikethrough, task lists — and `==highlights==`), rendered
// in place (livePreview), formatted from the keyboard (formatting),
// Zotero links as pills (zoteroLinks), the page-cite icon on the line
// being written (citeGutter), and the reading questions offered on a
// line begun with "?" (prompts).
//
// Plain DOM, like the PDF viewer; NotesEditor.tsx mounts it.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { citeGutter, setCiteEnabled, type CiteSource } from "./citeGutter";
import { formattingKeymap } from "./formatting";
import { HighlightSyntax } from "./highlightSyntax";
import { livePreview } from "./livePreview";
import { promptCompletion } from "./prompts";
import { notesHighlight, notesTheme } from "./theme";
import { zoteroLinks, type LinkHandlers } from "./zoteroLinks";

export interface NotesEditorOptions extends LinkHandlers {
  doc: string;
  onChange: (text: string) => void;
  cite: CiteSource;
  /** The caret moved (or a selection changed) — once the writer has
   *  placed one, so a fresh editor's start-of-document doesn't count. */
  onSelect?: (anchor: number, head: number) => void;
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
        formattingKeymap,
        keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, extensions: [HighlightSyntax] }),
        syntaxHighlighting(notesHighlight),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: "true", autocapitalize: "sentences" }),
        promptCompletion,
        livePreview,
        zoteroLinks({ follow: opts.follow, annotationColor: opts.annotationColor }),
        citeGutter(opts.cite),
        notesTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
          if (u.transactions.some((tr) => tr.isUserEvent("select") || tr.isUserEvent("input"))) {
            caretPlaced = true;
          }
          if (u.selectionSet && caretPlaced) {
            const { anchor, head } = u.state.selection.main;
            opts.onSelect?.(anchor, head);
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
      const { anchor, head } = view.state.selection.main;
      opts.onSelect?.(anchor, head);
      view.focus();
    },
    /** Where the view starts: the position of its first line. (A
     *  position, not pixels — the height of lines not yet drawn is
     *  only CodeMirror's estimate.) */
    topPosition: (): number => view.lineBlockAtHeight(view.scrollDOM.scrollTop).from,
    /** Put the caret (or selection) and the view back where they were
     *  left, without taking focus. Positions past the end (the notes
     *  changed elsewhere since) are kept to the end. */
    restorePlace(sel: [number, number] | undefined, top: number | undefined): void {
      const end = view.state.doc.length;
      view.dispatch({
        selection: sel ? { anchor: Math.min(sel[0], end), head: Math.min(sel[1], end) } : undefined,
        effects: top ? EditorView.scrollIntoView(Math.min(top, end), { y: "start" }) : undefined,
      });
      if (sel) caretPlaced = true;
    },
    /** Replace the whole text (an empty note's questions), the caret at
     *  `caret`, and take focus. */
    setDoc(text: string, caret: number): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: Math.min(caret, text.length) },
        userEvent: "input",
        scrollIntoView: true,
      });
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
