import { useMemo, useState } from "react";
import { createFolder } from "../lib/actions";
import { startImport } from "../lib/importer";
import { extractIdentifiers } from "../lib/identifiers";
import { useStore } from "../lib/store";
import { Modal } from "./Modal";

export function ImportModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const selectedCollection = useStore((s) => s.selectedCollection);
  const collections = useStore((s) => s.library.collections);

  const targetName = useMemo(() => {
    if (selectedCollection === "all") return "My Library (no folder)";
    if (selectedCollection === "unfiled") return "My Library (no folder)";
    return (
      collections.find((c) => c.key === selectedCollection)?.data?.name ??
      "selected folder"
    );
  }, [selectedCollection, collections]);

  const count = useMemo(() => extractIdentifiers(text).length, [text]);

  const go = () => {
    startImport(text, selectedCollection);
    onClose();
  };

  return (
    <Modal title="Import identifiers" onClose={onClose}>
      <p className="hint">
        Paste DOIs, ISBNs, arXiv IDs, or URLs — clean lists, or messy notes
        with several identifiers per line (DOIs are picked out of prose and
        doi.org links). Each one becomes a Zotero item; the app then hunts
        for its PDF and uploads it to your library.
      </p>
      <textarea
        className="import-textarea"
        rows={8}
        autoFocus
        placeholder={
          "10.1038/s41586-020-2649-2\narXiv:2303.08774\n978-0-262-03384-8\nhttps://doi.org/10.1126/science.1157784"
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="import-footer">
        <span className="hint">
          Destination: <strong>{targetName}</strong>
        </span>
        <button className="tool-btn accent" disabled={count === 0} onClick={go}>
          Import {count > 0 ? `${count} item(s)` : ""}
        </button>
      </div>
    </Modal>
  );
}

export function NewFolderModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [nested, setNested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedCollection = useStore((s) => s.selectedCollection);
  const collections = useStore((s) => s.library.collections);

  const parentName =
    selectedCollection !== "all" && selectedCollection !== "unfiled"
      ? collections.find((c) => c.key === selectedCollection)?.data?.name
      : undefined;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await createFolder(
        name.trim(),
        nested && parentName ? selectedCollection : undefined,
      );
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New folder" onClose={onClose}>
      <label className="settings-field">
        <span>Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) void go();
          }}
        />
      </label>
      {parentName && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={nested}
            onChange={(e) => setNested(e.target.checked)}
          />
          Create inside “{parentName}”
        </label>
      )}
      {error && <div className="error-msg">{error}</div>}
      <div className="import-footer">
        <span />
        <button
          className="tool-btn accent"
          disabled={!name.trim() || busy}
          onClick={go}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}
