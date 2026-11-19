// A section the reader added (lib/dividers.ts) as the Highlights tab shows
// it: a heading over the highlights that fall in it, like the outline's,
// marked with the accent's dashed rule it has on the page. A click goes
// to its line — in the open PDF, or opening it at its page — and its
// buttons rename it (and nest it under a section before it, as on the
// page) or delete it (a second press confirms). Unlike the
// outline's headings, one with no highlights under it still shows (while
// nothing narrows the list), since the reader put it there.
import { useState } from "react";
import { dividersOf, nestingChoices, removeDivider, renameDivider, useDividers, type NestChoice } from "../lib/dividers";
import { outlineOf, sectionsOf, type Section } from "../lib/outline";
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
  /** Indented by its depth, as in the list (not as the map's column
   *  heading or row). */
  indent?: boolean;
}

export function DividerHeading({ section, id, itemKey, attKey, open, shown, onShown, indent = true }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // While renaming: the sections it can be nested under, and the one chosen.
  const [choices, setChoices] = useState<NestChoice[]>([]);
  const [parent, setParent] = useState("");
  const startRename = () => {
    const mine = dividersOf(useDividers.getState().list, attKey);
    const current = mine.find((d) => d.id === id)?.parentId ?? "";
    const list = nestingChoices(sectionsOf(outlineOf(attKey)), mine, section.pageIndex, section.top, id);
    setChoices(list);
    setParent(list.some((c) => c.id === current) ? current : "");
    setName(section.title);
    setRenaming(true);
  };

  const go = () => {
    if (renaming || window.getSelection()?.toString()) return;
    if (open) goToReaderPosition(section.pageIndex, section.top);
    else openReaderAt(itemKey, attKey, section.pageIndex + 1);
    onShown();
  };
  const commit = () => {
    setRenaming(false);
    const nestedIn = section.nestedIn ? section.nestedIn.replace(/^divider:/, "") : "";
    const renamed = name.trim() && name.trim() !== section.title;
    if (renamed || parent !== nestedIn) renameDivider(id, renamed ? name : section.title, parent || null);
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
      style={indent ? { paddingLeft: Math.min(section.depth, 3) * 10 } : undefined}
      title={`${section.path.join(" › ")} — go to this section`}
      onClick={go}
    >
      {renaming ? (
        // Kept when the focus leaves the name and its dropdown together.
        <span
          className="hl-divider-edit"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
          }}
        >
          <input
            className="hl-bookmark-input"
            value={name}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") {
                e.preventDefault();
                setName(section.title);
                setRenaming(false);
              }
            }}
            aria-label="Section name"
          />
          {choices.length > 0 && (
            <label className="hl-divider-nest">
              Nested under
              <select value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">None</option>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {"\u00a0\u00a0\u00a0".repeat(c.level)}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </span>
      ) : (
        <span className="hl-divider-name">{section.title}</span>
      )}
      <span className="hl-actions">
        <button
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation();
            startRename();
          }}
          title="Rename this section, or nest it under one before it"
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
