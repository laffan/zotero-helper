// Embedded PDF-capture browser (desktop). The modal renders the chrome;
// a Rust child webview covers the body area and follows it on resize.
// Downloads and PDF navigations inside the webview finish the job via
// the pdf-captured / pdf-url-detected events. On platforms without
// child webviews (iPadOS) opening fails and the modal shows the
// system-browser + file-picker fallback instead.
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { invoke } from "../lib/tauri";
import { CloseIcon, GlobeIcon, PdfIcon, Spinner } from "./Icons";

export function CaptureModal({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const job = useStore((s) => s.jobs[jobId]);
  const setModal = useStore((s) => s.setModal);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    void invoke("close_capture_window", { jobId }).catch(() => {});
    onClose();
  }, [jobId, onClose]);

  // Open the child webview over the body area (once).
  useEffect(() => {
    const el = bodyRef.current;
    const landing = job?.landingUrl ?? job?.candidates[0];
    if (!el || !landing) {
      setError(landing ? "Not ready" : "No page to open for this item");
      return;
    }
    const r = el.getBoundingClientRect();
    invoke("open_capture_window", {
      url: landing,
      jobId,
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
    })
      .then(() => setOpened(true))
      .catch((e) => setError(String(e)));
    return () => {
      void invoke("close_capture_window", { jobId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Keep the webview glued to the body rect.
  useEffect(() => {
    if (!opened) return;
    const el = bodyRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      void invoke("capture_set_bounds", {
        jobId,
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
      }).catch(() => {});
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [opened, jobId]);

  // The capture succeeded once the job moves on — close the browser.
  const stage = job?.stage;
  useEffect(() => {
    if (!job || stage === "uploading" || stage === "done") close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  if (!job) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal modal-capture" role="dialog" aria-label="Find the PDF">
        <div className="capture-header">
          <span className="capture-title" title={String(job.item?.title ?? job.identifier)}>
            {job.stage === "downloading" && <Spinner size={13} />}
            {String(job.item?.title ?? job.identifier)}
          </span>
          <button
            className="mini-btn"
            onClick={() => void invoke("capture_back", { jobId }).catch(() => {})}
            disabled={!opened}
          >
            ← Back
          </button>
          <button
            className="mini-btn accent"
            onClick={() => void invoke("capture_grab", { jobId }).catch(() => {})}
            disabled={!opened}
            title="Treat the page currently shown as the PDF and attach it"
          >
            <PdfIcon size={12} /> Grab this page
          </button>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="capture-body" ref={bodyRef}>
          {!opened && !error && (
            <div className="capture-placeholder">
              <Spinner /> Opening browser…
            </div>
          )}
          {error && (
            <div className="capture-placeholder">
              <GlobeIcon />
              <p className="hint">{error}</p>
              <p className="hint">
                Use “Open in system browser” from the previous screen, then
                “Attach PDF file…” once you've saved the PDF.
              </p>
              <button
                className="mini-btn"
                onClick={() => setModal({ kind: "rescue", jobId })}
              >
                Back to options
              </button>
            </div>
          )}
        </div>
        <div className="capture-footer hint">
          Download the PDF on the publisher page (or navigate to it) and it's
          attached automatically — use “Grab this page” if it's already showing.
        </div>
      </div>
    </div>
  );
}
