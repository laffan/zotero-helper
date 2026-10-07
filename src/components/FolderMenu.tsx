// The menu at the right of a sidebar folder: flag, rename, download all
// of its PDFs to this device, delete. The button shows while the row is
// hovered (always, faintly, where there is no hover — sidebar.css).
import { useState } from "react";
import { deleteFolder } from "../lib/actions";
import { cacheFolderPdfs } from "../lib/notes";
import { appLog, useStore } from "../lib/store";
import { MenuIcon } from "./Icons";
import { ToolbarMenu, useDropdown } from "./ToolbarMenu";

const MENU_WIDTH = 210;

export function FolderMenu({
  folderKey,
  name,
  onRename,
}: {
  folderKey: string;
  name: string;
  /** Start editing the name in the row. */
  onRename: () => void;
}) {
  const { open, setOpen, ref } = useDropdown();
  const flagged = useStore((s) => s.flaggedFolders.includes(folderKey));
  const toggleFlag = useStore((s) => s.toggleFlag);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const close = () => {
    setOpen(false);
    setConfirmDelete(false);
  };
  const run = (fn: () => void | Promise<void>) => {
    close();
    void Promise.resolve(fn()).catch((e) => appLog("error", `${e}`));
  };

  return (
    <div
      className={`filter-anchor tree-menu ${open ? "open" : ""}`}
      ref={ref}
      // The row underneath selects on click and starts drags.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="tree-menu-btn"
        onClick={() => (open ? close() : setOpen(true))}
        title="Folder options"
        aria-label={`Options for ${name}`}
        aria-expanded={open}
      >
        <MenuIcon size={13} />
      </button>
      {open && (
        <ToolbarMenu anchorRef={ref} width={MENU_WIDTH}>
          <button className="menu-item" onClick={() => run(() => toggleFlag(folderKey))}>
            <strong>{flagged ? "Unflag" : "Flag"}</strong>
            <span>{flagged ? "Take it out of Flagged" : "Keep it in Flagged, above Library"}</span>
          </button>
          <button className="menu-item" onClick={() => run(onRename)}>
            <strong>Rename…</strong>
            <span>Renames the collection in Zotero</span>
          </button>
          <button className="menu-item" onClick={() => run(() => cacheFolderPdfs(folderKey))}>
            <strong>Download all PDFs</strong>
            <span>Keep this folder’s PDFs on this device</span>
          </button>
          <span className="menu-sep" />
          <button
            className={`menu-item ${confirmDelete ? "danger" : ""}`}
            onClick={() =>
              confirmDelete
                ? run(async () => {
                    try {
                      await deleteFolder(folderKey);
                    } catch (e) {
                      appLog("error", `Delete failed: ${e}`);
                    }
                  })
                : setConfirmDelete(true)
            }
          >
            <strong>{confirmDelete ? `Delete “${name}”?` : "Delete"}</strong>
            <span>
              {confirmDelete
                ? "Click again to delete it from Zotero (its items stay in the library)"
                : "Deletes the collection in Zotero"}
            </span>
          </button>
        </ToolbarMenu>
      )}
    </div>
  );
}
