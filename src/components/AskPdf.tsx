// Ask PDF — the conversations tab's way to ask about the entry's PDF:
// pressing it opens this small chooser under the buttons. Two tiers of
// dropdowns say what to ask about: the first the kind of part — the
// full text, a section of its outline, a run of pages, or (with the PDF
// open) the visible pages, every page whose top and bottom are both in
// view (`pagesInView` in pdfviewer/places.ts; else the page at the
// view's centre) — and the second, beside it, which section or which
// pages, when the first needs saying more (PdfParts.tsx). Under them,
// one link begins the conversation with what they name.
//
// The sections are left out of the first dropdown when the PDF has no
// outline that points into its pages; the PDF's outline and page count
// are read as the chooser opens (`usePdfShape`; the open PDF's come from
// the viewer), the PDF downloaded first if it isn't on this device, as
// asking would. A part goes to the model as its pages only, after their
// page markers, with a line saying which part it is (lib/ai/context.ts,
// `PageSpan`).
import { useState } from "react";
import { readerPageNow, usePdfShape, useReaderPage } from "../lib/outline";
import { useStore } from "../lib/store";
import type { PageSpan } from "../lib/types";
import { ArrowRightIcon, CloseIcon, Spinner } from "./Icons";
import { PageRangeSelect, pagesLabel, SectionSelect, sectionIndexAt, sectionLabel, useSectionSpans } from "./PdfParts";
import { readerVisiblePages } from "./ReaderPane";

interface Props {
  attKey: string;
  disabled: boolean;
  /** Ask about the whole PDF (no span), or a part of it. */
  onAsk: (pages?: PageSpan) => void;
  onClose: () => void;
}

type Kind = "full" | "section" | "pages" | "visible";

export function AskPdf({ attKey, disabled, onAsk, onClose }: Props) {
  const shape = usePdfShape(attKey, true);
  const open = useStore((s) => s.reading?.attKey === attKey);
  const spans = useSectionSpans(shape);
  const total = shape?.pages ?? 0;
  // To begin with: the section and the page being read, when the PDF is
  // open; else the first section, page 1.
  const here = open ? readerPageNow() : 0;
  // The visible pages, again as the reader turns a page.
  useReaderPage();
  const visible = open ? readerVisiblePages(attKey) : null;
  const [chosen, setKind] = useState<Kind>("full");
  // Visible pages need the PDF open; closed, it is the full text again.
  const kind: Kind = chosen === "visible" && !visible ? "full" : chosen;
  const [pick, setPick] = useState<number | null>(null);
  const section = spans[pick ?? sectionIndexAt(spans, here)];
  const [range, setRange] = useState<[number, number] | null>(null);
  const [from, to] = range ?? [here || 1, here || 1];

  // What the links begins the conversation with, and the part sent.
  const part: { label: string; span?: PageSpan } | null =
    kind === "full"
      ? { label: "the full text" }
      : kind === "section"
        ? section && { label: `“${section.section.title}”`, span: { from: section.from, to: section.to, label: sectionLabel(section) } }
        : kind === "pages"
          ? total > 0 && to <= total ? { label: pagesLabel(from, to), span: { from, to, label: pagesLabel(from, to) } } : null
          : visible
            ? {
                label: `the visible ${visible[1] > visible[0] ? "pages" : "page"} (${pagesLabel(visible[0], visible[1])})`,
                span: { from: visible[0], to: visible[1], label: pagesLabel(visible[0], visible[1]) },
              }
            : null;

  return (
    <div className="ask-pdf">
      <div className="ask-pdf-head">
        <span>Ask about</span>
        {total > 0 && <span className="ask-pdf-note">{total} pages</span>}
        <button className="link-btn ask-pdf-close" onClick={onClose} aria-label="Close" title="Close">
          <CloseIcon size={11} />
        </button>
      </div>
      <div className="ask-pdf-row">
        <select className="pdf-part-select pdf-part-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Ask about">
          <option value="full">Full text</option>
          {spans.length > 0 && <option value="section">Section</option>}
          {total > 0 && <option value="pages">Pages</option>}
          {visible && <option value="visible">Visible pages</option>}
        </select>
        {kind === "section" && <SectionSelect spans={spans} value={spans.indexOf(section)} onChange={setPick} />}
        {kind === "pages" && <PageRangeSelect total={total} from={from} to={to} onChange={(f, t) => setRange([f, t])} />}
        {!shape && (
          <span className="ask-pdf-note">
            <Spinner size={11} /> Reading the PDF’s contents…
          </span>
        )}
      </div>
      <button
        className="link-btn ask-pdf-begin"
        disabled={disabled || !part}
        onClick={() => {
          // The visible pages as they are now, should the view have moved
          // without a page turning.
          const now = kind === "visible" ? readerVisiblePages(attKey) : null;
          if (now) onAsk({ from: now[0], to: now[1], label: pagesLabel(now[0], now[1]) });
          else if (part) onAsk(part.span);
        }}
      >
        Begin conversation with {part?.label ?? "…"}
        <ArrowRightIcon size={11} />
      </button>
    </div>
  );
}
