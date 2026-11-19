// Sections the reader adds to a PDF: Add Section, in the reader's bottom
// bar and among reading mode's buttons, puts a labelled dashed line across
// a page (src/pdfviewer/dividers.ts). Zotero has nothing like them, so,
// like the bookmarks (lib/bookmarks.ts), they stay in this app —
// `sections.json` in its data folder (src-tauri/src/dividers.rs), loaded
// at startup and written a moment after each change.
//
// In the code they are "dividers", to keep them apart from the outline's
// sections (lib/outline.ts) — which they join in the Highlights tab:
// `withDividers` puts them among the PDF's own headings, in document
// order, so a highlight files under the nearest heading above it,
// whichever made it. A PDF with no outline is divided by them alone.
//
// A section can be nested under one of the reader's sections before it
// (`parentId`, chosen as it is added or renamed): it is then a level
// under that one — in the list, and on the Highlight Map a heading
// within that one's column rather than a column of its own (unless that
// one is a chapter). Only a section still open at the point can be chosen
// (`nestingChoices`): the nearest before it, that one's own parent, and
// so on up, within the same heading of the outline — so the nesting
// always reads true in document order. One whose parent no longer is
// (moved past another, or the parent deleted) sits at the top level
// again. Whether a section is a chapter is still its name's to say.
import { create } from "zustand";
import type { Section } from "./outline";
import { appLog } from "./store";
import { invoke, isTauri } from "./tauri";

export interface Divider {
  id: string;
  /** The PDF attachment, and the entry it belongs to. */
  attKey: string;
  itemKey: string;
  /** 0-based page. */
  pageIndex: number;
  /** The page's printed label, when the PDF has labels. */
  pageLabel?: string;
  /** The line's height on the page, in PDF units (y up). */
  top: number;
  name: string;
  createdMs: number;
  /** The reader's section it is nested under (see above). */
  parentId?: string;
}

export const useDividers = create<{ list: Divider[] }>(() => ({ list: [] }));

let saveTimer = 0;

function save(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!isTauri) return;
    invoke("save_dividers", { dividers: useDividers.getState().list }).catch((e) =>
      appLog("error", `Saving sections failed: ${e}`),
    );
  }, 300);
}

function setList(list: Divider[]): void {
  useDividers.setState({ list });
  save();
}

/** Called once, from bootstrap. */
export async function loadDividers(): Promise<void> {
  try {
    const list = await invoke<Divider[]>("load_dividers");
    useDividers.setState({ list: Array.isArray(list) ? list : [] });
  } catch (e) {
    appLog("debug", `No sections loaded: ${e}`);
  }
}

export function addDivider(d: Omit<Divider, "id" | "createdMs">): void {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  setList([...useDividers.getState().list, { ...d, id, createdMs: Date.now() }]);
}

/** Renamed — and, given `parentId`, nested under that section (null:
 *  under none). */
export function renameDivider(id: string, name: string, parentId?: string | null): void {
  const clean = name.trim();
  if (!clean) return;
  const nest = (d: Divider): Divider => {
    if (parentId === undefined) return d;
    const { parentId: _old, ...rest } = d;
    return parentId ? { ...rest, parentId } : rest;
  };
  setList(useDividers.getState().list.map((d) => (d.id === id ? nest({ ...d, name: clean }) : d)));
}

/** Dragged to another height on its page. */
export function moveDivider(id: string, top: number): void {
  setList(useDividers.getState().list.map((d) => (d.id === id ? { ...d, top } : d)));
}

/** Deleted; the sections nested under it move up to its own parent. */
export function removeDivider(id: string): void {
  const list = useDividers.getState().list;
  const gone = list.find((d) => d.id === id);
  setList(
    list
      .filter((d) => d.id !== id)
      .map((d) => {
        if (d.parentId !== id) return d;
        const { parentId: _old, ...rest } = d;
        return gone?.parentId ? { ...rest, parentId: gone.parentId } : rest;
      }),
  );
}

/** A PDF's dividers, in reading order. */
export function dividersOf(list: Divider[], attKey: string): Divider[] {
  return list.filter((d) => d.attKey === attKey).sort((a, b) => a.pageIndex - b.pageIndex || b.top - a.top);
}

