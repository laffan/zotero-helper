// Each note's page, small, above its first line on the notepad
// (surface.ts): a label at the top left of the note's strokes. A
// finished stroke moves only its own note's label, by that stroke's box
// alone — rebuilding them all, and every link's chip, at each pen-up
// cost the next stroke its start on a full pad — while any other change
// measures them all afresh.
import { strokeBox } from "./ink";
import type { Note, Notepad, NoteStroke } from "./model";

export function createNoteLabels(pad: () => Notepad) {
  const els = new Map<string, HTMLElement>();
  // Each note's top left corner, kept as its strokes arrive; forgotten
  // (and measured again when asked for) at any other change.
  const corners = new Map<string, [number, number]>();

  function cornerOf(id: string): [number, number] | null {
    let c = corners.get(id);
    if (c) return c;
    let [x0, y0] = [Infinity, Infinity];
    for (const s of pad().strokes) {
      if (s.note !== id) continue;
      const b = strokeBox(s);
      x0 = Math.min(x0, b[0]);
      y0 = Math.min(y0, b[1]);
    }
    if (x0 === Infinity) return null;
    corners.set(id, (c = [x0, y0]));
    return c;
  }

  /** A note's label, made or moved to the top left of its strokes;
   *  null when it has none. */
  function label(n: Note): HTMLElement | null {
    const corner = cornerOf(n.id);
    if (!corner) return null;
    let el = els.get(n.id);
    if (!el) {
      el = document.createElement("span");
      el.className = "notepad-note-label";
      el.textContent = `p. ${n.pageIndex + 1}`;
      els.set(n.id, el);
    }
    el.style.left = `${corner[0]}px`;
    el.style.top = `${corner[1] - 16}px`;
    return el;
  }

  return {
    /** Every note's label, measured afresh. */
    all(): HTMLElement[] {
      els.clear();
      corners.clear();
      return pad().notes.flatMap((n) => label(n) ?? []);
    },
    /** Stroke `s` joined its note: that label alone moves (or appears). */
    grew(s: NoteStroke): HTMLElement | null {
      const box = strokeBox(s);
      const c = corners.get(s.note);
      if (c) corners.set(s.note, [Math.min(c[0], box[0]), Math.min(c[1], box[1])]);
      const n = pad().notes.find((x) => x.id === s.note);
      return n ? label(n) : null;
    },
  };
}
