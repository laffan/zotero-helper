// The toolbar's Share and Sync menus. With the library showing they act
// on the selection and the library; with a PDF open they act on that
// PDF's entry alone, since nothing else is on screen.
import { syncFolder, syncNow, syncReadingEntry } from "../lib/actions";
import { itemTitle, pdfAttachmentOf, REAL_KEY } from "../lib/collections";
import { cachePdf, cachedPdfIsStale } from "../lib/notes";
import { shareAbstracts, sharePdfs } from "../lib/share";
import { appLog, useStore, type ReadingState } from "../lib/store";
import { Refresh, ShareIcon, Spinner } from "./Icons";
import { ToolbarMenu, useDropdown } from "./ToolbarMenu";

export function ShareMenuButton({ reading }: { reading: ReadingState | null }) {
  const { open, setOpen, ref } = useDropdown();
  const selectedKeys = useStore((s) => s.selectedKeys);
  const setModal = useStore((s) => s.setModal);
  const keys = () => (reading ? [reading.itemKey] : useStore.getState().selectedKeys);
  const disabled = !reading && selectedKeys.length === 0;

  /** Runs a share action with the Share button's viewport position —
   *  the iPad share sheet is a popover and points its arrow there. */
  const run = (action: (keys: string[], anchor: { x: number; y: number }) => Promise<void>) => {
    setOpen(false);
    const r = ref.current?.getBoundingClientRect();
    const anchor = r ? { x: r.left + r.width / 2, y: r.bottom } : { x: window.innerWidth / 2, y: 60 };
    void action(keys(), anchor);
  };

  return (
    <div className="filter-anchor" ref={ref}>
      <button
        className="tool-btn"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        title={reading ? "Share this PDF" : "Share the selected items"}
      >
        <ShareIcon />
        <span className="tool-label">Share ▾</span>
      </button>
      {open && (
        <ToolbarMenu anchorRef={ref}>
          <button className="menu-item" onClick={() => run(sharePdfs)}>
            <strong>{reading ? "Share PDF" : "Share PDFs"}</strong>
            <span>{reading ? "Share this PDF" : "Download the selected items’ PDFs and share them"}</span>
          </button>
          <button className="menu-item" onClick={() => run(shareAbstracts)}>
            <strong>{reading ? "Share abstract" : "Share abstracts"}</strong>
            <span>Title (linked to Zotero) + abstract as Markdown</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              // The Hush picker sends the selection; while reading,
              // that is the open entry.
              if (reading) useStore.getState().setSelectedKeys([reading.itemKey]);
              setModal({ kind: "sendToHush" });
            }}
          >
            <strong>Send to Hush</strong>
            <span>Hush downloads the {reading ? "PDF" : "PDFs"} itself into a desk or project</span>
          </button>
        </ToolbarMenu>
      )}
    </div>
  );
}

export function SyncMenuButton({ reading }: { reading: ReadingState | null }) {
  const { open, setOpen, ref } = useDropdown();
  const syncing = useStore((s) => s.syncing);
  const syncProgress = useStore((s) => s.syncProgress);
  const selectedCollection = useStore((s) => s.selectedCollection);
  const collections = useStore((s) => s.library.collections);
  const items = useStore((s) => s.library.items);
  const cachedPdfs = useStore((s) => s.cachedPdfs);
  const pdfsDownloading = useStore((s) => s.pdfsDownloading);

  const isRealCollection = REAL_KEY.test(selectedCollection);
  const folderName = collections.find((c) => c.key === selectedCollection)?.data?.name;

  const run = (action: () => Promise<void>) => {
    setOpen(false);
    void action();
  };

  const att = reading ? pdfAttachmentOf(items, reading.itemKey) : undefined;
  const stale = att ? cachedPdfIsStale(att, cachedPdfs[att.key]) : false;
  const redownload = async () => {
    const item = items.find((i) => i.key === reading?.itemKey);
    if (!att || !item) return;
    try {
      await cachePdf(att, item.key, itemTitle(item));
    } catch (e) {
      appLog("error", `Downloading the PDF failed: ${e}`);
    }
  };

  const busy = syncing || Boolean(att && pdfsDownloading.includes(att.key));
  return (
    <div className="filter-anchor" ref={ref}>
      <button
        className="tool-btn"
        onClick={() => setOpen(!open)}
        disabled={busy}
        title={reading ? "Sync this PDF" : "Sync options"}
      >
        {busy ? <Spinner /> : <Refresh />}
        <span className="tool-label">
          {syncing && syncProgress
            ? `${syncProgress.phase} ${syncProgress.done}/${syncProgress.total}`
            : "Sync ▾"}
        </span>
      </button>
      {open && reading && (
        <ToolbarMenu anchorRef={ref}>
          <button className="menu-item" onClick={() => run(() => syncReadingEntry(reading.itemKey))}>
            <strong>Sync highlights &amp; notes</strong>
            <span>Fetch new highlights from Zotero and push these notes</span>
          </button>
          <button className="menu-item" disabled={!att} onClick={() => run(redownload)}>
            <strong>Download the PDF again</strong>
            <span>
              {stale
                ? "Zotero has a newer copy than this device"
                : "Replace this device’s copy with Zotero’s"}
            </span>
          </button>
        </ToolbarMenu>
      )}
      {open && !reading && (
        <ToolbarMenu anchorRef={ref}>
          <button
            className="menu-item"
            disabled={!isRealCollection}
            onClick={() => run(() => syncFolder(selectedCollection))}
          >
            <strong>Sync this folder</strong>
            <span>
              {isRealCollection ? `Fetch changes for “${folderName}” only` : "Select a folder first"}
            </span>
          </button>
          <button className="menu-item" onClick={() => run(() => syncNow(false))}>
            <strong>Sync all changes</strong>
            <span>Incremental — everything changed since last sync</span>
          </button>
          <button className="menu-item" onClick={() => run(() => syncNow(true))}>
            <strong>Full refresh</strong>
            <span>Re-download the entire library (slow)</span>
          </button>
        </ToolbarMenu>
      )}
    </div>
  );
}
