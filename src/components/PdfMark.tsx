// The PDF marker on a list row or grid caption. Outlined when the entry
// has a PDF in Zotero, filled once that PDF is downloaded to this
// device. Holding ⌘ (Ctrl elsewhere) turns every marker into a button —
// download for the outlined ones, remove for the filled — so the cache
// can be managed straight from the list, without selecting anything.
import { useEffect, useState } from "react";
import { cacheItemPdf, uncachePdf } from "../lib/notes";
import { appLog, useStore } from "../lib/store";
import { DownloadIcon, PdfIcon, Spinner, TrashIcon } from "./Icons";

const APPLE =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** How the key is named in tooltips. */
export const COMMAND_LABEL = APPLE ? "⌘" : "Ctrl";

const commandKey = (e: KeyboardEvent | PointerEvent) => (APPLE ? e.metaKey : e.ctrlKey);

/** Whether ⌘ (Ctrl off Apple platforms) is held down. Pointer moves
 *  re-read it too, so a key released while the window was in the
 *  background (⌘-Tab away) doesn't leave it stuck on. */
export function useCommandHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const read = (e: KeyboardEvent | PointerEvent) => setHeld(commandKey(e));
    const release = () => setHeld(false);
    window.addEventListener("keydown", read);
    window.addEventListener("keyup", read);
    window.addEventListener("pointermove", read);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", read);
      window.removeEventListener("keyup", read);
      window.removeEventListener("pointermove", read);
      window.removeEventListener("blur", release);
    };
  }, []);
  return held;
}

export function PdfMark({
  itemKey,
  attKey,
  hasPdf,
  commandHeld,
  size = 13,
}: {
  itemKey: string;
  /** The Zotero attachment to download; undefined for none (or one not
   *  yet synced, which can't be fetched). */
  attKey: string | undefined;
  hasPdf: boolean;
  commandHeld: boolean;
  size?: number;
}) {
  const cached = useStore((s) => (attKey ? Boolean(s.cachedPdfs[attKey]) : false));
  const downloading = useStore((s) => (attKey ? s.pdfsDownloading.includes(attKey) : false));
  if (!hasPdf && !attKey) return null;
  if (downloading) return <Spinner size={size} />;
  if (!commandHeld || !attKey) {
    return (
      <span className="pdf-mark" title={cached ? "PDF downloaded to this device" : "Has a PDF"}>
        <PdfIcon size={size} filled={cached} />
      </span>
    );
  }
  const act = async () => {
    try {
      await (cached ? uncachePdf(attKey) : cacheItemPdf(itemKey));
    } catch (e) {
      appLog("error", `${cached ? "Removing" : "Downloading"} the PDF failed: ${e}`);
    }
  };
  return (
    <button
      className={`pdf-mark-btn ${cached ? "remove" : "download"}`}
      // Neither a selection click nor the start of a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void act();
      }}
      title={cached ? "Remove the downloaded PDF from this device" : "Download the PDF to this device"}
      aria-label={cached ? "Remove downloaded PDF" : "Download PDF"}
    >
      {cached ? <TrashIcon size={size} /> : <DownloadIcon size={size} />}
    </button>
  );
}
