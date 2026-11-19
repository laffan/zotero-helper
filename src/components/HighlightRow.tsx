// One highlight as the Highlights tab shows it — a row of the list
// (HighlightsPanel.tsx), a card of the Highlight Map (HighlightMap.tsx):
// its text and comment, its page, and three actions: Copy (a Markdown
// quote), Note (the same quote, into the entry's notes) and Zotero
// (opens the PDF there, on the highlight). A bookmark among them is a
// BookmarkRow. With the PDF open beside the panel a click goes to the
// highlight in the pages; otherwise it only shows the row's actions.
//
// The actions show only on the row the pointer is over (`data-hover`,
// set by useRowHover from a mouse or trackpad's moves — not CSS :hover,
// which a finger's tap sets too, and a tap that reveals something is one
// WebKit doesn't pass on as a click) and on the row last picked, the
// finger's way to them; on a screen with no pointer at all, on every row
// (tabs.css).
import { useRef, useState } from "react";
import { openInZotero } from "../lib/actions";
import { copyText } from "../lib/clipboard";
import { isBookmark } from "../lib/bookmarks";
import { annotationMarkdown, annotationPosition, type Annotation } from "../lib/highlights";
import { insertIntoNotes } from "../lib/notes";
import { useStore } from "../lib/store";
import type { ZItem } from "../lib/types";
import { BookmarkRow } from "./BookmarkRow";
import { Marked } from "./HighlightFilters";
import { CopyIcon, ExternalIcon, QuoteIcon } from "./Icons";
import { showInReader } from "./ReaderPane";

interface Props {
  item: ZItem;
  att: ZItem;
  entry: Annotation;
  /** The search, lower case, to mark. */
  q: string;
  /** Notes belong to one entry: Note only with one selected. */
  canAdd: boolean;
  /** The PDF open beside the panel. */
  openAttKey: string | null;
  shown: boolean;
  onShown: () => void;
}

export function HighlightRow({ item, att, entry: a, q, canAdd, openAttKey, shown, onShown }: Props) {
  const settings = useStore((s) => s.settings);
  // The action that just happened, shown on its button for a moment.
  const [done, setDone] = useState<"copy" | "add" | null>(null);
  if (isBookmark(a)) {
    return (
      <BookmarkRow
        entry={a}
        itemKey={item.key}
        marked={<Marked text={a.text} q={q} />}
        canAdd={canAdd}
        shown={shown}
        onShown={onShown}
      />
    );
  }
  const navigable = att.key === openAttKey;

  const flash = (what: "copy" | "add") => {
    setDone(what);
    window.setTimeout(() => setDone((d) => (d === what ? null : d)), 1500);
  };
  const copy = () => {
    void copyText(annotationMarkdown(settings, a)).then((ok) => (ok ? flash("copy") : setDone(null)));
  };
  const add = () => {
    insertIntoNotes(annotationMarkdown(settings, a));
    flash("add");
  };
  /** Scroll the open PDF to the highlight. */
  const reveal = () => {
    // A text selection in the row is someone copying, not navigating.
    if (window.getSelection()?.toString()) return;
    if (!navigable) return onShown();
    const page = annotationPosition(a)?.pageIndex;
    if (showInReader(att.key, page != null ? page + 1 : undefined, a.key)) onShown();
  };
  const open = () => {
    const page = parseInt(a.pageLabel, 10);
    void openInZotero(item.key, att.key, undefined, isNaN(page) ? undefined : page, a.key);
  };
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      className={`hl-row ${navigable ? "navigable" : ""} ${shown ? "shown" : ""}`}
      style={a.color ? { borderLeftColor: a.color } : undefined}
      onClick={reveal}
      title={navigable ? "Show in the PDF" : undefined}
    >
      {a.text && (
        <div className="hl-text">
          <Marked text={a.text} q={q} />
        </div>
      )}
      {a.comment && (
        <div className="hl-comment">
          <Marked text={a.comment} q={q} />
        </div>
      )}
      <div className="hl-meta">
        {a.pageLabel && <span>p. {a.pageLabel}</span>}
        {a.type !== "highlight" && <span>· {a.type}</span>}
        {a.tags.length > 0 && <span className="hl-tags">· {a.tags.join(", ")}</span>}
        <span className="hl-actions">
          <button
            className="link-btn"
            onClick={act(() => void copy())}
            title="Copy as a Markdown quote with a link back to the page"
          >
            <CopyIcon size={11} />
            {done === "copy" ? "Copied" : "Copy"}
          </button>
          {canAdd && (
            <button
              className="link-btn"
              onClick={act(add)}
              title="Add to the notes as a quote, with a link back to the page"
            >
              <QuoteIcon size={11} />
              {done === "add" ? "Added" : "Note"}
            </button>
          )}
          <button className="link-btn" onClick={act(open)} title="Open the PDF in Zotero at this highlight">
            <ExternalIcon size={11} />
            Zotero
          </button>
        </span>
      </div>
    </div>
  );
}

/** Mark the row (or section heading) under a mouse or trackpad pointer
 *  for its actions, and none once the pointer has left: the handler for
 *  the list's, or the map's, pointer moves and leaving. */
export function useRowHover(): (e: React.PointerEvent) => void {
  const hovered = useRef<HTMLElement | null>(null);
  return (e) => {
    if (e.pointerType !== "mouse") return;
    const over = e.type === "pointerleave" ? null : (e.target as Element).closest<HTMLElement>(".hl-row, .hl-divider");
    if (over === hovered.current) return;
    hovered.current?.removeAttribute("data-hover");
    over?.setAttribute("data-hover", "");
    hovered.current = over;
  };
}
