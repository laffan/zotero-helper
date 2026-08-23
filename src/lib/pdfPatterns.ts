// Where a source keeps its PDFs — the frontend half of the pattern book
// (src-tauri/src/pdf/patterns.rs).
//
// The point of learning a pattern is the *other* items from the same
// publisher: when one of them finally comes through — usually because
// the user walked it past a robot check in the capture browser — every
// item parked on "PDF needs your help" from that same source is worth
// another try. Re-queued jobs go through the ordinary pipeline, and the
// backend paces the speculative requests, so a batch trickles rather
// than stampedes.
import { appLog, useStore } from "./store";
import { invoke } from "./tauri";
import type { ImportJob, PdfPattern } from "./types";

/** Patterns already tried against a job, so a parked item is woken at
 *  most once per thing we've learned. */
const wokenFor = new Map<string, Set<string>>();

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function doiPrefix(doi: string | undefined): string {
  return String(doi ?? "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .split("/")[0]
    .toLowerCase();
}

function patternKey(p: PdfPattern): string {
  return `${p.host}|${p.doiPrefix}|${p.template}|${p.rewriteFrom}`;
}

/** Would this pattern have anything to say about that job? */
function covers(p: PdfPattern, j: ImportJob): boolean {
  if (p.doiPrefix && doiPrefix(j.doi) === p.doiPrefix) return true;
  return Boolean(p.host) && hostOf(j.landingUrl) === p.host;
}

/**
 * Record the URL a PDF actually came from, and return the ids of parked
 * jobs from the same source that should be re-queued because of it.
 */
export async function learnPdfPattern(
  job: ImportJob,
  pdfUrl: string,
): Promise<string[]> {
  if (!pdfUrl) return [];
  let pattern: PdfPattern | null = null;
  try {
    pattern = await invoke<PdfPattern | null>("learn_pdf_pattern", {
      doi: job.doi ?? null,
      landingUrl: job.landingUrl ?? null,
      pdfUrl,
    });
  } catch (e) {
    appLog("debug", `Could not record where that PDF came from: ${e}`);
    return [];
  }
  if (!pattern) return [];

  const key = patternKey(pattern);
  const s = useStore.getState();
  pruneWoken(s.jobs);
  const waiting = s.jobOrder
    .map((id) => s.jobs[id])
    .filter((j): j is ImportJob => Boolean(j))
    .filter(
      (j) =>
        j.id !== job.id &&
        j.stage === "needs-manual" &&
        covers(pattern as PdfPattern, j) &&
        !wokenFor.get(j.id)?.has(key),
    );
  for (const j of waiting) {
    const tried = wokenFor.get(j.id) ?? new Set<string>();
    tried.add(key);
    wokenFor.set(j.id, tried);
  }
  if (waiting.length) {
    appLog(
      "info",
      `Retrying ${waiting.length} parked item(s) from ${pattern.host} with the pattern that just worked`,
    );
  }
  return waiting.map((j) => j.id);
}

/** Jobs come and go (dismissed, finished, cleared) — drop bookkeeping
 *  for ids the store no longer knows about. */
function pruneWoken(live: Record<string, ImportJob>): void {
  for (const id of wokenFor.keys()) {
    if (!live[id]) wokenFor.delete(id);
  }
}
