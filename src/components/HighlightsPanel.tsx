// The Highlights tab: a searchable browser of the selection's Zotero
// annotations, modelled on Hush's highlight pane — a filter box, a
// column of colour swatches, and the highlights in reading order, each
// with its page and an Open in Zotero link that lands on it.
//
// Several selected entries (or one with several PDFs) list under a
// heading per PDF. Nothing is fetched: annotations arrive with every
// sync (src/lib/highlights.ts), and ↻ runs an incremental one. While
// the PDF is open beside the panel, clicking a highlight scrolls the
// viewer to it. A PDF with an outline (lib/outline.ts) has its
// highlights filed under the section headings they fall in.
import { useMemo, useState } from "react";
import { openInZotero, syncNow } from "../lib/actions";
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
import { sectionIndexOf, sectionsOf, useOutlines, type Section } from "../lib/outline";
import { useStore } from "../lib/store";
import type { ZItem } from "../lib/types";
import { CopyIcon, Refresh, Spinner } from "./Icons";
import { showInReader } from "./ReaderPane";

interface Group {
  item: ZItem;
  att: ZItem;
  list: Annotation[];
}

/** Every annotated PDF of the given entries, with its annotations. */
export function highlightGroups(library: ZItem[], items: ZItem[]): Group[] {
  const index = annotationIndexFor(library);
  const out: Group[] = [];
  for (const item of items) {
    for (const att of annotatableAttachments(library, item)) {
      const list = index.get(att.key);
      if (list?.length) out.push({ item, att, list });
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

export function HighlightsPanel({ items }: { items: ZItem[] }) {
  const library = useStore((s) => s.library.items);
  const settings = useStore((s) => s.settings);
  const syncing = useStore((s) => s.syncing);
  // With the PDF open beside the panel, a highlight is a place to go.
  const openAttKey = useStore((s) => s.reading?.attKey ?? null);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const groups = useMemo(() => highlightGroups(library, items), [library, items]);
  const outlines = useOutlines(groups.map((g) => g.att.key));
  const all = useMemo(() => groups.flatMap((g) => g.list), [groups]);
  const colors = useMemo(() => colorsOf(all), [all]);
  const activeColor = color && colors.includes(color) ? color : null;
  const q = query.trim().toLowerCase();

  const visible = groups
    .map((g) => ({
      ...g,
      list: g.list.filter(
        (a) => (!activeColor || a.color === activeColor) && matchesQuery(a, q) && (a.text || a.comment),
      ),
    }))
    .filter((g) => g.list.length);
  const shown = visible.reduce((n, g) => n + g.list.length, 0);

  const copy = async (a: Annotation) => {
    try {
      await navigator.clipboard.writeText(annotationMarkdown(settings, a));
      setCopied(a.key);
      window.setTimeout(() => setCopied((k) => (k === a.key ? null : k)), 1500);
    } catch {
      setCopied(null);
    }
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

  const row = (g: Group, a: Annotation) => (
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
            {copied === a.key ? "Copied" : <CopyIcon size={11} />}
          </button>
          <button
            className="link-btn"
            onClick={(e) => {
              e.stopPropagation();
              open(g, a);
            }}
            title="Open the PDF in Zotero at this highlight"
          >
            Open in Zotero ↗
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
          {shown === all.length ? `${all.length}` : `${shown} of ${all.length}`} highlight
          {all.length === 1 ? "" : "s"}
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
        {colors.length > 1 && (
          <div className="hl-colors">
            <button
              className={`hl-swatch hl-swatch-all ${activeColor ? "" : "active"}`}
              onClick={() => setColor(null)}
              title="All colours"
            />
            {colors.map((c) => (
              <button
                key={c}
                className={`hl-swatch ${activeColor === c ? "active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(activeColor === c ? null : c)}
                title="Only this colour"
              />
            ))}
          </div>
        )}
        <div className="hl-list">
          {visible.length === 0 && <div className="meta-empty">No highlights match.</div>}
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
