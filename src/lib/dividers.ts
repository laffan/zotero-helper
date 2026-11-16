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

export function renameDivider(id: string, name: string): void {
  const clean = name.trim();
  if (!clean) return;
  setList(useDividers.getState().list.map((d) => (d.id === id ? { ...d, name: clean } : d)));
}

/** Dragged to another height on its page. */
export function moveDivider(id: string, top: number): void {
  setList(useDividers.getState().list.map((d) => (d.id === id ? { ...d, top } : d)));
}

export function removeDivider(id: string): void {
  setList(useDividers.getState().list.filter((d) => d.id !== id));
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

/** The outline's sections (sectionsOf, in document order) with the
 *  reader's dividers among them. A divider sits a level under the
 *  outline heading it falls in — a part of that section — or at the
 *  top level before the first heading, or with no outline. */
export function withDividers(sections: Section[], dividers: Divider[]): Section[] {
  if (!dividers.length) return sections;
  const added = dividers.map((d): Section => {
    let parent: Section | null = null;
    for (const s of sections) {
      if (!atOrBefore(s, d.pageIndex, d.top)) break;
      parent = s;
    }
    return {
      id: SECTION_PREFIX + d.id,
      title: d.name,
      path: [...(parent?.path ?? []), d.name],
      depth: parent ? parent.depth + 1 : 0,
      pageIndex: d.pageIndex,
      top: d.top,
    };
  });
  // Stable: at the same spot, the outline's heading comes first, so
  // what lies there files under the divider.
  return [...sections, ...added]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.pageIndex - b.s.pageIndex || b.s.top - a.s.top || a.i - b.i)
    .map((x) => x.s);
}
