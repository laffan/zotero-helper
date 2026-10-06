// The Notes tab: an entry's NOTES.md, and the way into Take Notes.
//
// The button at the top follows what is on hand:
//   notes and PDF here     → Take Notes
//   notes, PDF not here    → Download PDF (then Take Notes)
//   no notes, entry has PDF → Download PDF & Create Notes (then Take Notes)
//   no notes, no PDF       → Create Notes
// While Take Notes is open for this entry the tab is the editor instead.
import { useEffect, useRef, useState } from "react";
import { isStandaloneAttachment, itemTitle, pdfAttachmentOf } from "../lib/collections";
import {
  cachePdf,
  cachedPdfIsStale,
  noteAttachmentOf,
  NOTES_FILENAME,
  openNote,
  saveNote,
} from "../lib/notes";
import { appLog, useStore } from "../lib/store";
import type { NoteMeta, ZItem } from "../lib/types";
import { PencilIcon, PdfIcon, Spinner } from "./Icons";
import { NotesEditor } from "./NotesEditor";
import { NotesMarkdown } from "./NotesMarkdown";

interface Note {
  text: string;
  meta: NoteMeta;
}

export function NotesPanel({ item }: { item: ZItem }) {
  const items = useStore((s) => s.library.items);
  const reading = useStore((s) => s.reading);
  const cachedPdfs = useStore((s) => s.cachedPdfs);
  const setReading = useStore((s) => s.setReading);
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remoteAtt = noteAttachmentOf(items, item.key);
  const remoteKey = useRef(remoteAtt?.key);
  remoteKey.current = remoteAtt?.key;
  const pdfAtt = pdfAttachmentOf(items, item.key);
  const cached = pdfAtt ? cachedPdfs[pdfAtt.key] : undefined;
  const editing = reading?.itemKey === item.key;
  const standalone = isStandaloneAttachment(item);

  // Load once per entry. Not on library changes: our own push updates
  // the attachment, and re-reading mid-edit would be pointless.
  useEffect(() => {
    if (standalone) {
      setLoading(false);
      return;
    }
    let stale = false;
    setLoading(true);
    setNote(null);
    setError(null);
    openNote(item.key, remoteKey.current)
      .then((n) => !stale && setNote(n))
      .catch((e) => !stale && setError(String(e)))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [item.key, standalone]);

  if (standalone) {
    return (
      <div className="meta-empty">
        Notes belong to an entry, and this file has no parent entry in Zotero.
      </div>
    );
  }

  if (editing && note) {
    return (
      <NotesEditor
        key={item.key}
        itemKey={item.key}
        initialText={note.text}
        initialMeta={note.meta}
        onDone={(text, meta) => {
          setNote({ text, meta });
          setReading(null);
        }}
      />
    );
  }

  const title = itemTitle(item);

  const download = async (): Promise<boolean> => {
    if (!pdfAtt) return true;
    setBusy("Downloading the PDF…");
    try {
      await cachePdf(pdfAtt, item.key, title);
      return true;
    } catch (e) {
      appLog("error", `Downloading the PDF failed: ${e}`);
      setError(`Downloading the PDF failed: ${e}`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setError(null);
    if (pdfAtt && !cached && !(await download())) return;
    setBusy("Creating notes…");
    try {
      const text = `# ${title}\n\n`;
      const meta = await saveNote(item.key, text);
      setNote({ text, meta });
    } catch (e) {
      setError(`Creating notes failed: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  let action: React.ReactNode;
  if (loading) {
    action = (
      <div className="notes-loading">
        <Spinner size={13} /> Checking for notes…
      </div>
    );
  } else if (busy) {
    action = (
      <button className="tool-btn accent notes-action" disabled>
        <Spinner size={13} /> {busy}
      </button>
    );
  } else if (!note) {
    action = (
      <button className="tool-btn accent notes-action" onClick={() => void create()}>
        <PencilIcon size={13} />
        {pdfAtt && !cached ? "Download PDF & Create Notes" : "Create Notes"}
      </button>
    );
  } else if (pdfAtt && !cached) {
    action = (
      <button className="tool-btn accent notes-action" onClick={() => void download()}>
        <PdfIcon size={13} /> Download PDF
      </button>
    );
  } else {
    action = (
      <button
        className="tool-btn accent notes-action"
        onClick={() => setReading({ itemKey: item.key, attKey: pdfAtt?.key ?? null })}
      >
        <PencilIcon size={13} /> Take Notes
      </button>
    );
  }

  return (
    <div className="notes-panel">
      <div className="notes-panel-head">
        {action}
        {!pdfAtt && !loading && (
          <span className="hint">This entry has no PDF in Zotero.</span>
        )}
        {cachedPdfIsStale(pdfAtt, cached) && !busy && (
          <span className="hint">
            Zotero has a newer copy of this PDF —{" "}
            <button className="link-btn" onClick={() => void download()}>
              download it again
            </button>
          </span>
        )}
        {error && <div className="error-msg">{error}</div>}
      </div>
      {note ? (
        note.text.trim() ? (
          <NotesMarkdown itemKey={item.key} text={note.text} />
        ) : (
          <div className="meta-empty">Nothing written yet.</div>
        )
      ) : (
        !loading && (
          <div className="meta-empty">
            No {NOTES_FILENAME} for this entry yet. Notes are written here and
            kept in Zotero as an attachment of the entry.
          </div>
        )
      )}
    </div>
  );
}
