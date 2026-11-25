// The Highlight Map: the Highlights tab while the PDF is open and the
// panel is wide (MetadataPanel's MAP_WIDTH) — the same highlights as
// the list, laid out on a canvas that pans and zooms (highlightmap/
// view.ts), in rows for the PDF's chapters and columns for what each is
// divided into (highlightmap/layout.ts) — a column running on into more
// to its right, so that no chapter is taller than the canvas
// (highlightmap/wrap.ts). Each card is the list's row
// (HighlightRow): a click goes to the highlight in the pages, and Copy,
// Note and Zotero are on it as in the list.
//
// One bar over the canvas holds the search, the colours, ↻ and View
// Notepad (the PDF's notepad, as a pane over the map's right —
// MapNotepad.tsx), the search and colours being the list's own (kept per PDF), so
// the panel crosses between the two with the same ones. They work
// differently here: neither narrows the map, which keeps still; both
// fade what they leave out. The search also goes round its matches —
// the first as the words are typed, then Enter (or ›) the next and
// ⇧Enter (or ‹) the one before, each glided to the middle of the view
// and ringed — the cards the colours fade among them. The view —
// pan and zoom — is the PDF's, kept beside it (lib/readerUi.ts), and as
// it was left when the map comes back.
import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { dividerIdOf } from "../lib/dividers";
import { attachmentName } from "../lib/collections";
import { matchesQuery, type Annotation } from "../lib/highlights";
import type { Section } from "../lib/outline";
import { lastUi, saveUi } from "../lib/recent";
import { mapRows, type MapColumn, type MapRow } from "../highlightmap/layout";
import { createMapView, type MapViewControl } from "../highlightmap/view";
import { createMapWrap, type MapWrapControl } from "../highlightmap/wrap";
import { DividerHeading } from "./DividerHeading";
import { ColorSwatches, HighlightSearch, type HighlightFilter } from "./HighlightFilters";
import { HighlightRow, useRowHover } from "./HighlightRow";
import type { HighlightGroup } from "./HighlightsPanel";
import { ChevronDown, ChevronUp, FitIcon, MinusIcon, PlusIcon } from "./Icons";
import { MapNotepadPane, MapNotepadToggle, useMapNotepad } from "./MapNotepad";
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
  const { groups, sectionsFor, query, setQuery, filter, sync, openAttKey, setShownKey } = props;
  const pad = useMapNotepad();
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<MapViewControl | null>(null);
  const wrapRef = useRef<MapWrapControl | null>(null);
  const hover = useRowHover();
  const q = query.trim().toLowerCase();

  const maps = groups.map((g) => ({ g, rows: mapRows(sectionsFor(g), g.list.filter((a) => a.text || a.comment)) }));

  // The search's matches, in reading order: the cards it goes round —
  // the ones the colours fade among them, since a faded card is still
  // on the map to be found.
  const order: string[] = [];
  if (q) {
    for (const { rows } of maps)
      for (const r of rows)
        for (const c of r.columns)
          for (const it of c.items)
            if (it.kind === "entry" && matchesQuery(it.entry, q)) order.push(it.entry.key);
  }
  const [cursor, setCursor] = useState({ q, i: 0, step: 0 });
  const at = cursor.q === q && order.length ? Math.min(cursor.i, order.length - 1) : 0;
  const current = order[at] ?? null;
  const step = (d: number) => {
    if (order.length) setCursor({ q, i: (at + d + order.length) % order.length, step: cursor.step + 1 });
  };

  // The columns wrapped to the canvas's height, after every render (what
  // changed may be any card's height) — before the view below first
  // measures the map.
  useLayoutEffect(() => {
    const wrap = createMapWrap(hostRef.current!, layerRef.current!);
    wrapRef.current = wrap;
    return () => {
      wrap.destroy();
      wrapRef.current = null;
    };
  }, []);
  useLayoutEffect(() => wrapRef.current?.relayout());

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
      // The notepad's pane, beside the canvas in the stage.
      covered: () => host.parentElement?.querySelector<HTMLElement>(".hlmap-notepad")?.offsetWidth ?? 0,
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
        <div className="hlmap-search">
          <HighlightSearch
            value={query}
            onChange={setQuery}
            placeholder="Search the map…"
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
        {openAttKey && <MapNotepadToggle pad={pad} />}
      </div>
      <div className="hlmap-stage">
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
        {openAttKey && pad.open && <MapNotepadPane attKey={openAttKey} pad={pad} />}
      </div>
    </div>
  );
}

/** A chapter: its heading over its columns, side by side, each in as
 *  many stacks as its cards need (highlightmap/wrap.ts). */
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
  // Faded: left out by the search, while there is one — a match shows
  // whatever its colour — else by the colours.
  const faded = (a: Annotation) => (q ? !matches.has(a.key) : !filter.passes(a));
  // Each item in a box of its own, placed by wrap.ts.
  return (
    <div className="hlmap-column">
      {column.section ? (
        <Heading section={column.section} kind="column" g={g} ctx={ctx} />
      ) : (
        headed && <div className="hlmap-head hlmap-head-column hlmap-head-blank" />
      )}
      {column.items.length > 0 && (
        <div className="hlmap-flow">
          {column.items.map((it) =>
            it.kind === "heading" ? (
              <div key={it.section.id} className="hlmap-item hlmap-item-head">
                <Heading section={it.section} kind="sub" g={g} ctx={ctx} />
              </div>
            ) : (
              <div key={it.entry.key} className="hlmap-item">
                <div
                  data-key={it.entry.key}
                  className={`hlmap-card ${faded(it.entry) ? "dim" : ""} ${matches.has(it.entry.key) ? "match" : ""} ${
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
              </div>
            ),
          )}
        </div>
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
