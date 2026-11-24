// The Highlight Map's shape: a PDF's highlights in rows and columns.
// Rows are its chapters — the outline's top-level headings, and any
// heading, the outline's or the reader's (Add Section), whose name
// begins with "Chapter". Columns are what a chapter is divided into —
// the outline's headings one level under the chapter's, and every
// section the reader added (lib/dividers.ts) that isn't a chapter — but
// one the reader nested under another of theirs that isn't a chapter is
// a small heading within that one's column, as is any heading deeper
// than a column's.
//
// It is the same filing the Highlights list does (sectionIndexOf, in
// lib/outline.ts — a highlight falls under the nearest heading above
// it), laid out in two directions instead of one: walking the headings
// in document order, a chapter starts a row, a column heading starts a
// column in the row, and each heading's highlights go in the column in
// force. Highlights before a row's first column heading make a column
// of their own at its start, with no heading; those before the first
// chapter, a row with no heading at the top. How tall a column may be
// is the canvas's to say: wrap.ts runs a long one on into more stacks
// to its right, so a row is never taller than the canvas.
//
// As in the list, the outline's headings with no highlights are left
// out, and the reader's sections stay (an empty column, or a row),
// since the reader put them there. The search and the colour filter
// don't change the shape — the map pans to a match and dims what the
// filter leaves out (HighlightMap.tsx) — so the map keeps still while
// they change.
import type { Annotation } from "../lib/highlights";
import { dividerIdOf } from "../lib/dividers";
import { sectionIndexOf, type Section } from "../lib/outline";

/** What a column holds, top to bottom. */
export type MapItem = { kind: "heading"; section: Section } | { kind: "entry"; entry: Annotation };

export interface MapColumn {
  key: string;
  /** Its heading; null for the highlights before a row's first one. */
  section: Section | null;
  items: MapItem[];
}

export interface MapRow {
  key: string;
  /** Its chapter; null for the highlights before the first. */
  section: Section | null;
  columns: MapColumn[];
}

/** A name that makes a heading a chapter, wherever it sits. */
const CHAPTER = /^chapter\b/i;

export const isChapter = (s: Section): boolean => CHAPTER.test(s.title.trim());

interface Building extends MapRow {
  /** The chapter heading's depth (-1 for the row before the first). */
  depth: number;
}

/** The PDF's highlights (`list`, in reading order) as rows of columns,
 *  under its sections — the outline's with the reader's among them
 *  (withDividers), in document order. */
export function mapRows(sections: Section[], list: Annotation[]): MapRow[] {
  // Each section's highlights, by its index; -1 before the first.
  const under = new Map<number, Annotation[]>();
  for (const a of list) {
    const i = sections.length ? sectionIndexOf(sections, a) : -1;
    const got = under.get(i);
    if (got) got.push(a);
    else under.set(i, [a]);
  }
  const entries = (i: number): MapItem[] => (under.get(i) ?? []).map((entry) => ({ kind: "entry", entry }));
  const lead = (key: string): MapColumn => ({ key: `${key}/lead`, section: null, items: [] });

  const rows: Building[] = [{ key: "top", section: null, depth: -1, columns: [lead("top")] }];
  let row = rows[0];
  let column = row.columns[0];
  column.items.push(...entries(-1));
  const byId = new Map(sections.map((s) => [s.id, s]));
  sections.forEach((s, i) => {
    const mine = dividerIdOf(s) !== null;
    const parent = s.nestedIn ? byId.get(s.nestedIn) : undefined;
    // Nested under a column of the reader's (or a heading in one): within it.
    const within = mine && parent !== undefined && !isChapter(parent);
    if (isChapter(s) || (!mine && s.depth === 0)) {
      row = { key: s.id, section: s, depth: s.depth, columns: [lead(s.id)] };
      rows.push(row);
      column = row.columns[0];
    } else if (!within && (mine || s.depth <= row.depth + 1)) {
      column = { key: s.id, section: s, items: [] };
      row.columns.push(column);
    } else column.items.push({ kind: "heading", section: s });
    column.items.push(...entries(i));
  });

  const out: MapRow[] = [];
  for (const r of rows) {
    const columns = r.columns
      .map((c) => ({ ...c, items: dropBareHeadings(c.items) }))
      .filter((c) => c.items.length || (c.section && dividerIdOf(c.section)));
    const keep = columns.length || (r.section && dividerIdOf(r.section));
    if (keep) out.push({ key: r.key, section: r.section, columns: columns.length ? columns : [lead(r.key)] });
  }
  return out;
}

/** A heading within a column goes when no highlight follows it before
 *  the next heading (or the column's end) — but the reader's own, which
 *  they put there. */
function dropBareHeadings(items: MapItem[]): MapItem[] {
  return items.filter(
    (it, i) => it.kind === "entry" || dividerIdOf(it.section) !== null || items[i + 1]?.kind === "entry",
  );
}
