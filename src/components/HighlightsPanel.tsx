// The Highlights tab: a searchable browser of the selection's Zotero
// annotations, modelled on Hush's highlight pane — a filter box, a
// column of colour swatches, and the highlights in reading order, each
// with its page and three actions: Copy (a Markdown quote), Note (the
// same quote, into the entry's notes) and Zotero (opens the PDF there,
// on the highlight).
//
// Several selected entries (or one with several PDFs) list under a
// heading per PDF. Nothing is fetched: annotations arrive with every
// sync (src/lib/highlights.ts), and ↻ runs an incremental one. The
// PDFs' bookmarks (lib/bookmarks.ts, made in the reader, kept by this
// app) list among the highlights at the top of their page, with a
// bookmark entry in the colour column to show only them. While
// the PDF is open beside the panel, clicking a highlight scrolls the
// viewer to it. A PDF with an outline (lib/outline.ts) has its
// highlights filed under the section headings they fall in. The
// search, the colours picked and the scroll are the open PDF's, kept
// for it (lib/readerUi.ts); browsing the library, they are the panel's.
import { useMemo, useRef, useState } from "react";
import { openInZotero, syncNow } from "../lib/actions";
import { BOOKMARK_FILTER, bookmarkEntry, isBookmark, useBookmarks, type Bookmark } from "../lib/bookmarks";
import { attachmentName, itemTitle } from "../lib/collections";
import {
  annotatableAttachments,
  annotationIndexFor,
  annotationPosition,
  annotationMarkdown,
  colorsOf,
  matchesQuery,
  type Annotation,
} from "../lib/highlights";
import { insertIntoNotes } from "../lib/notes";
import { sectionIndexOf, sectionsOf, useOutlines, type Section } from "../lib/outline";
import { usePdfUi, usePdfUiScroll } from "../lib/readerUi";
import { useStore } from "../lib/store";
import type { ZItem } from "../lib/types";
import { BookmarkRow } from "./BookmarkRow";
import { BookmarkIcon, CopyIcon, ExternalIcon, QuoteIcon, Refresh, Spinner } from "./Icons";
import { showInReader } from "./ReaderPane";

interface Group {
  item: ZItem;
  att: ZItem;
  list: Annotation[];
}

/** Every annotated (or bookmarked) PDF of the given entries, with its
 *  annotations and bookmarks in reading order. */
