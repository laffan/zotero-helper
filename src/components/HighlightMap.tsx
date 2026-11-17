// The Highlight Map: the Highlights tab while the PDF is open and the
// panel is wide (MetadataPanel's MAP_WIDTH) — the same highlights as
// the list, laid out on a canvas that pans and zooms (highlightmap/
// view.ts), in rows for the PDF's chapters and columns for what each is
// divided into (highlightmap/layout.ts). Each card is the list's row
// (HighlightRow): a click goes to the highlight in the pages, and Copy,
// Note and Zotero are on it as in the list.
//
// One bar over the canvas holds the count, the search, the colours and
// ↻, the search and colours being the list's own (kept per PDF), so the
// panel crosses between the two with the same ones. They work
// differently here: the search doesn't narrow the map but goes round its
// matches — the first as the words are typed, then Enter (or ›) the next
// and ⇧Enter (or ‹) the one before, each glided to the middle of the
// view and ringed; the colours dim the cards they leave out (and the
// search steps over those). The view — pan and zoom — is the PDF's, kept
// beside it (lib/readerUi.ts), and as it was left when the map comes
// back.
import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { dividerIdOf } from "../lib/dividers";
import { attachmentName } from "../lib/collections";
import { matchesQuery } from "../lib/highlights";
import type { Section } from "../lib/outline";
import { lastUi, saveUi } from "../lib/recent";
import { mapRows, type MapColumn, type MapRow } from "../highlightmap/layout";
import { createMapView, type MapViewControl } from "../highlightmap/view";
import { DividerHeading } from "./DividerHeading";
import { ColorSwatches, type HighlightFilter } from "./HighlightFilters";
import { HighlightRow, useRowHover } from "./HighlightRow";
import type { HighlightGroup } from "./HighlightsPanel";
import { ChevronDown, ChevronUp, FitIcon, MinusIcon, PlusIcon } from "./Icons";
import { goToReaderPosition } from "./ReaderPane";

/** The pause in typing before the map goes to the first match, ms. */
const TYPING_MS = 250;
/** Each press of − or + zooms by this much. */
const ZOOM_STEP = 1.25;

interface Props {
  groups: HighlightGroup[];
  /** A PDF's headings, the outline's and the reader's (withDividers). */
  sectionsFor: (g: HighlightGroup) => Section[];
  query: string;
  setQuery: (q: string) => void;
  filter: HighlightFilter;
  count: string;
  /** The ↻ button. */
  sync: React.ReactNode;
  canAdd: boolean;
  openAttKey: string | null;
  shownKey: string | null;
  setShownKey: (key: string | null) => void;
}

/** What the cards and headings need to know, passed down the map. */
interface Ctx extends Props {
  q: string;
  matches: Set<string>;
  current: string | null;
}

