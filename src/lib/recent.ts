// What has been read on this device: the PDFs opened most recently
// (the sidebar's Recent folder) and the page each PDF was left on, with
// the viewer's state there (layout, folded view, place) and the reading
// UI around it (readerUi.ts: panel widths, tabs, filters, searches), so
// it opens as it was left. Local only, like pins and view modes —
// nothing here is written to Zotero.
//
// No store import: the store records opens through noteOpened, and the
// item list reads the order through recentKeys.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SavedView } from "../pdfviewer/viewState";
import type { ReaderUi } from "./readerUi";

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
  /** attKey → the 1-based page last in view, the viewer's state, the
   *  UI around it, and when. */
  pages: Record<string, { page: number; ms: number; view?: SavedView; ui?: ReaderUi }>;
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

/** Take an entry off Recent (opening its PDF again puts it back). */
export function forgetOpened(itemKey: string): void {
  useRecent.setState((s) => ({ opened: s.opened.filter((r) => r.itemKey !== itemKey) }));
}

/** Entry keys in Recent, newest first. */
export function recentKeys(opened: RecentOpen[]): string[] {
  return opened.map((r) => r.itemKey);
}

/** The page `attKey` was left on, or null when it was never read here. */
export function lastPage(attKey: string): number | null {
  return useRecent.getState().pages[attKey]?.page ?? null;
}

/** The viewer's state `attKey` was left in, or null. */
export function lastView(attKey: string): SavedView | null {
  return useRecent.getState().pages[attKey]?.view ?? null;
}

let pageTimer = 0;
let pendingPage: { attKey: string; page: number; view?: SavedView } | null = null;
/** UI records changed since the last write, by attKey. */
const pendingUi = new Map<string, ReaderUi>();

type Pages = RecentState["pages"];
function capped(pages: Pages): Pages {
  const keys = Object.keys(pages);
  if (keys.length <= PAGES_LIMIT) return pages;
  keys.sort((a, b) => pages[a].ms - pages[b].ms);
  return Object.fromEntries(keys.slice(-PAGES_LIMIT).map((k) => [k, pages[k]]));
}

function flushPage(): void {
  window.clearTimeout(pageTimer);
  const p = pendingPage;
  pendingPage = null;
  const uis = [...pendingUi];
  pendingUi.clear();
  if (!p && !uis.length) return;
  useRecent.setState((s) => {
    let pages: Pages = s.pages;
    const prev = p ? s.pages[p.attKey] : undefined;
    if (p && !(prev?.page === p.page && (!p.view || JSON.stringify(prev.view) === JSON.stringify(p.view)))) {
      const view = p.view ?? prev?.view;
      pages = { ...pages, [p.attKey]: { ...prev, page: p.page, ms: Date.now(), ...(view ? { view } : {}) } };
    }
    for (const [attKey, ui] of uis) {
      const was = pages[attKey];
      pages = { ...pages, [attKey]: { ...was, page: was?.page ?? 1, ms: Date.now(), ui } };
    }
    return pages === s.pages ? {} : { pages: capped(pages) };
  });
}

/** The reading UI `attKey` was left with (readerUi.ts) — the latest,
 *  written or not. Empty when it was never read here. */
export function lastUi(attKey: string): ReaderUi {
  return pendingUi.get(attKey) ?? useRecent.getState().pages[attKey]?.ui ?? {};
}

/** Change part of the reading UI kept for `attKey`. Written after a
 *  pause, like the page: a dragged panel edge changes it every frame. */
export function saveUi(attKey: string, patch: Partial<ReaderUi>): void {
  pendingUi.set(attKey, { ...lastUi(attKey), ...patch });
  window.clearTimeout(pageTimer);
  pageTimer = window.setTimeout(flushPage, 600);
}

/** The reader moved to `page`, the viewer now in `view`. Written after
 *  a pause, since scrolling through a book passes a page every few
 *  frames. */
export function savePage(attKey: string, page: number, view?: SavedView): void {
  if (pendingPage && pendingPage.attKey !== attKey) flushPage();
  pendingPage = { attKey, page, view: view ?? (pendingPage?.attKey === attKey ? pendingPage.view : undefined) };
  window.clearTimeout(pageTimer);
  pageTimer = window.setTimeout(flushPage, 600);
}

/** Write a page still waiting out its pause — the PDF is closing. */
export const flushSavedPage = flushPage;

// The app going to the background may be the last chance to write it.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPage();
});
