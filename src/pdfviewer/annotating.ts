// Making and editing marks in the pages, put together: the bar over a
// text selection (selectionBar.ts), the editor a tap on a highlight
// opens (annotPopover.ts) with handles on its passage
// (highlightHandles.ts), the ⌘-click (or the sentence tool) that
// selects a whole sentence (sentenceMark.ts), and the passages the app
// keeps marked — those the AI has explained, and the words looked up,
// whose definition a tap shows (passageMarks.ts). The viewer hands over
// its pages and the writer; absent a writer, a selection can only be
// quoted.
import { annotationPosition, type Annotation } from "../lib/highlights";
import { annotationAtPoint, attachAnnotationTaps, draftFromRange, pageBoxAt } from "./annotate";
import { createAnnotationPopover } from "./annotPopover";
import { createHighlightHandles } from "./highlightHandles";
import { createLookupPopup } from "./lookupPopup";
import { createPassageMarks, type ExplainMark, type WordMark } from "./passageMarks";
import { createSelectionBar, type MarkType } from "./selectionBar";
import { attachSentenceMarks, sentenceAround } from "./sentenceMark";
import type { PageRecord } from "./types";
import type { PdfViewerOptions } from "./viewerOptions";

export interface AnnotatingEnv {
  scrollArea: HTMLElement;
  root: HTMLElement;
  opts: PdfViewerOptions;
  getPages: () => PageRecord[];
  getPageLabels: () => string[] | null;
  getAnnotations: () => Annotation[];
  isFolded: () => boolean;
  /** Is this node on a fold opened to its whole page? */
  inExpanded: (node: Node) => boolean;
  /** A mark of this kind was made: the folded view keeps showing it. */
  include: (type: string, color: string) => void;
  /** The bottom bar's sentence tool, which annotating keeps. */
  sentenceButton: HTMLElement;
}

/** A word looked up, as the pages mark it: a tap shows `definition`. */
export type DefinedWord = WordMark & { word: string; definition: string };

