// Reading mode's place in the document: the page indicator the bottom
// bar shows ("54% | Pg 7 of 13", "54% | Pg 7–9 of 13" for a set — the
// share of the document up to the page in view), floating at the bottom
// centre of the screen while the bar is hidden. It shows only in
// reading mode (readingmode.css; the viewer itself doesn't know the
// mode). A press opens the page picker — the thumbnail grid as a popup
// (thumbnails.ts) — to jump to a page without leaving reading mode,
// with the PDF's outline, when it has one, as a column at its left.
// The same text is the bottom bar's indicator, whose press shows every
// page at a glance — the thumbnail grid over the viewer
// (createPageFinder puts the two together).
import type { OutlineEntry } from "./outline";
import { createThumbnailManager, type ThumbnailEnv } from "./thumbnails";

export interface ReadingProgressEnv {
  /** Open the picker, with `side` (the outline column) beside it. */
  openPicker: (side: HTMLElement | null) => void;
  getOutline: () => OutlineEntry[];
  currentPage: () => number;
  /** Go to an outline entry's place; the picker then closes. */
  goToEntry: (e: OutlineEntry) => void;
}

/** The indicator's text: how far through the document page `first`
 *  is, and the page (or set, `first`–`last`) of `total`. */
export function progressText(first: number, last: number, total: number): string {
  if (!total) return "";
  const pct = Math.round((first / total) * 100);
  return `${pct}% | Pg ${last > first ? `${first}–${last}` : first} of ${total}`;
}

/** The outline as a column of links, the section being read marked. */
function outlineColumn(outline: OutlineEntry[], page: number, pick: (e: OutlineEntry) => void): HTMLElement | null {
  if (!outline.length) return null;
  const col = document.createElement("nav");
  col.className = "pdf-thumb-toc";
  let current: HTMLElement | null = null;
  const walk = (list: OutlineEntry[], depth: number) => {
    for (const e of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pdf-thumb-toc-entry";
      b.style.setProperty("--depth", String(depth));
      b.textContent = e.title;
      if (e.pageIndex == null) b.disabled = true;
      else {
        b.title = `${e.title} — p. ${e.pageIndex + 1}`;
        b.addEventListener("click", () => pick(e));
        // The last heading at or before the page is the one being read.
        if (e.pageIndex + 1 <= page) current = b;
      }
      col.appendChild(b);
      walk(e.children, depth + 1);
    }
  };
  walk(outline, 0);
  // TS can't see the assignment inside the closure.
  const here = current as HTMLElement | null;
  if (here) {
    here.classList.add("current");
    requestAnimationFrame(() => (col.scrollTop = here.offsetTop - col.clientHeight / 3));
  }
  return col;
}

export function createReadingProgress(root: HTMLElement, env: ReadingProgressEnv) {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "pdf-reading-progress";
  pill.title = "Go to a page";
  pill.addEventListener("click", () => {
    const side = outlineColumn(env.getOutline(), env.currentPage(), env.goToEntry);
    env.openPicker(side);
  });
  root.appendChild(pill);
  return {
    /** The indicator's text, as the bottom bar shows it. */
    set(text: string): void {
      if (pill.textContent !== text) pill.textContent = text;
      pill.hidden = !text;
    },
    destroy: () => pill.remove(),
  };
}

export interface PageFinderEnv extends Omit<ThumbnailEnv, "onHide"> {
  currentPage: () => number;
  /** A place on a page (an outline entry's): `top` in PDF units. */
  goToPosition: (pageIndex: number, top: number | null) => void;
}

/** Where the reader is, shown twice — `indicator` in the bottom bar,
 *  whose press shows the thumbnail grid over `body`, and reading mode's
 *  pill over `root`, whose press opens the page picker. */
export function createPageFinder(body: HTMLElement, root: HTMLElement, indicator: HTMLElement, env: PageFinderEnv) {
  const thumbs = createThumbnailManager(body, { ...env, onHide: () => indicator.classList.remove("active") });
  let outline: OutlineEntry[] = [];
  const pill = createReadingProgress(root, {
    openPicker: (side) => thumbs.showPicker(env.currentPage(), side),
    getOutline: () => outline,
    currentPage: env.currentPage,
    goToEntry: (e) => {
      thumbs.close();
      if (e.pageIndex != null) env.goToPosition(e.pageIndex, e.top);
    },
  });
  indicator.addEventListener("click", () => indicator.classList.toggle("active", thumbs.toggle()));
  return {
    /** The page (or set, `first`–`last`) of `total` in view. */
    set(first: number, last: number, total: number): void {
      const text = progressText(first, last, total);
      if (indicator.textContent !== text) indicator.textContent = text;
      pill.set(text);
    },
    setOutline: (o: OutlineEntry[]) => (outline = o),
    destroy(): void {
      thumbs.destroy();
      pill.destroy();
    },
  };
}
