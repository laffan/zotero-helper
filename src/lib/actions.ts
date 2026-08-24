// App-level actions: bootstrap, event listeners, sync, collection CRUD,
// item editing.
import { scheduleTrayClear } from "../components/TaskTray";
import { itemTitle } from "./collections";
import { loadChats } from "./ai/chat";
import { captureFinished, downloadForJob } from "./importer";
import { appLog, useStore } from "./store";
import { invoke, isTauri, on } from "./tauri";
import type {
  LibraryCache,
  LogLine,
  Settings,
  SyncProgress,
} from "./types";

let bootstrapped = false;

export async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  const store = useStore.getState();

  if (!isTauri) {
    appLog(
      "warn",
      "Running outside Tauri — backend commands are unavailable (UI preview mode)",
    );
    store.setView("settings");
    return;
  }

  // Backend → frontend event streams.
  await on<LogLine>("app-log", (line) => useStore.getState().pushLog(line));
  await on<SyncProgress>("sync-progress", (p) =>
    useStore.getState().setSyncProgress(p),
  );
  await on<{ jobId: string; path: string; url?: string }>(
    "pdf-captured",
    (p) => {
      appLog("info", "Capture browser intercepted a download");
      void captureFinished(p.jobId, p.path, p.url);
    },
  );
  await on<{ jobId: string; url: string }>("pdf-url-detected", (p) => {
    const j = useStore.getState().jobs[p.jobId];
    if (j && (j.stage === "needs-manual" || j.stage === "downloading")) {
      appLog("info", `Capture browser landed on a PDF: ${p.url}`);
      void downloadForJob(p.jobId, p.url);
    }
  });

  // iPad: the native capture view (tauri-plugin-capture-view) reports
  // results as plugin events rather than app events.
  if (document.documentElement.classList.contains("ipados")) {
    try {
      const { addPluginListener } = await import("@tauri-apps/api/core");
      await addPluginListener(
        "capture-view",
        "captured",
        (p: { jobId: string; path: string; url?: string }) => {
          appLog("info", "Capture browser intercepted a PDF");
          void captureFinished(p.jobId, p.path, p.url);
        },
      );
      await addPluginListener(
        "capture-view",
        "failed",
        (p: { jobId: string; message: string }) => {
          appLog("warn", `Capture: ${p.message}`);
          useStore.getState().updateJob(p.jobId, {
            stage: "needs-manual",
            message: p.message,
          });
        },
      );
    } catch (e) {
      appLog("debug", `Capture plugin events unavailable: ${e}`);
    }
  }

  // Conversations are local to this app, so they load whether or not
  // Zotero credentials are in place yet.
  await loadChats();

  try {
    const settings = await invoke<Settings>("get_settings");
    store.setSettings(settings);
    if (!settings.zoteroApiKey || !settings.zoteroUserId) {
      store.setView("settings");
      appLog("info", "Add your Zotero API credentials to get started");
      return;
    }
    const cached = await invoke<LibraryCache>("load_library");
    store.setLibrary(cached);
    if (cached.version === 0) {
      appLog("info", "No local library yet — starting first sync");
      await syncNow(true);
    } else {
      appLog(
        "info",
        `Loaded ${cached.items.length} items from local cache (v${cached.version})`,
      );
      // Refresh quietly in the background.
      void syncNow(false);
    }
  } catch (e) {
    appLog("error", `Startup failed: ${e}`);
  }
}

export async function syncNow(full: boolean): Promise<void> {
  const store = useStore.getState();
  if (store.syncing) return;
  store.setSyncing(true);
  try {
    const lib = await invoke<LibraryCache>("sync_library", { full });
    useStore.getState().setLibrary(lib);
  } catch (e) {
    appLog("error", `Sync failed: ${e}`);
  } finally {
    useStore.getState().setSyncing(false);
    useStore.getState().setSyncProgress(null);
  }
}

/** Folder-scoped sync — fetches only the given collection's changes.
 *  The cheap option for very large libraries. */
export async function syncFolder(key: string): Promise<void> {
  if (key === "all" || key === "unfiled") return syncNow(false);
  const store = useStore.getState();
  if (store.syncing) return;
  store.setSyncing(true);
  try {
    const lib = await invoke<LibraryCache>("sync_collection", {
      collectionKey: key,
    });
    useStore.getState().setLibrary(lib);
  } catch (e) {
    appLog("error", `Folder sync failed: ${e}`);
  } finally {
    useStore.getState().setSyncing(false);
    useStore.getState().setSyncProgress(null);
  }
}

