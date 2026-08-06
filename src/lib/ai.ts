// "AI Tidy" driver: runs the backend tidy command for each selected item
// sequentially, applies returned fixes to Zotero, and mirrors them locally.
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
        const fixes = await invoke<Record<string, unknown>>("ai_tidy_item", {
          item,
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

function label(item: ZItem): string {
  const t = item.data?.title ?? item.key;
  return String(t).length > 60 ? `${String(t).slice(0, 57)}…` : String(t);
}