export function HighlightMap(props: Props) {
  const { groups, sectionsFor, query, setQuery, filter, count, sync, openAttKey, setShownKey } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<MapViewControl | null>(null);
  const hover = useRowHover();
  const q = query.trim().toLowerCase();

  const maps = groups.map((g) => ({ g, rows: mapRows(sectionsFor(g), g.list.filter((a) => a.text || a.comment)) }));

  // The search's matches, in reading order: the cards it goes round.
  const order: string[] = [];
  if (q) {
    for (const { rows } of maps)
      for (const r of rows)
        for (const c of r.columns)
          for (const it of c.items)
            if (it.kind === "entry" && filter.passes(it.entry) && matchesQuery(it.entry, q)) order.push(it.entry.key);
  }
  const [cursor, setCursor] = useState({ q, i: 0, step: 0 });
  const at = cursor.q === q && order.length ? Math.min(cursor.i, order.length - 1) : 0;
  const current = order[at] ?? null;
  const step = (d: number) => {
    if (order.length) setCursor({ q, i: (at + d + order.length) % order.length, step: cursor.step + 1 });
  };

  // The canvas: its view as this PDF left it, or a first look.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const layer = layerRef.current;
    if (!host || !layer) return;
    const view = createMapView(host, layer, {
      moved(v, done) {
        if (zoomRef.current) zoomRef.current.textContent = `${Math.round(v.z * 100)}%`;
        if (done && openAttKey) {
          saveUi(openAttKey, { hlMap: { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z * 1000) / 1000 } });
        }
      },
    });
    const saved = openAttKey ? lastUi(openAttKey).hlMap : undefined;
    if (saved) view.set(saved);
    else view.home();
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [openAttKey]);

  // To the match in force: at once for a step, after a pause in typing.
  // Not for the search the map opened with — its view is as left.
  const opened = useRef<string | null>(q);
  const seenStep = useRef(cursor.step);
  useEffect(() => {
    const stepped = seenStep.current !== cursor.step;
    seenStep.current = cursor.step;
    if (!stepped && opened.current === q) return;
    opened.current = null;
    if (!current) return;
    const t = window.setTimeout(
      () => {
        const el = layerRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(current)}"]`);
        if (el) viewRef.current?.show(el);
      },
      stepped ? 0 : TYPING_MS,
    );
    return () => window.clearTimeout(t);
  }, [current, q, cursor.step]);

  /** A tap on the bare canvas lets go of the card picked. */
  const bare = (e: React.MouseEvent) => {
    if (!(e.target as Element).closest(".hlmap-card, .hlmap-head, .hlmap-controls")) setShownKey(null);
  };

  const ctx: Ctx = { ...props, q, matches: new Set(order), current };
  return (
    <div className="hl-panel hlmap">
      <div className="hlmap-bar">
        <span className="hl-count">{count}</span>
        <div className="hlmap-search">
          <input
            className="hl-search"
            type="search"
            placeholder="Search the map…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }}
          />
          {q && <span className="hlmap-hits">{order.length ? `${at + 1} of ${order.length}` : "No matches"}</span>}
          {order.length > 1 && (
            <>
              <button className="icon-btn" onClick={() => step(-1)} title="The match before (⇧Enter)" aria-label="Previous match">
                <ChevronUp size={13} />
              </button>
              <button className="icon-btn" onClick={() => step(1)} title="The next match (Enter)" aria-label="Next match">
                <ChevronDown size={13} />
              </button>
            </>
          )}
        </div>
        <ColorSwatches filter={filter} row />
        {sync}
      </div>
      <div className="hlmap-canvas" ref={hostRef} onClick={bare} onPointerMove={hover} onPointerLeave={hover}>
        <div className="hlmap-layer" ref={layerRef}>
          {maps.every((m) => !m.rows.length) && <div className="meta-empty">Nothing to map.</div>}
          {maps.map(({ g, rows }) => (
            <section className="hlmap-pdf" key={g.att.key}>
              {groups.length > 1 && <div className="hlmap-pdf-title">{attachmentName(g.att)}</div>}
              {rows.map((r) => (
                <RowView key={r.key} row={r} g={g} ctx={ctx} />
              ))}
            </section>
          ))}
        </div>
        <div className="hlmap-controls">
          <button className="icon-btn" onClick={() => viewRef.current?.zoom(1 / ZOOM_STEP)} title="Zoom out" aria-label="Zoom out">
            <MinusIcon size={13} />
          </button>
          <button className="hlmap-zoom" ref={zoomRef} onClick={() => viewRef.current?.zoom(null)} title="Actual size">
            100%
          </button>
          <button className="icon-btn" onClick={() => viewRef.current?.zoom(ZOOM_STEP)} title="Zoom in" aria-label="Zoom in">
            <PlusIcon size={13} />
          </button>
          <button className="icon-btn" onClick={() => viewRef.current?.fit()} title="The whole map" aria-label="Fit the whole map">
            <FitIcon size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** A chapter: its heading over its columns, side by side. */
function RowView({ row, g, ctx }: { row: MapRow; g: HighlightGroup; ctx: Ctx }) {
  // A column with no heading leaves its heading's room, so the cards
  // start level across the row.
  const headed = row.columns.some((c) => c.section);
  return (
    <div className="hlmap-row">
      {row.section && <Heading section={row.section} kind="row" g={g} ctx={ctx} />}
      <div className="hlmap-columns">
        {row.columns.map((c) => (
          <ColumnView key={c.key} column={c} headed={headed} g={g} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function ColumnView({ column, headed, g, ctx }: { column: MapColumn; headed: boolean; g: HighlightGroup; ctx: Ctx }) {
  const { q, canAdd, openAttKey, shownKey, setShownKey, filter, matches, current } = ctx;
  return (
    <div className="hlmap-column">
      {column.section ? (
        <Heading section={column.section} kind="column" g={g} ctx={ctx} />
      ) : (
        headed && <div className="hlmap-head hlmap-head-column hlmap-head-blank" />
      )}
      {column.items.map((it) =>
        it.kind === "heading" ? (
          <Heading key={it.section.id} section={it.section} kind="sub" g={g} ctx={ctx} />
        ) : (
          <div
            key={it.entry.key}
            data-key={it.entry.key}
            className={`hlmap-card ${filter.passes(it.entry) ? "" : "dim"} ${matches.has(it.entry.key) ? "match" : ""} ${
              current === it.entry.key ? "current" : ""
            }`}
          >
            <HighlightRow
              item={g.item}
              att={g.att}
              entry={it.entry}
              q={matches.has(it.entry.key) ? q : ""}
              canAdd={canAdd}
              openAttKey={openAttKey}
              shown={shownKey === it.entry.key}
              onShown={() => setShownKey(it.entry.key)}
            />
          </div>
        ),
      )}
      {!column.items.length && <div className="hlmap-empty">No highlights</div>}
    </div>
  );
}

/** A chapter's, a column's or a smaller heading: the reader's sections
 *  as in the list (DividerHeading — a click goes to the line, Rename,
 *  Delete), the outline's a click to its place in the open PDF. */
function Heading({ section, kind, g, ctx }: { section: Section; kind: "row" | "column" | "sub"; g: HighlightGroup; ctx: Ctx }) {
  const id = dividerIdOf(section);
  const open = g.att.key === ctx.openAttKey;
  if (id) {
    return (
      <div className={`hlmap-head hlmap-head-${kind} mine`}>
        <DividerHeading
          section={section}
          id={id}
          itemKey={g.item.key}
          attKey={g.att.key}
          open={open}
          shown={ctx.shownKey === section.id}
          onShown={() => ctx.setShownKey(section.id)}
          indent={false}
        />
      </div>
    );
  }
  return (
    <div
      className={`hlmap-head hlmap-head-${kind} ${open ? "navigable" : ""}`}
      title={section.path.join(" › ")}
      onClick={open ? () => goToReaderPosition(section.pageIndex, Number.isFinite(section.top) ? section.top : null) : undefined}
    >
      {section.title}
    </div>
  );
}
