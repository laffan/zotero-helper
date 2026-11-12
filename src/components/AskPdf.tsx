// Ask PDF — the conversations tab's way to ask about the entry's PDF
// (it was Ask Full Paper): all of it, one section of its outline, or a
// run of pages. Pressing it opens this small chooser under the buttons.
// The sections are the outline's entries that point into the pages
// (`sectionsOf`), each running to where the next heading at its level
// or above begins (`sectionSpans`); with no such outline — none in the
// file, or one whose entries resolve to nothing — the section row is
// left out. The PDF's outline and page count are read once the chooser
// opens (`usePdfShape`; the open PDF's come from the viewer), the PDF
// downloaded first if it isn't on this device, as asking would. A part
// goes to the model as its pages only, after their page markers, with
// a line saying which part it is (lib/ai/context.ts, `PageSpan`).
import { useMemo, useState } from "react";
import { readerPageNow, sectionAtPage, sectionsOf, sectionSpans, usePdfShape } from "../lib/outline";
import { useStore } from "../lib/store";
import type { PageSpan } from "../lib/types";
import { CloseIcon, Spinner } from "./Icons";

interface Props {
  attKey: string;
  disabled: boolean;
  /** Ask about the whole PDF (no span), or a part of it. */
  onAsk: (pages?: PageSpan) => void;
  onClose: () => void;
}

const pagesLabel = (from: number, to: number) => (from === to ? `p. ${from}` : `pp. ${from}–${to}`);

export function AskPdf({ attKey, disabled, onAsk, onClose }: Props) {
  const shape = usePdfShape(attKey, true);
  const open = useStore((s) => s.reading?.attKey === attKey);
  const spans = useMemo(
    () => (shape ? sectionSpans(sectionsOf(shape.outline), shape.pages) : []),
    [shape],
  );
  // To begin with: the section and the page being read, when the PDF is
  // open; else the first section, page 1.
  const here = open ? readerPageNow() : 0;
  const [pick, setPick] = useState<number | null>(null);
  const shownPick = pick ?? Math.max(0, here ? sectionAtPage(spans.map((s) => s.section), here) : 0);
  const [from, setFrom] = useState(String(here || 1));
  const [to, setTo] = useState(String(here || 1));
  const total = shape?.pages ?? null;
  const f = Number(from);
  const t = Number(to);
  const pagesOk = Number.isInteger(f) && Number.isInteger(t) && f >= 1 && t >= f && (!total || t <= total);

  const askSection = () => {
    const s = spans[shownPick];
    if (s) onAsk({ from: s.from, to: s.to, label: `section “${s.section.title}”, ${pagesLabel(s.from, s.to)}` });
  };

  return (
    <div className="ask-pdf">
      <div className="ask-pdf-head">
        <span>Ask about</span>
        <button className="link-btn ask-pdf-close" onClick={onClose} aria-label="Close" title="Close">
          <CloseIcon size={11} />
        </button>
      </div>
      <div className="ask-pdf-row">
        <button className="meta-tab-action" disabled={disabled} onClick={() => onAsk()}>
          The whole PDF
        </button>
        {total && <span className="ask-pdf-note">{total} pages</span>}
      </div>
      {!shape && (
        <div className="ask-pdf-row ask-pdf-note">
          <Spinner size={11} /> Reading the PDF’s contents…
        </div>
      )}
      {spans.length > 0 && (
        <div className="ask-pdf-row">
          <select
            className="ask-pdf-select"
            value={shownPick}
            onChange={(e) => setPick(Number(e.target.value))}
            aria-label="Section"
          >
            {spans.map((s, i) => (
              <option key={s.section.id} value={i}>
                {"  ".repeat(Math.min(s.section.depth, 4))}
                {s.section.title} — {pagesLabel(s.from, s.to)}
              </option>
            ))}
          </select>
          <button className="meta-tab-action" disabled={disabled} onClick={askSection}>
            This section
          </button>
        </div>
      )}
      <div className="ask-pdf-row">
        <span>Pages</span>
        <input
          className="ask-pdf-page"
          inputMode="numeric"
          value={from}
          onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))}
          aria-label="First page"
        />
        <span>–</span>
        <input
          className="ask-pdf-page"
          inputMode="numeric"
          value={to}
          onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))}
          aria-label="Last page"
        />
        <button
          className="meta-tab-action"
          disabled={disabled || !pagesOk}
          onClick={() => onAsk({ from: f, to: t, label: pagesLabel(f, t) })}
        >
          These pages
        </button>
      </div>
    </div>
  );
}