/** The id a divider takes as a Section among the outline's. */
const SECTION_PREFIX = "divider:";
/** The divider a Section stands for, or null for an outline heading. */
export const dividerIdOf = (s: Section): string | null =>
  s.id.startsWith(SECTION_PREFIX) ? s.id.slice(SECTION_PREFIX.length) : null;

/** Is section `s` at or before the spot (page, height)? */
const atOrBefore = (s: Section, pageIndex: number, top: number) =>
  s.pageIndex < pageIndex || (s.pageIndex === pageIndex && s.top >= top);

/** The outline's heading section `(pageIndex, top)` falls in — the last
 *  at or before it — or null before the first. */
function enclosing(sections: Section[], pageIndex: number, top: number): Section | null {
  let parent: Section | null = null;
  for (const s of sections) {
    if (!atOrBefore(s, pageIndex, top)) break;
    parent = s;
  }
  return parent;
}

/** A reader's section still open at the point reached, and the Section
 *  it is among the headings. */
type Open = { id: string; s: Section };

/** Walk `dividers` (in reading order) among the outline's `sections`,
 *  giving each its place as a Section — nested under its parent while
 *  that is still open, else at the top level of the outline heading it
 *  falls in. Returns them, and what is still open after the last. */
function walk(sections: Section[], dividers: Divider[]): { added: Section[]; open: Open[]; under: Section | null } {
  const added: Section[] = [];
  let open: Open[] = [];
  let under: Section | null | undefined;
  for (const d of dividers) {
    const parent = enclosing(sections, d.pageIndex, d.top);
    // Past an outline heading, the sections before it are closed.
    if (parent !== under) {
      open = [];
      under = parent;
    }
    const at = d.parentId ? open.findIndex((o) => o.id === d.parentId) : -1;
    open = at >= 0 ? open.slice(0, at + 1) : [];
    const over = at >= 0 ? open[at].s : parent;
    const s: Section = {
      id: SECTION_PREFIX + d.id,
      title: d.name,
      path: [...(over?.path ?? []), d.name],
      depth: over ? over.depth + 1 : 0,
      pageIndex: d.pageIndex,
      top: d.top,
      ...(at >= 0 ? { nestedIn: open[at].s.id } : {}),
    };
    open.push({ id: d.id, s });
    added.push(s);
  }
  return { added, open, under: under ?? null };
}

const inOrder = (a: Divider, b: Divider) => a.pageIndex - b.pageIndex || b.top - a.top;

/** The outline's sections (sectionsOf, in document order) with the
 *  reader's dividers among them. A divider sits a level under the
 *  outline heading it falls in — a part of that section — or at the
 *  top level before the first heading, or with no outline; one nested
 *  under another of the reader's, a level under that one. */
export function withDividers(sections: Section[], dividers: Divider[]): Section[] {
  if (!dividers.length) return sections;
  const { added } = walk(sections, dividers.slice().sort(inOrder));
  // Stable: at the same spot, the outline's heading comes first, so
  // what lies there files under the divider.
  return [...sections, ...added]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.pageIndex - b.s.pageIndex || b.s.top - a.s.top || a.i - b.i)
    .map((x) => x.s);
}

/** A section a new or renamed one at `(pageIndex, top)` can be nested
 *  under: its id, name, and how deep it is among the choices (0 the
 *  outermost). */
export interface NestChoice {
  id: string;
  name: string;
  level: number;
}

/** The reader's sections still open at `(pageIndex, top)` — the ones a
 *  section there can be nested under — outermost first. `exceptId`: the
 *  section being renamed, left out. */
export function nestingChoices(
  sections: Section[],
  dividers: Divider[],
  pageIndex: number,
  top: number,
  exceptId?: string,
): NestChoice[] {
  const before = dividers
    .filter((d) => d.id !== exceptId && (d.pageIndex < pageIndex || (d.pageIndex === pageIndex && d.top > top)))
    .sort(inOrder);
  const { open, under } = walk(sections, before);
  if (!before.length || enclosing(sections, pageIndex, top) !== under) return [];
  return open.map((o, level) => ({ id: o.id, name: o.s.title, level }));
}
