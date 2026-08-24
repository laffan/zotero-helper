// The single-item metadata panel.
//
// It reads as a record, not a form: every field shows its value as text,
// and hovering a field's label reveals a small Edit link that swaps just
// that field for an input. The abstract is the reason — it is the field
// you most often want to *read*, and a five-row textarea is the worst
// possible way to show a paragraph you aren't editing.
//
// The hierarchy is carried by type and colour rather than by boxes: the
// title is the only thing set in bold, field names are small, quiet and
// capitalised, and every value sits at full contrast so the content is
// the part that reads. Fields are separated by space, not by rules.
//
// Save is still the one commit point: editing a field only changes the
// draft, and nothing reaches Zotero until Save.
import { useEffect, useRef, useState } from "react";
import { saveItemEdits } from "../lib/actions";
import { appLog } from "../lib/store";
import { type ZCreator, type ZItem } from "../lib/types";
import { AttachmentList } from "./AttachmentList";
import { CloseIcon, Spinner } from "./Icons";

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

/** A field's label plus its Edit/Done link. The link is invisible until
 *  the label is hovered, so the panel reads as prose — except where
 *  there is no pointer to hover with, and on the field being edited. */
function FieldHead({
  label,
  editing,
  onToggle,
  extra,
}: {
  label: string;
  editing: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className={`meta-field-head ${editing ? "editing" : ""}`}>
      <span>{label}</span>
      <button className="meta-edit" onClick={onToggle}>
        {editing ? "Done" : "Edit"}
      </button>
      {extra}
    </div>
  );
}

/** Read view of a value. An empty field still gets a row, so it stays
 *  somewhere you can hover and fill in. */
function ReadValue({ value, block }: { value: string; block?: boolean }) {
  if (!value.trim()) return <span className="meta-value empty">—</span>;
  return (
    <span className={`meta-value ${block ? "block" : ""}`}>{value}</span>
  );
}

function creatorLine(c: ZCreator): string {
  const name = c.name
    ? c.name
    : [c.firstName, c.lastName].filter(Boolean).join(" ");
  return c.creatorType && c.creatorType !== "author"
    ? `${name} (${c.creatorType})`
    : name;
}

export function ItemEditor({ item }: { item: ZItem }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [creators, setCreators] = useState<ZCreator[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** Field ids currently swapped for inputs. */
  const [editing, setEditing] = useState<string[]>([]);
  const lastKey = useRef<string | null>(null);

  // Re-seed the draft on selection change, and also whenever the item's
  // data changes underneath us (AI actions, sync) — but never clobber
  // edits the user is in the middle of making.
  useEffect(() => {
    if (lastKey.current === item.key && dirty) return;
    const switched = lastKey.current !== item.key;
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
    // A different item starts closed again; a refresh of the same one
    // leaves open fields open.
    if (switched) setEditing([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, dirty]);

  const toggle = (id: string) =>
    setEditing((e) => (e.includes(id) ? e.filter((f) => f !== id) : [...e, id]));
  const isEditing = (id: string) => editing.includes(id);

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
        setEditing([]);
        return;
      }
      await saveItemEdits(item.key, patch);
      setDirty(false);
      // Saved values read better than the inputs they came from.
      setEditing([]);
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

      <div className="meta-field meta-field-title">
        <FieldHead
          label="Title"
          editing={isEditing("title")}
          onToggle={() => toggle("title")}
        />
        {isEditing("title") ? (
          <textarea
            rows={2}
            autoFocus
            value={draft.title ?? ""}
            onChange={(e) => setField("title", e.target.value)}
          />
        ) : (
          <ReadValue value={draft.title ?? ""} block />
        )}
      </div>

      <div className="meta-field">
        <FieldHead
          label="Creators"
          editing={isEditing("creators")}
          onToggle={() => toggle("creators")}
          extra={
            isEditing("creators") ? (
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
            ) : null
          }
        />
        {isEditing("creators") ? (
          creators.map((c, i) => (
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
          ))
        ) : (
          <ReadValue value={creators.map(creatorLine).join(", ")} block />
        )}
      </div>

      <div className="meta-field meta-field-abstract">
        <FieldHead
          label="Abstract"
          editing={isEditing("abstractNote")}
          onToggle={() => toggle("abstractNote")}
        />
        {isEditing("abstractNote") ? (
          <textarea
            rows={10}
            autoFocus
            value={draft.abstractNote ?? ""}
            onChange={(e) => setField("abstractNote", e.target.value)}
          />
        ) : (
          // In full: this is the field you read rather than edit.
          <ReadValue value={draft.abstractNote ?? ""} block />
        )}
      </div>

      {EDITABLE_FIELDS.map((f) => (
        <div className="meta-field" key={f.id}>
          <FieldHead
            label={f.label}
            editing={isEditing(f.id)}
            onToggle={() => toggle(f.id)}
          />
          {isEditing(f.id) ? (
            f.multiline ? (
              <textarea
                rows={3}
                autoFocus
                value={draft[f.id] ?? ""}
                onChange={(e) => setField(f.id, e.target.value)}
              />
            ) : (
              <input
                autoFocus
                value={draft[f.id] ?? ""}
                onChange={(e) => setField(f.id, e.target.value)}
              />
            )
          ) : (
            <ReadValue value={draft[f.id] ?? ""} block={f.multiline} />
          )}
        </div>
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
