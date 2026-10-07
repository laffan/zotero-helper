// A row for an identifier going through the import pipeline: its
// title, five steps of progress, and — when the PDF needs help — the
// way into the rescue options and the capture browser.
import { retryJob } from "../lib/importer";
import { useStore } from "../lib/store";
import type { ImportJob, ImportStage } from "../lib/types";
import { CheckIcon, CloseIcon, GlobeIcon, Spinner } from "./Icons";

export const JOB_ROW_HEIGHT = 52;

const STAGE_LABELS: Record<ImportStage, string> = {
  pending: "Queued",
  resolving: "Looking up metadata",
  creating: "Creating Zotero item",
  "finding-pdf": "Searching for PDF",
  downloading: "Downloading PDF",
  uploading: "Uploading to Zotero",
  done: "Done",
  "needs-manual": "PDF needs your help",
  error: "Failed",
};

const STAGE_STEP: Record<ImportStage, number> = {
  pending: 0,
  resolving: 1,
  creating: 2,
  "finding-pdf": 3,
  downloading: 3,
  uploading: 4,
  done: 5,
  "needs-manual": 3,
  error: 0,
};

export function JobRow({ jobItem }: { jobItem: ImportJob }) {
  const { setModal, dismissJob } = useStore();
  const busy = ["resolving", "creating", "finding-pdf", "downloading", "uploading"].includes(
    jobItem.stage,
  );
  const title = jobItem.item?.title ?? jobItem.identifier;
  const step = STAGE_STEP[jobItem.stage];
  // What the capture browser would open — the same page the rescue
  // modal's own button uses.
  const landing = jobItem.landingUrl ?? jobItem.candidates[0];

  return (
    <div className={`job-row job-${jobItem.stage}`} style={{ height: JOB_ROW_HEIGHT }}>
      <div className="job-main">
        <div className="job-title" title={String(title)}>
          {busy && <Spinner size={13} />}
          {jobItem.stage === "done" && <CheckIcon size={13} />}
          <span>{String(title)}</span>
        </div>
        <div className="job-status">
          <span className="job-steps" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => (
              <i
                key={n}
                className={
                  step >= n ? (jobItem.stage === "error" ? "bad" : "on") : ""
                }
              />
            ))}
          </span>
          <span className={`job-stage-label stage-${jobItem.stage}`}>
            {STAGE_LABELS[jobItem.stage]}
          </span>
          {jobItem.message && (
            <span className="job-message" title={jobItem.message}>
              — {jobItem.message}
            </span>
          )}
        </div>
      </div>
      <div className="job-actions">
        {jobItem.stage === "needs-manual" && (
          // One button, two halves: the options screen on the left, a
          // shortcut straight into the capture browser on the right —
          // that's the option almost every rescue ends up using.
          <span className="btn-split">
            <button
              className="mini-btn accent"
              onClick={() => setModal({ kind: "rescue", jobId: jobItem.id })}
            >
              Find PDF
            </button>
            <button
              className="mini-btn accent"
              disabled={!landing}
              onClick={() => setModal({ kind: "capture", jobId: jobItem.id })}
              aria-label="Open capture browser"
              title={
                landing
                  ? `Open the capture browser at ${landing}`
                  : "No page to open for this item"
              }
            >
              <GlobeIcon size={12} />
            </button>
          </span>
        )}
        {jobItem.stage === "error" && (
          <button className="mini-btn" onClick={() => retryJob(jobItem.id)}>
            Retry
          </button>
        )}
        {(jobItem.stage === "error" ||
          jobItem.stage === "needs-manual" ||
          jobItem.stage === "done") && (
          <button
            className="icon-btn"
            onClick={() => dismissJob(jobItem.id)}
            aria-label="Dismiss"
            title="Dismiss (keeps the item, skips the PDF)"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
