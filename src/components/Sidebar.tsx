import { useMemo, useRef, useState } from "react";
import { renameFolder } from "../lib/actions";
import {
  buildTree,
  collectionPaths,
  type CollectionNode,
} from "../lib/collections";
import { useDragging, useIsDropTarget } from "../lib/dragdrop";
import { appLog, QUESTIONS, useStore } from "../lib/store";
import { FolderMenu } from "./FolderMenu";
import {
  ChatIcon,
  ChevronDown,
  ChevronRight,
  FlagIcon,
  Folder,
} from "./Icons";

/** A folder's name while it is being renamed: Enter (or leaving the
 *  field) renames it in Zotero, Escape leaves it as it was. */
function RenameField({ folderKey, name, onDone }: { folderKey: string; name: string; onDone: () => void }) {
  const [value, setValue] = useState(name);
  // Enter unmounts the field, which can also blur it — rename once.
  const finished = useRef(false);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onDone();
    if (commit && value.trim() && value.trim() !== name) {
      renameFolder(folderKey, value).catch((e) => appLog("error", `Rename failed: ${e}`));
    }
  };
  return (
    <input
      className="tree-rename"
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      aria-label="Folder name"
    />
  );
}

function Node({ node, depth }: { node: CollectionNode; depth: number }) {
  const { selectedCollection, selectCollection, toggleFolder } = useStore();
  // Fold state lives in the persisted store, so it survives restarts.
  const open = useStore((s) => !s.collapsedFolders.includes(node.key));
  const flagged = useStore((s) => s.flaggedFolders.includes(node.key));
  const hasChildren = node.children.length > 0;
  // Items dragged from the list land here (see lib/dragdrop).
  const dropOver = useIsDropTarget(node.key);
  const [renaming, setRenaming] = useState(false);

  return (
    <>
      <div
        className={`tree-row ${selectedCollection === node.key ? "selected" : ""} ${
          dropOver ? "drop-over" : ""
        }`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => selectCollection(node.key)}
        data-drop-collection={node.key}
        data-drop-name={node.name}
      >
        {hasChildren ? (
          <button
            className="tree-toggle"
            onClick={(e) => {
              e.stopPropagation();
              toggleFolder(node.key);
            }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="tree-toggle-spacer" />
        )}
        {flagged ? <FlagIcon size={14} filled /> : <Folder size={14} />}
        {renaming ? (
          <RenameField folderKey={node.key} name={node.name} onDone={() => setRenaming(false)} />
        ) : (
          <span className="tree-name">{node.name}</span>
        )}
        <FolderMenu folderKey={node.key} name={node.name} onRename={() => setRenaming(true)} />
      </div>
      {open &&
        node.children.map((c) => (
          <Node key={c.key} node={c} depth={depth + 1} />
        ))}
    </>
  );
}

interface FlaggedFolder {
  key: string;
  name: string;
  path: string;
}

/** A row in the Flagged section: same drop behavior and menu as a tree
 *  row (unflag is in the menu), but flat. */
function FlaggedRow({
  folder,
  selected,
  onSelect,
}: {
  folder: FlaggedFolder;
  selected: boolean;
  onSelect: () => void;
}) {
  const dropOver = useIsDropTarget(folder.key);
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      className={`tree-row ${selected ? "selected" : ""} ${dropOver ? "drop-over" : ""}`}
      style={{ paddingLeft: 10 }}
      onClick={onSelect}
      title={folder.path}
      data-drop-collection={folder.key}
      data-drop-name={folder.name}
    >
      <span className="tree-toggle-spacer" />
      <FlagIcon size={14} filled />
      {renaming ? (
        <RenameField folderKey={folder.key} name={folder.name} onDone={() => setRenaming(false)} />
      ) : (
        <span className="tree-name">{folder.name}</span>
      )}
      <FolderMenu folderKey={folder.key} name={folder.name} onRename={() => setRenaming(true)} />
    </div>
  );
}

export function Sidebar() {
  const collections = useStore((s) => s.library.collections);
  const itemCount = useStore(
    (s) => s.library.items.filter((i) => !i.data?.parentItem).length,
  );
  const { selectedCollection, selectCollection, sidebarOpen, setSidebarOpen } =
    useStore();
  const hidden = useStore((s) => s.sidebarHidden);
  const dragging = useDragging();
  const chatCount = useStore((s) => s.chats.length);
  const flaggedKeys = useStore((s) => s.flaggedFolders);
  const tree = useMemo(() => buildTree(collections), [collections]);

  // Flags are stored as bare keys, so a collection deleted in Zotero
  // simply drops out of the list here.
  const flagged = useMemo(() => {
    const paths = collectionPaths(collections);
    const byKey = new Map(collections.map((c) => [c.key, c]));
    return flaggedKeys
      .filter((k) => byKey.has(k))
      .map((k) => ({
        key: k,
        name: String(byKey.get(k)?.data?.name ?? "(untitled)"),
        path: paths.get(k) ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [collections, flaggedKeys]);

  return (
    <>
      {sidebarOpen && (
        <div className="drawer-scrim" onClick={() => setSidebarOpen(false)} />
      )}
      <nav
        className={`sidebar ${sidebarOpen ? "open" : ""} ${
          dragging ? "drop-mode" : ""
        } ${hidden ? "collapsed" : ""}`}
      >
        {flagged.length > 0 && (
          <>
            <div className="sidebar-section">Flagged</div>
            {flagged.map((f) => (
              <FlaggedRow
                key={f.key}
                folder={f}
                selected={selectedCollection === f.key}
                onSelect={() => selectCollection(f.key)}
              />
            ))}
          </>
        )}
        {/* Conversations, not a Zotero collection — hence no drop
            target and no flag. It sits above Library because it is
            about the library rather than part of it. */}
        <div
          className={`tree-row ${selectedCollection === QUESTIONS ? "selected" : ""}`}
          style={{ paddingLeft: 10, marginTop: 10 }}
          onClick={() => selectCollection(QUESTIONS)}
          title="Conversations with the AI about your works"
        >
          <span className="tree-toggle-spacer" />
          <ChatIcon size={14} />
          <span className="tree-name">Questions</span>
          {chatCount > 0 && <span className="tree-count">{chatCount}</span>}
        </div>
        <div className="sidebar-section">Library</div>
        <div
          className={`tree-row ${selectedCollection === "all" ? "selected" : ""}`}
          style={{ paddingLeft: 10 }}
          onClick={() => selectCollection("all")}
        >
          <span className="tree-toggle-spacer" />
          <Folder size={14} />
          <span className="tree-name">All Items</span>
          <span className="tree-count">{itemCount}</span>
        </div>
        <div
          className={`tree-row ${selectedCollection === "unfiled" ? "selected" : ""}`}
          style={{ paddingLeft: 10 }}
          onClick={() => selectCollection("unfiled")}
        >
          <span className="tree-toggle-spacer" />
          <Folder size={14} />
          <span className="tree-name">Unfiled</span>
        </div>
        <div className="sidebar-section">Collections</div>
        {tree.length === 0 && (
          <div className="sidebar-empty">No collections yet</div>
        )}
        {tree.map((n) => (
          <Node key={n.key} node={n} depth={0} />
        ))}
      </nav>
    </>
  );
}
