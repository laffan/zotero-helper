// The pages' bookmarks: the button at each page's top right, its naming
// box, and what a bookmarked page shows. Pressing a page's bookmark
// button opens a small box beside it (nameBox.ts): on a page without
// one, the name filled in ("p. 12") and selected — Enter (or Add) makes
// the bookmark; on a page with one, that bookmark's name, to rename it
// (Save) or Remove it. Escape or a press elsewhere drops the box. In
// reading mode, where the buttons are hidden, holding a page's corner
// opens it instead (bookmarkHold.ts). The bookmarks themselves are the
// app's (lib/bookmarks.ts); `createPageBookmarks` is what the viewer
// wires up.
import { attachBookmarkHold } from "./bookmarkHold";
import { createNameBox } from "./nameBox";
import type { PageRecord } from "./types";
import type { PdfViewerOptions } from "./viewerOptions";

/** A bookmark as a page shows it. */
export interface PageBookmark {
  id: string;
  pageIndex: number;
  name: string;
}

interface PageBookmarksEnv {
  root: HTMLElement;
  scrollArea: HTMLElement;
  opts: PdfViewerOptions;
  getPages: () => PageRecord[];
  getPageLabels: () => string[] | null;
}

/** The viewer's bookmarks: `onBookmarkPage` for the pages' buttons
 *  (pageTools.ts), `set` for the PDF's bookmarks. */
export function createPageBookmarks(env: PageBookmarksEnv) {
  const { opts } = env;
  const box = createNameBox(env.root);
  let marks: PageBookmark[] = [];
  const detachHold = opts.onBookmark && opts.holdToBookmark ? attachBookmarkHold(env.scrollArea, opts.holdToBookmark) : null;

  /** Page `page`'s (1-based) button was pressed. */
  function onBookmarkPage(page: number, button: HTMLElement): void {
    const idx = page - 1;
    const existing = marks.find((m) => m.pageIndex === idx);
    const label = env.getPageLabels()?.[idx];
    box.open({
      anchor: button,
      align: "right",
      label: "Bookmark name",
      name: existing?.name ?? `p. ${label ?? page}`,
      existing: Boolean(existing),
      // The page's top in PDF space (its viewport may be scaled).
      save: (name) =>
        existing
          ? opts.onRenameBookmark?.(existing.id, name)
          : opts.onBookmark?.(idx, env.getPages()[idx]?.viewport.viewBox[3] ?? 0, name, label),
      remove: existing ? () => opts.onRemoveBookmark?.(existing.id) : undefined,
    });
  }

  return {
    onBookmarkPage: opts.onBookmark ? onBookmarkPage : undefined,
    /** The PDF's bookmarks, shown on their pages. */
    set(list: PageBookmark[]): void {
      marks = list;
      markBookmarkedPages(env.getPages(), list);
    },
    destroy(): void {
      box.close();
      detachHold?.();
    },
  };
}

/** Fill the bookmark button on pages that have a bookmark, and put the
 *  bookmark's name beside it (the first, and how many more). On those
 *  pages both stay showing; elsewhere the button shows only near its
 *  corner (pageTools.ts). */
export function markBookmarkedPages(pages: PageRecord[], marks: PageBookmark[]): void {
  const byPage = new Map<number, PageBookmark[]>();
  for (const m of marks) byPage.set(m.pageIndex, [...(byPage.get(m.pageIndex) ?? []), m]);
  pages.forEach((p, i) => {
    const list = byPage.get(i);
    p.wrapper.querySelector(".pdf-page-bookmark-btn")?.classList.toggle("marked", Boolean(list));
    const label = p.wrapper.querySelector<HTMLElement>(".pdf-page-bookmark-label");
    if (!label) return;
    label.textContent = list ? list[0].name + (list.length > 1 ? ` +${list.length - 1}` : "") : "";
    label.classList.toggle("marked", Boolean(list));
  });
}
