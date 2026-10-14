import { useMemo, useState } from "react";
import { deleteFolder } from "../lib/actions";
import { getAbstracts, tidyItems } from "../lib/ai";
import { startAsk } from "../lib/ai/chat";
import { askTargetFor } from "../lib/ai/context";
import { REAL_KEY } from "../lib/collections";
import { startPdfFetch } from "../lib/importer";
import { closeReader } from "../lib/notes";
import { useOutline } from "../lib/outline";
import { toggleMeta, toggleSidebar } from "../lib/panels";
import { shortcutHint } from "../lib/shortcuts/bindings";
import { QUESTIONS, useStore } from "../lib/store";
import {
  ArrowLeftIcon,
  FolderMinus,
  FolderPlus,
  GearIcon,
  ImportIcon,
  PanelLeft,
  PanelRight,
  PdfIcon,
  Sparkles,
  Spinner,
  TerminalIcon,
} from "./Icons";
import { SearchBox } from "./SearchBox";
import { ReadingTitle } from "./RecentPdfs";
import { ToolbarMenu, useDropdown } from "./ToolbarMenu";
import { ShareMenuButton, SyncMenuButton } from "./ToolbarShareSync";

/** Folder controls are icon-only, so their glyphs carry the whole
 *  meaning and are drawn a touch larger than the labelled buttons'. */
const FOLDER_ICON = 20;

