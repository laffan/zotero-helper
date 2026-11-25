// The Notes tab: an entry's NOTES.md, always open for writing (see
// NotesEditor). Opening it asks Zotero first whether its copy changed,
// so notes written on another device arrive. The PDF that goes beside
// the notes is opened from the tab bar (PdfTabButton).
//
// With that PDF open, View Notepad at the pane's foot splits it: the
// notes above, the PDF's notepad below (NotepadBody, the pad reading
// mode floats), so what was scribbled there can be typed up here. The
// bar between them is the divider — dragged to share the height — with
// Hide Notepad at its middle and, at its right, two switches: full
// height (the pad takes the whole pane, the notes kept out of sight,
// still open) and full screen (the pad and its bar fill the window).
// Either goes back to the split; full height pressed in full screen
// leaves it for the pane's height. The pad is the same element through
// all three, only placed differently, so its undo and pan carry on.
// Whether it shows, the split and full height are this device's; full
// screen lasts while the notes are open.
import { useEffect, useRef, useState } from "react";
import { isStandaloneAttachment, pdfAttachmentOf } from "../lib/collections";
import { localNote, noteAttachmentOf, openNote } from "../lib/notes";
import { hear } from "../lib/windows/channel";
import { useStore } from "../lib/store";
import type { NoteMeta, ZItem } from "../lib/types";
import { FullHeightIcon, FullScreenIcon, Spinner } from "./Icons";
import { NotepadBody } from "./NotepadBody";
import { NotesEditor } from "./NotesEditor";

interface Note {
  text: string;
  meta: NoteMeta | null;
}

const SPLIT_KEY = "zh-notes-notepad";

interface Split {
  open: boolean;
  /** The notes' share of the height. */
  ratio: number;
  /** The pad takes the whole pane. */
  tall?: boolean;
}

function storedSplit(): Split {
  try {
    const v = JSON.parse(localStorage.getItem(SPLIT_KEY) ?? "null") as Split | null;
    return v && typeof v.ratio === "number" ? v : { open: false, ratio: 0.5 };
  } catch {
    return { open: false, ratio: 0.5 };
  }
}

/** The pane's foot: View / Hide Notepad, and — open — the divider, with
 *  full height and full screen at its right. */
function NotepadSplit({ panelRef, split, setSplit, screen, setScreen }: {
  panelRef: React.RefObject<HTMLDivElement>;
  split: Split;
  setSplit: (s: Split) => void;
  screen: boolean;
  setScreen: (on: boolean) => void;
}) {
  // Only between the notes and the pad does the bar divide them.
  const divides = split.open && !split.tall && !screen;
  const drag = (e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!divides || !panel || (e.target as Element).closest("button")) return;
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
  const tallOn = split.tall && !screen;
  return (
    <div className={divides ? "notes-notepad-bar open" : "notes-notepad-bar"} onPointerDown={drag}>
      <button
        type="button"
        className="notes-notepad-toggle"
        onClick={() => {
          if (split.open) setScreen(false);
          setSplit({ ...split, open: !split.open });
        }}
      >
        {split.open ? "Hide Notepad" : "View Notepad"}
      </button>
      {split.open && (
        <span className="notes-notepad-modes">
          <button
            type="button"
            className={tallOn ? "notes-notepad-mode active" : "notes-notepad-mode"}
            aria-pressed={tallOn}
            title={tallOn ? "Share the height with the notes" : "Full height: the notepad takes the whole pane"}
            aria-label="Full height"
            onClick={() => {
              setScreen(false);
              setSplit({ ...split, tall: !tallOn });
            }}
          >
            <FullHeightIcon size={14} />
          </button>
          <button
            type="button"
            className={screen ? "notes-notepad-mode active" : "notes-notepad-mode"}
            aria-pressed={screen}
            title={screen ? "Leave full screen" : "Full screen: the notepad fills the window"}
            aria-label="Full screen"
            onClick={() => setScreen(!screen)}
          >
            <FullScreenIcon size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

export function NotesPanel({ item }: { item: ZItem }) {
  const items = useStore((s) => s.library.items);
  // The notepad belongs to the PDF open beside these notes.
  const padKey = useStore((s) => (s.reading?.itemKey === item.key ? s.reading.attKey : null));
  const [split, setSplitState] = useState(storedSplit);
  // The pad over the whole window, while the notes are open.
  const [screen, setScreen] = useState(false);
  const setSplit = (s: Split) => {
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

  // Read again when another window saved these notes (lib/windows/) —
  // unless they are being written here, which will be saved in turn.
  const [reread, setReread] = useState({ key: item.key, n: 0 });
  const rev = reread.key === item.key ? reread.n : 0;
  useEffect(
    () =>
      hear<{ itemKey: string }>("note", (m) => {
        const typing = panelRef.current?.querySelector(".notes-split-top")?.contains(document.activeElement);
        if (m.itemKey !== item.key || typing) return;
        setReread((r) => ({ key: item.key, n: (r.key === item.key ? r.n : 0) + 1 }));
      }),
    [item.key],
  );

  // Load once per entry. Not on library changes: our own pushes update
  // the attachment, and re-reading mid-edit would be pointless. Read
  // again (from this device only) when another window saved them.
  useEffect(() => {
    if (standalone) return;
    let stale = false;
    if (!rev) setNote(null);
    setError(null);
    (rev ? localNote(item.key) : openNote(item.key, remoteKey.current))
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
  }, [item.key, standalone, rev]);

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
  const full = padOpen && screen;
  // The notes: their share beside the pad, out of sight under a pad of
  // the pane's height, the whole pane otherwise (under a full screen too).
  const tall = padOpen && split.tall && !full;
  const shared = padOpen && !split.tall && !full;
  return (
    <div className="notes-panel" ref={panelRef}>
      {error && <div className="error-msg notes-error">{error}</div>}
      <div
        className={tall ? "notes-split-top notes-out-of-sight" : "notes-split-top"}
        style={shared ? { flex: `0 0 ${split.ratio * 100}%` } : undefined}
      >
        <NotesEditor
          key={`${item.key}:${rev}`}
          itemKey={item.key}
          initialText={note.text}
          initialMeta={note.meta}
          pdfAttKey={pdfAtt?.key ?? null}
        />
      </div>
      {padKey && (
        <div className={`notes-notepad-area${padOpen ? " open" : ""}${full ? " full-screen" : ""}`}>
          <NotepadSplit panelRef={panelRef} split={split} setSplit={setSplit} screen={full} setScreen={setScreen} />
          {padOpen && (
            <div className="notepad notepad-docked">
              <NotepadBody attKey={padKey} kind="docked" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
