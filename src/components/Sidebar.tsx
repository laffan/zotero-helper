import { useMemo } from "react";
import {
  buildTree,
  collectionPaths,
  type CollectionNode,
} from "../lib/collections";
import { useDragging, useIsDropTarget } from "../lib/dragdrop";
import { QUESTIONS, useStore } from "../lib/store";
import {
  AskIcon,
  ChevronDown,
  ChevronRight,
  CloseIcon,
  FlagIcon,
  Folder,
} from "./Icons";

function Node({ node, depth }: { node: CollectionNode; depth: number }) {
  const { selectedCollection, selectCollection, toggleFolder } = useStore();
  // Fold state lives in the persisted store, so it survives restarts.
  const open = useStore((s) => !s.collapsedFolders.includes(node.key));
  const flagged = useStore((s) => s.flaggedFolders.includes(node.key));
  const hasChildren = node.children.length > 0;
  // Items dragged from the list land here (see lib/dragdrop).
  const dropOver = useIsDropTarget(node.key);

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
        <span className="tree-name">{node.name}</span>
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

/** A row in the Flagged section: same drop behavior as a tree row, but
 *  flat and with its own unflag control. */
function FlaggedRow({
  folder,
  selected,
  onSelect,
  onUnflag,
}: {
  folder: FlaggedFolder;
  selected: boolean;
  onSelect: () => void;
  onUnflag: () => void;
}) {
  const dropOver = useIsDropTarget(folder.key);
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
      <span className="tree-name">{folder.name}</span>
      <button
        className="tree-unflag"
        onClick={(e) => {
          e.stopPropagation();
          onUnflag();
        }}
        aria-label={`Unflag ${folder.name}`}
        title="Remove from Flagged"
      >
        <CloseIcon size={11} />
      </button>
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
  const dragging = useDragging();
  const chatCount = useStore((s) => s.chats.length);
  const flaggedKeys = useStore((s) => s.flaggedFolders);
  const toggleFlag = useStore((s) => s.toggleFlag);
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
        }`}
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
                onUnflag={() => toggleFlag(f.key)}
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
          <AskIcon size={14} />
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
