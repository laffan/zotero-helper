// The open PDF's outline, at the reader's left: its headings as a tree
// that folds, each a link to its place in the pages. The heading the
// reader is in is marked as the pages scroll. Shown from the toolbar's
// left panel button, which only appears when the PDF has an outline.
import { useEffect, useMemo, useRef, useState } from "react";
import { sectionAtPage, sectionsOf, useReaderPage, type OutlineEntry } from "../lib/outline";
import { useStore } from "../lib/store";
import { ChevronDown, ChevronRight, CloseIcon } from "./Icons";
import { goToReaderPosition } from "./ReaderPane";

const overlaid = () => window.matchMedia("(max-width: 700px)").matches;

/** Outlines this small open fully; larger ones show the top level. */
const OPEN_ALL_BELOW = 40;

function countEntries(list: OutlineEntry[]): number {
  return list.reduce((n, e) => n + 1 + countEntries(e.children), 0);
}

export function OutlinePanel({ outline }: { outline: OutlineEntry[] }) {
  const setOutlineOpen = useStore((s) => s.setOutlineOpen);
  const page = useReaderPage();
  const sections = useMemo(() => sectionsOf(outline), [outline]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (countEntries(outline) >= OPEN_ALL_BELOW) return new Set();
    const all = new Set<string>();
    const walk = (list: OutlineEntry[], id: string) =>
      list.forEach((e, i) => {
        const eid = id ? `${id}.${i}` : String(i);
        if (e.children.length) all.add(eid);
        walk(e.children, eid);
      });
    walk(outline, "");
    return all;
  });

  // The heading the reader is in — or, while it is folded away, the
  // nearest heading above it that is showing.
  const current = useMemo(() => {
    const at = sectionAtPage(sections, page);
    if (at < 0) return null;
    const parts = sections[at].id.split(".");
    let id = parts[0];
    for (let i = 1; i < parts.length && expanded.has(id); i++) id = `${id}.${parts[i]}`;
    return id;
  }, [sections, page, expanded]);

  // Keep the current heading in sight — by scrolling the list itself:
  // scrollIntoView can also cut short the pages' own smooth scroll.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(".outline-row.current");
    if (!list || !row) return;
    const lr = list.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (rr.top < lr.top) list.scrollTop -= lr.top - rr.top + 8;
    else if (rr.bottom > lr.bottom) list.scrollTop += rr.bottom - lr.bottom + 8;
  }, [current]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rows = (list: OutlineEntry[], depth: number, parent: string): React.ReactNode =>
    list.map((e, i) => {
      const id = parent ? `${parent}.${i}` : String(i);
      const open = expanded.has(id);
      return (
        <div key={id}>
          <div
            className={`outline-row ${current === id ? "current" : ""} ${e.pageIndex == null ? "dead" : ""}`}
            style={{ paddingLeft: 6 + depth * 12 }}
            onClick={() => {
              if (e.pageIndex == null) return;
              goToReaderPosition(e.pageIndex, e.top);
              // Lying over the pages (outline-panel in notes.css), it
              // makes way for the place it took you to.
              if (overlaid()) setOutlineOpen(false);
            }}
            title={e.title}
          >
            {e.children.length ? (
              <button
                className="outline-toggle"
                onClick={(ev) => {
                  ev.stopPropagation();
                  toggle(id);
                }}
                aria-label={open ? "Collapse" : "Expand"}
              >
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            ) : (
              <span className="outline-toggle" />
            )}
            <span className="outline-title">{e.title}</span>
            {e.pageIndex != null && <span className="outline-page">{e.pageIndex + 1}</span>}
          </div>
          {open && rows(e.children, depth + 1, id)}
        </div>
      );
    });

  return (
    <nav className="outline-panel" aria-label="Outline">
      <div className="outline-head">
        <span>Contents</span>
        <button className="icon-btn" onClick={() => setOutlineOpen(false)} aria-label="Hide the outline">
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="outline-list" ref={listRef}>
        {rows(outline, 0, "")}
      </div>
    </nav>
  );
}
