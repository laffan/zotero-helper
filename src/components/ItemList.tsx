import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInZotero } from "../lib/actions";
import {
  abstractMap,
  creatorSummary,
  itemsForCollection,
  itemTitle,
  pdfAttachmentMap,
  pdfMap,
  REAL_KEY,
  topLevelItems,
  yearOf,
} from "../lib/collections";
import { startItemDrag } from "../lib/dragdrop";
import { trackPointerDrag } from "../lib/dragGesture";
import { readItem } from "../lib/notes";
import { RECENT, useRecent } from "../lib/recent";
import {
  DEFAULT_FOLDER_VIEW,
  THUMB_SCALE,
  useStore,
  type ResizableCol,
} from "../lib/store";
import { useSearchResults } from "../lib/search";
import { useThumbnail, useThumbnailsReady } from "../lib/thumbnails";
import type { ZItem } from "../lib/types";
import { IconGrid } from "./IconGrid";
import {
  AbstractIcon,
  FlagIcon,
  GridViewIcon,
  ListViewIcon,
  PdfIcon,
  PinIcon,
  TagIcon,
} from "./Icons";
import { JOB_ROW_HEIGHT, JobRow } from "./JobRow";
import { COMMAND_LABEL, PdfMark, useCommandHeld } from "./PdfMark";
import { TagDots } from "./TagDots";

