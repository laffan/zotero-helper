// The right panel for a standalone attachment — a file Zotero holds with
// no parent entry. These carry almost no metadata (no creators, no
// publication, no abstract), so the full editor would be twenty empty
// boxes: the name, the link, and the file's own facts is all there is.
import { useEffect, useRef, useState } from "react";
import { saveItemEdits } from "../lib/actions";
import { attachmentName, REAL_KEY } from "../lib/collections";
import { shareAttachment } from "../lib/share";
import { appLog } from "../lib/store";
import type { ZItem } from "../lib/types";
import { ShareIcon, Spinner } from "./Icons";

/** The only two fields worth editing on a file with no parent. */
const EDITABLE_FIELDS: { id: string; label: string }[] = [
  { id: "title", label: "Name" },
  { id: "url", label: "URL" },
];

const FACTS: { id: string; label: string; date?: boolean }[] = [
  { id: "contentType", label: "Type" },
  { id: "filename", label: "File" },
  { id: "dateAdded", label: "Added", date: true },
  { id: "dateModified", label: "Modified", date: true },
];

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AttachmentPanel({ item }: { item: ZItem }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lastKey = useRef<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Re-seed on selection change and on sync, but never over an edit in
  // progress — same contract as the full editor.
  useEffect(() => {
    if (lastKey.current === item.key && dirty) return;
    lastKey.current = item.key;
    const d: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) {
      d[f.id] = String((item.data as Record<string, unknown>)?.[f.id] ?? "");
    }
    setDraft(d);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, dirty]);

  const save = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      const orig = item.data as Record<string, unknown>;
      for (const [k, v] of Object.entries(draft)) {
        if (String(orig?.[k] ?? "") !== v) patch[k] = v;
      }
      if (Object.keys(patch).length === 0) {
        setDirty(false);
        return;
      }
      await saveItemEdits(item.key, patch);
      setDirty(false);
    } catch (e) {
      appLog("error", `Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  // Linked-URL attachments have no file to hand to the share sheet.
  const hasFile =
    REAL_KEY.test(item.key) && item.data?.linkMode !== "linked_url";

  const share = () => {
    const r = rowRef.current?.getBoundingClientRect();
    void shareAttachment(
      item.key,
      attachmentName(item),
      r
        ? { x: r.right - 20, y: r.top }
        : { x: window.innerWidth / 2, y: 60 },
    );
  };

  return (
    <div className="meta-editor">
      <div className="meta-type-row">
        <span className="meta-itemtype">Attachment</span>
        <span className="meta-key">{item.key}</span>
      </div>

      {EDITABLE_FIELDS.map((f) => (
        <label className="meta-field" key={f.id}>
          <span>{f.label}</span>
          <input
            value={draft[f.id] ?? ""}
            onChange={(e) => {
              setDraft((d) => ({ ...d, [f.id]: e.target.value }));
              setDirty(true);
            }}
          />
        </label>
      ))}

      <div className="meta-field meta-facts">
        {FACTS.map((f) => {
          const v = String(
            (item.data as Record<string, unknown>)?.[f.id] ?? "",
          ).trim();
          if (!v) return null;
          return (
            <div className="meta-fact" key={f.id}>
              <span className="meta-fact-label">{f.label}</span>
              <span className="meta-fact-value" title={v}>
                {f.date ? fmtWhen(v) : v}
              </span>
            </div>
          );
        })}
      </div>

      {hasFile && (
        <div className="meta-field" ref={rowRef}>
          <button className="mini-btn" onClick={share} title="Share this file">
            <ShareIcon size={12} /> Share file
          </button>
        </div>
      )}

      <div className="meta-save-row">
        <button
          className="tool-btn accent"
          disabled={!dirty || saving}
          onClick={save}
        >
          {saving ? <Spinner size={13} /> : null}
          {saving ? "Saving…" : dirty ? "Save to Zotero" : "Saved"}
        </button>
      </div>
    </div>
  );
}
