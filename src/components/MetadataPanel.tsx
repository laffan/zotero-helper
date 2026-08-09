import { useEffect, useMemo, useRef, useState } from "react";
import { saveItemEdits } from "../lib/actions";
import { isStandaloneAttachment } from "../lib/collections";
import { appLog, useStore } from "../lib/store";
import { type ZCreator, type ZItem } from "../lib/types";
import { AttachmentList } from "./AttachmentList";
import { AttachmentPanel } from "./AttachmentPanel";
import { CloseIcon, Spinner } from "./Icons";
import { SummaryView } from "./SummaryView";

const EDITABLE_FIELDS: { id: string; label: string; multiline?: boolean }[] = [
  { id: "date", label: "Date" },
  { id: "publicationTitle", label: "Publication" },
  { id: "journalAbbreviation", label: "Journal Abbr" },
  { id: "volume", label: "Volume" },
  { id: "issue", label: "Issue" },
  { id: "pages", label: "Pages" },
  { id: "DOI", label: "DOI" },
  { id: "ISSN", label: "ISSN" },
  { id: "ISBN", label: "ISBN" },
  { id: "publisher", label: "Publisher" },
  { id: "place", label: "Place" },
  { id: "url", label: "URL" },
  { id: "language", label: "Language" },
  { id: "extra", label: "Extra", multiline: true },
];

function SingleItemEditor({ item }: { item: ZItem }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [creators, setCreators] = useState<ZCreator[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lastKey = useRef<string | null>(null);

  // Re-seed the draft on selection change, and also whenever the item's
  // data changes underneath us (AI actions, sync) — but never clobber
  // edits the user is in the middle of making.
  useEffect(() => {
    if (lastKey.current === item.key && dirty) return;
    lastKey.current = item.key;
    const d: Record<string, string> = {
      title: String(item.data?.title ?? ""),
      abstractNote: String(item.data?.abstractNote ?? ""),
    };
    for (const f of EDITABLE_FIELDS) {
      d[f.id] = String((item.data as Record<string, unknown>)?.[f.id] ?? "");
    }
    setDraft(d);
    setCreators((item.data?.creators ?? []).map((c) => ({ ...c })));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, dirty]);

  const setField = (id: string, value: string) => {
    setDraft((d) => ({ ...d, [id]: value }));
    setDirty(true);
  };

  const setCreator = (i: number, patch: Partial<ZCreator>) => {
    setCreators((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      const orig = item.data as Record<string, unknown>;
      for (const [k, v] of Object.entries(draft)) {
        if (String(orig?.[k] ?? "") !== v) patch[k] = v;
      }
      const origCreators = JSON.stringify(item.data?.creators ?? []);
      const newCreators = creators.filter(
        (c) => c.firstName || c.lastName || c.name,
      );
      if (JSON.stringify(newCreators) !== origCreators) {
        patch.creators = newCreators;
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

  return (
    <div className="meta-editor">
      <div className="meta-type-row">
        <span className="meta-itemtype">{String(item.data?.itemType ?? "")}</span>
        <span className="meta-key">{item.key}</span>
      </div>
      <label className="meta-field">
        <span>Title</span>
        <textarea
          rows={2}
          value={draft.title ?? ""}
          onChange={(e) => setField("title", e.target.value)}
        />
      </label>

      <div className="meta-field">
        <span>
          Creators{" "}
          <button
            className="mini-btn"
            onClick={() => {
              setCreators((cs) => [
                ...cs,
                { creatorType: "author", firstName: "", lastName: "" },
              ]);
              setDirty(true);
            }}
          >
            + add
          </button>
        </span>
        {creators.map((c, i) => (
          <div className="creator-row" key={i}>
            <input
              placeholder="First"
              value={c.firstName ?? ""}
              onChange={(e) => setCreator(i, { firstName: e.target.value })}
            />
            <input
              placeholder="Last"
              value={c.lastName ?? c.name ?? ""}
              onChange={(e) =>
                setCreator(i, { lastName: e.target.value, name: undefined })
              }
            />
            <select
              value={c.creatorType}
              onChange={(e) => setCreator(i, { creatorType: e.target.value })}
            >
              <option value="author">author</option>
              <option value="editor">editor</option>
              <option value="contributor">contributor</option>
              <option value="translator">translator</option>
            </select>
            <button
              className="icon-btn"
              aria-label="Remove creator"
              onClick={() => {
                setCreators((cs) => cs.filter((_, j) => j !== i));
                setDirty(true);
              }}
            >
              <CloseIcon size={11} />
            </button>
          </div>
        ))}
      </div>

      <label className="meta-field">
        <span>Abstract</span>
        <textarea
          rows={5}
          value={draft.abstractNote ?? ""}
          onChange={(e) => setField("abstractNote", e.target.value)}
        />
      </label>

      {EDITABLE_FIELDS.map((f) => (
        <label className="meta-field" key={f.id}>
          <span>{f.label}</span>
          {f.multiline ? (
            <textarea
              rows={2}
              value={draft[f.id] ?? ""}
              onChange={(e) => setField(f.id, e.target.value)}
            />
          ) : (
            <input
              value={draft[f.id] ?? ""}
              onChange={(e) => setField(f.id, e.target.value)}
            />
          )}
        </label>
      ))}

      <AttachmentList itemKey={item.key} />

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

export function MetadataPanel() {
  const selectedKeys = useStore((s) => s.selectedKeys);
  const items = useStore((s) => s.library.items);
  const { metaOpen, setMetaOpen } = useStore();

  const selected = useMemo(
    () => items.filter((i) => selectedKeys.includes(i.key)),
    [items, selectedKeys],
  );

  let content: React.ReactNode;
  if (selected.length === 0) {
    content = <div className="meta-empty">Select an item to see its details</div>;
  } else if (selected.length === 1) {
    // A file with no parent entry has almost no metadata to edit — it
    // gets its own trimmed panel rather than a page of empty fields.
    content = isStandaloneAttachment(selected[0]) ? (
      <AttachmentPanel item={selected[0]} />
    ) : (
      <SingleItemEditor item={selected[0]} />
    );
  } else {
    content = <SummaryView items={selected} />;
  }

  return (
    <>
      {metaOpen && (
        <div className="drawer-scrim" onClick={() => setMetaOpen(false)} />
      )}
      <aside className={`meta-panel ${metaOpen ? "open" : ""}`}>{content}</aside>
    </>
  );
}
