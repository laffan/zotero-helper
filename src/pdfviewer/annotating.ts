// Making and editing marks in the pages, put together: the bar over a
// text selection (selectionBar.ts), the editor a tap on a highlight
// opens (annotPopover.ts) with handles on its passage
// (highlightHandles.ts), the ⌘-click (or the sentence tool) that
// selects a whole sentence (sentenceMark.ts), and the passages the app
// keeps marked — those the AI has explained, and the words looked up,
// whose definition a tap shows (passageMarks.ts) — and, in night vision,
// each highlight's colour flag (colorFlags.ts). The viewer hands over
// its pages and the writer; absent a writer, a selection can only be
// quoted.
import { annotationPosition, type Annotation } from "../lib/highlights";
import { annotationAtClient, attachAnnotationTaps, draftFromRange } from "./annotate";
import { createAnnotationPopover } from "./annotPopover";
import { createColorFlags } from "./colorFlags";
import { createHighlightHandles } from "./highlightHandles";
import { createLookupPopup } from "./lookupPopup";
import { createPassageMarks, type ExplainMark, type WordMark } from "./passageMarks";
import { createSelectionBar, type MarkType } from "./selectionBar";
import { attachSentenceMarks, sentenceAround } from "./sentenceMark";
import type { PageRecord, PDFDocumentProxy } from "./types";
import type { PdfViewerOptions } from "./viewerOptions";

export interface AnnotatingEnv {
  scrollArea: HTMLElement;
  root: HTMLElement;
  opts: PdfViewerOptions;
  getPages: () => PageRecord[];
  /** The open PDF (its text places night vision's colour flags). */
  getPdfDoc: () => PDFDocumentProxy | null;
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

/** Are two passages on a page (PDF rects) the same one — overlapping by
 *  at least 80% of the larger? Then explaining one again opens the other's
 *  explanation, rather than asking anew. */
function samePassage(a: number[][], b: number[][]): boolean {
  const area = (rs: number[][]) => rs.reduce((n, r) => n + Math.abs(r[2] - r[0]) * Math.abs(r[3] - r[1]), 0);
  let shared = 0;
  for (const r of a) {
    for (const q of b) {
      const w = Math.min(Math.max(r[0], r[2]), Math.max(q[0], q[2])) - Math.max(Math.min(r[0], r[2]), Math.min(q[0], q[2]));
      const h = Math.min(Math.max(r[1], r[3]), Math.max(q[1], q[3])) - Math.max(Math.min(r[1], r[3]), Math.min(q[1], q[3]));
      if (w > 0 && h > 0) shared += w * h;
    }
  }
  return shared >= 0.8 * Math.max(area(a), area(b));
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
                // The passage explained before (the sentence tool selects
                // what it underlined): that explanation, opened again.
                const known = d && explained.onPage(d.pageIndex).find((m) => samePassage(m.rects, d.rects));
                if (known && opts.onExplainTap) return opts.onExplainTap(known.id);
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
        // A highlight's text explained: no underline of its own (the
        // highlight keeps its tap, which opens this popover, and its
        // Explain then opens that explanation again).
        onExplain: opts.onExplain
          ? (a) => {
              const pageIndex = annotationPosition(a)?.pageIndex ?? 0;
              opts.onExplain!(a.text, pageIndex + 1, { pageIndex, rects: [], annotationKey: a.key });
            }
          : undefined,
        onOpenExplanation: opts.onExplainTap,
        canLookup: opts.canExplain,
        onOpen: (a) => handles?.show(a),
        onClose: () => handles?.hide(),
      }, scrollArea)
    : null;

  // Before the highlights' taps, which a tap on an explained passage
  // or a word looked up goes ahead of — unless one of the reader's own
  // highlights lies beneath it: its editor opens then, carrying the
  // explanation (Explain opens it) or the definition (shown over it), so
  // a highlight under an underline can still be recoloured, edited and
  // deleted, and the underline's explanation is still a tap away.
  const ignore = () => Boolean(selection?.justDismissed());
  const editableAt = (target: Element, x: number, y: number) => {
    if (!popover || !writer) return null;
    const a = annotationAtClient(target, x, y, env.getPages(), env.getAnnotations());
    return a && writer.canEdit(a) ? a : null;
  };
  const yields = (target: Element, x: number, y: number) => editableAt(target, x, y) !== null;
  const explained = createPassageMarks(scrollArea, {
    kind: "explain",
    getPages: env.getPages,
    open: (id) => opts.onExplainTap?.(id),
    ignore,
    yields,
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
    yields,
  });

  if (popover && writer) {
    attachAnnotationTaps(scrollArea, {
      getPages: env.getPages,
      getAnnotations: env.getAnnotations,
      ignore: () => Boolean(selection?.justDismissed()),
      canEdit: writer.canEdit,
      open: (a, at, tap) => {
        const word = defined.find((w) => w.id === words.idAt(tap.target, tap.x, tap.y));
        popover.open(a, at, {
          explanation: explained.idAt(tap.target, tap.x, tap.y),
          definition: word ? { word: word.word, text: word.definition } : null,
        });
      },
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
        // (the reader's or not), a word looked up — keeps its own tap. An
        // explained passage doesn't: the tool selects it, to be marked,
        // and the bar's Explain opens its explanation again.
        claimed: (target, x, y) => {
          if (words.at(target, x, y)) return true;
          return Boolean(annotationAtClient(target, x, y, env.getPages(), env.getAnnotations()));
        },
        enabled: () => !scrollArea.classList.contains("pdf-crop-editing"),
      })
    : null;

  // Night vision's colour flags (colorFlags.ts).
  const flags = createColorFlags({
    getPages: env.getPages,
    getPdfDoc: env.getPdfDoc,
    getAnnotations: env.getAnnotations,
  });

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
      flags.pageRendered(idx);
    },
    /** The annotations changed. */
    sync(list: Annotation[]): void {
      popover?.sync(list);
      handles?.sync(list);
      flags.sync();
    },
    destroy(): void {
      flags.destroy();
      selection?.destroy();
      popover?.destroy();
      handles?.destroy();
      detachSentences?.();
      hideDefinition();
      definition.destroy();
    },
  };
}
