// Desk/project picker for "Send to Hush". The desk list is read from the
// local Hush install when possible; otherwise (iPad, Hush elsewhere) the
// user types names and Hush resolves them case-insensitively.
import { useEffect, useMemo, useState } from "react";
import {
  analyzeSelection,
  listHushDesks,
  sendToHush,
  type HushDesk,
} from "../lib/hush";
import { appLog, useStore } from "../lib/store";
import { SendIcon, Spinner } from "./Icons";
import { Modal } from "./Modal";

const CUSTOM = "__custom__";
const ACTIVE = "";

export function SendToHushModal({ onClose }: { onClose: () => void }) {
  const items = useStore((s) => s.library.items);
  const selectedKeys = useStore((s) => s.selectedKeys);
  const [desks, setDesks] = useState<HushDesk[] | null>(null);
  const [deskChoice, setDeskChoice] = useState<string>(ACTIVE);
  const [customDesk, setCustomDesk] = useState("");
  const [projectChoice, setProjectChoice] = useState<string>(ACTIVE);
  const [customProject, setCustomProject] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listHushDesks().then(setDesks);
  }, []);

  const split = useMemo(
    () => analyzeSelection(items, selectedKeys),
    [items, selectedKeys],
  );

  const chosenDesk = useMemo(
    () => (desks ?? []).find((d) => d.id === deskChoice),
    [desks, deskChoice],
  );

  const deskParam =
    deskChoice === CUSTOM ? customDesk.trim() : chosenDesk?.name ?? "";
  const projectParam =
    projectChoice === CUSTOM
      ? customProject.trim()
      : (chosenDesk?.projects ?? []).find((p) => p.id === projectChoice)
          ?.name ?? "";

  const send = async () => {
    setBusy(true);
    try {
      // Send names rather than ids — robust even when the roster read
      // and the live Hush state have drifted.
      await sendToHush(split.ready, deskParam, projectParam);
      onClose();
    } catch (e) {
      appLog("error", `Send to Hush failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Send to Hush" onClose={onClose}>
      <p className="hint">
        Hush registers each PDF and downloads it from Zotero with its own
        credentials, so items need a PDF attachment already synced to
        Zotero.
      </p>

      <label className="settings-field">
        <span>Desk</span>
        <select
          value={deskChoice}
          onChange={(e) => {
            setDeskChoice(e.target.value);
            setProjectChoice(ACTIVE);
          }}
        >
          <option value={ACTIVE}>Hush’s active desk</option>
          {(desks ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value={CUSTOM}>Type a desk name…</option>
        </select>
      </label>
      {deskChoice === CUSTOM && (
        <input
          autoFocus
          placeholder="Desk name in Hush"
          value={customDesk}
          onChange={(e) => setCustomDesk(e.target.value)}
        />
      )}
      {desks !== null && desks.length === 0 && deskChoice === ACTIVE && (
        <p className="hint">
          Couldn’t read a local Hush library (normal on iPad) — pick “Type
          a desk name…” to target a specific desk.
        </p>
      )}

      <label className="settings-field">
        <span>Project (optional)</span>
        <select
          value={projectChoice}
          onChange={(e) => setProjectChoice(e.target.value)}
        >
          <option value={ACTIVE}>None — desk’s PDFs folder only</option>
          {(chosenDesk?.projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={CUSTOM}>Type a project name…</option>
        </select>
      </label>
      {projectChoice === CUSTOM && (
        <input
          placeholder="Project name in Hush"
          value={customProject}
          onChange={(e) => setCustomProject(e.target.value)}
        />
      )}

      <div className="hint">
        {split.ready.length} item(s) ready to send
        {split.skipped.length > 0 && ` · ${split.skipped.length} skipped`}
      </div>
      {split.skipped.length > 0 && (
        <ul className="candidate-list">
          {split.skipped.map(({ item, reason }) => (
            <li key={item.key} className="hint">
              “{String(item.data?.title ?? item.key)}” — {reason}
            </li>
          ))}
        </ul>
      )}

      <div className="import-footer">
        <span />
        <button
          className="tool-btn accent"
          disabled={
            busy ||
            split.ready.length === 0 ||
            (deskChoice === CUSTOM && !customDesk.trim())
          }
          onClick={send}
        >
          {busy ? <Spinner size={13} /> : <SendIcon size={13} />}
          Send {split.ready.length > 0 ? `${split.ready.length} item(s)` : ""}
        </button>
      </div>
    </Modal>
  );
}
