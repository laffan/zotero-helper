// What has been read on this device: the PDFs opened most recently
// (the sidebar's Recent folder) and the page each PDF was left on, so
// it opens there again. Local only, like pins and view modes — nothing
// here is written to Zotero.
//
// No store import: the store records opens through noteOpened, and the
// item list reads the order through recentKeys.
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The sidebar row that lists recently opened PDFs. Not a Zotero
 *  collection, like Questions. */
export const RECENT = "recent";

export const RECENT_LIMIT = 100;
/** Last pages kept, oldest dropped first — far more than Recent shows,
 *  so a paper read months ago still opens where it was left. */
const PAGES_LIMIT = 2000;

export interface RecentOpen {
  itemKey: string;
  attKey: string;
  ms: number;
}

interface RecentState {
  /** Newest first, one row per entry. */
  opened: RecentOpen[];
  /** attKey → the 1-based page last in view, and when. */
  pages: Record<string, { page: number; ms: number }>;
}

export const useRecent = create<RecentState>()(
  persist((): RecentState => ({ opened: [], pages: {} }), { name: "zotero-helper-recent" }),
);

/** A PDF was opened: it goes to the top of Recent. */
export function noteOpened(itemKey: string, attKey: string): void {
  useRecent.setState((s) => ({
    opened: [
      { itemKey, attKey, ms: Date.now() },
      ...s.opened.filter((r) => r.itemKey !== itemKey),
    ].slice(0, RECENT_LIMIT),
  }));
}

/** Entry keys in Recent, newest first. */
export function recentKeys(opened: RecentOpen[]): string[] {
  return opened.map((r) => r.itemKey);
}

/** The page `attKey` was left on, or null when it was never read here. */
export function lastPage(attKey: string): number | null {
  return useRecent.getState().pages[attKey]?.page ?? null;
}

let pageTimer = 0;
let pendingPage: { attKey: string; page: number } | null = null;

function flushPage(): void {
  window.clearTimeout(pageTimer);
  const p = pendingPage;
  pendingPage = null;
  if (!p) return;
  useRecent.setState((s) => {
    if (s.pages[p.attKey]?.page === p.page) return {};
    let pages = { ...s.pages, [p.attKey]: { page: p.page, ms: Date.now() } };
    const keys = Object.keys(pages);
    if (keys.length > PAGES_LIMIT) {
      keys.sort((a, b) => pages[a].ms - pages[b].ms);
      pages = Object.fromEntries(keys.slice(-PAGES_LIMIT).map((k) => [k, pages[k]]));
    }
    return { pages };
  });
}

/** The reader moved to `page`. Written after a pause, since scrolling
 *  through a book passes a page every few frames. */
export function savePage(attKey: string, page: number): void {
  if (pendingPage && pendingPage.attKey !== attKey) flushPage();
  pendingPage = { attKey, page };
  window.clearTimeout(pageTimer);
  pageTimer = window.setTimeout(flushPage, 600);
}

/** Write a page still waiting out its pause — the PDF is closing. */
export const flushSavedPage = flushPage;

// The app going to the background may be the last chance to write it.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPage();
});
