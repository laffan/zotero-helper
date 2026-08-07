// "AI Tidy" driver: for each selected item, render the first page of its
// PDF (when it has one) to a downsampled JPEG, then have the backend ask
// Claude to extract/correct metadata from that image plus a trimmed
// CrossRef record. Fixes are written to Zotero and mirrored locally.
import { pdfAttachmentOf } from "./collections";
import { appLog, useStore } from "./store";
import { invoke } from "./tauri";
import type { ZItem } from "./types";

export async function tidyItems(keys: string[]): Promise<void> {
  const store = useStore.getState();
  if (store.tidying) return;
  const items = store.library.items.filter((i) => keys.includes(i.key));
  if (items.length === 0) return;

  store.setTidying(true);
  appLog("info", `AI Tidy: processing ${items.length} item(s)…`);
  let changed = 0;
  try {
    for (const item of items) {
      try {
        const pageImage = await firstPageImage(item);
        appLog("info", `AI Tidy: asking the model about “${label(item)}”…`);
        const fixes = await invoke<Record<string, unknown>>("ai_tidy_item", {
          item,
          pageImage,
        });
        const fields = Object.keys(fixes ?? {});
        if (fields.length === 0) {
          appLog("info", `AI Tidy: “${label(item)}” already looks good`);
          continue;
        }
        await invoke("update_zotero_item", {
          key: item.key,
          version: item.version,
          patch: fixes,
        });
        useStore.getState().patchItemData(item.key, fixes);
        changed++;
        appLog(
          "info",
          `AI Tidy: updated ${fields.join(", ")} on “${label(item)}”`,
        );
      } catch (e) {
        appLog("error", `AI Tidy failed on “${label(item)}”: ${e}`);
      }
    }
  } finally {
    useStore.getState().setTidying(false);
    appLog("info", `AI Tidy finished — ${changed} item(s) updated`);
  }
}

/** First page of the item's PDF as base64 JPEG, or null when there is no
 *  PDF or any step fails (the tidy then runs on metadata alone). */
async function firstPageImage(item: ZItem): Promise<string | null> {
  const att = pdfAttachmentOf(useStore.getState().library.items, item.key);
  if (!att) return null;
  try {
    appLog("info", `AI Tidy: fetching PDF first page of “${label(item)}”…`);
    // Lazy import: pdf.js is ~0.5 MB and only needed here.
    const [{ renderFirstPageJpeg }, bytes] = await Promise.all([
      import("./pdfPage"),
      invoke<ArrayBuffer>("download_attachment_file", { attKey: att.key }),
    ]);
    return await renderFirstPageJpeg(bytes);
  } catch (e) {
    appLog(
      "warn",
      `AI Tidy: couldn't render the PDF page (${e}) — using metadata only`,
    );
    return null;
  }
}

function label(item: ZItem): string {
  const t = item.data?.title ?? item.key;
  return String(t).length > 60 ? `${String(t).slice(0, 57)}…` : String(t);
}
