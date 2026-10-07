// Settings → Storage: what this app keeps on the device. Highlights and
// downloaded PDFs both take room, so the library cache (its size, what
// it holds, when it was last refreshed) and the PDF cache are reported
// separately, and the PDF cache can be emptied or trimmed one file at a
// time. Thumbnails can be cleared too; notes are listed but not
// clearable here, since they may hold words not yet pushed to Zotero.
import { useCallback, useEffect, useMemo, useState } from "react";
import { refreshCachedPdfs } from "../lib/notes";
import { forgetThumbnails } from "../lib/thumbnails";
import { appLog, useStore } from "../lib/store";
import { invoke } from "../lib/tauri";
import type { StorageReport } from "../lib/types";
import { Spinner, TrashIcon } from "./Icons";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function when(ms: number): string {
  return ms ? new Date(ms).toLocaleString() : "never";
}

export function StorageSettings() {
  const library = useStore((s) => s.library);
  const cachedPdfs = useStore((s) => s.cachedPdfs);
  const [report, setReport] = useState<StorageReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setReport(await invoke<StorageReport>("storage_report"));
      await refreshCachedPdfs();
    } catch (e) {
      appLog("debug", `Storage report unavailable: ${e}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const c = { entries: 0, attachments: 0, annotations: 0, notes: 0 };
    for (const i of library.items) {
      const t = i.data?.itemType;
      if (t === "annotation") c.annotations++;
      else if (t === "attachment") c.attachments++;
      else if (t === "note") c.notes++;
      else c.entries++;
    }
    return c;
  }, [library.items]);

  const pdfs = Object.values(cachedPdfs).sort((a, b) => b.savedMs - a.savedMs);

  const run = async (label: string, cmd: string, args?: Record<string, unknown>) => {
    setBusy(label);
    try {
      await invoke(cmd, args);
      if (cmd === "clear_thumbnails") forgetThumbnails();
    } catch (e) {
      appLog("error", `${label} failed: ${e}`);
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  return (
    <>
      <h2>Storage on this device</h2>
      <div className="storage-block">
        <div className="storage-line">
          <strong>Zotero library cache</strong>
          <span>{report ? formatBytes(report.library.bytes) : "…"}</span>
        </div>
        <div className="storage-detail">
          {library.items.length.toLocaleString()} items —{" "}
          {counts.entries.toLocaleString()} entries,{" "}
          {counts.attachments.toLocaleString()} attachments,{" "}
          {counts.annotations.toLocaleString()} highlights &amp; annotations,{" "}
          {counts.notes.toLocaleString()} Zotero notes; {library.collections.length.toLocaleString()} folders
        </div>
        <div className="storage-detail">
          Last updated {when(library.lastSyncMs)}
          {library.version ? ` (library version ${library.version})` : ""}
        </div>
      </div>

      <div className="storage-block">
        <div className="storage-line">
          <strong>Downloaded PDFs</strong>
          <span>
            {report ? `${formatBytes(report.pdfs.bytes)} · ${report.pdfs.files} file${report.pdfs.files === 1 ? "" : "s"}` : "…"}
          </span>
          <button
            className="mini-btn"
            disabled={!pdfs.length || busy !== null}
            onClick={() => void run("Clearing the PDF cache", "clear_pdf_cache")}
          >
            {busy === "Clearing the PDF cache" ? <Spinner size={11} /> : "Clear all"}
          </button>
        </div>
        <div className="storage-detail">
          Kept to read beside your notes, and used instead of the network wherever a PDF
          is read while it is here. Removing one only frees space — Zotero
          still has it.
        </div>
        {pdfs.length > 0 && (
          <ul className="storage-list">
            {pdfs.map((p) => (
              <li key={p.attKey}>
                <span className="storage-name" title={p.filename}>
                  {p.title || p.filename}
                </span>
                <span className="storage-meta">
                  {formatBytes(p.size)} · {new Date(p.savedMs).toLocaleDateString()}
                </span>
                <button
                  className="icon-btn"
                  disabled={busy !== null}
                  onClick={() => void run("Removing a PDF", "remove_cached_pdf", { attKey: p.attKey })}
                  title="Remove this PDF from the device"
                  aria-label={`Remove ${p.title || p.filename}`}
                >
                  <TrashIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="storage-block">
        <div className="storage-line">
          <strong>Thumbnails</strong>
          <span>{report ? `${formatBytes(report.thumbnails.bytes)} · ${report.thumbnails.files}` : "…"}</span>
          <button
            className="mini-btn"
            disabled={!report?.thumbnails.files || busy !== null}
            onClick={() => void run("Clearing thumbnails", "clear_thumbnails")}
          >
            {busy === "Clearing thumbnails" ? <Spinner size={11} /> : "Clear"}
          </button>
        </div>
        <div className="storage-line">
          <strong>Reading notes</strong>
          <span>{report ? `${formatBytes(report.notes.bytes)} · ${report.notes.files}` : "…"}</span>
        </div>
      </div>
    </>
  );
}
