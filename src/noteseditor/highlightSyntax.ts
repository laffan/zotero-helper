// `==highlighted==` text — not CommonMark or GFM, but the convention of
// Obsidian, Typora, iA Writer and markdown-it's mark plugin. A lezer
// Markdown extension modelled on its own GFM strikethrough: `==` runs
// are delimiters that pair up the way `~~` ones do, and the result is a
// Highlight node with HighlightMark children (which livePreview hides
// off the line being edited).
import type { MarkdownConfig } from "@lezer/markdown";
import { Tag, tags as t } from "@lezer/highlight";

/** What notesHighlight (theme.ts) paints as a marker-pen band. */
export const highlightTag = Tag.define();

const PUNCT = /[\p{P}\p{S}]/u;
const DELIM = { resolve: "Highlight", mark: "HighlightMark" };
const EQ = 61; // '='

export const HighlightSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": highlightTag } },
    { name: "HighlightMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        // Exactly two: `===` is something else (a setext underline).
        if (next !== EQ || cx.char(pos + 1) !== EQ || cx.char(pos + 2) === EQ) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = PUNCT.test(before);
        const pAfter = PUNCT.test(after);
        return cx.addDelimiter(
          DELIM,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        );
      },
      after: "Emphasis",
    },
  ],
};