const ROW_HEIGHT = 36;
const OVERSCAN = 8;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtAdded(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

/** A row's tiny first-page cover, once the folder's icon view has
 *  rendered them all. */
function ListCover({ attKey }: { attKey: string }) {
  const thumb = useThumbnail(attKey);
  return thumb ? <img src={thumb} alt="" /> : null;
}

/** Grab handle at the start of a header column. The title column takes
 *  whatever room is left, so a column grows leftwards: dragging its
 *  handle left widens it and the handle stays under the pointer. */
function ColGrip({ col }: { col: ResizableCol }) {
  const start = (e: React.PointerEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startW = useStore.getState().colWidths[col];
    trackPointerDrag(e, (ev) => {
      const w = Math.min(420, Math.max(40, startW - (ev.clientX - startX)));
      useStore.getState().setColWidth(col, w);
    });
  };
  return (
    <span
      className="col-grip"
      onPointerDown={start}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize the column"
      aria-hidden="true"
    />
  );
}

export function ItemList() {
  const library = useStore((s) => s.library);
  const selectedCollection = useStore((s) => s.selectedCollection);
  const searchQuery = useStore((s) => s.searchQuery);
  const searchMode = useStore((s) => s.searchMode);
  const searchDates = useStore((s) => s.searchDates);
  const selectedKeys = useStore((s) => s.selectedKeys);
  const setSelectedKeys = useStore((s) => s.setSelectedKeys);
  const { sortBy, sortDir, setSort } = useStore();
  const jobs = useStore((s) => s.jobs);
  const jobOrder = useStore((s) => s.jobOrder);
  const recentOpened = useRecent((s) => s.opened);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  // The header sits outside the scrolling body, so it has to reserve
  // exactly the width that body's scrollbar takes — which is 15-ish px
  // with classic scrollbars and 0 with the overlay ones iPadOS and
  // macOS use. Guessing a fixed value puts every column out of line
  // with its own rows, so it's measured.
  const [scrollbarW, setScrollbarW] = useState(0);
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setViewH(el.clientHeight);
      setScrollbarW(el.offsetWidth - el.clientWidth);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const searchKeys = useSearchResults(
    library.items,
    searchQuery,
    searchMode,
    searchDates,
  );
  const searching = searchKeys !== null;
  const withPdf = useMemo(() => pdfMap(library.items), [library.items]);
  const withAbstract = useMemo(() => abstractMap(library.items), [library.items]);
  const attByParent = useMemo(
    () => pdfAttachmentMap(library.items),
    [library.items],
  );
  const folderView =
    useStore((s) => s.folderViews[selectedCollection]) ?? DEFAULT_FOLDER_VIEW;
  const togglePin = useStore((s) => s.togglePin);
  const setFolderMode = useStore((s) => s.setFolderMode);
  const setThumbScale = useStore((s) => s.setThumbScale);
  // Results come back ranked by relevance (or by date), which a grid of
  // thumbnails hides — so a search always renders as a list. The
  // folder's own mode is untouched and returns when the search clears.
  const iconMode = folderView.mode === "icons" && !searching;
  const pinned = folderView.pinned;
  const flagged = useStore((s) => s.flaggedFolders.includes(selectedCollection));
  const toggleFlag = useStore((s) => s.toggleFlag);
  // "All Items", "Unfiled" and "Recent" already sit at the top of the
  // sidebar.
  const canFlag = REAL_KEY.test(selectedCollection);
  const showTagColors = useStore((s) => s.showTagColors);
  const toggleTagColors = useStore((s) => s.toggleTagColors);
  const hasTagColors = useStore((s) => (s.library.tagColors?.length ?? 0) > 0);

  const activeJobs = useMemo(
    () => jobOrder.map((id) => jobs[id]).filter(Boolean),
    [jobs, jobOrder],
  );
  const jobItemKeys = useMemo(
    () => new Set(activeJobs.map((j) => j.itemKey).filter(Boolean) as string[]),
    [activeJobs],
  );

  const items = useMemo(() => {
    let list: ZItem[];
    if (searchKeys) {
      const byKey = new Map(topLevelItems(library.items).map((i) => [i.key, i]));
      list = searchKeys
        .map((k) => byKey.get(k))
        .filter((i): i is ZItem => Boolean(i));
    } else if (selectedCollection === RECENT) {
      // Recent is its own order: the last opened first.
      list = itemsForCollection(library.items, RECENT);
    } else {
      list = itemsForCollection(library.items, selectedCollection);
      const dir = sortDir === "asc" ? 1 : -1;
      const cmp: Record<string, (a: ZItem, b: ZItem) => number> = {
        title: (a, b) =>
          String(a.data?.title ?? "").localeCompare(String(b.data?.title ?? "")),
        creator: (a, b) => creatorSummary(a).localeCompare(creatorSummary(b)),
        date: (a, b) => yearOf(a).localeCompare(yearOf(b)),
        dateAdded: (a, b) =>
          String(a.data?.dateAdded ?? "").localeCompare(
            String(b.data?.dateAdded ?? ""),
          ),
      };
      list = list.slice().sort((a, b) => dir * cmp[sortBy](a, b));
    }
    // Rows for in-flight jobs replace their library rows.
    list = list.filter((i) => !jobItemKeys.has(i.key));
    // Pinned items float to the top, keeping their relative order.
    if (pinned.length) {
      const isPinned = new Set(pinned);
      list = [
        ...list.filter((i) => isPinned.has(i.key)),
        ...list.filter((i) => !isPinned.has(i.key)),
      ];
    }
    return list;
  }, [
    library.items,
    recentOpened,
    selectedCollection,
    searchKeys,
    sortBy,
    sortDir,
    jobItemKeys,
    pinned,
  ]);

  const jobsHeight = activeJobs.length * JOB_ROW_HEIGHT;
  const totalHeight = jobsHeight + items.length * ROW_HEIGHT;

  const firstVisible = Math.max(
    0,
    Math.floor((scrollTop - jobsHeight) / ROW_HEIGHT) - OVERSCAN,
  );
  const lastVisible = Math.min(
    items.length,
    Math.ceil((scrollTop - jobsHeight + viewH) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = items.slice(firstVisible, Math.max(firstVisible, lastVisible));

  const handleRowClick = (e: React.MouseEvent, item: ZItem) => {
    const idx = items.findIndex((i) => i.key === item.key);
    if (e.shiftKey && anchorRef.current) {
      const anchorIdx = items.findIndex((i) => i.key === anchorRef.current);
      if (anchorIdx >= 0 && idx >= 0) {
        const [a, b] = anchorIdx < idx ? [anchorIdx, idx] : [idx, anchorIdx];
        setSelectedKeys(items.slice(a, b + 1).map((i) => i.key));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      anchorRef.current = item.key;
      setSelectedKeys(
        selectedKeys.includes(item.key)
          ? selectedKeys.filter((k) => k !== item.key)
          : [...selectedKeys, item.key],
      );
      return;
    }
    anchorRef.current = item.key;
    setSelectedKeys([item.key]);
  };

  // A double-click reads the entry: its PDF is downloaded to this
  // device (when it isn't yet) and opened beside the notes. An entry
  // with no PDF opens in Zotero instead.
  const openItem = (item: ZItem) => {
    if (!REAL_KEY.test(item.key)) return;
    void readItem(item.key).then((opened) => {
      if (!opened) void openInZotero(item.key);
    });
  };
  const pinItem = (item: ZItem) => togglePin(selectedCollection, item.key);

  // Recent keeps its own order, so no column claims to sort it.
  const isRecent = selectedCollection === RECENT && !searching;
  const sortIndicator = (col: string) =>
    sortBy === col && !isRecent ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  const emptyText = searching
    ? "No results"
    : isRecent
      ? "PDFs you open will be listed here, the latest first"
      : "No items here yet — use Import IDs to add some";

  const colWidths = useStore((s) => s.colWidths);
  const commandHeld = useCommandHeld();
  // Tiny covers join the list once every PDF here has its thumbnail —
  // which a visit to the folder's icon view renders. The list itself
  // never sets off a render.
  const coverKeys = useMemo(
    () => items.map((i) => attByParent.get(i.key)).filter((k): k is string => Boolean(k)),
    [items, attByParent],
  );
  const showCovers = useThumbnailsReady(coverKeys) && !iconMode;

  return (
    <section
      className="item-list"
      style={
        {
          "--w-creator": `${colWidths.creator}px`,
          "--w-year": `${colWidths.year}px`,
          "--w-added": `${colWidths.added}px`,
        } as React.CSSProperties
      }
    >
      <div className="view-bar">
        <button
          className={`view-btn ${flagged ? "on" : ""}`}
          disabled={!canFlag}
          onClick={() => toggleFlag(selectedCollection)}
          title={
            !canFlag
              ? "Only collections can be flagged"
              : flagged
                ? "Remove this folder from Flagged"
                : "Flag this folder — it rises to the top of the sidebar (app-side only, nothing is sent to Zotero)"
          }
          aria-label={flagged ? "Unflag this folder" : "Flag this folder"}
          aria-pressed={flagged}
        >
          <FlagIcon size={14} filled={flagged} />
        </button>
        <span className="view-sep" />
        <button
          className={`view-btn ${!iconMode ? "on" : ""}`}
          disabled={searching}
          onClick={() => setFolderMode(selectedCollection, "list")}
          title={
            searching
              ? "Search results always show as a list"
              : "Show this folder as a list"
          }
          aria-label="List view"
        >
          <ListViewIcon size={14} />
        </button>
        <button
          className={`view-btn ${iconMode ? "on" : ""}`}
          disabled={searching}
          onClick={() => setFolderMode(selectedCollection, "icons")}
          title={
            searching
              ? "Search results always show as a list — clear the search to switch back"
              : "Show this folder as icons (PDF first pages)"
          }
          aria-label="Icon view"
        >
          <GridViewIcon size={14} />
        </button>
        <span className="view-sep" />
        <button
          className={`view-btn ${showTagColors && hasTagColors ? "on" : ""}`}
          disabled={!hasTagColors}
          onClick={toggleTagColors}
          title={
            !hasTagColors
              ? "This library has no colored tags — assign one in Zotero first"
              : showTagColors
                ? "Hide colored tags"
                : "Show colored tags"
          }
          aria-label="Toggle colored tags"
          aria-pressed={showTagColors && hasTagColors}
        >
          <TagIcon size={14} />
        </button>
        {iconMode && !isRecent && (
          <div className="view-sort">
            {/* List view sorts by clicking column headers; the icon view
                has none, so it gets this. */}
            <label htmlFor="icon-sort">Sort</label>
            <select
              id="icon-sort"
              value={sortBy}
              onChange={(e) => {
                const next = e.target.value as typeof sortBy;
                if (next !== sortBy) setSort(next);
              }}
            >
              <option value="title">Title</option>
              <option value="creator">Creator</option>
              <option value="date">Year</option>
              <option value="dateAdded">Added</option>
            </select>
            <button
              className="view-btn"
              onClick={() => setSort(sortBy)}
              title={sortDir === "asc" ? "Ascending" : "Descending"}
              aria-label="Reverse sort order"
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        )}
      </div>
      <div
        className="list-header"
        hidden={iconMode}
        style={{ paddingRight: scrollbarW }}
      >
        <span className="col col-pin" aria-hidden="true" />
        {showCovers && (
          <span className="col col-cover" data-tip="First page" aria-label="First page" />
        )}
        <button className="col col-title" onClick={() => setSort("title")}>
          Title{sortIndicator("title")}
        </button>
        <button className="col col-creator" onClick={() => setSort("creator")}>
          <ColGrip col="creator" />
          Creator{sortIndicator("creator")}
        </button>
        <button className="col col-year" onClick={() => setSort("date")}>
          <ColGrip col="year" />
          Year{sortIndicator("date")}
        </button>
        <button className="col col-added" onClick={() => setSort("dateAdded")}>
          <ColGrip col="added" />
          Added{sortIndicator("dateAdded")}
        </button>
        {/* Tooltips drawn in CSS (itemlist.css): these headers are bare
            glyphs, and a native title tooltip is slow to come, when the
            webview shows one at all. */}
        <span className="col col-mark tip-end" data-tip="Has an abstract" aria-label="Abstract">
          <AbstractIcon size={13} />
        </span>
        <span
          className="col col-mark tip-end"
          data-tip={
            commandHeld
              ? "Click a row's icon to download its PDF, or to remove a downloaded one"
              : `Has a PDF · filled: downloaded to this device · hold ${COMMAND_LABEL} to download or remove`
          }
          aria-label="PDF"
        >
          <PdfIcon size={13} />
        </span>
      </div>
      {iconMode && (
        <>
          {activeJobs.length > 0 && (
            <div className="grid-jobs">
              {activeJobs.map((j) => (
                <JobRow key={j.id} jobItem={j} />
              ))}
            </div>
          )}
          <IconGrid
            items={items}
            selectedKeys={selectedKeys}
            pinnedKeys={pinned}
            attByParent={attByParent}
            commandHeld={commandHeld}
            scale={folderView.thumbScale ?? 1}
            onSelect={handleRowClick}
            onOpen={openItem}
            onTogglePin={pinItem}
            onDragStart={startItemDrag}
          />
          {items.length === 0 && activeJobs.length === 0 && (
            <div className="list-empty">
              {emptyText}
            </div>
          )}
        </>
      )}
      <div
        className="list-body"
        ref={containerRef}
        hidden={iconMode}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          {activeJobs.map((j, i) => (
            <div
              key={j.id}
              style={{
                position: "absolute",
                top: i * JOB_ROW_HEIGHT,
                left: 0,
                right: 0,
              }}
            >
              <JobRow jobItem={j} />
            </div>
          ))}
          {visible.map((item, i) => {
            const idx = firstVisible + i;
            const selected = selectedKeys.includes(item.key);
            return (
              <div
                key={item.key}
                className={`item-row ${selected ? "selected" : ""}`}
                style={{
                  position: "absolute",
                  top: jobsHeight + idx * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                }}
                onClick={(e) => handleRowClick(e, item)}
                onDoubleClick={() => openItem(item)}
                onPointerDown={(e) => startItemDrag(e, item.key)}
                title="Double-click to read the PDF beside its notes · drag onto a folder to file it there"
              >
                <button
                  className={`col col-pin ${pinned.includes(item.key) ? "on" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    pinItem(item);
                  }}
                  aria-label={pinned.includes(item.key) ? "Unpin" : "Pin to top"}
                  title={
                    pinned.includes(item.key)
                      ? "Unpin from the top of this folder"
                      : "Pin to the top of this folder"
                  }
                >
                  <PinIcon size={24} filled={pinned.includes(item.key)} />
                </button>
                {showCovers && (
                  <span className="col col-cover">
                    {attByParent.has(item.key) && (
                      <ListCover attKey={attByParent.get(item.key)!} />
                    )}
                  </span>
                )}
                <span className="col col-title" title={itemTitle(item)}>
                  <TagDots item={item} />
                  {itemTitle(item)}
                </span>
                <span className="col col-creator">{creatorSummary(item)}</span>
                <span className="col col-year">{yearOf(item)}</span>
                <span className="col col-added">
                  {fmtAdded(String(item.data?.dateAdded ?? ""))}
                </span>
                <span
                  className="col col-mark"
                  title={
                    withAbstract.has(item.key) ? "Has an abstract" : undefined
                  }
                >
                  {withAbstract.has(item.key) && <AbstractIcon size={13} />}
                </span>
                <span className="col col-mark">
                  <PdfMark
                    itemKey={item.key}
                    attKey={attByParent.get(item.key)}
                    hasPdf={withPdf.has(item.key)}
                    commandHeld={commandHeld}
                  />
                </span>
              </div>
            );
          })}
        </div>
        {items.length === 0 && activeJobs.length === 0 && (
          <div className="list-empty">
            {emptyText}
          </div>
        )}
      </div>
      <footer className="list-footer">
        <span>
          {searchKeys
            ? `${items.length} result(s)`
            : `${items.length} item(s)`}
          {selectedKeys.length > 1 && ` · ${selectedKeys.length} selected`}
        </span>
        {iconMode && (
          <label className="thumb-scale" title="Thumbnail size">
            <GridViewIcon size={11} />
            <input
              type="range"
              min={THUMB_SCALE.min}
              max={THUMB_SCALE.max}
              step={THUMB_SCALE.step}
              value={folderView.thumbScale ?? 1}
              onChange={(e) =>
                setThumbScale(selectedCollection, Number(e.target.value))
              }
              aria-label="Thumbnail size"
            />
          </label>
        )}
      </footer>
    </section>
  );
}
