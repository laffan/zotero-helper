// Manual PDF rescue for a parked import job: open the embedded capture
// browser (desktop), open the system browser (all platforms), paste a direct
// PDF URL, or attach a file already on disk.
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { downloadForJob, uploadAndFinish } from "../lib/importer";
import { appLog, useStore } from "../lib/store";
import { invoke } from "../lib/tauri";
import { GlobeIcon, PdfIcon } from "./Icons";
import { Modal } from "./Modal";

export function PdfRescueModal({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const job = useStore((s) => s.jobs[jobId]);
  const [manualUrl, setManualUrl] = useState("");
  const [busy, setBusy] = useState(false);

  if (!job) return null;
  const landing = job.landingUrl ?? job.candidates[0];

  const openCapture = async () => {
    if (!landing) return;
    try {
      await invoke("open_capture_window", { url: landing, jobId });
      onClose(); // capture events finish the job in the background
    } catch (e) {
      appLog("warn", `${e}`);
    }
  };

  const openSystem = async () => {
    if (!landing) return;
    try {
      await openUrl(landing);
    } catch (e) {
      appLog("warn", `Could not open browser: ${e}`);
    }
  };

  const tryUrl = async (url: string) => {
    setBusy(true);
    try {
      await downloadForJob(jobId, url);
      const j = useStore.getState().jobs[jobId];
      if (!j || j.stage === "done" || j.stage === "uploading") onClose();
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    try {
      const file = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof file === "string") {
        setBusy(true);
        await uploadAndFinish(jobId, file);
        onClose();
      }
    } catch (e) {
      appLog("warn", `File picker failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Find the PDF yourself" onClose={onClose} wide>
      <p className="hint">
        <strong>{job.item?.title ?? job.identifier}</strong>
      </p>
      {job.message && <p className="hint">{job.message}</p>}

      <div className="rescue-actions">
        <button className="tool-btn accent" onClick={openCapture} disabled={!landing}>
          <GlobeIcon />
          Open capture browser
        </button>
        <button className="tool-btn" onClick={openSystem} disabled={!landing}>
          Open in system browser
        </button>
        <button className="tool-btn" onClick={pickFile} disabled={busy}>
          <PdfIcon />
          Attach PDF file…
        </button>
      </div>
      <p className="hint">
        In the capture browser, any PDF you download (or navigate to) is
        grabbed automatically and attached to the item. On iPad, use the system
        browser to save the PDF to Files, then “Attach PDF file…”.
      </p>

      {job.candidates.length > 0 && (
        <>
          <h3 className="rescue-subhead">Candidates found</h3>
          <ul className="candidate-list">
            {job.candidates.map((c) => (
              <li key={c}>
                <button
                  className="link-btn"
                  disabled={busy}
                  onClick={() => tryUrl(c)}
                  title="Try downloading this URL"
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="rescue-subhead">Direct PDF URL</h3>
      <div className="field-with-btn">
        <input
          placeholder="https://…/paper.pdf"
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
        />
        <button
          className="mini-btn"
          disabled={!manualUrl.trim() || busy}
          onClick={() => tryUrl(manualUrl.trim())}
        >
          Download
        </button>
      </div>
    </Modal>
  );
}
