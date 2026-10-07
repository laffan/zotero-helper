// Reading notes: one NOTES.md per entry, edited here and pushed to
// Zotero as an attachment of the entry (src-tauri/src/notes.rs has the
// sync protocol).
//
// Saving is local and immediate (debounced keystrokes); pushing to
// Zotero is periodic — every couple of minutes while anything is
// unpushed, when the app goes to the background, and when the PDF
// beside the notes is closed. Opening a note asks Zotero first whether its copy has
// changed, so notes written on another device arrive.
import { itemTitle, pdfAttachmentOf, REAL_KEY } from "./collections";
import { appLog, useStore } from "./store";
import { invoke, isTauri } from "./tauri";
import type {
  CachedPdf,
  LocalNote,
  NoteMeta,
  NoteSyncOutcome,
  ZItem,
} from "./types";

export const NOTES_FILENAME = "NOTES.md";
const PUSH_EVERY_MS = 2 * 60 * 1000;

/** The entry's NOTES.md attachment, when the library has one. */
export function noteAttachmentOf(items: ZItem[], itemKey: string): ZItem | undefined {
  return items.find(
    (a) =>
      a.data?.parentItem === itemKey &&
      a.data?.itemType === "attachment" &&
      REAL_KEY.test(a.key) &&
      String(a.data?.filename ?? a.data?.title ?? "") === NOTES_FILENAME,
  );
}

function adopt(outcome: NoteSyncOutcome): void {
  if (outcome.item?.key) useStore.getState().upsertItem(outcome.item);
}

/** What the Notes tab needs to show: the local text (fresh from Zotero
 *  when online and Zotero's copy changed), or null when there are no
 *  notes for this entry anywhere. */
export async function openNote(
  itemKey: string,
  remoteAttKey: string | undefined,
): Promise<{ text: string; meta: NoteMeta } | null> {
  let local = await invoke<LocalNote | null>("notes_load", { itemKey });
  const known = remoteAttKey || local?.meta.attKey;
  if (known && navigator.onLine) {
    try {
      const out = await invoke<NoteSyncOutcome>("notes_pull", {
        itemKey,
        attKey: remoteAttKey ?? null,
      });
      adopt(out);
      if (out.status === "updated" && out.text != null) {
        return { text: out.text, meta: out.meta };
      }
      if (out.status === "conflict") {
        appLog("warn", `${NOTES_FILENAME} changed in Zotero too — kept this device's version (Zotero's is saved beside it)`);
      }
      local = await invoke<LocalNote | null>("notes_load", { itemKey });
    } catch (e) {
      appLog("debug", `Could not check Zotero for newer notes: ${e}`);
    }
  }
  return local;
}

export async function saveNote(itemKey: string, text: string): Promise<NoteMeta> {
  return invoke<NoteMeta>("notes_save", { itemKey, text });
}

/** Push one note now. Resolves to its new bookkeeping. */
export async function pushNote(itemKey: string): Promise<NoteMeta | null> {
  try {
    const out = await invoke<NoteSyncOutcome>("notes_push", { itemKey });
    adopt(out);
    return out.meta;
  } catch (e) {
    appLog("warn", `Pushing ${NOTES_FILENAME} failed (will retry): ${e}`);
    return null;
  }
}

let pushing = false;

/** Push every note with local edits. Quietly does nothing offline. */
export async function pushDirtyNotes(): Promise<void> {
  if (pushing || !isTauri || !navigator.onLine) return;
  pushing = true;
  try {
    const list = await invoke<NoteMeta[]>("notes_list");
    for (const meta of list) if (meta.dirty) await pushNote(meta.itemKey);
  } catch (e) {
    appLog("debug", `Note push pass failed: ${e}`);
  } finally {
    pushing = false;
  }
}

/** Start the periodic push. Called once from bootstrap. */
export function startNotesSync(): void {
  void pushDirtyNotes();
  window.setInterval(() => void pushDirtyNotes(), PUSH_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void pushDirtyNotes();
  });
  window.addEventListener("online", () => void pushDirtyNotes());
}

// --- the PDF cache ----------------------------------------------------------

export async function refreshCachedPdfs(): Promise<void> {
  try {
    useStore.getState().setCachedPdfs(await invoke<CachedPdf[]>("list_cached_pdfs"));
  } catch (e) {
    appLog("debug", `PDF cache unavailable: ${e}`);
  }
}

/** Download an attachment's PDF into the cache. */
export async function cachePdf(att: ZItem, itemKey: string, title: string): Promise<CachedPdf> {
  const { setPdfDownloading } = useStore.getState();
  setPdfDownloading(att.key, true);
  try {
    const entry = await invoke<CachedPdf>("cache_pdf", {
      attKey: att.key,
      itemKey,
      title,
      filename: String(att.data?.filename ?? `${att.key}.pdf`),
    });
    appLog("info", `Saved “${title}” on this device (${Math.round(entry.size / 1024)} KB)`);
    await refreshCachedPdfs();
    return entry;
  } finally {
    setPdfDownloading(att.key, false);
  }
}

/** Download an entry's PDF into the cache, unless it is there already. */
export async function cacheItemPdf(itemKey: string): Promise<void> {
  const { library, cachedPdfs, pdfsDownloading } = useStore.getState();
  const att = pdfAttachmentOf(library.items, itemKey);
  const item = library.items.find((i) => i.key === itemKey);
  if (!att || !item || cachedPdfs[att.key] || pdfsDownloading.includes(att.key)) return;
  await cachePdf(att, itemKey, itemTitle(item));
}

/** Take an attachment's PDF off this device. */
export async function uncachePdf(attKey: string): Promise<void> {
  await invoke("remove_cached_pdf", { attKey });
  const title = useStore.getState().cachedPdfs[attKey]?.title;
  appLog("info", `Removed ${title ? `“${title}”` : "the PDF"} from this device`);
  await refreshCachedPdfs();
}

/** Open an entry's PDF beside its notes, downloading it first when it
 *  isn't on this device — what a double-click on an entry does. False
 *  when the entry has no PDF in Zotero. */
export async function readItem(itemKey: string): Promise<boolean> {
  const att = pdfAttachmentOf(useStore.getState().library.items, itemKey);
  if (!att) return false;
  try {
    await cacheItemPdf(itemKey);
  } catch (e) {
    appLog("error", `Downloading the PDF failed: ${e}`);
    return true;
  }
  const st = useStore.getState();
  st.setSelectedKeys([itemKey]);
  st.setReading({ itemKey, attKey: att.key });
  return true;
}

/** Is the cached copy older than the file Zotero now holds? Zotero
 *  records each stored file's md5, so this needs no download. */
export function cachedPdfIsStale(att: ZItem | undefined, cached: CachedPdf | undefined): boolean {
  const remote = String(att?.data?.md5 ?? "");
  return Boolean(cached && remote && cached.md5 && remote !== cached.md5);
}

// --- inserting into the open notes ------------------------------------------

type Inserter = (markdown: string) => void;
let inserter: Inserter | null = null;
let pending: string[] = [];

/** The notes editor registers itself while it is mounted, and takes
 *  anything sent while it wasn't. */
export function registerNotesInserter(fn: Inserter | null): void {
  inserter = fn;
  if (fn && pending.length) {
    const queued = pending;
    pending = [];
    for (const md of queued) fn(md);
  }
}

/** Add Markdown at the editor's caret. With another tab showing, the
 *  Notes tab is brought up and the text lands once its editor mounts. */
export function insertIntoNotes(markdown: string): void {
  if (inserter) {
    inserter(markdown);
    return;
  }
  pending.push(markdown);
  useStore.getState().setMetaTab("notes");
}
