// The Highlights tab: a searchable browser of the selection's Zotero
// annotations, modelled on Hush's highlight pane — a filter box, a
// column of colour swatches (HighlightFilters.tsx), and the highlights
// in reading order, each a HighlightRow (its page, Copy, Note, Zotero).
// With the PDF open and the panel wide (MetadataPanel's MAP_WIDTH), the
// same highlights, search and colours are a Highlight Map instead
// (HighlightMap.tsx): the list below is the narrow panel's.
//
// Several selected entries (or one with several PDFs) list under a
// heading per PDF. Nothing is fetched: annotations arrive with every
// sync (src/lib/highlights.ts), and ↻ runs an incremental one. The
// PDFs' bookmarks (lib/bookmarks.ts, made in the reader, kept by this
// app) list among the highlights at the top of their page, with a
// bookmark entry in the colour column to show only them. While
// the PDF is open beside the panel, clicking a highlight scrolls the
// viewer to it. A PDF with an outline (lib/outline.ts) has its
// highlights filed under the section headings they fall in — and so does
// one the reader has divided with Add Section (lib/dividers.ts): those
// sections join the outline's headings (or stand alone, with no outline),
// each a DividerHeading that goes to its line and can be renamed or
// deleted. The
// search, the colours picked and the scroll are the open PDF's, kept
// for it (lib/readerUi.ts); browsing the library, they are the panel's.
import { useMemo, useRef, useState } from "react";
import { syncNow } from "../lib/actions";
import { bookmarkEntry, useBookmarks, type Bookmark } from "../lib/bookmarks";
import { dividerIdOf, dividersOf, useDividers, withDividers } from "../lib/dividers";
import { attachmentName, itemTitle } from "../lib/collections";
import { annotatableAttachments, annotationIndexFor, matchesQuery, type Annotation } from "../lib/highlights";
import { sectionIndexOf, sectionsOf, useOutlines, type Section } from "../lib/outline";
import { usePdfUi, usePdfUiScroll } from "../lib/readerUi";
import { useStore } from "../lib/store";
import type { ZItem } from "../lib/types";
import { DividerHeading } from "./DividerHeading";
import { ColorSwatches, useHighlightFilter } from "./HighlightFilters";
import { HighlightMap } from "./HighlightMap";
import { HighlightRow, useRowHover } from "./HighlightRow";
import { Refresh, Spinner } from "./Icons";

/** One PDF's highlights and bookmarks, and the entry it belongs to. */
export interface HighlightGroup {
  item: ZItem;
  att: ZItem;
  list: Annotation[];
}

/** Every annotated (or bookmarked) PDF of the given entries, with its
 *  annotations and bookmarks in reading order. */
export function highlightGroups(library: ZItem[], items: ZItem[], bookmarks: Bookmark[] = []): HighlightGroup[] {
  const index = annotationIndexFor(library);
  const out: HighlightGroup[] = [];
  for (const item of items) {
    for (const att of annotatableAttachments(library, item)) {
      const marks = bookmarks.filter((b) => b.attKey === att.key).map(bookmarkEntry);
      const annots = index.get(att.key) ?? [];
      const list = marks.length
        ? [...marks, ...annots].sort((a, b) => (a.sortIndex < b.sortIndex ? -1 : a.sortIndex > b.sortIndex ? 1 : 0))
        : annots;
      if (list.length) out.push({ item, att, list });
    }
  }
  return out;
}

