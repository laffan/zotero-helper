// The PDF beside the notes: the viewer that takes over the sidebar and
// item list while notes are written in the right panel.
//
// The viewer itself is plain DOM (src/pdfviewer/, a port of Hush's), so
// this component only mounts it, feeds it the cached PDF and the
// entry's Zotero annotations, and routes what it hands back: a selected
// passage or a highlight into the notes, a page's bookmark to
// lib/bookmarks.ts, new or edited highlights to Zotero
// (lib/annotationEdits.ts), and a passage to explain to the AI
// (lib/ai/explain.ts, shown in ExplainChat).
import { useEffect, useRef, useState } from "react";
import { openInZotero } from "../lib/actions";
import { startExplain } from "../lib/ai/explain";
import { lookUp } from "../lib/ai/lookup";
import { aiConnected } from "../lib/ai/models";
import {
  canEditAnnotation,
  createAnnotation,
  deleteAnnotation,
  newItemKey,
  notePenActivity,
  updateAnnotation,
} from "../lib/annotationEdits";
import {
  annotationIndexFor,
  annotationMarkdown,
  pdfLink,
  type Annotation,
} from "../lib/highlights";
import { addBookmark, bookmarksOf, removeBookmark, renameBookmark, useBookmarks } from "../lib/bookmarks";
import { insertIntoNotes, readItem } from "../lib/notes";
import { setOutline, setReaderPage, useOutline } from "../lib/outline";
import { flushSavedPage, lastPage, lastView, savePage } from "../lib/recent";
import { appLog, useStore, type MetaTab } from "../lib/store";
import { invoke } from "../lib/tauri";
import { useWords } from "../lib/words";
import type { ViewerCommand } from "../pdfviewer/commands";
import type { SearchOptions, SearchStatus } from "../pdfviewer/search";
import type { PdfViewer } from "../pdfviewer/viewer";
import { ExplainChat } from "./ExplainChat";
import { ReadingNotepad } from "./ReadingNotepad";
import { Spinner } from "./Icons";
import { OutlinePanel } from "./OutlinePanel";

let active: { attKey: string; viewer: PdfViewer } | null = null;

/** Move the open viewer to a page or an annotation of `attKey`. False
 *  when that PDF isn't the one open — the caller falls back to Zotero. */
export function showInReader(attKey: string, page?: number, annotationKey?: string): boolean {
  if (!active || active.attKey !== attKey) return false;
  if (annotationKey && active.viewer.showAnnotation(annotationKey)) return true;
  if (page) active.viewer.goToPage(page);
  return Boolean(page);
}

/** A page to go to once `attKey` has opened (openReaderAt), and the
 *  passage to mark there when an AI citation quoted one. */
let pendingPage: { attKey: string; page: number; quote?: string } | null = null;

/** Mark an AI citation's passage in `viewer` and go to it, logging how
 *  the search went. A passage that doesn't appear is otherwise a dead
 *  end for the person looking at it: the log says whether the words
 *  were nowhere in the document, whether the pages have any text to
 *  search, and whether the sweep even reached the far end of a long
 *  PDF. */
async function showQuote(viewer: PdfViewer, attKey: string, page: number, quote: string): Promise<void> {
  const report = await viewer.showQuote(quote, page);
  if (!report) return;
  const file = useStore.getState().library.items.find((i) => i.key === attKey)?.data?.filename || attKey;
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
        : `best run anywhere was ${report.bestRun} word(s)${report.bestRunPage ? ` on page ${report.bestRunPage}` : ""}`;
  // Never pretend: the reader is left on the cited page, unmarked.
  appLog("warn", `Highlight: no match for the ${where} — ${why}; showing the cited page instead`);
}

/** Show page `page` (1-based) of `attKey` — in the open viewer, or by
 *  opening it (downloading it first if it isn't on this device). With
 *  `quote`, the passage decides the page and is marked there; `tab` is
 *  the right panel's tab when the PDF has to be opened. */
