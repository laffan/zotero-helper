// An entry's NOTES.md, always editable: CodeMirror with Markdown
// rendered in place (src/noteseditor/). Saved to this device a moment
// after each keystroke, pushed to Zotero periodically (src/lib/notes.ts)
// and when the PDF is closed.
//
// With the entry's PDF open beside it, the viewer sends quotes, page
// citations and highlights here (insertIntoNotes), Zotero links move the
// viewer instead of opening Zotero, and the line being written gets the
// cite-this-page icon.
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { openInZotero } from "../lib/actions";
import { annotationByKey, parsePdfLink, pdfLink } from "../lib/highlights";
import { NOTES_FILENAME, pushNote, registerNotesInserter, saveNote } from "../lib/notes";
import { appLog, useStore } from "../lib/store";
import type { NoteMeta } from "../lib/types";
import type { NotesEditorHandle } from "../noteseditor/editor";
import { Spinner } from "./Icons";
import { currentReaderPage, showInReader } from "./ReaderPane";

const SAVE_DELAY_MS = 600;

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

function follow(itemKey: string, href: string): void {
  const link = parsePdfLink(href);
  if (link) {
    if (!showInReader(link.attKey, link.page, link.annotation)) {
      void openInZotero(itemKey, link.attKey, undefined, link.page, link.annotation);
    }
    return;
  }
  if (/^(https?|zotero):\/\//i.test(href)) {
    void openUrl(href).catch((e) => appLog("warn", `Could not open ${href}: ${e}`));
  }
}

interface Props {
  itemKey: string;
  initialText: string;
  /** Null for notes that don't exist yet — the first keystroke makes them. */
  initialMeta: NoteMeta | null;
  /** The entry's PDF, when there is one. */
  pdfAttKey: string | null;
}

export function NotesEditor({ itemKey, initialText, initialMeta, pdfAttKey }: Props) {
  const reading = useStore((s) => s.reading);
  const [meta, setMeta] = useState(initialMeta);
  const [pushing, setPushing] = useState(false);
  const [, tick] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NotesEditorHandle | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef(0);

  const flush = async (): Promise<void> => {
    clearTimeout(timer.current);
    const t = pending.current;
    if (t == null) return;
    pending.current = null;
    try {
      setMeta(await saveNote(itemKey, t));
    } catch (e) {
      appLog("error", `Saving notes failed: ${e}`);
    }
  };

  // The PDF beside the notes is this entry's: cite and jump within it.
  const pdfOpen = Boolean(pdfAttKey && reading?.itemKey === itemKey && reading.attKey === pdfAttKey);
  const pdfOpenRef = useRef(pdfOpen);
  pdfOpenRef.current = pdfOpen;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let handle: NotesEditorHandle | null = null;
    let cancelled = false;
    void import("../noteseditor/editor").then(({ createNotesEditor }) => {
      if (cancelled) return;
      handle = createNotesEditor(host, {
        doc: initialText,
        placeholder: `Write notes in Markdown. They're saved on this device and kept in Zotero as ${NOTES_FILENAME}.`,
        onChange: (text) => {
          pending.current = text;
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
        },
        follow: (href) => follow(itemKey, href),
        annotationColor: (key) => annotationByKey(useStore.getState().library.items, key)?.color,
        cite: () => {
          const page = pdfAttKey ? currentReaderPage(pdfAttKey) : null;
          if (!pdfAttKey || page == null) return null;
          return `[p. ${page}](${pdfLink(useStore.getState().settings, pdfAttKey, page)})`;
        },
      });
      editorRef.current = handle;
      handle.setCiteEnabled(pdfOpenRef.current);
      registerNotesInserter((md) => handle?.insert(md));
    });
    return () => {
      cancelled = true;
      registerNotesInserter(null);
      editorRef.current = null;
      handle?.destroy();
      // Never lose the last keystrokes to an unmount.
      void flush();
    };
    // One editor per entry; the panel is keyed by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  useEffect(() => {
    editorRef.current?.setCiteEnabled(pdfOpen);
  }, [pdfOpen]);

  // Keep "pushed 3 min ago" honest.
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const push = async () => {
    setPushing(true);
    await flush();
    const m = await pushNote(itemKey);
    if (m) setMeta(m);
    setPushing(false);
  };

  const status = !meta
    ? null
    : pushing
      ? "Pushing to Zotero…"
      : meta.dirty
        ? "Saved here · not yet in Zotero"
        : meta.pushedMs
          ? `In Zotero · pushed ${ago(meta.pushedMs)}`
          : "In Zotero";

  return (
    <div className="notes-editor">
      {status && (
        <div className="notes-editor-head">
          <span className={`notes-status ${meta?.dirty ? "dirty" : ""}`}>{status}</span>
          {meta?.dirty && (
            <button className="mini-btn" onClick={() => void push()} disabled={pushing}>
              {pushing ? <Spinner size={11} /> : "Push now"}
            </button>
          )}
        </div>
      )}
      <div className="notes-cm" ref={hostRef} />
    </div>
  );
}
