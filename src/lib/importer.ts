// The DOI-import pipeline. Each identifier becomes a job that advances
// through: resolve → create parent item → find PDF → download → upload.
// Jobs that cannot fetch a PDF automatically park in "needs-manual" and the
// user finishes them via the rescue modal / capture browser.
import { appLog, useStore } from "./store";
import { invoke } from "./tauri";
import type { DownloadedPdf, Resolved, ZItemData } from "./types";

let pumping = false;
const inFlightCaptures = new Set<string>();

export function startImport(rawText: string, collectionKey?: string): number {
  const identifiers = rawText
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const store = useStore.getState();
  for (const identifier of identifiers) {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    store.addJob({
      id,
      identifier,
      stage: "pending",
      candidates: [],
      collectionKey:
        collectionKey && collectionKey !== "all" && collectionKey !== "unfiled"
          ? collectionKey
          : undefined,
    });
  }
  if (identifiers.length) {
    appLog("info", `Queued ${identifiers.length} identifier(s) for import`);
    void pump();
  }
  return identifiers.length;
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const s = useStore.getState();
      const next = s.jobOrder
        .map((id) => s.jobs[id])
        .find((j) => j && j.stage === "pending");
      if (!next) break;
      await runJob(next.id);
    }
  } finally {
    pumping = false;
  }
}

function job(id: string) {
  return useStore.getState().jobs[id];
}

async function runJob(id: string): Promise<void> {
  const upd = useStore.getState().updateJob;
  try {
    // Steps 1–2 are skipped when retrying a job whose item already exists.
    if (!job(id).itemKey) {
      // 1. Resolve identifier → metadata
      upd(id, { stage: "resolving" });
      const resolved = await invoke<Resolved>("resolve_identifier", {
        identifier: job(id).identifier,
      });
      const data: ZItemData = { ...resolved.item } as ZItemData;
      const collectionKey = job(id).collectionKey;
      if (collectionKey) data.collections = [collectionKey];
      upd(id, {
        item: data,
        candidates: resolved.pdfCandidates ?? [],
        landingUrl: resolved.landingUrl ?? undefined,
        doi: typeof data.DOI === "string" ? data.DOI : undefined,
        stage: "creating",
      });

      // 2. Create the parent item in Zotero
      const resp = await invoke<Record<string, any>>("create_zotero_items", {
        items: [data],
      });
      const created = resp?.successful?.["0"];
      const key: string | undefined = created?.key ?? created?.data?.key;
      if (!key) {
        throw new Error(
          `Zotero rejected the item: ${JSON.stringify(resp?.failed ?? resp)}`,
        );
      }
      appLog("info", `Created Zotero item ${key} — “${data.title ?? job(id).identifier}”`);
      upd(id, { itemKey: key });
      useStore.getState().upsertItem({
        key,
        version: created?.version ?? 0,
        data: { ...(created?.data ?? data), key } as ZItemData,
        meta: created?.meta,
      });
    }

    // 3. Find PDF candidates
    upd(id, { stage: "finding-pdf" });
    let candidates: string[] = [];
    try {
      candidates = await invoke<string[]>("find_pdf_candidates", {
        doi: job(id).doi ?? null,
        landingUrl: job(id).landingUrl ?? null,
        seed: job(id).candidates,
      });
    } catch (e) {
      appLog("warn", `PDF search failed: ${e}`);
    }
    upd(id, { candidates });

    if (candidates.length === 0) {
      upd(id, {
        stage: "needs-manual",
        message: "No PDF found automatically — use the browser to locate one",
      });
      return;
    }

    // 4. Try downloading each candidate (backend enforces rate limits)
    upd(id, { stage: "downloading" });
    let downloaded: DownloadedPdf | null = null;
    for (const url of candidates) {
      try {
        downloaded = await invoke<DownloadedPdf>("download_pdf", {
          url,
          referer: job(id).landingUrl ?? null,
        });
        break;
      } catch (e) {
        appLog("warn", `Candidate failed (${url}): ${e}`);
      }
    }
    if (!downloaded) {
      upd(id, {
        stage: "needs-manual",
        message:
          "Automatic download was blocked — open the browser to fetch the PDF yourself",
      });
      return;
    }

    // 5. Upload to Zotero
    await uploadAndFinish(id, downloaded.path, downloaded.filename);
  } catch (e) {
    appLog("error", `Import failed for “${job(id)?.identifier}”: ${e}`);
    upd(id, { stage: "error", message: String(e) });
  }
}

/** Re-queue a failed job from the start (or from PDF search if the item exists). */
export function retryJob(id: string): void {
  const j = job(id);
  if (!j) return;
  useStore.getState().updateJob(id, { stage: "pending", message: undefined });
  void pump();
}

/** Attach a local PDF file to the job's item and complete the job. */
export async function uploadAndFinish(
  id: string,
  filePath: string,
  filename?: string,
): Promise<void> {
  const upd = useStore.getState().updateJob;
  const j = job(id);
  if (!j?.itemKey) {
    appLog("error", "Cannot attach PDF: the parent item was never created");
    return;
  }
  try {
    upd(id, { stage: "uploading" });
    await invoke<string>("attach_pdf", {
      parentKey: j.itemKey,
      filePath,
      filename: filename ?? null,
    });
    upd(id, { stage: "done", hasPdf: true, message: undefined });
    appLog("info", `PDF attached to ${j.itemKey} ✓`);
    // Reflect the new attachment locally so the ✓PDF chip shows immediately.
    useStore.getState().upsertItem({
      key: `${j.itemKey}-att-local`,
      version: 0,
      data: {
        key: `${j.itemKey}-att-local`,
        version: 0,
        itemType: "attachment",
        parentItem: j.itemKey,
        contentType: "application/pdf",
        linkMode: "imported_file",
      },
    });
    // Auto-dismiss the finished job row after a moment.
    setTimeout(() => {
      const cur = useStore.getState().jobs[id];
      if (cur?.stage === "done") useStore.getState().dismissJob(id);
    }, 4000);
  } catch (e) {
    appLog("error", `Attaching PDF failed: ${e}`);
    upd(id, { stage: "needs-manual", message: `Upload failed: ${e}` });
  }
}

/** Try downloading a specific URL for a parked job (rescue modal / capture). */
export async function downloadForJob(id: string, url: string): Promise<void> {
  const upd = useStore.getState().updateJob;
  if (inFlightCaptures.has(id)) return;
  inFlightCaptures.add(id);
  try {
    upd(id, { stage: "downloading" });
    const pdf = await invoke<DownloadedPdf>("download_pdf", {
      url,
      referer: job(id)?.landingUrl ?? null,
    });
    await invoke("close_capture_window", { jobId: id }).catch(() => {});
    await uploadAndFinish(id, pdf.path, pdf.filename);
  } catch (e) {
    appLog("warn", `Download failed: ${e}`);
    upd(id, {
      stage: "needs-manual",
      message: `Download failed: ${e}`,
    });
  } finally {
    inFlightCaptures.delete(id);
  }
}

/** Called when the capture window intercepted a completed download. */
export async function captureFinished(id: string, path: string): Promise<void> {
  if (inFlightCaptures.has(id)) return;
  inFlightCaptures.add(id);
  try {
    await uploadAndFinish(id, path);
  } finally {
    inFlightCaptures.delete(id);
  }
}
