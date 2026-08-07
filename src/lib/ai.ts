// AI actions (the toolbar "AI ▾" menu). Each runs sequentially over the
// selected items and narrates progress in the activity log.
//
//  - getAbstracts: LiteParse extracts text from the PDF's first pages,
//    the model pulls the abstract out verbatim, and it's written to
//    abstractNote. The model never has to "read" the PDF itself.
//  - tidyItems: metadata + trimmed-CrossRef cleanup of all fields.
import { pdfAttachmentOf } from "./collections";
import { scheduleTrayClear } from "../components/TaskTray";
import { appLog, useStore } from "./store";
import { invoke } from "./tauri";
import type { ZItem } from "./types";

export async function getAbstracts(keys: string[]): Promise<void> {
  const store = useStore.getState();
  if (store.tidying) return;
  const items = store.library.items.filter((i) => keys.includes(i.key));
  if (items.length === 0) return;

  store.setTidying(true);
  store.startUiTasks(
    "Get abstract",
    items.map((i) => ({ id: i.key, title: label(i) })),
  );
  const task = (id: string, status: "working" | "done" | "error", note?: string) =>
    useStore.getState().updateUiTask(id, { status, note });
  appLog("info", `Get Abstract: processing ${items.length} item(s)…`);
  let changed = 0;
  try {
    for (const item of items) {
      try {
        task(item.key, "working");
        const existing = String(item.data?.abstractNote ?? "").trim();
        if (existing) {
          appLog("info", `Get Abstract: “${label(item)}” already has one`);
          task(item.key, "done", "already has one");
          continue;
        }
        const pageText = await firstPagesText(item);
        if (!pageText) {
          appLog(
            "warn",
            `Get Abstract: no PDF text for “${label(item)}” — skipped`,
          );
          task(item.key, "error", "no PDF text");
          continue;
        }
        const abstract = await invoke<string>("ai_get_abstract", {
          item,
          pageText,
        });
        if (!abstract) {
          appLog("info", `Get Abstract: none found in “${label(item)}”`);
          task(item.key, "done", "none found");
          continue;
        }
        await invoke("update_zotero_item", {
          key: item.key,
          version: item.version,
          patch: { abstractNote: abstract },
        });
        useStore.getState().patchItemData(item.key, { abstractNote: abstract });
        changed++;
        appLog("info", `Get Abstract: saved for “${label(item)}”`);
        task(item.key, "done", "saved");
      } catch (e) {
        appLog("error", `Get Abstract failed on “${label(item)}”: ${e}`);
        task(item.key, "error", String(e).slice(0, 80));
      }
    }
  } finally {
    useStore.getState().setTidying(false);
    appLog("info", `Get Abstract finished — ${changed} item(s) updated`);
    scheduleTrayClear();
  }
}

export async function tidyItems(keys: string[]): Promise<void> {
  const store = useStore.getState();
  if (store.tidying) return;
  const items = store.library.items.filter((i) => keys.includes(i.key));
  if (items.length === 0) return;

  store.setTidying(true);
  store.startUiTasks(
    "Tidy metadata",
    items.map((i) => ({ id: i.key, title: label(i) })),
  );
  const task = (id: string, status: "working" | "done" | "error", note?: string) =>
    useStore.getState().updateUiTask(id, { status, note });
  appLog("info", `AI Tidy: processing ${items.length} item(s)…`);
  let changed = 0;
  try {
    for (const item of items) {
      try {
        task(item.key, "working");
        appLog("info", `AI Tidy: asking the model about “${label(item)}”…`);
        const fixes = await invoke<Record<string, unknown>>("ai_tidy_item", {
          item,
        });
        const fields = Object.keys(fixes ?? {});
        if (fields.length === 0) {
          appLog("info", `AI Tidy: “${label(item)}” already looks good`);
          task(item.key, "done", "already good");
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
        task(item.key, "done", `${fields.length} field(s)`);
      } catch (e) {
        appLog("error", `AI Tidy failed on “${label(item)}”: ${e}`);
        task(item.key, "error", String(e).slice(0, 80));
      }
    }
  } finally {
    useStore.getState().setTidying(false);
    appLog("info", `AI Tidy finished — ${changed} item(s) updated`);
    scheduleTrayClear();
  }
}

/** LiteParse text of the first pages of the item's PDF, or null when it
 *  has no PDF / download / parsing fails. */
async function firstPagesText(item: ZItem): Promise<string | null> {
  const att = pdfAttachmentOf(useStore.getState().library.items, item.key);
  if (!att) return null;
  try {
    appLog("info", `Get Abstract: reading PDF of “${label(item)}”…`);
    // Lazy import: the LiteParse WASM is ~5 MB and only needed here.
    const [{ extractFirstPagesText }, bytes] = await Promise.all([
      import("./pdfText"),
      invoke<ArrayBuffer>("download_attachment_file", { attKey: att.key }),
    ]);
    const text = await extractFirstPagesText(bytes);
    return text || null;
  } catch (e) {
    appLog("warn", `Get Abstract: PDF parsing failed (${e})`);
    return null;
  }
}

function label(item: ZItem): string {
  const t = item.data?.title ?? item.key;
  return String(t).length > 60 ? `${String(t).slice(0, 57)}…` : String(t);
}
