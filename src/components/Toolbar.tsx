import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteFolder, syncFolder, syncNow } from "../lib/actions";
import { getAbstracts, tidyItems } from "../lib/ai";
import { startPdfFetch } from "../lib/importer";
import { useStore } from "../lib/store";
import {
  FolderMinus,
  FolderPlus,
  GearIcon,
  ImportIcon,
  PanelLeft,
  PanelRight,
  PdfIcon,
  Refresh,
  SearchIcon,
  SendIcon,
  Sparkles,
  Spinner,
  TerminalIcon,
} from "./Icons";

/** Toolbar dropdowns render into document.body: the toolbar scrolls
 *  horizontally (`overflow-x: auto`), and any overflow value clips
 *  absolutely-positioned children — the menu would vanish under the
 *  item list. Fixed positioning from the anchor's rect escapes that. */
function ToolbarMenu({
  anchorRef,
  children,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const r = anchorRef.current?.getBoundingClientRect();
  if (!r) return null;
  const width = 250;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  return createPortal(
    <div
      className="filter-pop sync-menu"
      style={{ position: "fixed", top: r.bottom + 4, left, right: "auto" }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function Toolbar() {
  const {
    selectedCollection,
    selectedKeys,
    searchQuery,
    setSearchQuery,
    syncing,
    tidying,
    logOpen,
    setLogOpen,
    setModal,
    setView,
    sidebarOpen,
    setSidebarOpen,
    metaOpen,
    setMetaOpen,
    syncProgress,
  } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const syncMenuRef = useRef<HTMLDivElement>(null);
  const aiMenuRef = useRef<HTMLDivElement>(null);
  const collections = useStore((s) => s.library.collections);

  const isRealCollection =
    selectedCollection !== "all" && selectedCollection !== "unfiled";
  const currentFolderName = isRealCollection
    ? collections.find((c) => c.key === selectedCollection)?.data?.name
    : undefined;

  useEffect(() => {
    if (!syncMenuOpen && !aiMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      // The menus are portaled to document.body — a mousedown inside one
      // must not close it before the item's click handler fires.
      if ((e.target as Element).closest?.(".filter-pop")) return;
      if (syncMenuRef.current && !syncMenuRef.current.contains(e.target as Node)) {
        setSyncMenuOpen(false);
      }
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) {
        setAiMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [syncMenuOpen, aiMenuOpen]);

  const runAi = (action: () => Promise<void>) => {
    setAiMenuOpen(false);
    void action();
  };

  const runSync = (action: () => Promise<void>) => {
    setSyncMenuOpen(false);
    void action();
  };

  const onDeleteFolder = async () => {
    if (!isRealCollection) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    setConfirmDelete(false);
    try {
      await deleteFolder(selectedCollection);
    } catch (e) {
      useStore.getState().pushLog({
        level: "error",
        message: `Delete failed: ${e}`,
        ts: Date.now(),
      });
    }
  };

  return (
    <header className="toolbar">
      <button
        className="icon-btn narrow-only"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title="Collections"
        aria-label="Toggle collections"
      >
        <PanelLeft />
      </button>

      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={() => setModal({ kind: "newFolder" })}
          title="New folder"
        >
          <FolderPlus />
          <span className="tool-label">New Folder</span>
        </button>
        <button
          className={`tool-btn ${confirmDelete ? "danger" : ""}`}
          onClick={onDeleteFolder}
          disabled={!isRealCollection}
          title={confirmDelete ? "Click again to confirm" : "Delete selected folder"}
        >
          <FolderMinus />
          <span className="tool-label">
            {confirmDelete ? "Confirm?" : "Delete Folder"}
          </span>
        </button>
        <span className="toolbar-sep" />
        <button
          className="tool-btn accent"
          onClick={() => setModal({ kind: "import" })}
          title="Import DOIs / ISBNs / arXiv IDs / URLs with PDFs"
        >
          <ImportIcon />
          <span className="tool-label">Import IDs</span>
        </button>
        <button
          className="tool-btn"
          onClick={() => startPdfFetch(useStore.getState().selectedKeys)}
          disabled={selectedKeys.length === 0}
          title="Find and attach PDFs for the selected existing entries (discovers missing DOIs first)"
        >
          <PdfIcon />
          <span className="tool-label">Fetch PDFs</span>
        </button>
        <div className="filter-anchor" ref={aiMenuRef}>
          <button
            className="tool-btn"
            onClick={() => setAiMenuOpen(!aiMenuOpen)}
            disabled={selectedKeys.length === 0 || tidying}
            title="AI actions for the selected items"
          >
            {tidying ? <Spinner /> : <Sparkles />}
            <span className="tool-label">AI ▾</span>
          </button>
          {aiMenuOpen && (
            <ToolbarMenu anchorRef={aiMenuRef}>
              <button
                className="menu-item"
                onClick={() =>
                  runAi(() => getAbstracts(useStore.getState().selectedKeys))
                }
              >
                <strong>Get abstract</strong>
                <span>
                  Read it out of the PDF's first pages (items without one)
                </span>
              </button>
              <button
                className="menu-item"
                onClick={() =>
                  runAi(() => tidyItems(useStore.getState().selectedKeys))
                }
              >
                <strong>Tidy metadata</strong>
                <span>Clean up all fields against CrossRef</span>
              </button>
            </ToolbarMenu>
          )}
        </div>
        <button
          className="tool-btn"
          onClick={() => setModal({ kind: "sendToHush" })}
          disabled={selectedKeys.length === 0}
          title="Send the selected items' PDFs to the Hush writing app"
        >
          <SendIcon />
          <span className="tool-label">Send to Hush</span>
        </button>
        <div className="filter-anchor" ref={syncMenuRef}>
          <button
            className="tool-btn"
            onClick={() => setSyncMenuOpen(!syncMenuOpen)}
            disabled={syncing}
            title="Sync options"
          >
            {syncing ? <Spinner /> : <Refresh />}
            <span className="tool-label">
              {syncing && syncProgress
                ? `${syncProgress.phase} ${syncProgress.done}/${syncProgress.total}`
                : "Sync ▾"}
            </span>
          </button>
          {syncMenuOpen && (
            <ToolbarMenu anchorRef={syncMenuRef}>
              <button
                className="menu-item"
                disabled={!isRealCollection}
                onClick={() => runSync(() => syncFolder(selectedCollection))}
              >
                <strong>Sync this folder</strong>
                <span>
                  {isRealCollection
                    ? `Fetch changes for “${currentFolderName}” only`
                    : "Select a folder first"}
                </span>
              </button>
              <button
                className="menu-item"
                onClick={() => runSync(() => syncNow(false))}
              >
                <strong>Sync all changes</strong>
                <span>Incremental — everything changed since last sync</span>
              </button>
              <button
                className="menu-item"
                onClick={() => runSync(() => syncNow(true))}
              >
                <strong>Full refresh</strong>
                <span>Re-download the entire library (slow)</span>
              </button>
            </ToolbarMenu>
          )}
        </div>
      </div>

      <div className="toolbar-search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search everything…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search library"
        />
      </div>

      <div className="toolbar-group">
        <button
          className={`icon-btn ${logOpen ? "active" : ""}`}
          onClick={() => setLogOpen(!logOpen)}
          title="Activity log"
          aria-label="Toggle activity log"
        >
          <TerminalIcon />
        </button>
        <button
          className="icon-btn"
          onClick={() => setView("settings")}
          title="Settings"
          aria-label="Settings"
        >
          <GearIcon />
        </button>
        <button
          className="icon-btn narrow-only"
          onClick={() => setMetaOpen(!metaOpen)}
          title="Details"
          aria-label="Toggle details panel"
        >
          <PanelRight />
        </button>
      </div>
    </header>
  );
}