export function openReaderAt(
  itemKey: string,
  attKey: string,
  page: number,
  { quote, tab }: { quote?: string; tab?: MetaTab } = {},
): void {
  if (quote?.trim() && active?.attKey === attKey) {
    // Still loading: the passage is searched once the pages are there.
    if (active.viewer.getPageCount()) void showQuote(active.viewer, attKey, page, quote);
    else pendingPage = { attKey, page, quote };
    return;
  }
  if (showInReader(attKey, page)) return;
  pendingPage = { attKey, page, quote };
  const st = useStore.getState();
  if (st.cachedPdfs[attKey]) st.setReading({ itemKey, attKey }, tab);
  else void readItem(itemKey, tab);
}

/** A place in the open PDF — an outline entry's: a 0-based page and a
 *  height on it in PDF units (null for its top). */
export function goToReaderPosition(pageIndex: number, top: number | null): void {
  active?.viewer.goToPosition(pageIndex, top);
}

/** A keyboard command for the open viewer (lib/shortcuts/). */
export function readerCommand(cmd: ViewerCommand): void {
  active?.viewer.command(cmd);
}

/** The open viewer's pen — its colour and the colours it takes — for
 *  reading mode's pen flyout. */
export function readerPen() {
  return active?.viewer.inkPen ?? null;
}

/** Where the open viewer is, and what is at a client point — for the
 *  reading-mode notepad (src/notepad/). */
export function readerPlace() {
  return active?.viewer.place() ?? null;
}
export function readerPlaceAt(x: number, y: number) {
  return active?.viewer.placeAt(x, y) ?? null;
}

/** How many pages `attKey` has, when it is the PDF open. */
export function readerPageCount(attKey: string | undefined): number | null {
  return active && active.attKey === attKey ? active.viewer.getPageCount() || null : null;
}

/** The page the open viewer shows, when it shows `attKey`. */
export function currentReaderPage(attKey: string): number | null {
  return active?.attKey === attKey ? active.viewer.currentPage() : null;
}

type SearchRequest = { query: string; onStatus: (s: SearchStatus) => void; opts?: SearchOptions };
/** A search asked for before `attKey`'s viewer was there — the one a
 *  PDF was left with, put back as it opens. */
let pendingSearch: (SearchRequest & { attKey: string }) | null = null;

function runSearch(viewer: PdfViewer, r: SearchRequest): void {
  viewer.onSearchChange(r.onStatus);
  void viewer.search(r.query, r.opts);
}

/** Find `query` in `attKey`, the open PDF; `onStatus` hears the count
 *  grow and the current hit change. Before its viewer is there, it
 *  waits for it. */
export function searchReader(
  attKey: string,
  query: string,
  onStatus: (s: SearchStatus) => void,
  opts?: SearchOptions,
): void {
  if (active?.attKey === attKey) {
    pendingSearch = null;
    runSearch(active.viewer, { query, onStatus, opts });
  } else pendingSearch = { attKey, query, onStatus, opts };
}

/** Next (1) or previous (-1) hit of the search in the open PDF. */
export function stepReaderSearch(dir: 1 | -1): void {
  active?.viewer.searchStep(dir);
}

/** Show hit `idx` (0-based) of the search in the open PDF. */
export function goToReaderSearchHit(idx: number): void {
  active?.viewer.searchGoTo(idx);
}

const addToNotes = insertIntoNotes;

