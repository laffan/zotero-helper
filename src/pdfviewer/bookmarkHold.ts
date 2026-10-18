// Bookmarking by holding a page's corner — reading mode's way, where the
// pages' bookmark buttons are hidden (readingmode.css). A press held
// still for a full second (HOLD_MS) near a page's top-right corner opens
// the bookmark box for that page, as its button would: to name a new
// bookmark, or to rename or remove the one there (bookmarks.ts). The
// button comes up under the finger as the press goes on, filling, so
// the hold can be seen to be counting.
//
// "Near" is measured from the button, which sits 8px in from the corner
// of what is shown of the page (a reading crop moves it in). While the
// press lasts the page's text can't be selected, so the iPad's own long
// press (a word selected, its menu) doesn't start under it; moving more
// than a few pixels, lifting, or scrolling lets go. The Pencil writing
// in ink mode never bookmarks.
const HOLD_MS = 1000;
const REACH_PX = 72;
const SLOP_PX = 10;

/** `enabled`: the hold applies now (reading mode). */
export function attachBookmarkHold(scrollArea: HTMLElement, enabled: () => boolean): () => void {
  let press: { id: number; x: number; y: number; timer: number; wrapper: HTMLElement; button: HTMLElement } | null = null;
  // The click that ends a hold that opened the box is not a tap on the
  // page (the sentence tool, a highlight, the selection's dismissal).
  let swallowUntil = 0;

  function end(): void {
    if (!press) return;
    window.clearTimeout(press.timer);
    press.button.classList.remove("pressing");
    press.wrapper.classList.remove("pdf-corner-pressing");
    press = null;
  }

  const onDown = (e: PointerEvent) => {
    end();
    if (!enabled() || !e.isPrimary || e.button !== 0) return;
    if (e.pointerType === "pen" && scrollArea.classList.contains("pdf-ink-active")) return;
    const wrapper = (e.target as Element).closest<HTMLElement>(".pdf-page-wrapper");
    const button = wrapper?.querySelector<HTMLElement>(".pdf-page-bookmark-btn");
    if (!wrapper || !button) return;
    const r = button.getBoundingClientRect();
    if (r.right + 8 - e.clientX > REACH_PX || e.clientY - (r.top - 8) > REACH_PX) return;
    wrapper.classList.add("pdf-corner-pressing");
    button.classList.add("pressing");
    const timer = window.setTimeout(() => {
      const b = press?.button;
      end();
      if (!b) return;
      window.getSelection()?.removeAllRanges();
      b.click();
      // After the button's own click, which this would otherwise eat.
      swallowUntil = performance.now() + 800;
    }, HOLD_MS);
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, timer, wrapper, button };
  };
  const onMove = (e: PointerEvent) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP_PX) end();
  };
  const onUp = (e: PointerEvent) => {
    if (press && e.pointerId === press.id) end();
  };
  const onClick = (e: MouseEvent) => {
    if (performance.now() > swallowUntil) return;
    swallowUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  };
  // iPadOS's own long-press menu, over the corner.
  const onContextMenu = (e: Event) => {
    if (press) e.preventDefault();
  };

  scrollArea.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  window.addEventListener("click", onClick, true);
  scrollArea.addEventListener("scroll", end);
  scrollArea.addEventListener("contextmenu", onContextMenu);
  return () => {
    end();
    scrollArea.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
    window.removeEventListener("click", onClick, true);
    scrollArea.removeEventListener("scroll", end);
    scrollArea.removeEventListener("contextmenu", onContextMenu);
  };
}
