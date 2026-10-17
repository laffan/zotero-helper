// Reading mode's notepad, as kept: one per PDF — the Pencil's strokes on
// it, grouped into notes (each remembering where in the PDF the reader
// was when it was written), and the links dragged onto it from the
// pages. Stored on this device (src-tauri/src/notepads.rs,
// `notepads/<attKey>.json`), loaded as the pad opens and written a
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

/** Strokes written together, and where the reader was then. */
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

/** A stroke written this soon after the last one, and this near it,
 *  belongs to the same note (Zotero's ink merges by the same rule). */
export const NOTE_JOIN_MS = 10_000;
export const NOTE_JOIN_PX = 60;

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export async function loadNotepad(attKey: string): Promise<Notepad> {
  if (!isTauri) return emptyNotepad();
  try {
    const pad = await invoke<Notepad | null>("load_notepad", { attKey });
    return pad && Array.isArray(pad.strokes) ? { ...emptyNotepad(), ...pad } : emptyNotepad();
  } catch (e) {
    appLog("warn", `Could not read the notepad: ${e}`);
    return emptyNotepad();
  }
}

let saveTimer = 0;
let pending: { attKey: string; pad: Notepad } | null = null;

/** Write `pad` a moment from now (the last of a burst of changes). */
export function saveNotepadSoon(attKey: string, pad: Notepad): void {
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

/** A link's label: the page, or the highlight's first words. */
export function linkLabel(t: PlaceTarget): string {
  if (t.kind === "place") return `p. ${t.pageIndex + 1}`;
  const words = t.text.replace(/\s+/g, " ").trim();
  return words.length > 40 ? `${words.slice(0, 40).trimEnd()}…` : words || `p. ${t.pageIndex + 1}`;
}
