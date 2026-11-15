// What undo takes back on the notepad (surface.ts), and taking it back —
// with the two edits it shares with the surface: moving strokes and
// links, and dropping the notes a removal leaves with no strokes. Each
// change made in a view is a step, kept with what it needs to be undone
// — the strokes, notes and links it took away, how far it moved things,
// the colours or words it replaced — and undo takes the last one back.
// The steps are the view's own: another view's changes are that view's
// to undo.
import type { Note, Notepad, NoteLink, NoteStroke } from "./model";

export type Step =
  | { kind: "stroke"; id: string }
  | { kind: "link"; id: string }
  | { kind: "erase"; strokes: NoteStroke[]; notes: Note[] }
  | { kind: "remove" | "clear"; strokes: NoteStroke[]; notes: Note[]; links: NoteLink[] }
  | { kind: "move"; strokes: string[]; links: string[]; dx: number; dy: number }
  | { kind: "fix"; link: NoteLink }
  | { kind: "recolor"; was: [NoteStroke, string][] }
  // A text note's words before they were changed (texts.ts).
  | { kind: "text"; link: NoteLink; was: string };

/** Move strokes and links (by id) by (dx, dy) on the canvas. */
export function shiftItems(pad: Notepad, strokeIds: string[], linkIds: string[], dx: number, dy: number): void {
  for (const s of pad.strokes) {
    if (!strokeIds.includes(s.id)) continue;
    s.points = s.points.map((v, i) => Math.round((v + (i % 2 ? dy : dx)) * 10) / 10);
  }
  for (const l of pad.links) {
    if (!linkIds.includes(l.id)) continue;
    l.x = Math.round(l.x + dx);
    l.y = Math.round(l.y + dy);
  }
}

/** The notes left with no strokes go; returned, for undo. */
export function dropEmpty(pad: Notepad): Note[] {
  const gone = pad.notes.filter((n) => !pad.strokes.some((s) => s.note === n.id));
  pad.notes = pad.notes.filter((n) => !gone.includes(n));
  return gone;
}

/** Put the pad back as it was before `step`; the caller draws it. */
export function takeBack(pad: Notepad, step: Step): void {
  if (step.kind === "link") pad.links = pad.links.filter((l) => l.id !== step.id);
  else if (step.kind === "move") shiftItems(pad, step.strokes, step.links, -step.dx, -step.dy);
  else if (step.kind === "fix") step.link.fixed = !step.link.fixed || undefined;
  else if (step.kind === "recolor") for (const [st, c] of step.was) st.color = c;
  else if (step.kind === "text") step.link.text = step.was;
  else if (step.kind === "stroke") {
    pad.strokes = pad.strokes.filter((s) => s.id !== step.id);
    dropEmpty(pad);
  } else {
    pad.strokes.push(...step.strokes);
    pad.notes.push(...step.notes);
    if (step.kind !== "erase") pad.links.push(...step.links);
  }
}
