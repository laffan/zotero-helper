// Bookmarks: named places in a PDF, made with the bookmark button at the
// top right of each page in the reader. Zotero has nothing like them, so
// they stay in this app — `bookmarks.json` in its data folder
// (src-tauri/src/bookmarks.rs), loaded at startup and written a moment
// after each change.
//
// The Highlights tab lists them among the highlights, in reading order
// and under the outline's headings, so each is turned into an
// Annotation-shaped entry (type "bookmark") for it — never for the
// viewer's painter, which only ever gets Zotero's annotations.
import { create } from "zustand";
import type { Annotation } from "./highlights";
import { appLog } from "./store";
import { invoke, isTauri } from "./tauri";
import type { ZItem } from "./types";

export interface Bookmark {
  id: string;
  /** The PDF attachment, and the entry it belongs to. */
  attKey: string;
  itemKey: string;
  /** 0-based page. */
  pageIndex: number;
  /** The page's printed label ("iv", "212"), when the PDF has labels. */
  pageLabel?: string;
  /** Height on the page in PDF units (y up): the top of the page, so
   *  it files under a heading that starts there. */
  top: number;
  name: string;
  createdMs: number;
}

/** The Highlights filter's entry for bookmarks, beside the colours. */
export const BOOKMARK_FILTER = "bookmark";

export const useBookmarks = create<{ list: Bookmark[] }>(() => ({ list: [] }));

let saveTimer = 0;

function save(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!isTauri) return;
    invoke("save_bookmarks", { bookmarks: useBookmarks.getState().list }).catch((e) =>
      appLog("error", `Saving bookmarks failed: ${e}`),
    );
  }, 300);
}

function setList(list: Bookmark[]): void {
  useBookmarks.setState({ list });
  save();
}

/** Called once, from bootstrap. */
export async function loadBookmarks(): Promise<void> {
  try {
    const list = await invoke<Bookmark[]>("load_bookmarks");
    useBookmarks.setState({ list: Array.isArray(list) ? list : [] });
  } catch (e) {
    appLog("debug", `No bookmarks loaded: ${e}`);
  }
}

export function addBookmark(b: Omit<Bookmark, "id" | "createdMs">): void {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  setList([...useBookmarks.getState().list, { ...b, id, createdMs: Date.now() }]);
}

export function renameBookmark(id: string, name: string): void {
  const clean = name.trim();
  if (!clean) return;
  setList(useBookmarks.getState().list.map((b) => (b.id === id ? { ...b, name: clean } : b)));
}

export function removeBookmark(id: string): void {
  setList(useBookmarks.getState().list.filter((b) => b.id !== id));
}

/** A PDF's bookmarks, by page. */
export function bookmarksOf(list: Bookmark[], attKey: string): Bookmark[] {
  return list.filter((b) => b.attKey === attKey).sort((a, b) => a.pageIndex - b.pageIndex || a.createdMs - b.createdMs);
}

/** The key a bookmark lists under in the Highlights tab. */
const KEY_PREFIX = "bookmark:";
export const isBookmark = (a: Annotation) => a.type === "bookmark";
export const bookmarkIdOf = (a: Annotation) => a.key.slice(KEY_PREFIX.length);

/** A bookmark as the Highlights tab lists it. Its sort index puts it at
 *  the top of its page, ahead of the page's highlights. */
export function bookmarkEntry(b: Bookmark): Annotation {
  const position = { pageIndex: b.pageIndex, rects: [[0, b.top, 0, b.top]] };
  return {
    key: KEY_PREFIX + b.id,
    attKey: b.attKey,
    type: "bookmark",
    color: "",
    text: b.name,
    comment: "",
    pageLabel: b.pageLabel || String(b.pageIndex + 1),
    sortIndex: `${String(b.pageIndex).padStart(5, "0")}|000000|00000`,
    tags: [],
    external: false,
    _raw: { key: KEY_PREFIX + b.id, version: 0, data: { key: KEY_PREFIX + b.id, version: 0, itemType: "bookmark" } } as ZItem,
    _parsedPosition: position,
  };
}