export function highlightGroups(library: ZItem[], items: ZItem[], bookmarks: Bookmark[] = []): Group[] {
  const index = annotationIndexFor(library);
  const out: Group[] = [];
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

function Marked({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let last = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, last)) {
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <mark className="hl-match" key={i}>
        {text.slice(i, i + q.length)}
      </mark>,
    );
    last = i + q.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

const NO_COLORS: string[] = [];

export function HighlightsPanel({ items }: { items: ZItem[] }) {
  const library = useStore((s) => s.library.items);
  const settings = useStore((s) => s.settings);
  const syncing = useStore((s) => s.syncing);
  // With the PDF open beside the panel, a highlight is a place to go.
  const openAttKey = useStore((s) => s.reading?.attKey ?? null);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [query, setQuery] = usePdfUi(openAttKey, "hlQuery", "");
  // The colours shown; none picked shows all. A click picks one colour
  // (or, on the only one picked, all again); ⌘-click (Ctrl elsewhere)
  // adds or removes one, as in a file list.
  const [picked, setPicked] = usePdfUi(openAttKey, "hlColors", NO_COLORS);
  const listRef = useRef<HTMLDivElement>(null);
  usePdfUiScroll(openAttKey, "hlScroll", listRef);
  // The last action that just happened, shown on its button for a moment.
  const [done, setDone] = useState<{ key: string; what: "copy" | "add" } | null>(null);
  // Notes belong to one entry, so Note is offered only with one selected.
  const canAdd = items.length === 1;

  const bookmarks = useBookmarks((s) => s.list);
  const groups = useMemo(() => highlightGroups(library, items, bookmarks), [library, items, bookmarks]);
  const outlines = useOutlines(groups.map((g) => g.att.key));
  const all = useMemo(() => groups.flatMap((g) => g.list), [groups]);
  // The colour column's entries: the highlights' colours, then bookmarks.
  const colors = useMemo(() => colorsOf(all), [all]);
  const marks = all.filter(isBookmark).length;
  const filters = marks ? [...colors, BOOKMARK_FILTER] : colors;
  const active = picked.filter((c) => filters.includes(c));
  const filterOf = (a: Annotation) => (isBookmark(a) ? BOOKMARK_FILTER : a.color);
  const pick = (c: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setPicked(active.includes(c) ? active.filter((x) => x !== c) : [...active, c]);
    } else setPicked(active.length === 1 && active[0] === c ? [] : [c]);
  };
  const q = query.trim().toLowerCase();

  const visible = groups
    .map((g) => ({
      ...g,
      list: g.list.filter(
        (a) => (!active.length || active.includes(filterOf(a))) && matchesQuery(a, q) && (a.text || a.comment),
      ),
    }))
    .filter((g) => g.list.length);
  const shown = visible.reduce((n, g) => n + g.list.length, 0);

  const flash = (key: string, what: "copy" | "add") => {
    setDone({ key, what });
    window.setTimeout(() => setDone((d) => (d?.key === key && d.what === what ? null : d)), 1500);
  };

  const copy = async (a: Annotation) => {
    try {
      await navigator.clipboard.writeText(annotationMarkdown(settings, a));
      flash(a.key, "copy");
    } catch {
      setDone(null);
    }
  };

  const add = (a: Annotation) => {
    insertIntoNotes(annotationMarkdown(settings, a));
    flash(a.key, "add");
  };

  /** Scroll the open PDF to the highlight. */
  const reveal = (g: Group, a: Annotation) => {
    if (g.att.key !== openAttKey) return;
    // A text selection in the row is someone copying, not navigating.
    if (window.getSelection()?.toString()) return;
    const page = annotationPosition(a)?.pageIndex;
    if (showInReader(g.att.key, page != null ? page + 1 : undefined, a.key)) setShownKey(a.key);
  };

  const open = (g: Group, a: Annotation) => {
    const page = parseInt(a.pageLabel, 10);
    void openInZotero(g.item.key, g.att.key, undefined, isNaN(page) ? undefined : page, a.key);
  };

  const row = (g: Group, a: Annotation) =>
    isBookmark(a) ? (
      <BookmarkRow
        key={a.key}
        entry={a}
        itemKey={g.item.key}
        marked={<Marked text={a.text} q={q} />}
        canAdd={canAdd}
        shown={shownKey === a.key}
        onShown={() => setShownKey(a.key)}
      />
    ) : (
    <div
      className={`hl-row ${g.att.key === openAttKey ? "navigable" : ""} ${
        shownKey === a.key ? "shown" : ""
      }`}
      key={a.key}
      style={a.color ? { borderLeftColor: a.color } : undefined}
      onClick={() => reveal(g, a)}
      title={g.att.key === openAttKey ? "Show in the PDF" : undefined}
    >
      {a.text && (
        <div className="hl-text">
          <Marked text={a.text} q={q} />
        </div>
      )}
      {a.comment && (
        <div className="hl-comment">
          <Marked text={a.comment} q={q} />
        </div>
      )}
      <div className="hl-meta">
        {a.pageLabel && <span>p. {a.pageLabel}</span>}
        {a.type !== "highlight" && <span>· {a.type}</span>}
        {a.tags.length > 0 && <span className="hl-tags">· {a.tags.join(", ")}</span>}
        <span className="hl-actions">
          <button
            className="link-btn"
            onClick={(e) => {
              e.stopPropagation();
              void copy(a);
            }}
            title="Copy as a Markdown quote with a link back to the page"
          >
            <CopyIcon size={11} />
            {done?.key === a.key && done.what === "copy" ? "Copied" : "Copy"}
          </button>
          {canAdd && (
            <button
              className="link-btn"
              onClick={(e) => {
                e.stopPropagation();
                add(a);
              }}
              title="Add to the notes as a quote, with a link back to the page"
            >
              <QuoteIcon size={11} />
              {done?.key === a.key && done.what === "add" ? "Added" : "Note"}
            </button>
          )}
          <button
            className="link-btn"
            onClick={(e) => {
              e.stopPropagation();
              open(g, a);
            }}
            title="Open the PDF in Zotero at this highlight"
          >
            <ExternalIcon size={11} />
            Zotero
          </button>
        </span>
      </div>
    </div>
  );

  // With the PDF's outline known, highlights file under the heading
  // they fall in; headings with none aren't shown.
  const bySection = (g: Group): { section: Section | null; list: Annotation[] }[] => {
    const sections = sectionsOf(outlines.get(g.att.key) ?? []);
    if (!sections.length) return [{ section: null, list: g.list }];
    const parts = new Map<number, Annotation[]>();
    for (const a of g.list) {
      const i = sectionIndexOf(sections, a);
      const list = parts.get(i);
      if (list) list.push(a);
      else parts.set(i, [a]);
    }
    return [...parts.keys()]
      .sort((x, y) => x - y)
      .map((i) => ({ section: i < 0 ? null : sections[i], list: parts.get(i)! }));
  };

  return (
    <div className="hl-panel">
      <div className="hl-head">
        <span className="hl-count">
          {shown === all.length ? `${all.length - marks}` : `${shown} of ${all.length}`}{" "}
          {shown === all.length ? (all.length - marks === 1 ? "highlight" : "highlights") : "shown"}
          {marks > 0 && shown === all.length && ` · ${marks} bookmark${marks === 1 ? "" : "s"}`}
        </span>
        <button
          className="icon-btn"
          onClick={() => void syncNow(false)}
          disabled={syncing}
          title="Fetch changes from Zotero"
          aria-label="Sync highlights"
        >
          {syncing ? <Spinner size={13} /> : <Refresh size={14} />}
        </button>
      </div>
      <input
        className="hl-search"
        type="search"
        placeholder="Search highlights…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="hl-body">
        {filters.length > 1 && (
          <div className="hl-colors">
            <button
              className={`hl-swatch hl-swatch-all ${active.length ? "" : "active"}`}
              onClick={() => setPicked([])}
              title="All colours"
            />
            {colors.map((c) => (
              <button
                key={c}
                className={`hl-swatch ${active.includes(c) ? "active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={(e) => pick(c, e)}
                title="Only this colour (⌘-click to pick several)"
              />
            ))}
            {marks > 0 && (
              <button
                className={`hl-swatch hl-swatch-bookmark ${active.includes(BOOKMARK_FILTER) ? "active" : ""}`}
                onClick={(e) => pick(BOOKMARK_FILTER, e)}
                title="Only bookmarks (⌘-click to add them to colours)"
                aria-label="Only bookmarks"
              >
                <BookmarkIcon size={11} filled />
              </button>
            )}
          </div>
        )}
        <div className="hl-list" ref={listRef}>
          {visible.length === 0 && <div className="meta-empty">Nothing matches.</div>}
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
                  {part.section && (
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
        </div>
      </div>
    </div>
  );
}
