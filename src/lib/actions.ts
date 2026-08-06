// App-level actions: bootstrap, event listeners, sync, collection CRUD,
// item editing.
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
  await on<{ jobId: string; path: string }>("pdf-captured", (p) => {
    appLog("info", "Capture browser intercepted a download");
    void captureFinished(p.jobId, p.path);
  });
  await on<{ jobId: string; url: string }>("pdf-url-detected", (p) => {
    const j = useStore.getState().jobs[p.jobId];
    if (j && (j.stage === "needs-manual" || j.stage === "downloading")) {
      appLog("info", `Capture browser landed on a PDF: ${p.url}`);
      void downloadForJob(p.jobId, p.url);
    }
  });

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
