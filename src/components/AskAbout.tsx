// Ask About — the head of the conversations tab: how a conversation
// about the entry begins. Two tiers of dropdowns say what to ask about:
// the first the kind — the abstract, or the PDF's full text, a section
// of its outline, a run of pages, or (with the PDF open) the visible
// pages, every page whose top and bottom are both in view
// (`useReaderVisiblePages`, kept as the pages come to rest after a
// scroll) — and the second, beside it, which section or which pages,
// when the first needs saying more (PdfParts.tsx). Under them, one link
// begins the conversation with what they name.
//
// The PDF's outline and page count are read once they are needed: at
// once for a PDF on this device (the open one's come from the viewer),
// and for one that isn't only when Section or Pages is picked, which
// downloads it, as asking would. Section is offered until the outline is
// known, then only if it points into the pages. With no PDF on record,
// the full text is the one PDF choice, and asking it opens the popup
// that offers to find one. A part goes to the model as its pages only,
// after their page markers, with a line saying which part it is
// (lib/ai/context.ts, `PageSpan`).
import { useState } from "react";
import { readerPageNow, usePdfShape } from "../lib/outline";
import { useStore } from "../lib/store";
import type { AskDepth, PageSpan } from "../lib/types";
import { ArrowRightIcon, Spinner } from "./Icons";
import { PageRangeSelect, pagesLabel, SectionSelect, sectionIndexAt, sectionLabel, useSectionSpans } from "./PdfParts";
import { useReaderVisiblePages } from "./ReaderPane";

interface Props {
  /** The entry's PDF, if it has one. */
  attKey: string | null;
  disabled: boolean;
  /** Ask about the abstract, or the PDF — all of it (no span) or a part. */
  onAsk: (depth: AskDepth, pages?: PageSpan) => void;
}

type Kind = "abstract" | "full" | "section" | "pages" | "visible";

const spanOf = (from: number, to: number, label = pagesLabel(from, to)): PageSpan => ({ from, to, label });

export function AskAbout({ attKey, disabled, onAsk }: Props) {
  const open = useStore((s) => Boolean(attKey) && s.reading?.attKey === attKey);
  const cached = useStore((s) => Boolean(attKey && s.cachedPdfs[attKey]));
  const [chosen, setKind] = useState<Kind>(attKey ? "full" : "abstract");
  const visible = useReaderVisiblePages(open ? attKey : null);
  // Visible pages need the PDF open; closed, it is the full text again.
  const kind: Kind = chosen === "visible" && !visible ? "full" : chosen;
  const shape = usePdfShape(attKey, cached || open || kind === "section" || kind === "pages");
  const spans = useSectionSpans(shape);
  const total = shape?.pages ?? 0;
  // To begin with: the section and the page being read, when the PDF is
  // open; else the first section, page 1.
  const here = open ? readerPageNow() : 0;
  const [pick, setPick] = useState<number | null>(null);
  const section = spans[pick ?? sectionIndexAt(spans, here)];
  const [range, setRange] = useState<[number, number] | null>(null);
  const [from, to] = range ?? [here || 1, here || 1];

  // What the link begins the conversation with, and how.
  const part: { label: string; depth: AskDepth; span?: PageSpan } | null =
    kind === "abstract"
      ? { label: "the abstract", depth: "abstracts" }
      : kind === "full"
        ? { label: "the full text", depth: "full" }
        : kind === "section"
          ? section
            ? { label: `“${section.section.title}”`, depth: "full", span: spanOf(section.from, section.to, sectionLabel(section)) }
            : null
          : kind === "pages"
            ? total > 0 && to <= total ? { label: pagesLabel(from, to), depth: "full", span: spanOf(from, to) } : null
            : visible
              ? {
                  label: `the visible ${visible[1] > visible[0] ? "pages" : "page"} (${pagesLabel(visible[0], visible[1])})`,
                  depth: "full",
                  span: spanOf(visible[0], visible[1]),
                }
              : null;

  const reading = attKey && !shape && (kind === "section" || kind === "pages");
  return (
    <div className="ask-about">
      <div className="ask-about-head">
        <span>Ask about</span>
        {total > 0 && <span className="ask-about-note">{total} pages</span>}
      </div>
      <div className="ask-about-row">
        <select className="pdf-part-select pdf-part-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Ask about">
          <option value="abstract">Abstract</option>
          <option value="full">Full text</option>
          {attKey && (!shape || spans.length > 0) && <option value="section">Section</option>}
          {attKey && <option value="pages">Pages</option>}
          {visible && <option value="visible">Visible pages</option>}
        </select>
        {kind === "section" && shape && spans.length > 0 && (
          <SectionSelect spans={spans} value={spans.indexOf(section)} onChange={setPick} />
        )}
        {kind === "section" && shape && !spans.length && <span className="ask-about-note">This PDF has no contents to choose from.</span>}
        {kind === "pages" && shape && <PageRangeSelect total={total} from={from} to={to} onChange={(f, t) => setRange([f, t])} />}
        {reading && (
          <span className="ask-about-note">
            <Spinner size={11} /> Reading the PDF’s contents…
          </span>
        )}
      </div>
      <button className="link-btn ask-about-begin" disabled={disabled || !part} onClick={() => part && onAsk(part.depth, part.span)}>
        Begin conversation with {part?.label ?? "…"}
        <ArrowRightIcon size={11} />
      </button>
    </div>
  );
}
