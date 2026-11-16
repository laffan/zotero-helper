// A section the reader added (lib/dividers.ts) as the Highlights tab shows
// it: a heading over the highlights that fall in it, like the outline's,
// marked with the accent's dashed rule it has on the page. A click goes
// to its line — in the open PDF, or opening it at its page — and its
// buttons rename it or delete it (a second press confirms). Unlike the
// outline's headings, one with no highlights under it still shows (while
// nothing narrows the list), since the reader put it there.
import { useState } from "react";
import { removeDivider, renameDivider } from "../lib/dividers";
import type { Section } from "../lib/outline";
import { TrashIcon } from "./Icons";
import { goToReaderPosition, openReaderAt } from "./ReaderPane";

interface Props {
  section: Section;
  id: string;
  itemKey: string;
  attKey: string;
  /** The PDF is the one open beside the panel. */
  open: boolean;
  shown: boolean;
  onShown: () => void;
}

export function DividerHeading({ section, id, itemKey, attKey, open, shown, onShown }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const go = () => {
    if (renaming || window.getSelection()?.toString()) return;
    if (open) goToReaderPosition(section.pageIndex, section.top);
    else openReaderAt(itemKey, attKey, section.pageIndex + 1);
    onShown();
  };
  const commit = () => {
    setRenaming(false);
    if (name.trim() && name.trim() !== section.title) renameDivider(id, name);
    else setName(section.title);
  };
  const del = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    removeDivider(id);
  };

  return (
    <div
      className={`hl-section hl-divider ${shown ? "shown" : ""}`}
      style={{ paddingLeft: Math.min(section.depth, 3) * 10 }}
      title={`${section.path.join(" › ")} — go to this section`}
      onClick={go}
    >
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
              setName(section.title);
              setRenaming(false);
            }
          }}
          onBlur={commit}
          aria-label="Section name"
        />
      ) : (
        <span className="hl-divider-name">{section.title}</span>
      )}
      <span className="hl-actions">
        <button
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation();
            setName(section.title);
            setRenaming(true);
          }}
          title="Rename this section"
        >
          Rename
        </button>
        <button
          className={`link-btn ${confirmDelete ? "danger" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            del();
          }}
          title={confirmDelete ? "Press again to delete" : "Delete this section (its highlights stay)"}
        >
          <TrashIcon size={11} />
          {confirmDelete ? "Delete?" : "Delete"}
        </button>
      </span>
    </div>
  );
}