/** File items into a collection — what a drag from the item list onto a
 *  sidebar folder does. Zotero keeps an item in every collection it was
 *  added to, so this only ever adds: nothing is taken out of the folder
 *  the items were dragged from. Returns how many were filed. */
export async function addItemsToCollection(
  itemKeys: string[],
  collectionKey: string,
  collectionName?: string,
): Promise<number> {
  const store = useStore.getState();
  const name =
    collectionName ??
    String(
      store.library.collections.find((c) => c.key === collectionKey)?.data
        ?.name ?? collectionKey,
    );
  const items = store.library.items.filter(
    (i) => itemKeys.includes(i.key) && !i.data?.parentItem,
  );
  const todo = items.filter(
    (i) => !(i.data?.collections ?? []).includes(collectionKey),
  );
  if (todo.length === 0) {
    if (items.length > 0) {
      appLog("info", `Already in “${name}” — nothing to file`);
    }
    return 0;
  }
  // One item is a single quick write; a batch gets the progress tray.
  const tray = todo.length > 1;
  if (tray) {
    store.startUiTasks(
      `Add to ${name}`,
      todo.map((i) => ({ id: i.key, title: itemTitle(i) })),
    );
  }
  let filed = 0;
  try {
    for (const item of todo) {
      const task = (status: "working" | "done" | "error", note?: string) => {
        if (tray) useStore.getState().updateUiTask(item.key, { status, note });
      };
      try {
        task("working");
        const collections = [
          ...(item.data?.collections ?? []),
          collectionKey,
        ];
        await invoke("update_zotero_item", {
          key: item.key,
          version: item.version,
          patch: { collections },
        });
        useStore.getState().patchItemData(item.key, { collections });
        filed++;
        task("done");
      } catch (e) {
        appLog("error", `Could not file “${itemTitle(item)}” into “${name}”: ${e}`);
        task("error", String(e).slice(0, 80));
      }
    }
  } finally {
    if (tray) scheduleTrayClear();
  }
  if (filed) {
    appLog("info", `Filed ${filed} item(s) into “${name}”`);
    // Picks up the new item versions, so the next drag isn't a conflict.
    void syncNow(false);
  }
  return filed;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await invoke("save_settings", { settings });
  useStore.getState().setSettings(settings);
}

export async function verifyKey(
  key: string,
): Promise<{ userID?: number; username?: string }> {
  return invoke("verify_zotero_key", { key });
}

export async function createFolder(
  name: string,
  parent?: string,
): Promise<void> {
  const resp = await invoke<Record<string, any>>("create_collection", {
    name,
    parent: parent ?? null,
  });
  const ok = resp?.successful?.["0"];
  if (!ok) {
    throw new Error(JSON.stringify(resp?.failed ?? resp));
  }
  appLog("info", `Collection “${name}” created`);
  await syncNow(false);
}

export async function deleteFolder(key: string): Promise<void> {
  const col = useStore
    .getState()
    .library.collections.find((c) => c.key === key);
  if (!col) return;
  await invoke("delete_collection", { key, version: col.version });
  appLog("info", `Collection “${col.data?.name}” deleted`);
  const st = useStore.getState();
  if (st.selectedCollection === key) st.selectCollection("all");
  await syncNow(false);
}

/** Open in the Zotero app: the PDF itself when the item has one
 *  (zotero://open-pdf), otherwise the entry (zotero://select). Passing a
 *  collection selects the entry inside that folder, which matters for an
 *  item filed in several — it lands where you were looking. */
export async function openInZotero(
  itemKey: string,
  attKey?: string,
  collectionKey?: string,
  page?: number,
): Promise<void> {
  try {
    await invoke("open_in_zotero", {
      itemKey,
      attKey: attKey ?? null,
      collectionKey: collectionKey ?? null,
      page: page ?? null,
    });
  } catch (e) {
    appLog("warn", `Open in Zotero failed: ${e}`);
  }
}

export async function saveItemEdits(
  key: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const item = useStore.getState().library.items.find((i) => i.key === key);
  if (!item) throw new Error("Item not found locally");
  await invoke("update_zotero_item", { key, version: item.version, patch });
  useStore.getState().patchItemData(key, patch);
  appLog("info", `Saved changes to “${item.data?.title ?? key}”`);
  // Pick up the new version number quietly.
  void syncNow(false);
}
