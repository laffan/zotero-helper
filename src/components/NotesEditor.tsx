// The notes being written, in Take Notes mode. Plain Markdown in a
// textarea — saved to this device a moment after each keystroke, and
// pushed to Zotero periodically (src/lib/notes.ts) and on Done.
//
// The PDF viewer adds to it through insertIntoNotes(): a cited page, a
// selected passage, a highlight from its shelf. Those land at the caret
// as their own paragraph.
import { useEffect, useRef, useState } from "react";
import { pushNote, registerNotesInserter, saveNote } from "../lib/notes";
import { appLog } from "../lib/store";
import type { NoteMeta } from "../lib/types";
import { Spinner } from "./Icons";
import { NotesMarkdown } from "./NotesMarkdown";

const SAVE_DELAY_MS = 600;

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

/** Put `md` at the caret as a paragraph of its own. */
function spliceParagraph(text: string, start: number, end: number, md: string) {
  const before = text.slice(0, start).replace(/\s+$/, "");
  const after = text.slice(end).replace(/^\s+/, "");
  const head = before ? `${before}\n\n` : "";
  const inserted = `${head}${md.trim()}\n\n`;
  return { text: inserted + after, caret: inserted.length };
}

interface Props {
  itemKey: string;
  initialText: string;
  initialMeta: NoteMeta;
  onDone: (text: string, meta: NoteMeta) => void;
}

export function NotesEditor({ itemKey, initialText, initialMeta, onDone }: Props) {
  const [text, setText] = useState(initialText);
  const [meta, setMeta] = useState(initialMeta);
  const [preview, setPreview] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [, tick] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(initialText);
  const pending = useRef<string | null>(null);
  const timer = useRef(0);
  // Where the writer last left the caret. Until they place one, things
  // sent from the PDF go at the end — an untouched textarea reports its
  // caret at 0, which would file every quote above the title.
  const caret = useRef<{ start: number; end: number } | null>(null);

  const flush = async (): Promise<NoteMeta | null> => {
    clearTimeout(timer.current);
    const t = pending.current;
    if (t == null) return null;
    pending.current = null;
    try {
      const m = await saveNote(itemKey, t);
      setMeta(m);
      return m;
    } catch (e) {
      appLog("error", `Saving notes failed: ${e}`);
      return null;
    }
  };

  const change = (t: string) => {
    textRef.current = t;
    setText(t);
    pending.current = t;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  useEffect(() => {
    registerNotesInserter((md) => {
      const cur = textRef.current;
      const at = caret.current ?? { start: cur.length, end: cur.length };
      const next = spliceParagraph(cur, at.start, at.end, md);
      caret.current = { start: next.caret, end: next.caret };
      change(next.text);
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    });
    return () => registerNotesInserter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  // Never lose the last keystrokes to an unmount.
  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const done = async () => {
    const saved = (await flush()) ?? meta;
    onDone(textRef.current, saved);
    // Pushed in the background: Done shouldn't wait on the network.
    void pushNote(itemKey);
  };

  const status = pushing
    ? "Pushing to Zotero…"
    : meta.dirty
      ? "Saved here · not yet in Zotero"
      : meta.pushedMs
        ? `In Zotero · pushed ${ago(meta.pushedMs)}`
        : "In Zotero";

  return (
    <div className="notes-editor">
      <div className="notes-editor-head">
        <span className={`notes-status ${meta.dirty ? "dirty" : ""}`}>{status}</span>
        {meta.dirty && (
          <button className="mini-btn" onClick={() => void push()} disabled={pushing}>
            {pushing ? <Spinner size={11} /> : "Push now"}
          </button>
        )}
        <button className="mini-btn" onClick={() => setPreview(!preview)}>
          {preview ? "Edit" : "Preview"}
        </button>
        <button className="tool-btn accent notes-done" onClick={() => void done()}>
          Done
        </button>
      </div>
      {preview ? (
        <div className="notes-editor-preview">
          <NotesMarkdown itemKey={itemKey} text={text} />
        </div>
      ) : (
        <textarea
          ref={taRef}
          className="notes-textarea"
          value={text}
          onChange={(e) => change(e.target.value)}
          onSelect={(e) => {
            const t = e.currentTarget;
            caret.current = { start: t.selectionStart, end: t.selectionEnd };
          }}
          spellCheck
          placeholder="Write in Markdown. Select text in the PDF, or use a page's pencil button, to quote and cite it here."
        />
      )}
    </div>
  );
}
