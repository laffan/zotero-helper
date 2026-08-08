// Multi-select view: one condensed card per selected item, with a
// configurable field set. Clicking a card narrows the selection to that
// item; the Share button exports exactly what's on screen as Markdown.
import { useEffect, useRef, useState } from "react";
import { fullCreatorList } from "../lib/collections";
import { shareSummary } from "../lib/share";
import { useStore } from "../lib/store";
import {
  EXCLUSIVE_SUMMARY_GROUPS,
  SUMMARY_FIELD_OPTIONS,
  type ZItem,
} from "../lib/types";
import { ShareIcon } from "./Icons";

const ABSTRACT_PREVIEW_CHARS = 240;

/** The value shown for a field — also what Share writes out, so the
 *  document matches the panel. The one exception is the abstract:
 *  "abbreviated" vs "full" is a display choice, and shareSummary()
 *  exports the whole abstract either way. */
export function summaryValue(item: ZItem, field: string): string {
  if (field === "creators") return fullCreatorList(item);
  if (field === "tags")
    return (item.data?.tags ?? []).map((t) => t.tag).join(", ");
  if (field === "abstractShort") {
    const full = String(item.data?.abstractNote ?? "").trim();
    if (full.length <= ABSTRACT_PREVIEW_CHARS) return full;
    const cut = full.slice(0, ABSTRACT_PREVIEW_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    return `${cut.slice(0, lastSpace > 80 ? lastSpace : cut.length)}…`;
  }
  return String((item.data as Record<string, unknown>)?.[field] ?? "");
}

export function SummaryView({ items }: { items: ZItem[] }) {
  const { summaryFields, setSummaryFields, setSelectedKeys } = useStore();
  const [filterOpen, setFilterOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [filterOpen]);

  const toggle = (id: string) => {
    if (summaryFields.includes(id)) {
      setSummaryFields(summaryFields.filter((f) => f !== id));
      return;
    }
    // Turning one on clears anything it's mutually exclusive with
    // (the two abstract lengths).
    const rivals = EXCLUSIVE_SUMMARY_GROUPS.filter((g) => g.includes(id))
      .flat()
      .filter((f) => f !== id);
    setSummaryFields([
      ...summaryFields.filter((f) => !rivals.includes(f)),
      id,
    ]);
  };

  const active = SUMMARY_FIELD_OPTIONS.filter((f) =>
    summaryFields.includes(f.id),
  );

  const share = () => {
    const r = shareRef.current?.getBoundingClientRect();
    void shareSummary(
      items,
      active,
      summaryValue,
      r
        ? { x: r.left + r.width / 2, y: r.top }
        : { x: window.innerWidth / 2, y: 60 },
    );
  };

  return (
    <div className="summary-view">
      <div className="summary-header">
        <span>{items.length} items selected</span>
        <div className="filter-anchor" ref={popRef}>
          <button className="mini-btn" onClick={() => setFilterOpen(!filterOpen)}>
            Fields ▾
          </button>
          {filterOpen && (
            <div className="filter-pop">
              {SUMMARY_FIELD_OPTIONS.map((f) => (
                <label key={f.id}>
                  <input
                    type="checkbox"
                    checked={summaryFields.includes(f.id)}
                    onChange={() => toggle(f.id)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="summary-list">
        {items.map((item) => (
          <div
            className="summary-card"
            key={item.key}
            onClick={() => setSelectedKeys([item.key])}
            title="Click to select just this item"
          >
            {active.map((f) => {
              const v = summaryValue(item, f.id);
              if (!v) return null;
              return (
                <div className={`summary-field summary-${f.id}`} key={f.id}>
                  {f.id !== "title" && (
                    <span className="summary-label">{f.label}</span>
                  )}
                  <span className="summary-value">{v}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="summary-footer">
        <button
          className="tool-btn"
          ref={shareRef}
          onClick={share}
          title={`Export the fields shown above for these ${items.length} items as Markdown`}
        >
          <ShareIcon size={13} /> Share filtered metadata
        </button>
      </div>
    </div>
  );
}
