// A bookmark in the Highlights tab (lib/bookmarks.ts): its name and
// page, in reading order among the highlights. A click goes to the page —
// in the open PDF, or opening it — and its buttons rename it, put a link
// to the page in the notes, or delete it (a second press confirms).
import { useState } from "react";
import { bookmarkIdOf, removeBookmark, renameBookmark } from "../lib/bookmarks";
import { annotationPosition, pdfLink, type Annotation } from "../lib/highlights";
import { insertIntoNotes } from "../lib/notes";
import { useStore } from "../lib/store";
import { BookmarkIcon, QuoteIcon, TrashIcon } from "./Icons";
import { openReaderAt } from "./ReaderPane";

interface Props {
  entry: Annotation;
  itemKey: string;
  /** Highlight the search's matches in the name. */
  marked: React.ReactNode;
  /** Notes belong to one entry: Note only with one selected. */
  canAdd: boolean;
  shown: boolean;
  onShown: () => void;
}

export function BookmarkRow({ entry, itemKey, marked, canAdd, shown, onShown }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(entry.text);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const id = bookmarkIdOf(entry);
  const page = (annotationPosition(entry)?.pageIndex ?? 0) + 1;

  const go = () => {
    if (renaming || window.getSelection()?.toString()) return;
    openReaderAt(itemKey, entry.attKey, page);
    onShown();
  };
  const commit = () => {
    setRenaming(false);
    if (name.trim() && name.trim() !== entry.text) renameBookmark(id, name);
    else setName(entry.text);
  };
  const note = () => {
    const link = pdfLink(useStore.getState().settings, entry.attKey, page);
    insertIntoNotes(`[p. ${entry.pageLabel}](${link}) ${entry.text}`);
  };
  const del = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    removeBookmark(id);
  };

  return (
    <div className={`hl-row hl-bookmark navigable ${shown ? "shown" : ""}`} onClick={go} title="Go to this page">
      <div className="hl-text hl-bookmark-name">
        <BookmarkIcon size={12} />
        {renaming ? (
          <input
            className="hl-bookmark-input"
            value={name}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") {
                e.preventDefault();
                setName(entry.text);
                setRenaming(false);
              }
            }}
            onBlur={commit}
            aria-label="Bookmark name"
          />
        ) : (
          <span>{marked}</span>
        )}
      </div>
      <div className="hl-meta">
        <span>p. {entry.pageLabel}</span>
        <span>· bookmark</span>
        <span className="hl-actions">
          <button
            className="link-btn"
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            title="Rename this bookmark"
          >
            Rename
          </button>
          {canAdd && (
            <button
              className="link-btn"
              onClick={(e) => {
                e.stopPropagation();
                note();
              }}
              title="Add a link to this page to the notes"
            >
              <QuoteIcon size={11} />
              Note
            </button>
          )}
          <button
            className={`link-btn ${confirmDelete ? "danger" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              del();
            }}
            title={confirmDelete ? "Press again to delete" : "Delete this bookmark"}
          >
            <TrashIcon size={11} />
            {confirmDelete ? "Delete?" : "Delete"}
          </button>
        </span>
      </div>
    </div>
  );
}
