import { useState } from "react";
import { deleteFolder, syncNow } from "../lib/actions";
import { tidyItems } from "../lib/ai";
import { useStore } from "../lib/store";
import {
  FolderMinus,
  FolderPlus,
  GearIcon,
  ImportIcon,
  PanelLeft,
  PanelRight,
  Refresh,
  SearchIcon,
  SendIcon,
  Sparkles,
  Spinner,
  TerminalIcon,
} from "./Icons";

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

  const isRealCollection =
    selectedCollection !== "all" && selectedCollection !== "unfiled";

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
          onClick={() => tidyItems(useStore.getState().selectedKeys)}
          disabled={selectedKeys.length === 0 || tidying}
          title="Use AI to clean up metadata for the selected items"
        >
          {tidying ? <Spinner /> : <Sparkles />}
          <span className="tool-label">AI Tidy</span>
        </button>
        <button
          className="tool-btn"
          onClick={() => setModal({ kind: "sendToHush" })}
          disabled={selectedKeys.length === 0}
          title="Send the selected items' PDFs to the Hush writing app"
        >
          <SendIcon />
          <span className="tool-label">Send to Hush</span>
        </button>
        <button
          className="tool-btn"
          onClick={() => syncNow(false)}
          disabled={syncing}
          title="Re-sync with your Zotero library"
        >
          {syncing ? <Spinner /> : <Refresh />}
          <span className="tool-label">
            {syncing && syncProgress
              ? `${syncProgress.phase} ${syncProgress.done}/${syncProgress.total}`
              : "Sync"}
          </span>
        </button>
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
