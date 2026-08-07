import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ImportJob,
  LibraryCache,
  LogLine,
  Settings,
  SyncProgress,
  ZItem,
} from "./types";

export type ModalState =
  | null
  | { kind: "import" }
  | { kind: "newFolder" }
  | { kind: "sendToHush" }
  | { kind: "rescue"; jobId: string }
  | { kind: "capture"; jobId: string };

export type SortBy = "title" | "creator" | "date" | "dateAdded";

interface UiPrefs {
  leftWidth: number;
  rightWidth: number;
  termHeight: number;
  logOpen: boolean;
  summaryFields: string[];
  sortBy: SortBy;
  sortDir: "asc" | "desc";
  /** Sidebar folders folded shut (unlisted folders render open, so new
   *  collections start expanded). */
  collapsedFolders: string[];
}

interface AppStore extends UiPrefs {
  settings: Settings | null;
  library: LibraryCache;
  syncing: boolean;
  syncProgress: SyncProgress | null;
  tidying: boolean;

  view: "main" | "settings";
  selectedCollection: string; // collection key, "all", or "unfiled"
  selectedKeys: string[];
  searchQuery: string;
  sidebarOpen: boolean; // narrow-screen drawer
  metaOpen: boolean; // narrow-screen drawer
  logs: LogLine[];
  jobs: Record<string, ImportJob>;
  jobOrder: string[];
  modal: ModalState;

  setSettings: (s: Settings) => void;
  setLibrary: (l: LibraryCache) => void;
  setSyncing: (b: boolean) => void;
  setSyncProgress: (p: SyncProgress | null) => void;
  setTidying: (b: boolean) => void;
  setView: (v: "main" | "settings") => void;
  selectCollection: (key: string) => void;
  setSelectedKeys: (keys: string[]) => void;
  setSearchQuery: (q: string) => void;
  setSidebarOpen: (b: boolean) => void;
  setMetaOpen: (b: boolean) => void;
  setLogOpen: (b: boolean) => void;
  setModal: (m: ModalState) => void;
  setSort: (by: SortBy) => void;
  setSummaryFields: (f: string[]) => void;
  setPaneSizes: (p: Partial<Pick<UiPrefs, "leftWidth" | "rightWidth" | "termHeight">>) => void;
  toggleFolder: (key: string) => void;

  pushLog: (line: LogLine) => void;
  clearLogs: () => void;

  upsertItem: (item: ZItem) => void;
  patchItemData: (key: string, patch: Record<string, unknown>) => void;

  addJob: (job: ImportJob) => void;
  updateJob: (id: string, patch: Partial<ImportJob>) => void;
  dismissJob: (id: string) => void;
}

const EMPTY_LIBRARY: LibraryCache = {
  version: 0,
  collections: [],
  items: [],
  lastSyncMs: 0,
};

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // persisted UI prefs
      leftWidth: 230,
      rightWidth: 300,
      termHeight: 180,
      logOpen: false,
      summaryFields: ["title", "creators", "abstractNote"],
      sortBy: "dateAdded" as SortBy,
      sortDir: "desc" as const,
      collapsedFolders: [],

      settings: null,
      library: EMPTY_LIBRARY,
      syncing: false,
      syncProgress: null,
      tidying: false,

      view: "main" as const,
      selectedCollection: "all",
      selectedKeys: [],
      searchQuery: "",
      sidebarOpen: false,
      metaOpen: false,
      logs: [],
      jobs: {},
      jobOrder: [],
      modal: null,

      setSettings: (settings) => set({ settings }),
      setLibrary: (library) => set({ library }),
      setSyncing: (syncing) => set({ syncing }),
      setSyncProgress: (syncProgress) => set({ syncProgress }),
      setTidying: (tidying) => set({ tidying }),
      setView: (view) => set({ view }),
      selectCollection: (key) =>
        set({ selectedCollection: key, selectedKeys: [], sidebarOpen: false }),
      setSelectedKeys: (selectedKeys) => set({ selectedKeys }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setMetaOpen: (metaOpen) => set({ metaOpen }),
      setLogOpen: (logOpen) => set({ logOpen }),
      setModal: (modal) => set({ modal }),
      setSort: (by) => {
        const { sortBy, sortDir } = get();
        if (sortBy === by) {
          set({ sortDir: sortDir === "asc" ? "desc" : "asc" });
        } else {
          set({ sortBy: by, sortDir: "asc" });
        }
      },
      setSummaryFields: (summaryFields) => set({ summaryFields }),
      setPaneSizes: (p) => set(p),
      toggleFolder: (key) =>
        set((s) => ({
          collapsedFolders: s.collapsedFolders.includes(key)
            ? s.collapsedFolders.filter((k) => k !== key)
            : [...s.collapsedFolders, key],
        })),

      pushLog: (line) =>
        set((s) => ({ logs: [...s.logs.slice(-1999), line] })),
      clearLogs: () => set({ logs: [] }),

      upsertItem: (item) =>
        set((s) => {
          const items = s.library.items.slice();
          const idx = items.findIndex((i) => i.key === item.key);
          if (idx >= 0) items[idx] = item;
          else items.push(item);
          return { library: { ...s.library, items } };
        }),
      patchItemData: (key, patch) =>
        set((s) => {
          const items = s.library.items.map((i) =>
            i.key === key ? { ...i, data: { ...i.data, ...patch } } : i,
          );
          return { library: { ...s.library, items } };
        }),

      addJob: (job) =>
        set((s) => ({
          jobs: { ...s.jobs, [job.id]: job },
          jobOrder: [...s.jobOrder, job.id],
        })),
      updateJob: (id, patch) =>
        set((s) => {
          const existing = s.jobs[id];
          if (!existing) return {};
          return { jobs: { ...s.jobs, [id]: { ...existing, ...patch } } };
        }),
      dismissJob: (id) =>
        set((s) => {
          const jobs = { ...s.jobs };
          delete jobs[id];
          return { jobs, jobOrder: s.jobOrder.filter((j) => j !== id) };
        }),
    }),
    {
      name: "zotero-helper-ui",
      partialize: (s) => ({
        leftWidth: s.leftWidth,
        rightWidth: s.rightWidth,
        termHeight: s.termHeight,
        logOpen: s.logOpen,
        summaryFields: s.summaryFields,
        sortBy: s.sortBy,
        sortDir: s.sortDir,
        collapsedFolders: s.collapsedFolders,
        selectedCollection: s.selectedCollection,
      }),
    },
  ),
);

export function appLog(
  level: LogLine["level"],
  message: string,
): void {
  useStore.getState().pushLog({ level, message, ts: Date.now() });
}
