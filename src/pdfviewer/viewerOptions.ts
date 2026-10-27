// What the viewer is given by its host (ReaderPane): the callbacks that
// connect it to the notes, the bookmarks and Zotero, and the writer for
// annotations made in it.
import type { Annotation } from "../lib/highlights";
import type { AnnotationDraft } from "./annotate";
import type { InkWriter } from "./ink";
import type { OutlineEntry } from "./outline";
import type { MarkType } from "./selectionBar";
import type { SavedView } from "./viewState";

export interface PdfViewerOptions {
  /** Open the PDF in Zotero at a page (toolbar link, page pop-out). */
  onOpenInZotero?: (page: number) => void;
  /** Bookmark a page (its hover button), named as it is made; `top`
   *  is the page's top in PDF units. A bookmarked page's button renames
   *  or removes its bookmark instead. */
  onBookmark?: (pageIndex: number, top: number, name: string, pageLabel?: string) => void;
  /** Does holding a page's top-right corner for a second bookmark it
   *  (bookmarkHold.ts) — reading mode, where the button is hidden? */
  holdToBookmark?: () => boolean;
  onRenameBookmark?: (id: string, name: string) => void;
  onRemoveBookmark?: (id: string) => void;
  /** Quote selected text into the notes. */
  onQuote?: (text: string, page: number) => void;
  /** Ask the AI about selected text (the selection bar's sparkles),
   *  offered while `canExplain` says a service is connected; `place` is
   *  the passage on its page (PDF rects), to mark it by. */
  onExplain?: (text: string, page: number, place?: { pageIndex: number; rects: number[][] }) => void;
  canExplain?: () => boolean;
  /** Look up the selected word or phrase (the selection bar's
   *  magnifier), read in the sentence `context`; resolves with its
   *  definition. Offered while `canExplain`. `place` is the selection
   *  on its page (PDF rects), to mark the word by (setWordMarks); a
   *  highlight's text, looked up from its editor, has none. */
  onLookup?: (
    text: string,
    page: number,
    context: string,
    place?: { pageIndex: number; rects: number[][] },
  ) => Promise<string>;
  /** A tap on a passage explained before (setExplainMarks): its id. */
  onExplainTap?: (id: string) => void;
  /** The sentence tool (a tap selects a sentence) went on or off. */
  onSentenceTool?: (on: boolean) => void;
  /** Ink mode went on or off. */
  onInkMode?: (on: boolean) => void;
  /** Whether two pages show side by side ("Fit 2 pages", outside the
   *  folded view), reported as the layout changes. */
  onTwoUp?: (on: boolean) => void;
  /** Ink mode's tool: the pen, the eraser or select. */
  onInkTool?: (tool: "pen" | "eraser" | "select") => void;
  /** Send an annotation to the notes (its editor's Add to notes). */
  onInsertAnnotation?: (a: Annotation) => void;
  /** Make, change and delete annotations; absent, they are read-only. */
  annotate?: AnnotationWriter;
  /** The document's outline, once loaded (empty when it has none). */
  onOutline?: (outline: OutlineEntry[]) => void;
  /** Reading mode on or off (its bottom-bar button); absent hides it. */
  onReadingMode?: () => void;
  /** The page in view changed (1-based) — after the start page is
   *  reached, so opening a PDF doesn't report page 1 on the way. */
  onPageChange?: (page: number) => void;
  /** This PDF's view as it was left (viewState.ts), to open it so. */
  initialView?: SavedView | null;
  /** The view changed — reported once it settles, and on closing. */
  onViewChange?: (page: number, view: SavedView) => void;
}

/** Highlights and underlines (from a text selection) and ink (ink/). */
export interface AnnotationWriter extends InkWriter {
  create: (draft: AnnotationDraft, type: MarkType, color: string) => void;
  /** `text` and `position` together: a highlight's passage moved by
   *  its handles. */
  update: (
    key: string,
    patch: { color?: string; comment?: string; position?: string; sortIndex?: string; text?: string },
  ) => void;
}
