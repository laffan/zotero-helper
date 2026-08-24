// The page behind a citation, rendered in the app.
//
// The point is verification: an answer says something happens on page 7,
// and this is page 7. It fetches the PDF from Zotero, rasterizes the one
// page, and shows it — fit to the dialog by default, and at full size on
// a click, because the reason you opened it is to read the small print.
import { useEffect, useState } from "react";
import { openInZotero } from "../lib/actions";
import { itemTitle, pdfAttachmentOf } from "../lib/collections";
import { appLog, useStore } from "../lib/store";
import { invoke } from "../lib/tauri";
import { ExternalIcon, Spinner } from "./Icons";
import { Modal } from "./Modal";

/** Big enough to read a dense two-column page at full size. */
const PAGE_LONG_EDGE = 2200;

interface PageViewProps {
  itemKey: string;
  page: number;
  title: string;
  /** Passage to highlight, when the citation named one. */
  quote?: string;
  onClose: () => void;
}

export function PageViewModal({
  itemKey,
  page,
  title,
  quote,
  onClose,
}: PageViewProps) {
  const items = useStore((s) => s.library.items);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(page);
  const [pages, setPages] = useState(0);
  const [found, setFound] = useState(true);
  const [actualSize, setActualSize] = useState(false);

  const att = pdfAttachmentOf(items, itemKey);
  const item = items.find((i) => i.key === itemKey);
  const name = title || (item ? itemTitle(item) : itemKey);

  useEffect(() => {
    if (!att) {
      setError("That work has no PDF in Zotero any more.");
      return;
    }
    let stale = false;
    setUrl(null);
    setError(null);
    (async () => {
      try {
        const [{ renderPageDataUrl }, bytes] = await Promise.all([
          import("../lib/pdfPage"),
          invoke<ArrayBuffer>("download_attachment_file", { attKey: att.key }),
        ]);
        const out = await renderPageDataUrl(
          bytes,
          page,
          PAGE_LONG_EDGE,
          quote ?? "",
        );
        if (stale) return;
        setUrl(out.url);
        setShown(out.rendered);
        setPages(out.pages);
        setFound(out.found);
      } catch (e) {
        if (stale) return;
        appLog("warn", `Could not render page ${page}: ${e}`);
        setError(String(e));
      }
    })();
    return () => {
      stale = true;
    };
  }, [att, page, quote]);

  return (
    <Modal title={`Page ${page}`} onClose={onClose} wide>
      <div className="page-view">
        <div className="page-view-head">
          <span className="page-view-title" title={name}>
            {name}
          </span>
          <span className="page-view-sub">
            {pages > 0 ? `Page ${shown} of ${pages}` : `Page ${page}`}
            {shown !== page && pages > 0 && " — the citation was past the end"}
          </span>
          {quote && (
            <span
              className={`page-view-quote ${found || !url ? "" : "missed"}`}
              title={quote}
            >
              {!url
                ? `“${quote}”`
                : found
                  ? `Highlighted: “${quote}”`
                  : // Never pretend: an unfound passage says so rather
                    // than leaving a plain page looking checked.
                    `Could not find “${quote}” on this page — it may be
                     worded differently in the PDF, or on a scanned page.`}
            </span>
          )}
        </div>

        <div className={`page-view-stage ${actualSize ? "actual" : "fit"}`}>
          {error && <div className="error-msg">{error}</div>}
          {!error && !url && (
            <div className="page-view-loading">
              <Spinner size={14} /> rendering…
            </div>
          )}
          {url && (
            <img
              src={url}
              alt={`Page ${shown} of ${name}`}
              onClick={() => setActualSize(!actualSize)}
              title={actualSize ? "Click to fit" : "Click for actual size"}
            />
          )}
        </div>

        <div className="page-view-actions">
          <span className="hint">
            {actualSize ? "Click the page to fit it" : "Click the page to zoom"}
          </span>
          <button
            className="tool-btn"
            disabled={!att}
            onClick={() =>
              void openInZotero(itemKey, att?.key, undefined, shown)
            }
            title="Open this PDF in Zotero at this page"
          >
            <ExternalIcon size={13} /> Open in Zotero
          </button>
        </div>
      </div>
    </Modal>
  );
}
