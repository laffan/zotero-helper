// Icon view for a folder: a virtualized grid of first-page PDF
// thumbnails. Thumbnails render on demand as cells scroll into view and
// are cached on disk, so a folder is slow only the first time.
import { useEffect, useRef, useState } from "react";
import { creatorSummary, yearOf } from "../lib/collections";
import { useThumbnail } from "../lib/thumbnails";
import type { ZItem } from "../lib/types";
import { PdfIcon, PinIcon, Spinner } from "./Icons";

const CELL_MIN_W = 150;
const CELL_H = 210;
const GAP = 12;
const OVERSCAN_ROWS = 2;

function Cell({
  item,
  attKey,
  selected,
  pinned,
  onSelect,
  onOpen,
  onTogglePin,
}: {
  item: ZItem;
  attKey: string | undefined;
  selected: boolean;
  pinned: boolean;
  onSelect: (e: React.MouseEvent, item: ZItem) => void;
  onOpen: (item: ZItem) => void;
  onTogglePin: (item: ZItem) => void;
}) {
  const thumb = useThumbnail(attKey);
  return (
    <div
      className={`icon-cell ${selected ? "selected" : ""}`}
      onClick={(e) => onSelect(e, item)}
      onDoubleClick={() => onOpen(item)}
      title={String(item.data?.title ?? "")}
    >
      <div className="icon-thumb">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" />
        ) : attKey ? (
          <Spinner size={14} />
        ) : (
          <PdfIcon size={20} />
        )}
        <button
          className={`icon-pin ${pinned ? "on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(item);
          }}
          aria-label={pinned ? "Unpin" : "Pin to top"}
          title={pinned ? "Unpin" : "Pin to top"}
        >
          <PinIcon size={12} filled={pinned} />
        </button>
      </div>
      <div className="icon-title">{String(item.data?.title ?? "(untitled)")}</div>
      <div className="icon-sub">
        {[creatorSummary(item), yearOf(item)].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}

export function IconGrid({
  items,
  selectedKeys,
  pinnedKeys,
  attByParent,
  onSelect,
  onOpen,
  onTogglePin,
}: {
  items: ZItem[];
  selectedKeys: string[];
  pinnedKeys: string[];
  attByParent: Map<string, string>;
  onSelect: (e: React.MouseEvent, item: ZItem) => void;
  onOpen: (item: ZItem) => void;
  onTogglePin: (item: ZItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((size.w - GAP) / (CELL_MIN_W + GAP)));
  const cellW = (size.w - GAP * (cols + 1)) / cols;
  const rowH = CELL_H + GAP;
  const rows = Math.ceil(items.length / cols);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN_ROWS);
  const lastRow = Math.min(
    rows,
    Math.ceil((scrollTop + size.h) / rowH) + OVERSCAN_ROWS,
  );

  const cells: React.ReactNode[] = [];
  for (let r = firstRow; r < lastRow; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const item = items[idx];
      if (!item) break;
      cells.push(
        <div
          key={item.key}
          style={{
            position: "absolute",
            top: GAP + r * rowH,
            left: GAP + c * (cellW + GAP),
            width: cellW,
            height: CELL_H,
          }}
        >
          <Cell
            item={item}
            attKey={attByParent.get(item.key)}
            selected={selectedKeys.includes(item.key)}
            pinned={pinnedKeys.includes(item.key)}
            onSelect={onSelect}
            onOpen={onOpen}
            onTogglePin={onTogglePin}
          />
        </div>,
      );
    }
  }

  return (
    <div
      className="icon-grid"
      ref={ref}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ height: rows * rowH + GAP, position: "relative" }}>
        {cells}
      </div>
    </div>
  );
}
