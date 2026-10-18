// The notepad, as kept: one per PDF — the Pencil's strokes on it,
// grouped into notes (each remembering where in the PDF the reader was
// when it was written), and the links dragged onto it from the pages.
// Stored on this device (src-tauri/src/notepads.rs,
// `notepads/<attKey>.json`), loaded once and shared by every view of it
// (reading mode's floating pad, the notes pane's half), and written a
// moment after each change; never sent to Zotero.
//
// Coordinates are the pad's own canvas, in CSS pixels; the pad pans over
// it, so a note keeps its place on the canvas wherever the view is.
import type { PagePlace, PlaceTarget } from "../pdfviewer/places";
import { appLog } from "../lib/store";
import { invoke, isTauri } from "../lib/tauri";

export interface NoteStroke {
  id: string;
  /** x, y pairs on the canvas. */
  points: number[];
  width: number;
  color: string;
  /** The note it belongs to. */
  note: string;
}

/** Strokes written while the reader stayed on one page, and where the
 *  reader was when the first was. */
export interface Note extends PagePlace {
  id: string;
  createdMs: number;
}

export interface NoteLink {
  id: string;
  /** Its place on the canvas (top left). */
  x: number;
  y: number;
  target: PlaceTarget;
}

export interface Notepad {
  strokes: NoteStroke[];
  notes: Note[];
  links: NoteLink[];
  /** Where the canvas was panned to. */
  pan: { x: number; y: number };
}

export const emptyNotepad = (): Notepad => ({ strokes: [], notes: [], links: [], pan: { x: 0, y: 0 } });

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

async function loadNotepad(attKey: string): Promise<Notepad> {
  if (!isTauri) return emptyNotepad();
  try {
    const pad = await invoke<Notepad | null>("load_notepad", { attKey });
    return pad && Array.isArray(pad.strokes) ? { ...emptyNotepad(), ...pad } : emptyNotepad();
  } catch (e) {
    appLog("warn", `Could not read the notepad: ${e}`);
    return emptyNotepad();
  }
}

// Each PDF's pad, loaded once, and the views showing it.
const open = new Map<string, { pad: Promise<Notepad>; views: Set<(from: object) => void> }>();

function entry(attKey: string) {
  let e = open.get(attKey);
  if (!e) open.set(attKey, (e = { pad: loadNotepad(attKey), views: new Set() }));
  return e;
}

/** The PDF's pad — the same object for every view of it. */
export const notepadFor = (attKey: string): Promise<Notepad> => entry(attKey).pad;

/** Hear of changes another view made (`from` is the view that made
 *  them). */
export function watchNotepad(attKey: string, fn: (from: object) => void): () => void {
  const e = entry(attKey);
  e.views.add(fn);
  return () => e.views.delete(fn);
}

/** A view changed the pad: write it soon, and tell the others. */
export function notepadChanged(attKey: string, pad: Notepad, from: object): void {
  saveNotepadSoon(attKey, pad);
  for (const fn of entry(attKey).views) fn(from);
}

let saveTimer = 0;
let pending: { attKey: string; pad: Notepad } | null = null;

/** Write `pad` a moment from now (the last of a burst of changes). */
function saveNotepadSoon(attKey: string, pad: Notepad): void {
  if (pending && pending.attKey !== attKey) flushNotepad();
  pending = { attKey, pad };
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushNotepad, 600);
}

/** Write what is waiting now (the pad closing). */
export function flushNotepad(): void {
  window.clearTimeout(saveTimer);
  const p = pending;
  pending = null;
  if (!p || !isTauri) return;
  invoke("save_notepad", { attKey: p.attKey, notepad: p.pad }).catch((e) => appLog("error", `Saving the notepad failed: ${e}`));
}

/** A link's label: the page, or the highlight's text, all of it. */
export function linkLabel(t: PlaceTarget): string {
  if (t.kind === "place") return `p. ${t.pageIndex + 1}`;
  return t.text.replace(/\s+/g, " ").trim() || `p. ${t.pageIndex + 1}`;
}
