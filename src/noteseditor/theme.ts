// How the notes look: a writing surface in the app's own type, with
// Markdown rendered in place (livePreview.ts hides the marks; this sets
// the type the marks leave behind).
import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const notesHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.45em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.25em", fontWeight: "700" },
  { tag: t.heading3, fontSize: "1.1em", fontWeight: "700" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.92em" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--text-dim)" },
  { tag: t.quote, fontStyle: "italic" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--text-dim)" },
]);

export const notesTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13.5px",
    backgroundColor: "var(--panel)",
    color: "var(--text)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--sans)",
    lineHeight: "1.65",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "12px 14px 40vh 0",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--select-strong) !important",
  },
  ".cm-placeholder": { color: "var(--text-dim)", fontStyle: "italic" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
  },
  // Rendered block types (livePreview.ts sets these line classes).
  ".cm-md-quote": {
    borderLeft: "3px solid var(--accent-soft)",
    paddingLeft: "10px !important",
    color: "var(--text)",
  },
  ".cm-md-codeblock": {
    fontFamily: "var(--mono)",
    fontSize: "12px",
    backgroundColor: "var(--panel-alt)",
  },
  ".cm-md-hr": { color: "var(--text-dim)" },
  ".cm-md-hr-rule": {
    display: "inline-block",
    width: "100%",
    borderTop: "1px solid var(--border)",
    verticalAlign: "middle",
  },
  ".cm-md-link": {
    color: "var(--accent)",
    textDecoration: "underline",
    textDecorationColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
    textUnderlineOffset: "2px",
  },
});
