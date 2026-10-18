// The Notes tab: an entry's NOTES.md, always open for writing (see
// NotesEditor). Opening it asks Zotero first whether its copy changed,
// so notes written on another device arrive. The PDF that goes beside
// the notes is opened from the tab bar (PdfTabButton).
//
// With that PDF open, View Notepad at the pane's foot splits it: the
// notes above, the PDF's notepad below (NotepadBody, the pad reading
// mode floats), so what was scribbled there can be typed up here. The
// bar between them is the divider — dragged to share the height — with
// Hide Notepad at its middle. Whether it shows, and the split, are this
// device's.
import { useEffect, useRef, useState } from "react";
import { isStandaloneAttachment, pdfAttachmentOf } from "../lib/collections";
import { noteAttachmentOf, openNote } from "../lib/notes";
import { useStore } from "../lib/store";
import type { NoteMeta, ZItem } from "../lib/types";
import { Spinner } from "./Icons";
import { NotepadBody } from "./NotepadBody";
import { NotesEditor } from "./NotesEditor";

interface Note {
  text: string;
  meta: NoteMeta | null;
}

const SPLIT_KEY = "zh-notes-notepad";

function storedSplit(): { open: boolean; ratio: number } {
  try {
    const v = JSON.parse(localStorage.getItem(SPLIT_KEY) ?? "null") as { open: boolean; ratio: number } | null;
    return v && typeof v.ratio === "number" ? v : { open: false, ratio: 0.5 };
  } catch {
    return { open: false, ratio: 0.5 };
  }
}

/** The pane's foot: View / Hide Notepad, and — open — the divider. */
function NotepadSplit({ panelRef, split, setSplit }: {
  panelRef: React.RefObject<HTMLDivElement>;
  split: { open: boolean; ratio: number };
  setSplit: (s: { open: boolean; ratio: number }) => void;
}) {
  const drag = (e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!split.open || !panel || (e.target as Element).closest("button")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const move = (ev: PointerEvent) =>
      setSplit({ open: true, ratio: Math.max(0.15, Math.min(0.85, (ev.clientY - r.top) / r.height)) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div className={split.open ? "notes-notepad-bar open" : "notes-notepad-bar"} onPointerDown={drag}>
      <button type="button" className="notes-notepad-toggle" onClick={() => setSplit({ ...split, open: !split.open })}>
        {split.open ? "Hide Notepad" : "View Notepad"}
      </button>
    </div>
  );
}

export function NotesPanel({ item }: { item: ZItem }) {
  const items = useStore((s) => s.library.items);
  // The notepad belongs to the PDF open beside these notes.
  const padKey = useStore((s) => (s.reading?.itemKey === item.key ? s.reading.attKey : null));
  const [split, setSplitState] = useState(storedSplit);
  const setSplit = (s: { open: boolean; ratio: number }) => {
    setSplitState(s);
    try {
      localStorage.setItem(SPLIT_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  };
  const panelRef = useRef<HTMLDivElement>(null);
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
  const padOpen = Boolean(padKey && split.open);
  return (
    <div className="notes-panel" ref={panelRef}>
      {error && <div className="error-msg notes-error">{error}</div>}
      <div className="notes-split-top" style={padOpen ? { flex: `0 0 ${split.ratio * 100}%` } : undefined}>
        <NotesEditor
          key={item.key}
          itemKey={item.key}
          initialText={note.text}
          initialMeta={note.meta}
          pdfAttKey={pdfAtt?.key ?? null}
        />
      </div>
      {padKey && <NotepadSplit panelRef={panelRef} split={split} setSplit={setSplit} />}
      {padKey && padOpen && (
        <div className="notepad notepad-docked">
          <NotepadBody attKey={padKey} />
        </div>
      )}
    </div>
  );
}