export function HighlightsPanel({ items, map = false }: { items: ZItem[]; map?: boolean }) {
  const library = useStore((s) => s.library.items);
  const syncing = useStore((s) => s.syncing);
  // With the PDF open beside the panel, a highlight is a place to go.
  const openAttKey = useStore((s) => s.reading?.attKey ?? null);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [query, setQuery] = usePdfUi(openAttKey, "hlQuery", "");
  // Notes belong to one entry, so Note is offered only with one selected.
  const canAdd = items.length === 1;

  const bookmarks = useBookmarks((s) => s.list);
  const dividers = useDividers((s) => s.list);
  const groups = useMemo(() => highlightGroups(library, items, bookmarks), [library, items, bookmarks]);
  const outlines = useOutlines(groups.map((g) => g.att.key));
  const all = useMemo(() => groups.flatMap((g) => g.list), [groups]);
  const filter = useHighlightFilter(openAttKey, all);
  const { marks } = filter;
  const q = query.trim().toLowerCase();
  /** A PDF's headings: the outline's, with the reader's among them. */
  const sectionsFor = (g: HighlightGroup) =>
    withDividers(sectionsOf(outlines.get(g.att.key) ?? []), dividersOf(dividers, g.att.key));

  const sync = (
    <button
      className="icon-btn"
      onClick={() => void syncNow(false)}
      disabled={syncing}
      title="Fetch changes from Zotero"
      aria-label="Sync highlights"
    >
      {syncing ? <Spinner size={13} /> : <Refresh size={14} />}
    </button>
  );
  /** The list's count: "12 highlights · 2 bookmarks", or how many of
   *  them `shown` are. (The map's bar has none.) */
  const countLabel = (shown: number) =>
    shown === all.length
      ? `${all.length - marks} ${all.length - marks === 1 ? "highlight" : "highlights"}${
          marks > 0 ? ` · ${marks} bookmark${marks === 1 ? "" : "s"}` : ""
        }`
      : `${shown} of ${all.length} shown`;

  if (map) {
    return (
      <HighlightMap
        key={openAttKey ?? ""}
        groups={groups}
        sectionsFor={sectionsFor}
        query={query}
        setQuery={setQuery}
        filter={filter}
        sync={sync}
        canAdd={canAdd}
        openAttKey={openAttKey}
        shownKey={shownKey}
        setShownKey={setShownKey}
      />
    );
  }

  const visible = groups
    .map((g) => ({
      ...g,
      list: g.list.filter((a) => filter.passes(a) && matchesQuery(a, q) && (a.text || a.comment)),
    }))
    .filter((g) => g.list.length);
  const shown = visible.reduce((n, g) => n + g.list.length, 0);

  const row = (g: HighlightGroup, a: Annotation) => (
    <HighlightRow
      key={a.key}
      item={g.item}
      att={g.att}
      entry={a}
      q={q}
      canAdd={canAdd}
      openAttKey={openAttKey}
      shown={shownKey === a.key}
      onShown={() => setShownKey(a.key)}
    />
  );

  // With the PDF's outline known, or sections added to it, highlights
  // file under the heading they fall in; the outline's headings with none
  // aren't shown, the reader's are (unless the list is narrowed).
  const bySection = (g: HighlightGroup): { section: Section | null; list: Annotation[] }[] => {
    const sections = sectionsFor(g);
    if (!sections.length) return [{ section: null, list: g.list }];
    const parts = new Map<number, Annotation[]>();
    for (const a of g.list) {
      const i = sectionIndexOf(sections, a);
      const list = parts.get(i);
      if (list) list.push(a);
      else parts.set(i, [a]);
    }
    if (!q && !filter.active.length) sections.forEach((s, i) => dividerIdOf(s) && !parts.has(i) && parts.set(i, []));
    return [...parts.keys()]
      .sort((x, y) => x - y)
      .map((i) => ({ section: i < 0 ? null : sections[i], list: parts.get(i)! }));
  };

  return (
    <HighlightList
      openAttKey={openAttKey}
      empty={visible.length === 0}
      head={
        <div className="hl-head">
          <span className="hl-count">{countLabel(shown)}</span>
          {sync}
        </div>
      }
      search={
        <input
          className="hl-search"
          type="search"
          placeholder="Search highlights…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      }
      swatches={<ColorSwatches filter={filter} />}
    >
      {visible.map((g) => (
        <section key={g.att.key}>
          {groups.length > 1 && (
            <div className="hl-group" title={attachmentName(g.att)}>
              {itemTitle(g.item)}
              {annotatableAttachments(library, g.item).length > 1 && (
                <span className="hl-group-file"> — {attachmentName(g.att)}</span>
              )}
            </div>
          )}
          {bySection(g).map((part, i) => (
            <div key={part.section?.id ?? `pre-${i}`}>
              {part.section && dividerIdOf(part.section) ? (
                <DividerHeading
                  section={part.section}
                  id={dividerIdOf(part.section)!}
                  itemKey={g.item.key}
                  attKey={g.att.key}
                  open={g.att.key === openAttKey}
                  shown={shownKey === part.section.id}
                  onShown={() => setShownKey(part.section!.id)}
                />
              ) : part.section && (
                <div
                  className="hl-section"
                  style={{ paddingLeft: Math.min(part.section.depth, 3) * 10 }}
                  title={part.section.path.join(" › ")}
                >
                  {part.section.title}
                </div>
              )}
              {part.list.map((a) => row(g, a))}
            </div>
          ))}
        </section>
      ))}
    </HighlightList>
  );
}

interface ListFrame {
  openAttKey: string | null;
  empty: boolean;
  head: React.ReactNode;
  search: React.ReactNode;
  swatches: React.ReactNode;
  children: React.ReactNode;
}

/** The list's frame: the head and the search over it, the swatches
 *  beside it, and the list (`children`) — its scroll kept for the open
 *  PDF, its rows marked under the pointer. Its own component, so the
 *  scroll is put back each time the panel goes from the map to the list. */
function HighlightList({ openAttKey, empty, head, search, swatches, children }: ListFrame) {
  const listRef = useRef<HTMLDivElement>(null);
  usePdfUiScroll(openAttKey, "hlScroll", listRef);
  const hoverRow = useRowHover();
  return (
    <div className="hl-panel">
      {head}
      {search}
      <div className="hl-body">
        {swatches}
        <div className="hl-list" ref={listRef} onPointerMove={hoverRow} onPointerLeave={hoverRow}>
          {empty && <div className="meta-empty">Nothing matches.</div>}
          {children}
        </div>
      </div>
    </div>
  );
}
