import { useMemo, useState } from "react";
import { buildTree, type CollectionNode } from "../lib/collections";
import { useStore } from "../lib/store";
import { ChevronDown, ChevronRight, Folder } from "./Icons";

function Node({ node, depth }: { node: CollectionNode; depth: number }) {
  const { selectedCollection, selectCollection } = useStore();
  const [open, setOpen] = useState(true);
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
              setOpen(!open);
            }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="tree-toggle-spacer" />
        )}
        <Folder size={14} />
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
  const tree = useMemo(() => buildTree(collections), [collections]);

  return (
    <>
      {sidebarOpen && (
        <div className="drawer-scrim" onClick={() => setSidebarOpen(false)} />
      )}
      <nav className={`sidebar ${sidebarOpen ? "open" : ""}`}>
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
