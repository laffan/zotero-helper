import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInZotero } from "../lib/actions";
import {
  creatorSummary,
  itemsForCollection,
  pdfAttachmentMap,
  pdfMap,
  REAL_KEY,
  topLevelItems,
  yearOf,
} from "../lib/collections";
import { retryJob } from "../lib/importer";
import {
  DEFAULT_FOLDER_VIEW,
  THUMB_SCALE,
  useStore,
  type ResizableCol,
} from "../lib/store";
import { useSearchResults } from "../lib/search";
import type { ImportJob, ImportStage, ZItem } from "../lib/types";
import { IconGrid } from "./IconGrid";
import {
  CheckIcon,
  CloseIcon,
  FlagIcon,
  GridViewIcon,
  ListViewIcon,
  PdfIcon,
  PinIcon,
  Spinner,
} from "./Icons";

const ROW_HEIGHT = 36;
const JOB_ROW_HEIGHT = 52;
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

/** Drag handle on a header column's right edge. */
function ColGrip({ col }: { col: ResizableCol }) {
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = useStore.getState().colWidths[col];
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(420, Math.max(40, startW + ev.clientX - startX));
      useStore.getState().setColWidth(col, w);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <span
      className="col-grip"
      onPointerDown={start}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

const STAGE_LABELS: Record<ImportStage, string> = {
  pending: "Queued",
  resolving: "Looking up metadata",
  creating: "Creating Zotero item",
  "finding-pdf": "Searching for PDF",
  downloading: "Downloading PDF",
  uploading: "Uploading to Zotero",
  done: "Done",
  "needs-manual": "PDF needs your help",
  error: "Failed",
};

const STAGE_STEP: Record<ImportStage, number> = {
  pending: 0,
  resolving: 1,
  creating: 2,
  "finding-pdf": 3,
  downloading: 3,
  uploading: 4,
  done: 5,
  "needs-manual": 3,
  error: 0,
};

function JobRow({ jobItem }: { jobItem: ImportJob }) {
  const { setModal, dismissJob } = useStore();
  const busy = ["resolving", "creating", "finding-pdf", "downloading", "uploading"].includes(
    jobItem.stage,
  );
  const title = jobItem.item?.title ?? jobItem.identifier;
  const step = STAGE_STEP[jobItem.stage];

  return (
    <div className={`job-row job-${jobItem.stage}`} style={{ height: JOB_ROW_HEIGHT }}>
      <div className="job-main">
        <div className="job-title" title={String(title)}>
          {busy && <Spinner size={13} />}
          {jobItem.stage === "done" && <CheckIcon size={13} />}
          <span>{String(title)}</span>
        </div>
        <div className="job-status">
          <span className="job-steps" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => (
              <i
                key={n}
                className={
                  step >= n ? (jobItem.stage === "error" ? "bad" : "on") : ""
                }
              />
            ))}
          </span>
          <span className={`job-stage-label stage-${jobItem.stage}`}>
            {STAGE_LABELS[jobItem.stage]}
          </span>
          {jobItem.message && (
            <span className="job-message" title={jobItem.message}>
              — {jobItem.message}
            </span>
          )}
        </div>
      </div>
      <div className="job-actions">
        {jobItem.stage === "needs-manual" && (
          <button
            className="mini-btn accent"
            onClick={() => setModal({ kind: "rescue", jobId: jobItem.id })}
          >
            Find PDF
          </button>
        )}
        {jobItem.stage === "error" && (
          <button className="mini-btn" onClick={() => retryJob(jobItem.id)}>
            Retry
          </button>
        )}
        {(jobItem.stage === "error" ||
          jobItem.stage === "needs-manual" ||
          jobItem.stage === "done") && (
          <button
            className="icon-btn"
            onClick={() => dismissJob(jobItem.id)}
            aria-label="Dismiss"
            title="Dismiss (keeps the item, skips the PDF)"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export function ItemList() {
  const library = useStore((s) => s.library);
  const selectedCollection = useStore((s) => s.selectedCollection);
  const searchQuery = useStore((s) => s.searchQuery);
  const selectedKeys = useStore((s) => s.selectedKeys);
  const setSelectedKeys = useStore((s) => s.setSelectedKeys);
  const { sortBy, sortDir, setSort } = useStore();
  const jobs = useStore((s) => s.jobs);
  const jobOrder = useStore((s) => s.jobOrder);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const searchKeys = useSearchResults(library.items, searchQuery);
  const withPdf = useMemo(() => pdfMap(library.items), [library.items]);
  const attByParent = useMemo(
    () => pdfAttachmentMap(library.items),
    [library.items],
  );
  const folderView =
    useStore((s) => s.folderViews[selectedCollection]) ?? DEFAULT_FOLDER_VIEW;
  const togglePin = useStore((s) => s.togglePin);
  const setFolderMode = useStore((s) => s.setFolderMode);
  const setThumbScale = useStore((s) => s.setThumbScale);
  const iconMode = folderView.mode === "icons";
  const pinned = folderView.pinned;
  const flagged = useStore((s) => s.flaggedFolders.includes(selectedCollection));
  const toggleFlag = useStore((s) => s.toggleFlag);
  // "All Items" and "Unfiled" already sit at the top of the sidebar.
  const canFlag =
    selectedCollection !== "all" && selectedCollection !== "unfiled";

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

  const openItem = (item: ZItem) => {
    if (!REAL_KEY.test(item.key)) return;
    // Prefer the PDF itself; fall back to selecting the entry.
    void openInZotero(item.key, attByParent.get(item.key));
  };
  const pinItem = (item: ZItem) => togglePin(selectedCollection, item.key);

  const sortIndicator = (col: string) =>
    sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const colWidths = useStore((s) => s.colWidths);

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
          onClick={() => setFolderMode(selectedCollection, "list")}
          title="Show this folder as a list"
          aria-label="List view"
        >
          <ListViewIcon size={14} />
        </button>
        <button
          className={`view-btn ${iconMode ? "on" : ""}`}
          onClick={() => setFolderMode(selectedCollection, "icons")}
          title="Show this folder as icons (PDF first pages)"
          aria-label="Icon view"
        >
          <GridViewIcon size={14} />
        </button>
        {iconMode && (
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
      <div className="list-header" hidden={iconMode}>
        <span className="col col-pin" aria-hidden="true" />
        <button className="col col-title" onClick={() => setSort("title")}>
          Title{sortIndicator("title")}
        </button>
        <button className="col col-creator" onClick={() => setSort("creator")}>
          Creator{sortIndicator("creator")}
          <ColGrip col="creator" />
        </button>
        <button className="col col-year" onClick={() => setSort("date")}>
          Year{sortIndicator("date")}
          <ColGrip col="year" />
        </button>
        <button className="col col-added" onClick={() => setSort("dateAdded")}>
          Added{sortIndicator("dateAdded")}
          <ColGrip col="added" />
        </button>
        <span className="col col-pdf" title="PDF attached">
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
            scale={folderView.thumbScale ?? 1}
            onSelect={handleRowClick}
            onOpen={openItem}
            onTogglePin={pinItem}
          />
          {items.length === 0 && activeJobs.length === 0 && (
            <div className="list-empty">
              {searchQuery
                ? "No results"
                : "No items here yet — use Import IDs to add some"}
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
                title="Double-click to open in Zotero"
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
                <span className="col col-title" title={String(item.data?.title ?? "")}>
                  {String(item.data?.title ?? "(untitled)")}
                </span>
                <span className="col col-creator">{creatorSummary(item)}</span>
                <span className="col col-year">{yearOf(item)}</span>
                <span className="col col-added">
                  {fmtAdded(String(item.data?.dateAdded ?? ""))}
                </span>
                <span className="col col-pdf">
                  {withPdf.has(item.key) && <PdfIcon size={13} />}
                </span>
              </div>
            );
          })}
        </div>
        {items.length === 0 && activeJobs.length === 0 && (
          <div className="list-empty">
            {searchQuery
              ? "No results"
              : "No items here yet — use Import IDs to add some"}
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