export function ReaderPane() {
  const reading = useStore((s) => s.reading);
  const items = useStore((s) => s.library.items);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PdfViewer | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const outline = useOutline(reading?.attKey);
  const outlineShown = useStore((s) => s.outlineOpen) && Boolean(outline?.length);
  // Reading mode's notepad over the pages, or its icon.
  const notepad = useStore((s) => s.readingMode) && state === "ready";

  const itemKey = reading?.itemKey ?? "";
  const attKey = reading?.attKey ?? null;
  // A fresh download of this PDF (Sync → Download the PDF again)
  // changes its saved time, and the viewer reloads with the new copy.
  const savedMs = useStore((s) => (attKey ? s.cachedPdfs[attKey]?.savedMs : undefined));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !attKey) return;
    let cancelled = false;
    let viewer: PdfViewer | null = null;
    setState("loading");
    (async () => {
      try {
        const { createPdfViewer } = await import("../pdfviewer/viewer");
        if (cancelled) return;
        const settings = () => useStore.getState().settings;
        const cite = (page: number) => `[p. ${page}](${pdfLink(settings(), attKey, page)})`;
        viewer = createPdfViewer(host, {
          onOpenInZotero: (page) => void openInZotero(itemKey, attKey, undefined, page),
          onBookmark: (pageIndex, top, name, pageLabel) =>
            addBookmark({ attKey, itemKey, pageIndex, top, name, pageLabel }),
          holdToBookmark: () => useStore.getState().readingMode,
          onRenameBookmark: renameBookmark,
          onRemoveBookmark: removeBookmark,
          onQuote: (text, page) => addToNotes(`> ${text}\n\n— ${cite(page)}`),
          onExplain: (text, page, place) => startExplain(itemKey, text, page, place && { attKey, ...place }),
          onLookup: (text, page, context, place) => lookUp(itemKey, attKey, text, page, context, place),
          onExplainTap: (id) => useStore.getState().setExplain({ chatId: id }),
          canExplain: () => aiConnected(settings()),
          onSentenceTool: (on) => useStore.getState().setViewerTools({ sentenceTool: on }),
          onInkMode: (on) => useStore.getState().setViewerTools({ inkMode: on }),
          onInkTool: (tool) => useStore.getState().setViewerTools({ inkTool: tool }),
          onTwoUp: (on) => useStore.getState().twoUp !== on && useStore.getState().setViewerTools({ twoUp: on }),
          onInsertAnnotation: (a: Annotation) => addToNotes(annotationMarkdown(settings(), a)),
          annotate: {
            create: (d, type, color) =>
              createAnnotation({
                attKey,
                type,
                color,
                text: d.text,
                pageLabel: d.pageLabel,
                sortIndex: d.sortIndex,
                position: {
                  pageIndex: d.pageIndex,
                  rects: d.rects,
                  ...(d.nextPageRects ? { nextPageRects: d.nextPageRects } : {}),
                },
              }),
            newKey: newItemKey,
            createInk: (d) =>
              createAnnotation({
                attKey,
                type: "ink",
                key: d.key,
                color: d.color,
                pageLabel: d.pageLabel,
                sortIndex: d.sortIndex,
                position: { pageIndex: d.pageIndex, width: d.width, paths: d.paths },
              }),
            update: updateAnnotation,
            remove: deleteAnnotation,
            canEdit: (a) => canEditAnnotation(a, settings()),
            writing: notePenActivity,
          },
          onOutline: (o) => setOutline(attKey, o),
          onReadingMode: () => {
            const s = useStore.getState();
            s.setReadingMode(!s.readingMode);
          },
          // Remembered, so the PDF opens on this page next time.
          onPageChange: (page) => {
            setReaderPage(page);
            savePage(attKey, page);
          },
          // The PDF reopens as it was left: layout, folded view, place.
          initialView: lastView(attKey),
          onViewChange: (page, view) => savePage(attKey, page, view),
        });
        viewerRef.current = viewer;
        active = { attKey, viewer };
        // Searched before the PDF opened: run once the pages are there.
        if (pendingSearch?.attKey === attKey) {
          runSearch(viewer, pendingSearch);
          pendingSearch = null;
        }
        // Cached copies come straight off the disk; the command falls
        // back to Zotero for one that isn't (or was cleared meanwhile).
        const bytes = await invoke<ArrayBuffer>("download_attachment_file", { attKey });
        if (cancelled) return;
        await viewer.loadPdf(bytes, lastPage(attKey) ?? undefined);
        if (cancelled) return;
        const lib = useStore.getState().library.items;
        viewer.setAnnotations(annotationIndexFor(lib).get(attKey) ?? []);
        if (pendingPage?.attKey === attKey) {
          const { page, quote } = pendingPage;
          if (quote?.trim()) void showQuote(viewer, attKey, page, quote);
          else viewer.goToPage(page);
          pendingPage = null;
        }
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        appLog("error", `Could not open the PDF: ${e}`);
        setError(String(e));
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
      if (active?.viewer === viewer) active = null;
      // The next viewer starts with its tools off.
      useStore.getState().setViewerTools({ sentenceTool: false, inkMode: false, twoUp: false });
      viewerRef.current = null;
      // Destroying reports the view one last time; then it is written.
      void viewer?.destroy();
      flushSavedPage();
    };
  }, [itemKey, attKey, savedMs]);

  // The app going to the background may be the last chance to write
  // where the PDF was left.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      viewerRef.current?.flushView();
      flushSavedPage();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // Reading mode in or out: should WebKit leave the viewer at its old
  // height (a gap above the bottom bar, gone only once the app went to
  // the background and back), its height is set outright for a frame —
  // a relayout that keeps the scroll — checked once the change has laid
  // out, and again later.
  const readingMode = useStore((s) => s.readingMode);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const check = () => {
      const viewer = host.firstElementChild as HTMLElement | null;
      if (!viewer || Math.abs(viewer.offsetHeight - host.clientHeight) < 2) return;
      appLog("debug", `Reader: the viewer was ${viewer.offsetHeight}px in a ${host.clientHeight}px pane; laid out again`);
      viewer.style.height = `${host.clientHeight}px`;
      requestAnimationFrame(() => (viewer.style.height = ""));
    };
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(check)));
    const later = window.setTimeout(check, 400);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(later);
    };
  }, [readingMode]);

  // The pages with a bookmark show it (and its name) at their bookmark
  // button.
  const bookmarks = useBookmarks((s) => s.list);
  useEffect(() => {
    if (state === "ready" && attKey) {
      viewerRef.current?.setPageBookmarks(bookmarksOf(bookmarks, attKey));
    }
  }, [bookmarks, attKey, state]);

  // The passages explained in this PDF stay marked; a tap reopens one.
  const chats = useStore((s) => s.chats);
  useEffect(() => {
    if (state !== "ready" || !attKey) return;
    const marks = chats.flatMap((c) =>
      c.mode === "explain" && c.passage?.attKey === attKey
        ? [{ id: c.id, pageIndex: c.passage.pageIndex, rects: c.passage.rects }]
        : [],
    );
    viewerRef.current?.setExplainMarks(marks);
  }, [chats, attKey, state]);

  // The words looked up in this PDF are underlined; a tap shows the
  // definition.
  const words = useWords((s) => s.list);
  useEffect(() => {
    if (state !== "ready" || !attKey) return;
    const marks = words.flatMap((w) =>
      w.attKey === attKey && w.place ? [{ id: w.id, ...w.place, word: w.word, definition: w.definition }] : [],
    );
    viewerRef.current?.setWordMarks(marks);
  }, [words, attKey, state]);

  // A sync that brings new or edited highlights repaints them in place.
  useEffect(() => {
    if (state === "ready" && attKey) {
      viewerRef.current?.setAnnotations(annotationIndexFor(items).get(attKey) ?? []);
    }
  }, [items, attKey, state]);

  if (!reading) return null;
  return (
    <section className="reader-pane">
      {outlineShown && attKey && <OutlinePanel key={attKey} attKey={attKey} outline={outline ?? []} />}
      {!attKey ? (
        <div className="reader-empty">
          This entry has no PDF in Zotero — the notes are on the right.
        </div>
      ) : (
        <>
          <div className="reader-host" ref={hostRef} />
          <ExplainChat />
          {notepad && <ReadingNotepad attKey={attKey} />}
          {state !== "ready" && (
            <div className="reader-status">
              {state === "loading" ? (
                <>
                  <Spinner size={14} /> Opening the PDF…
                </>
              ) : (
                <span className="error-msg">{error}</span>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
