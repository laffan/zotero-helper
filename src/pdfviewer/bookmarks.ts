// The page bookmark button's naming box, and the mark on pages that
// have a bookmark. Pressing a page's bookmark button opens a small box
// beside it, the name filled in ("p. 12") and selected: Enter (or Add)
// makes the bookmark, Escape or a press elsewhere drops it. The
// bookmarks themselves are the app's (lib/bookmarks.ts).
import type { PageRecord } from "./types";

export function createBookmarkPrompt(host: HTMLElement, onSave: (pageIndex: number, name: string) => void) {
  let box: HTMLFormElement | null = null;

  function close(): void {
    box?.remove();
    box = null;
    document.removeEventListener("pointerdown", onOutside, true);
  }
  function onOutside(e: PointerEvent): void {
    if (box && !box.contains(e.target as Node)) close();
  }

  function open(pageIndex: number, button: HTMLElement, defaultName: string): void {
    close();
    const form = document.createElement("form");
    form.className = "pdf-bookmark-box";
    form.innerHTML = `<input type="text" aria-label="Bookmark name" /><button type="submit">Add</button>`;
    const input = form.querySelector("input")!;
    input.value = defaultName;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim() || defaultName;
      close();
      onSave(pageIndex, name);
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

/** Fill the bookmark button on pages that have a bookmark. */
export function markBookmarkedPages(pages: PageRecord[], indices: number[]): void {
  const on = new Set(indices);
  pages.forEach((p, i) => {
    p.wrapper.querySelector(".pdf-page-bookmark-btn")?.classList.toggle("marked", on.has(i));
  });
}
