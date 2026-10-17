// Making and editing marks in the pages, put together: the bar over a
// text selection (selectionBar.ts), the editor a tap on a highlight
// opens (annotPopover.ts) with handles on its passage
// (highlightHandles.ts), the ⌘-click (or the sentence tool) that
// selects a whole sentence (sentenceMark.ts), and the passages the AI has explained
// (explainMarks.ts). The viewer hands over its pages and the writer;
// absent a writer, a selection can only be quoted.
import { annotationPosition, type Annotation } from "../lib/highlights";
import { annotationAtPoint, attachAnnotationTaps, draftFromRange, pageBoxAt } from "./annotate";
import { createAnnotationPopover } from "./annotPopover";
import { createExplainMarks } from "./explainMarks";
import { createHighlightHandles } from "./highlightHandles";
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
            ? (text, page, range) => opts.onLookup!(text, page, sentenceAround(range) || text)
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
  // goes ahead of.
  const explained = createExplainMarks(scrollArea, {
    getPages: env.getPages,
    open: (id) => opts.onExplainTap?.(id),
    ignore: () => Boolean(selection?.justDismissed()),
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
        onHighlight: (target, x, y) => {
          const at = pageBoxAt(target);
          const p = at ? env.getPages()[at.pageIndex] : undefined;
          if (!at || !p || !writer) return false;
          const r = at.box.getBoundingClientRect();
          const a = annotationAtPoint(p, at.pageIndex, (x - r.left) / r.width, (y - r.top) / r.height, env.getAnnotations());
          return Boolean(a && writer.canEdit(a));
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
    },
    /** The passages the AI has explained, to mark. */
    setExplainMarks: explained.set,
    /** A page was drawn. */
    pageRendered: explained.pageRendered,
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
    },
  };
}
