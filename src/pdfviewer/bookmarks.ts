// The page bookmark button's naming box, and what a bookmarked page
// shows. Pressing a page's bookmark button opens a small box beside it:
// on a page without one, the name filled in ("p. 12") and selected —
// Enter (or Add) makes the bookmark; on a page with one, that bookmark's
// name, to rename it (Save) or Remove it. Escape or a press elsewhere
// drops the box. The bookmarks themselves are the app's
// (lib/bookmarks.ts).
import type { PageRecord } from "./types";

/** A bookmark as a page shows it. */
export interface PageBookmark {
  id: string;
  pageIndex: number;
  name: string;
}

interface PromptActions {
  create: (pageIndex: number, name: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

export function createBookmarkPrompt(host: HTMLElement, act: PromptActions) {
  let box: HTMLFormElement | null = null;

  function close(): void {
    box?.remove();
    box = null;
    document.removeEventListener("pointerdown", onOutside, true);
  }
  function onOutside(e: PointerEvent): void {
    if (box && !box.contains(e.target as Node)) close();
  }

  /** `existing`: the page's bookmark, to rename or remove. */
  function open(pageIndex: number, button: HTMLElement, defaultName: string, existing?: PageBookmark): void {
    close();
    const form = document.createElement("form");
    form.className = "pdf-bookmark-box";
    form.innerHTML =
      `<input type="text" aria-label="Bookmark name" /><button type="submit">${existing ? "Save" : "Add"}</button>` +
      (existing ? `<button type="button" class="pdf-bookmark-remove">Remove</button>` : "");
    const input = form.querySelector("input")!;
    input.value = existing?.name ?? defaultName;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim() || existing?.name || defaultName;
      close();
      if (existing) act.rename(existing.id, name);
      else act.create(pageIndex, name);
    });
    form.querySelector(".pdf-bookmark-remove")?.addEventListener("click", () => {
      close();
      if (existing) act.remove(existing.id);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    });
    host.appendChild(form);
    box = form;
    // Under the button, its right edges lined up, kept inside the viewer.
    const h = host.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const left = Math.max(8, Math.min(b.right - h.left - form.offsetWidth, h.width - form.offsetWidth - 8));
    form.style.left = `${left}px`;
    form.style.top = `${Math.max(8, b.bottom - h.top + 6)}px`;
    input.focus();
    input.select();
    document.addEventListener("pointerdown", onOutside, true);
  }

  return { open, close, destroy: close };
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
