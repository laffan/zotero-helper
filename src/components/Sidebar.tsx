import { useMemo } from "react";
import {
  buildTree,
  collectionPaths,
  type CollectionNode,
} from "../lib/collections";
import { useStore } from "../lib/store";
import {
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

  return (
    <>
      <div
        className={`tree-row ${selectedCollection === node.key ? "selected" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => selectCollection(node.key)}
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

export function Sidebar() {
  const collections = useStore((s) => s.library.collections);
  const itemCount = useStore(
    (s) => s.library.items.filter((i) => !i.data?.parentItem).length,
  );
  const { selectedCollection, selectCollection, sidebarOpen, setSidebarOpen } =
    useStore();
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
      <nav className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        {flagged.length > 0 && (
          <>
            <div className="sidebar-section">Flagged</div>
            {flagged.map((f) => (
              <div
                key={f.key}
                className={`tree-row ${selectedCollection === f.key ? "selected" : ""}`}
                style={{ paddingLeft: 10 }}
                onClick={() => selectCollection(f.key)}
                title={f.path}
              >
                <span className="tree-toggle-spacer" />
                <FlagIcon size={14} filled />
                <span className="tree-name">{f.name}</span>
                <button
                  className="tree-unflag"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFlag(f.key);
                  }}
                  aria-label={`Unflag ${f.name}`}
                  title="Remove from Flagged"
                >
                  <CloseIcon size={11} />
                </button>
              </div>
            ))}
          </>
        )}
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