export function createAnnotating(env: AnnotatingEnv) {
  const { opts, scrollArea, root } = env;
  const writer = opts.annotate;
  const mark = (range: Range, type: MarkType, color: string) => {
    const draft = draftFromRange(range, env.getPages(), env.getPageLabels());
    if (!draft || !writer) return;
    env.include(type, color);
    writer.create(draft, type, color);
  };
  const selection =
    opts.onQuote || writer || opts.onExplain
      ? createSelectionBar(scrollArea, root, {
          onQuote: opts.onQuote,
          // The folded view shows parts of pages; marks are made on
          // whole ones, so there a selection can only be quoted — but
          // on a fold opened to its page, it can be marked.
          canAnnotate: (range) => !env.isFolded() || env.inExpanded(range.startContainer),
          onAnnotate: writer ? mark : undefined,
          onExplain: opts.onExplain
            ? (text, page, range) => {
                const d = draftFromRange(range, env.getPages(), env.getPageLabels());
                opts.onExplain?.(text, page, d ? { pageIndex: d.pageIndex, rects: d.rects } : undefined);
              }
            : undefined,
          canExplain: opts.canExplain,
          onLookup: opts.onLookup
            ? (text, page, range) => {
                const d = draftFromRange(range, env.getPages(), env.getPageLabels());
                const place = d ? { pageIndex: d.pageIndex, rects: d.rects } : undefined;
                return opts.onLookup!(text, page, sentenceAround(range) || text, place);
              }
            : undefined,
        })
      : null;

  /** The element spanning page `idx` as shown, for the handles. */
  const pageBox = (idx: number): HTMLElement | null =>
    env.isFolded()
      ? root.querySelector<HTMLElement>(`.pdf-fold-wrapper.pdf-fold-expanded[data-page-index="${idx}"] .pdf-fold-page`)
      : (env.getPages()[idx]?.wrapper ?? null);
  const handles = writer
    ? createHighlightHandles({
        getPages: env.getPages,
        pageBox,
        commit: (a, range) => {
          const draft = draftFromRange(range, env.getPages(), env.getPageLabels());
          if (!draft || draft.text === a.text) return;
          writer.update(a.key, {
            position: JSON.stringify({ pageIndex: draft.pageIndex, rects: draft.rects, nextPageRects: draft.nextPageRects }),
            text: draft.text,
            sortIndex: draft.sortIndex,
          });
        },
      })
    : null;

  const popover = writer
    ? createAnnotationPopover(root, {
        update: (key, patch) => {
          const a = env.getAnnotations().find((x) => x.key === key);
          if (a && patch.color) env.include(a.type, patch.color);
          writer.update(key, patch);
        },
        remove: writer.remove,
        onInsert: opts.onInsertAnnotation,
        onLookup: opts.onLookup
          ? (a) => {
              const page = (annotationPosition(a)?.pageIndex ?? 0) + 1;
              return opts.onLookup!(a.text, page, a.text);
            }
          : undefined,
        canLookup: opts.canExplain,
        onOpen: (a) => handles?.show(a),
        onClose: () => handles?.hide(),
      })
    : null;

  // Before the highlights' taps, which a tap on an explained passage
  // or a word looked up goes ahead of.
  const ignore = () => Boolean(selection?.justDismissed());
  const explained = createPassageMarks(scrollArea, {
    kind: "explain",
    getPages: env.getPages,
    open: (id) => opts.onExplainTap?.(id),
    ignore,
  });
  // A word's definition, over the word, until the next press elsewhere
  // or a scroll.
  let defined: DefinedWord[] = [];
  const definition = createLookupPopup(root);
  const onOutside = (e: PointerEvent) => {
    if (!(e.target as Element).closest?.(".pdf-lookup")) hideDefinition();
  };
  function hideDefinition(): void {
    definition.hide();
    document.removeEventListener("pointerdown", onOutside, true);
  }
  const words = createPassageMarks(scrollArea, {
    kind: "word",
    getPages: env.getPages,
    open: (id, at) => {
      const w = defined.find((x) => x.id === id);
      if (!w) return;
      definition.showKnown(w.word, w.definition, at);
      document.addEventListener("pointerdown", onOutside, true);
    },
    ignore,
  });

  if (popover && writer) {
    attachAnnotationTaps(scrollArea, {
      getPages: env.getPages,
      getAnnotations: env.getAnnotations,
      ignore: () => Boolean(selection?.justDismissed()),
      canEdit: writer.canEdit,
      open: (a, at) => popover.open(a, at),
    });
  }

  // The sentence tool: on, a tap selects the sentence under it.
  let sentenceTool = false;
  const setSentenceTool = (on: boolean) => {
    sentenceTool = on;
    env.sentenceButton.classList.toggle("active", on);
    opts.onSentenceTool?.(on);
  };
  if (selection) env.sentenceButton.addEventListener("click", () => setSentenceTool(!sentenceTool));
  else env.sentenceButton.style.display = "none";
  const detachSentences = selection
    ? attachSentenceMarks(scrollArea, {
        latched: () => sentenceTool,
        // Text something else has claimed — a highlight or underline
        // (the reader's or not), an explained passage, a word looked up
        // — keeps its own tap.
        claimed: (target, x, y) => {
          if (explained.at(target, x, y) || words.at(target, x, y)) return true;
          const at = pageBoxAt(target);
          const p = at ? env.getPages()[at.pageIndex] : undefined;
          if (!at || !p) return false;
          const r = at.box.getBoundingClientRect();
          return Boolean(annotationAtPoint(p, at.pageIndex, (x - r.left) / r.width, (y - r.top) / r.height, env.getAnnotations()));
        },
        enabled: () => !scrollArea.classList.contains("pdf-crop-editing"),
      })
    : null;

  return {
    /** The pages scrolled: the editor is placed beside what it edits,
     *  so once that has moved away it closes (but not while its
     *  comment is being typed). */
    onScroll(): void {
      if (popover?.isOpen() && !root.querySelector(".pdf-annot-popover textarea:focus")) popover.close();
      hideDefinition();
    },
    /** The passages the AI has explained, to mark. */
    setExplainMarks: (marks: ExplainMark[]) => explained.set(marks),
    /** The words looked up in this PDF, to mark. */
    setWordMarks(list: DefinedWord[]): void {
      defined = list;
      words.set(list);
    },
    /** A page was drawn. */
    pageRendered(idx: number): void {
      explained.pageRendered(idx);
      words.pageRendered(idx);
    },
    /** The annotations changed. */
    sync(list: Annotation[]): void {
      popover?.sync(list);
      handles?.sync(list);
    },
    destroy(): void {
      selection?.destroy();
      popover?.destroy();
      handles?.destroy();
      detachSentences?.();
      hideDefinition();
      definition.destroy();
    },
  };
}
