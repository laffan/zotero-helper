// The Share menu's ways to share part of the open PDF, below its PDF /
// abstract / Hush entries: the visible pages (every page whose top and
// bottom are both in view — a spread of pages side by side, a paged set
// — or else the page at the view's centre; `pagesInView` in
// pdfviewer/places.ts), a run of pages, or — when the PDF has an outline
// that points into its pages — one of its sections.
// Pages and Section unfold, in the menu, the same dropdowns Ask PDF's
// chooser uses (PdfParts.tsx), and a Share link under them.
//
// The pages are cut out of the open document by pdf.js
// (pdfviewer/excerpt.ts), so the text stays text, and handed to the
// share sheet (or a save dialog off the iPad) as a PDF named after the
// entry's own and the part: "close-reading (pp. 4–9).pdf".
import { useState } from "react";
import { pdfAttachmentOf } from "../lib/collections";
import { readerPageNow, usePdfShape } from "../lib/outline";
import { pdfBaseName, sharePdfData } from "../lib/share";
import { appLog, useStore, type ReadingState } from "../lib/store";
import { ArrowRightIcon } from "./Icons";
import { PageRangeSelect, pagesLabel, SectionSelect, sectionIndexAt, useSectionSpans } from "./PdfParts";
import { readerExtractPages, readerVisiblePages } from "./ReaderPane";

type Anchor = { x: number; y: number };

interface Props {
  reading: ReadingState;
  /** Close the menu, and where the share sheet should point. */
  done: () => Anchor;
}

/** Pages `from`–`to` (1-based) of the open PDF, shared as a PDF. */
async function sharePages(reading: ReadingState, attKey: string, from: number, to: number, part: string, anchor: Anchor) {
  const name = `${pdfBaseName(reading.itemKey)} (${part})`;
  appLog("info", `Share: cutting ${pagesLabel(from, to)} out of the PDF…`);
  try {
    const bytes = await readerExtractPages(attKey, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
    if (!bytes) return appLog("warn", "Share: the PDF isn’t open");
    await sharePdfData(`${name}.pdf`, bytes, anchor);
  } catch (e) {
    appLog("error", `Share: could not cut ${pagesLabel(from, to)} out of the PDF: ${e}`);
  }
}

export function ReaderShareItems({ reading, done }: Props) {
  const att = useStore((s) => pdfAttachmentOf(s.library.items, reading.itemKey));
  // The PDF shown; only it can be cut (the viewer holds it).
  const attKey = reading.attKey ?? att?.key ?? "";
  const shape = usePdfShape(attKey || null, true);
  const spans = useSectionSpans(shape);
  const total = shape?.pages ?? 0;
  const here = readerPageNow() || 1;
  const visible = readerVisiblePages(attKey);
  const [open, setOpen] = useState<"pages" | "section" | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const section = spans[pick ?? sectionIndexAt(spans, here)];
  const [range, setRange] = useState<[number, number]>(() => visible ?? [here, here]);

  const share = (from: number, to: number, part: string) => void sharePages(reading, attKey, from, to, part, done());
  const toggle = (which: "pages" | "section") => setOpen(open === which ? null : which);

  return (
    <>
      <span className="menu-sep" />
      <button
        className="menu-item"
        disabled={!visible}
        onClick={() => {
          // As they are now: the menu may have stayed open while the
          // pages scrolled beneath it.
          const [f, t] = readerVisiblePages(attKey) ?? visible ?? [here, here];
          share(f, t, pagesLabel(f, t));
        }}
      >
        <strong>Share visible pages</strong>
        <span>{visible ? `${pagesLabel(visible[0], visible[1])}, as a PDF` : "As a PDF"}</span>
      </button>
      <button className={`menu-item ${open === "pages" ? "unfolded" : ""}`} disabled={!total} onClick={() => toggle("pages")}>
        <strong>Share pages…</strong>
        <span>Choose a run of pages to share as a PDF</span>
      </button>
      {open === "pages" && total > 0 && (
        <div className="menu-fields">
          <PageRangeSelect total={total} from={range[0]} to={Math.min(range[1], total)} onChange={(f, t) => setRange([f, t])} />
          <button className="link-btn menu-fields-go" onClick={() => share(range[0], range[1], pagesLabel(...range))}>
            Share {pagesLabel(...range)} <ArrowRightIcon size={11} />
          </button>
        </div>
      )}
      {spans.length > 0 && (
        <button className={`menu-item ${open === "section" ? "unfolded" : ""}`} onClick={() => toggle("section")}>
          <strong>Share section…</strong>
          <span>One section of the contents, as a PDF</span>
        </button>
      )}
      {open === "section" && section && (
        <div className="menu-fields">
          <SectionSelect spans={spans} value={spans.indexOf(section)} onChange={setPick} />
          <button
            className="link-btn menu-fields-go"
            onClick={() => share(section.from, section.to, `${section.section.title}, ${pagesLabel(section.from, section.to)}`)}
          >
            Share “{section.section.title}” <ArrowRightIcon size={11} />
          </button>
        </div>
      )}
    </>
  );
}
