// With a PDF open beside its notes, where the pointer is decides where
// the keyboard's focus is. Going back and forth between highlighting in
// the pages and writing in the notes took two clicks each way on the
// iPad: the first only moved the focus — out of the notes (WebKit's text
// interaction stays with a focused editor, so a press on the pages
// started no selection), or into them — and the second did what was
// meant. So a mouse or trackpad pointer (one that hovers) coming over
// the pages lets go of the notes editor, and the page area takes the
// focus (← / → then turn pages); coming over the notes editor focuses
// it, caret where it was, so the first click already places the caret
// or selects.
//
// Not in reading mode (no notes beside the pages), not while a button
// is held (a drag), and not into the notes while text in the pages is
// selected: focusing the editor would end that selection and its bar.
import { useStore } from "../store";

function selectionInPages(): boolean {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode) return false;
  const el = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
  return Boolean(el?.closest(".textLayer"));
}

function onMove(e: PointerEvent): void {
  if (e.pointerType !== "mouse" || e.buttons !== 0) return;
  const s = useStore.getState();
  if (!s.reading || s.readingMode || s.view !== "main" || s.modal !== null) return;
  const target = e.target as Element | null;
  if (!target?.closest) return;
  const active = document.activeElement as HTMLElement | null;
  // Only the notes let go: a highlight's comment or the search field
  // keep the focus they were given.
  const pages = target.closest<HTMLElement>(".pdf-scroll-area");
  if (pages) {
    if (active?.closest(".notes-cm")) {
      active.blur();
      pages.focus({ preventScroll: true });
    }
    return;
  }
  // Into the notes, from the pages or nothing — never out of another
  // field being typed in.
  // (The wrapper: an empty note's reading questions lie over the editor.)
  const notes = target.closest(".notes-cm-wrap")?.querySelector<HTMLElement>(".cm-content");
  if (!notes || notes.contains(active) || selectionInPages()) return;
  if (active && active !== document.body && active.closest("input, textarea, select, [contenteditable='true']")) return;
  notes.focus({ preventScroll: true });
}

let installed = false;

/** Start following the pointer. Called once, from App. */
export function installHoverFocus(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("pointermove", onMove, { passive: true });
}
