// The PDF beside the notes: the viewer that takes over the sidebar and
// item list while notes are written in the right panel.
//
// The viewer itself is plain DOM (src/pdfviewer/, a port of Hush's), so
// this component only mounts it, feeds it the cached PDF and the
// entry's Zotero annotations, and routes what it hands back — a cited
// page, a selected passage, a shelf highlight — into the notes, and new
// or edited highlights to Zotero (lib/annotationEdits.ts).
import { useEffect, useRef, useState } from "react";
import { openInZotero } from "../lib/actions";
import {
  canEditAnnotation,
  createAnnotation,
  deleteAnnotation,
  updateAnnotation,
} from "../lib/annotationEdits";
import {
  annotationIndexFor,
  annotationMarkdown,
  pdfLink,
  type Annotation,
} from "../lib/highlights";
import { insertIntoNotes } from "../lib/notes";
import { appLog, useStore } from "../lib/store";
import { invoke } from "../lib/tauri";
import type { SearchStatus } from "../pdfviewer/search";
import type { PdfViewer } from "../pdfviewer/viewer";
import { Spinner } from "./Icons";

let active: { attKey: string; viewer: PdfViewer } | null = null;

/** Move the open viewer to a page or an annotation of `attKey`. False
 *  when that PDF isn't the one open — the caller falls back to Zotero. */
export function showInReader(attKey: string, page?: number, annotationKey?: string): boolean {
  if (!active || active.attKey !== attKey) return false;
  if (annotationKey && active.viewer.showAnnotation(annotationKey)) return true;
  if (page) active.viewer.goToPage(page);
  return Boolean(page);
}

/** The page the open viewer shows, when it shows `attKey`. */
export function currentReaderPage(attKey: string): number | null {
  return active?.attKey === attKey ? active.viewer.currentPage() : null;
}

/** Find `query` in the open PDF; `onStatus` hears the count grow and
 *  the current hit change. Ignored before the viewer has a PDF. */
export function searchReader(query: string, onStatus: (s: SearchStatus) => void): void {
  if (!active) return;
  active.viewer.onSearchChange(onStatus);
  void active.viewer.search(query);
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
          onCitePage: (page) => addToNotes(cite(page)),
          onQuote: (text, page) => addToNotes(`> ${text}\n\n— ${cite(page)}`),
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
                position: { pageIndex: d.pageIndex, rects: d.rects },
              }),
            update: updateAnnotation,
            remove: deleteAnnotation,
            canEdit: (a) => canEditAnnotation(a, settings()),
          },
        });
        viewerRef.current = viewer;
        active = { attKey, viewer };
        // Cached copies come straight off the disk; the command falls
        // back to Zotero for one that isn't (or was cleared meanwhile).
        const bytes = await invoke<ArrayBuffer>("download_attachment_file", { attKey });
        if (cancelled) return;
        await viewer.loadPdf(bytes);
        if (cancelled) return;
        const lib = useStore.getState().library.items;
        viewer.setAnnotations(annotationIndexFor(lib).get(attKey) ?? []);
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
      viewerRef.current = null;
      void viewer?.destroy();
    };
  }, [itemKey, attKey, savedMs]);

  // A sync that brings new or edited highlights repaints them in place.
  useEffect(() => {
    if (state === "ready" && attKey) {
      viewerRef.current?.setAnnotations(annotationIndexFor(items).get(attKey) ?? []);
    }
  }, [items, attKey, state]);

  if (!reading) return null;
  return (
    <section className="reader-pane">
      {!attKey ? (
        <div className="reader-empty">
          This entry has no PDF in Zotero — the notes are on the right.
        </div>
      ) : (
        <>
          <div className="reader-host" ref={hostRef} />
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
