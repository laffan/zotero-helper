import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  creatorSummary,
  itemsForCollection,
  pdfMap,
  topLevelItems,
  yearOf,
} from "../lib/collections";
import { retryJob } from "../lib/importer";
import { useStore } from "../lib/store";
import { useSearchResults } from "../lib/search";
import type { ImportJob, ImportStage, ZItem } from "../lib/types";
import { CheckIcon, CloseIcon, PdfIcon, Spinner } from "./Icons";

const ROW_HEIGHT = 36;
const JOB_ROW_HEIGHT = 52;
const OVERSCAN = 8;

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
    return list.filter((i) => !jobItemKeys.has(i.key));
  }, [library.items, selectedCollection, searchKeys, sortBy, sortDir, jobItemKeys]);

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

  const sortIndicator = (col: string) =>
    sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <section className="item-list">
      <div className="list-header">
        <button className="col col-title" onClick={() => setSort("title")}>
          Title{sortIndicator("title")}
        </button>
        <button className="col col-creator" onClick={() => setSort("creator")}>
          Creator{sortIndicator("creator")}
        </button>
        <button className="col col-year" onClick={() => setSort("date")}>
          Year{sortIndicator("date")}
        </button>
        <span className="col col-pdf" title="PDF attached">
          <PdfIcon size={13} />
        </span>
      </div>
      <div
        className="list-body"
        ref={containerRef}
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
              >
                <span className="col col-title" title={String(item.data?.title ?? "")}>
                  {String(item.data?.title ?? "(untitled)")}
                </span>
                <span className="col col-creator">{creatorSummary(item)}</span>
                <span className="col col-year">{yearOf(item)}</span>
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
        {searchKeys
          ? `${items.length} result(s)`
          : `${items.length} item(s)`}
        {selectedKeys.length > 1 && ` · ${selectedKeys.length} selected`}
      </footer>
    </section>
  );
}
