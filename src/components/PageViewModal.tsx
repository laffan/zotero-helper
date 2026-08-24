// The page behind a citation, rendered in the app.
//
// The point is verification: an answer says something happens on page 7,
// and this is page 7. It fetches the PDF from Zotero, rasterizes the one
// page, and shows it — fit to the dialog by default, and at full size on
// a click, because the reason you opened it is to read the small print.
import { useEffect, useRef, useState } from "react";
import { openInZotero } from "../lib/actions";
import { itemTitle, pdfAttachmentOf } from "../lib/collections";
import { appLog, useStore } from "../lib/store";
import { invoke } from "../lib/tauri";
import type { QuoteReport } from "../lib/pdfPage";
import { ExternalIcon, Spinner } from "./Icons";
import { Modal } from "./Modal";

/** Big enough to read a dense two-column page at full size. */
const PAGE_LONG_EDGE = 2200;

/** Narrate a passage search into the activity log. A highlight that
 *  doesn't appear is otherwise a dead end for the person looking at it:
 *  this says whether the words were nowhere in the document, whether
 *  the pages have any text to search, and whether the sweep even
 *  reached the far end of a long PDF. */
function logSearch(report: QuoteReport, file: string): void {
  const where = `${report.quoteWords}-word passage in ${file} (${report.pages} pages, cited p.${report.citedPage})`;
  if (report.foundPage !== null) {
    appLog(
      "info",
      `Highlight: found ${report.exact ? "the whole" : `${report.matchedWords} words of the`} ${where} on page ${report.foundPage}, after ${report.scanned} page(s)`,
    );
    return;
  }
  const why = report.textError
    ? `the text layer could not be read — ${report.textError}`
    : report.textWords === 0
      ? "no text layer on any page searched — these pages are images"
      : report.truncated
        ? `swept ${report.scanned} of ${report.pages} pages before the cap`
        : `best run anywhere was ${report.bestRun} word(s)${
            report.bestRunPage ? ` on page ${report.bestRunPage}` : ""
          }`;
  appLog("warn", `Highlight: no match for the ${where} — ${why}`);
}

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
  const [searching, setSearching] = useState(false);
  const [shown, setShown] = useState(page);
  const [pages, setPages] = useState(0);
  const [found, setFound] = useState(true);
  const [focusY, setFocusY] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
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
    setSearching(Boolean(quote?.trim()));
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
        setFocusY(out.found ? out.focusY : 0);
        setSearching(false);
        if (out.report) logSearch(out.report, att.data?.filename || att.key);
      } catch (e) {
        if (stale) return;
        appLog("warn", `Could not render page ${page}: ${e}`);
        setError(String(e));
        setSearching(false);
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
            {shown !== page &&
              pages > 0 &&
              (found
                ? ` — the passage is here, not on the cited page ${page}`
                : " — the citation was past the end")}
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
                    `Could not find “${quote}” anywhere in this PDF — see the activity log for why.`}
            </span>
          )}
        </div>

        <div
          className={`page-view-stage ${actualSize ? "actual" : "fit"}`}
          ref={stageRef}
        >
          {error && <div className="error-msg">{error}</div>}
          {!error && !url && (
            <div className="page-view-loading">
              <Spinner size={14} />{" "}
              {searching ? "finding the passage…" : "rendering…"}
            </div>
          )}
          {url && (
            <img
              src={url}
              alt={`Page ${shown} of ${name}`}
              // Bring the passage into view once the image has a
              // height to measure, leaving a little of the page above
              // it for context.
              onLoad={(e) => {
                const stage = stageRef.current;
                if (!stage || focusY <= 0) return;
                const h = e.currentTarget.clientHeight;
                stage.scrollTop = Math.max(
                  0,
                  h * focusY - stage.clientHeight * 0.3,
                );
              }}
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
