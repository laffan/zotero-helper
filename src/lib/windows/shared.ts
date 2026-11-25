// What the app's windows share, loosely (lib/windows/): each window is
// its own — its folder, selection, search, the PDF it has open — and
// keeps the rest the same as the others as they change it. This file is
// the stores' half: the library and the UI prefs (the app's store), the
// PDFs on this device, Recent and the pages PDFs were left on, the AI
// prompts and the shortcuts. The rest is announced where it is written:
// annotations (annotationEdits.ts), conversations (ai/chat.ts),
// bookmarks, sections, words, settings, notepads and notes.
//
// The library, by what changed: a sync that brought a new library
// version is read again from the disk by the others (the Rust cache is
// the sync's); items and folders changed here — an edit, a folder made —
// go as themselves. Annotations aren't among them: they go with what
// becomes of them (annotationEdits.ts), so another window keeps showing
// one made here until a sync of its own includes it.
//
// What another window sends is taken in here without being announced
// again (`take`).
import { usePrompts } from "../ai/prompts";
import { RECENT_LIMIT, useRecent } from "../recent";
import { useShortcuts } from "../shortcuts/bindings";
import { useStore } from "../store";
import { invoke } from "../tauri";
import type { CachedPdf, LibraryCache, ZCollection, ZItem } from "../types";
import { announce, hear } from "./channel";

/** The UI prefs that are the device's rather than a window's — the look
 *  of the app, the lists' order and columns, the folders' pins and views
 *  — kept the same in every window. The rest (the folder open, the
 *  panels and their widths) are each window's own; the app opens next
 *  time with the last written. */
const SHARED_PREFS = [
  "appearance",
  "uiFontSize",
  "nightVision",
  "showTagColors",
  "summaryFields",
  "sortBy",
  "sortDir",
  "searchMode",
  "collapsedFolders",
  "flaggedFolders",
  "colWidths",
  "folderViews",
] as const;

type StoreState = ReturnType<typeof useStore.getState>;

let taking = 0;
/** Take in another window's change, unannounced. */
function take(fn: () => void): void {
  taking++;
  try {
    fn();
  } finally {
    taking--;
  }
}

const isAnnotation = (i: ZItem) => i.data?.itemType === "annotation";

/** What changed in the library between two of its states, annotations
 *  apart. */
function itemChanges(now: ZItem[], was: ZItem[]): { upserts: ZItem[]; removed: string[] } {
  const before = new Map(was.map((i) => [i.key, i]));
  const upserts: ZItem[] = [];
  for (const i of now) {
    const prev = before.get(i.key);
    before.delete(i.key);
    if (prev !== i && !isAnnotation(i)) upserts.push(i);
  }
  const removed = [...before.values()].filter((i) => !isAnnotation(i)).map((i) => i.key);
  return { upserts, removed };
}

function announceStore(s: StoreState, prev: StoreState): void {
  const patch: Record<string, unknown> = {};
  for (const k of SHARED_PREFS) if (s[k] !== prev[k]) patch[k] = s[k];
  if (Object.keys(patch).length) announce("prefs", { patch });
  if (s.cachedPdfs !== prev.cachedPdfs) announce("cached");
  const lib = s.library;
  const was = prev.library;
  if (lib === was) return;
  // A sync with something new (not the cache loaded as this window began).
  if (lib.version !== was.version) {
    if (was.version > 0) announce("library");
    return;
  }
  if (lib.items !== was.items) {
    const { upserts, removed } = itemChanges(lib.items, was.items);
    if (upserts.length || removed.length) announce("items", { upserts, removed });
  }
  if (lib.collections !== was.collections) announce("collections", { collections: lib.collections });
}

function hearStore(): void {
  hear<{ patch: Partial<StoreState> }>("prefs", (m) => take(() => useStore.setState(m.patch)));
  hear("library", async () => {
    const lib = await invoke<LibraryCache>("load_library");
    take(() => useStore.getState().setLibrary(lib));
  });
  hear<{ upserts: ZItem[]; removed: string[] }>("items", (m) =>
    take(() => {
      const st = useStore.getState();
      st.upsertItems(m.upserts);
      for (const key of m.removed) st.removeItem(key);
    }),
  );
  hear<{ collections: ZCollection[] }>("collections", (m) =>
    take(() => useStore.setState((s) => ({ library: { ...s.library, collections: m.collections } }))),
  );
  hear("cached", async () => {
    const list = await invoke<CachedPdf[]>("list_cached_pdfs");
    take(() => useStore.getState().setCachedPdfs(list));
  });
}

type Recent = ReturnType<typeof useRecent.getState>;

/** Recent: the list as the window that changed it has it, and the pages
 *  it changed — each record kept where it is newer than this window's. */
function shareRecent(): void {
  useRecent.subscribe((s, prev) => {
    if (taking) return;
    const pages: Recent["pages"] = {};
    for (const [k, v] of Object.entries(s.pages)) if (prev.pages[k] !== v) pages[k] = v;
    const opened = s.opened !== prev.opened ? s.opened : undefined;
    if (opened || Object.keys(pages).length) announce("recent", { pages, ...(opened ? { opened } : {}) });
  });
  hear<{ pages: Recent["pages"]; opened?: Recent["opened"] }>("recent", (m) =>
    take(() =>
      useRecent.setState((s) => {
        const pages = { ...s.pages };
        for (const [k, v] of Object.entries(m.pages)) if (!pages[k] || pages[k].ms <= v.ms) pages[k] = v;
        return { pages, opened: m.opened ? m.opened.slice(0, RECENT_LIMIT) : s.opened };
      }),
    ),
  );
}

/** A small store of the device's (the prompts, the shortcuts): its data
 *  as it now is. */
function shareSmall<T extends object>(kind: string, store: { getState(): T; setState(p: Partial<T>): void; subscribe(fn: (s: T, p: T) => void): () => void }, key: keyof T): void {
  store.subscribe((s, prev) => {
    if (!taking && s[key] !== prev[key]) announce(kind, { value: s[key] });
  });
  hear<{ value: T[keyof T] }>(kind, (m) => take(() => store.setState({ [key]: m.value } as Partial<T>)));
}

let started = false;

/** Keep this window's stores in step with the others'. From bootstrap,
 *  once, in the app (not a plain browser). */
export function startSharing(): void {
  if (started) return;
  started = true;
  useStore.subscribe((s, prev) => {
    if (!taking) announceStore(s, prev);
  });
  hearStore();
  shareRecent();
  shareSmall("prompts", usePrompts, "prompts");
  shareSmall("shortcuts", useShortcuts, "custom");
}
