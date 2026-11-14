// Picking a part of one PDF — a section of its outline, or a run of its
// pages — as Ask About (AskAbout.tsx) and the reader's Share menu
// (ReaderShare.tsx) both do: the dropdowns that say which section, or
// which pages. A section runs from its heading to where the next heading
// at its level or above begins (`sectionSpans` in lib/outline.ts); only
// the outline's entries that point into the pages count, so a PDF with
// no outline, or one that resolves to nothing, has no sections.
import { useMemo } from "react";
import { sectionAtPage, sectionsOf, sectionSpans, type OutlineEntry } from "../lib/outline";

export type SectionSpan = ReturnType<typeof sectionSpans>[number];

/** "p. 4", "pp. 4–9". */
export const pagesLabel = (from: number, to: number) => (from === to ? `p. ${from}` : `pp. ${from}–${to}`);

/** A section as a part's label: "section “Methods”, pp. 4–9". */
export const sectionLabel = (s: SectionSpan) => `section “${s.section.title}”, ${pagesLabel(s.from, s.to)}`;

/** The PDF's sections, each with its pages; empty without an outline
 *  that points into the pages. */
export function useSectionSpans(shape: { outline: OutlineEntry[]; pages: number } | null): SectionSpan[] {
  return useMemo(() => (shape ? sectionSpans(sectionsOf(shape.outline), shape.pages) : []), [shape]);
}

/** The section page `page` (1-based) is in; the first before any. */
export const sectionIndexAt = (spans: SectionSpan[], page: number) =>
  Math.max(0, page ? sectionAtPage(spans.map((s) => s.section), page) : 0);

export function SectionSelect({ spans, value, onChange }: { spans: SectionSpan[]; value: number; onChange: (i: number) => void }) {
  return (
    <select className="pdf-part-select" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Section">
      {spans.map((s, i) => (
        <option key={s.section.id} value={i}>
          {" ".repeat(Math.min(s.section.depth, 4))}
          {s.section.title} — {pagesLabel(s.from, s.to)}
        </option>
      ))}
    </select>
  );
}

/** From one page to another of `total`: the second never before the
 *  first (moving the first past it brings it along). */
export function PageRangeSelect({
  total,
  from,
  to,
  onChange,
}: {
  total: number;
  from: number;
  to: number;
  onChange: (from: number, to: number) => void;
}) {
  const pages = (start: number) =>
    Array.from({ length: Math.max(0, total - start + 1) }, (_, i) => (
      <option key={start + i} value={start + i}>
        p. {start + i}
      </option>
    ));
  return (
    <span className="pdf-part-range">
      <select
        className="pdf-part-select"
        value={from}
        onChange={(e) => {
          const f = Number(e.target.value);
          onChange(f, Math.max(f, to));
        }}
        aria-label="First page"
      >
        {pages(1)}
      </select>
      <span className="pdf-part-dash">to</span>
      <select className="pdf-part-select" value={to} onChange={(e) => onChange(from, Number(e.target.value))} aria-label="Last page">
        {pages(from)}
      </select>
    </span>
  );
}
