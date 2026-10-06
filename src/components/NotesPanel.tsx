// The Notes tab: an entry's NOTES.md, always open for writing (see
// NotesEditor). Opening it asks Zotero first whether its copy changed,
// so notes written on another device arrive. The PDF that goes beside
// the notes is opened from the tab bar (PdfTabButton).
import { useEffect, useRef, useState } from "react";
import { isStandaloneAttachment, pdfAttachmentOf } from "../lib/collections";
import { noteAttachmentOf, openNote } from "../lib/notes";
import { useStore } from "../lib/store";
import type { NoteMeta, ZItem } from "../lib/types";
import { Spinner } from "./Icons";
import { NotesEditor } from "./NotesEditor";

interface Note {
  text: string;
  meta: NoteMeta | null;
}

export function NotesPanel({ item }: { item: ZItem }) {
  const items = useStore((s) => s.library.items);
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remoteKey = useRef<string | undefined>();
  remoteKey.current = noteAttachmentOf(items, item.key)?.key;
  const pdfAtt = pdfAttachmentOf(items, item.key);
  const standalone = isStandaloneAttachment(item);

  // Load once per entry. Not on library changes: our own pushes update
  // the attachment, and re-reading mid-edit would be pointless.
  useEffect(() => {
    if (standalone) return;
    let stale = false;
    setNote(null);
    setError(null);
    openNote(item.key, remoteKey.current)
      .then((n) => !stale && setNote(n ?? { text: "", meta: null }))
      .catch((e) => {
        if (stale) return;
        // Still writable: whatever is saved locally loads on the next try.
        setError(String(e));
        setNote({ text: "", meta: null });
      });
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
  if (!note) {
    return (
      <div className="notes-loading">
        <Spinner size={13} /> Checking for notes…
      </div>
    );
  }
  return (
    <div className="notes-panel">
      {error && <div className="error-msg notes-error">{error}</div>}
      <NotesEditor
        key={item.key}
        itemKey={item.key}
        initialText={note.text}
        initialMeta={note.meta}
        pdfAttKey={pdfAtt?.key ?? null}
      />
    </div>
  );
}
