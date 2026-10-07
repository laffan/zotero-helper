// The right end of the details tab bar: the selected entry's PDF.
//   not on this device → Download PDF
//   on this device     → View PDF (the viewer takes the sidebar's and
//                        item list's room; the notes stay on the right)
//   open               → Close PDF
// A copy older than the one in Zotero offers itself for re-download.
import { itemTitle, pdfAttachmentOf } from "../lib/collections";
import { cachePdf, cachedPdfIsStale, pushDirtyNotes } from "../lib/notes";
import { appLog, useStore } from "../lib/store";
import type { ZItem } from "../lib/types";
import { PdfIcon, Refresh, Spinner } from "./Icons";

export function PdfTabButton({ item }: { item: ZItem }) {
  const items = useStore((s) => s.library.items);
  const cachedPdfs = useStore((s) => s.cachedPdfs);
  const reading = useStore((s) => s.reading);
  const setReading = useStore((s) => s.setReading);
  const pdfsDownloading = useStore((s) => s.pdfsDownloading);

  const att = pdfAttachmentOf(items, item.key);
  if (!att) return null;
  const downloading = pdfsDownloading.includes(att.key);
  const cached = cachedPdfs[att.key];
  const open = reading?.itemKey === item.key;

  const download = async () => {
    try {
      await cachePdf(att, item.key, itemTitle(item));
    } catch (e) {
      appLog("error", `Downloading the PDF failed: ${e}`);
    }
  };

  if (downloading) {
    return (
      <button className="meta-tab-action" disabled>
        <Spinner size={11} /> Downloading…
      </button>
    );
  }
  if (open) {
    return (
      <button
        className="meta-tab-action active"
        onClick={() => {
          setReading(null);
          void pushDirtyNotes();
        }}
        title="Close the PDF and bring back the library"
      >
        Close PDF
      </button>
    );
  }
  if (!cached) {
    return (
      <button className="meta-tab-action" onClick={() => void download()} title="Keep a copy on this device to read beside the notes">
        <PdfIcon size={12} /> Download PDF
      </button>
    );
  }
  return (
    <span className="meta-tab-actions">
      {cachedPdfIsStale(att, cached) && (
        <button
          className="meta-tab-action icon"
          onClick={() => void download()}
          title="Zotero has a newer copy of this PDF — download it again"
          aria-label="Download the newer PDF"
        >
          <Refresh size={12} />
        </button>
      )}
      <button
        className="meta-tab-action"
        onClick={() => setReading({ itemKey: item.key, attKey: att.key })}
        title="Read the PDF beside the notes"
      >
        <PdfIcon size={12} /> View PDF
      </button>
    </span>
  );
}