/** The open PDF's entry, named where the library's buttons would be. */
export function Toolbar() {
  const {
    selectedCollection,
    selectedKeys,
    tidying,
    logOpen,
    setLogOpen,
    setModal,
    setView,
    sidebarHidden,
    metaHidden,
  } = useStore();
  const reading = useStore((s) => s.reading);
  const hasOutline = Boolean(useOutline(reading?.attKey)?.length);
  const outlineOpen = useStore((s) => s.outlineOpen);
  const setOutlineOpen = useStore((s) => s.setOutlineOpen);
  const items = useStore((s) => s.library.items);
  const askPreparing = useStore((s) => s.askPreparing);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const aiMenu = useDropdown();
  const collections = useStore((s) => s.library.collections);

  // What the two Ask entries point at: the selection when there is one,
  // the open folder when there isn't. Named in the menu so it's obvious
  // what a click is about to send.
  const askTarget = useMemo(
    () => askTargetFor(items, collections, selectedCollection, selectedKeys),
    [items, collections, selectedCollection, selectedKeys],
  );
  const ASK_CONTEXT = {
    folder: "Folder",
    selection: "Selection",
    item: "Item",
  } as const;
  // Questions is a folder of conversations, not of works.
  const canAsk =
    selectedCollection !== QUESTIONS && askTarget.count > 0 && !askPreparing;

  // All Items, Unfiled, Questions and Recent are views, not folders.
  const isRealCollection = REAL_KEY.test(selectedCollection);
  const currentFolderName = isRealCollection
    ? collections.find((c) => c.key === selectedCollection)?.data?.name
    : undefined;

  const runAi = (action: () => Promise<void>) => {
    aiMenu.setOpen(false);
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
      {!reading && (
        <button
          className="icon-btn"
          onClick={toggleSidebar}
          title={`${sidebarHidden ? "Show the collections" : "Hide the collections"}${shortcutHint("toggleLeft")}`}
          aria-label="Toggle collections"
        >
          <PanelLeft />
        </button>
      )}

      {reading ? (
        // Nothing but the open PDF is on screen, so only what acts on it
        // stays: the way back to the library, its outline (when it has
        // one), its name, and Share and Sync, scoped to its entry.
        <div className="toolbar-group toolbar-reading">
          <button
            className="icon-btn"
            onClick={closeReader}
            title="Close the PDF and bring back the library"
            aria-label="Close the PDF"
          >
            <ArrowLeftIcon />
          </button>
          <span className="toolbar-sep" />
          {hasOutline && (
            <button
              className={`icon-btn ${outlineOpen ? "active" : ""}`}
              onClick={() => setOutlineOpen(!outlineOpen)}
              title={`${outlineOpen ? "Hide the outline" : "Show the PDF's outline"}${shortcutHint("toggleLeft")}`}
              aria-label="Toggle outline"
              aria-pressed={outlineOpen}
            >
              <PanelLeft />
            </button>
          )}
          <ReadingTitle itemKey={reading.itemKey} />
          <span className="toolbar-sep" />
          <ShareMenuButton reading={reading} />
          <SyncMenuButton reading={reading} />
        </div>
      ) : (
      <div className="toolbar-group">
        <button
          className="tool-btn icon-only"
          onClick={() => setModal({ kind: "newFolder" })}
          title="New folder"
          aria-label="New folder"
        >
          <FolderPlus size={FOLDER_ICON} />
        </button>
        <button
          className={`tool-btn icon-only ${confirmDelete ? "danger" : ""}`}
          onClick={onDeleteFolder}
          disabled={!isRealCollection}
          title={
            confirmDelete
              ? "Click again to confirm"
              : currentFolderName
                ? `Delete the folder “${currentFolderName}”`
                : "Delete selected folder"
          }
          aria-label="Delete folder"
        >
          <FolderMinus size={FOLDER_ICON} />
        </button>
        <span className="toolbar-sep" />
        <button
          className="tool-btn"
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
        <div className="filter-anchor" ref={aiMenu.ref}>
          <button
            className="tool-btn"
            onClick={() => aiMenu.setOpen(!aiMenu.open)}
            disabled={tidying || askPreparing}
            title="AI actions"
          >
            {tidying || askPreparing ? <Spinner /> : <Sparkles />}
            <span className="tool-label">AI ▾</span>
          </button>
          {aiMenu.open && (
            <ToolbarMenu anchorRef={aiMenu.ref}>
              <button
                className="menu-item"
                disabled={selectedKeys.length === 0}
                onClick={() =>
                  runAi(() => getAbstracts(useStore.getState().selectedKeys))
                }
              >
                <strong>Get abstract</strong>
                <span>
                  {selectedKeys.length === 0
                    ? "Select an item first"
                    : "Read it out of the PDF's first pages (items without one)"}
                </span>
              </button>
              <button
                className="menu-item"
                disabled={selectedKeys.length === 0}
                onClick={() =>
                  runAi(() => tidyItems(useStore.getState().selectedKeys))
                }
              >
                <strong>Tidy metadata</strong>
                <span>
                  {selectedKeys.length === 0
                    ? "Select an item first"
                    : "Clean up all fields against CrossRef"}
                </span>
              </button>
              <span className="menu-sep" />
              <button
                className="menu-item"
                disabled={!canAsk}
                onClick={() => runAi(() => startAsk(askTarget, "abstracts"))}
              >
                <strong>Ask Abstracts ({ASK_CONTEXT[askTarget.kind]})</strong>
                <span>
                  {canAsk
                    ? `Chat about the abstracts of ${askTarget.label}`
                    : "Nothing here to ask about"}
                </span>
              </button>
              <button
                className="menu-item"
                disabled={!canAsk}
                onClick={() => runAi(() => startAsk(askTarget, "full"))}
              >
                <strong>Ask Full Papers ({ASK_CONTEXT[askTarget.kind]})</strong>
                <span>
                  {canAsk
                    ? `Read the PDFs of ${askTarget.label} and chat about them`
                    : "Nothing here to ask about"}
                </span>
              </button>
            </ToolbarMenu>
          )}
        </div>
        <ShareMenuButton reading={null} />
        <SyncMenuButton reading={null} />
      </div>
      )}

      <SearchBox />

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
          className="icon-btn"
          onClick={toggleMeta}
          title={
            (metaHidden
              ? reading ? "Show the notes" : "Show the details panel"
              : reading ? "Hide the notes" : "Hide the details panel") + shortcutHint("toggleRight")
          }
          aria-label="Toggle details panel"
        >
          <PanelRight />
        </button>
      </div>
    </header>
  );
}
