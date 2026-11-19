// The explainer's In Context menu (ExplainChat.tsx): which part of the
// PDF goes with the question — all of it (for a PDF over 80 pages, the
// 80 around the passage), the section the passage is in, or the pages
// in view — each with the work's title and authors (lib/ai/explain.ts).
// Each choice says what it covers; one the provider still has in its
// cache, sent for this passage or another of the same PDF, says so and
// for how much longer (lib/ai/contextCache.ts), since asking with it
// again costs a tenth as much. The one chosen is ticked; picking one
// only chooses it — the window's Ask asks.
//
// A small menu under the button, fixed to the window so the explainer's
// rounded edge doesn't clip it; a press outside it or Escape closes it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cachedFor, partKey } from "../lib/ai/contextCache";
import { contextParts } from "../lib/ai/explain";
import { taskModel } from "../lib/ai/modelChoice";
import { pdfAttachmentOf } from "../lib/collections";
import { readerPageNow, sectionAtPage, usePdfShape } from "../lib/outline";
import { useStore } from "../lib/store";
import type { Chat, ContextPart } from "../lib/types";
import { CheckIcon } from "./Icons";
import { useSectionSpans } from "./PdfParts";
import { readerPageCount, useReaderVisiblePages } from "./ReaderPane";

const WIDTH = 270;

/** "p. 4", "pp. 4–9". */
const pp = (from: number, to: number) => (from === to ? `p. ${from}` : `pp. ${from}–${to}`);

/** "4:05", what is left of a cache window. */
const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function ExplainContextMenu({
  chat,
  chosen,
  anchor,
  onPick,
  onClose,
}: {
  chat: Chat;
  /** The part chosen now, to tick. */
  chosen: ContextPart | null;
  anchor: HTMLElement;
  onPick: (part: ContextPart) => void;
  onClose: () => void;
}) {
  const items = useStore((s) => s.library.items);
  const settings = useStore((s) => s.settings);
  const attKey = chat.passage?.attKey ?? pdfAttachmentOf(items, chat.source.itemKeys[0])?.key ?? null;
  const open = useStore((s) => Boolean(attKey) && s.reading?.attKey === attKey);
  const page = chat.passage ? chat.passage.pageIndex + 1 : readerPageNow() || 1;
  const shape = usePdfShape(attKey, true);
  const spans = useSectionSpans(shape);
  const visible = useReaderVisiblePages(open ? attKey : null);
  const total = (attKey && readerPageCount(attKey)) || shape?.pages || 0;
  const at = spans.length ? sectionAtPage(spans.map((s) => s.section), page) : -1;
  const span = at >= 0 ? spans[at] : null;
  const parts = attKey
    ? contextParts(attKey, page, total, span && { title: span.section.title, from: span.from, to: span.to }, visible)
    : null;
  const model = settings ? taskModel(settings, "explain").id : "";

  // The cache's countdown, while the menu is open.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    const below = r.bottom + 4;
    setPlace({ left, top: below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below });
  }, [anchor, Boolean(shape), Boolean(visible)]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  const fullNote =
    total === 0
      ? "the whole PDF"
      : total > 80 && parts
        ? `${pp(parts.full.from, parts.full.to)} — the 80 around the passage, of ${total}`
        : `all ${total} page${total === 1 ? "" : "s"}`;
  const sectionNote = span
    ? `“${span.section.title}”, ${pp(span.from, span.to)}`
    : !shape
      ? "Reading the outline…"
      : spans.length
        ? "The passage is before the first heading"
        : "This PDF has no outline";
  const visibleNote = visible ? pp(visible[0], visible[1]) : "Not known while the PDF is closed";

  const row = (title: string, note: string, part: ContextPart | null) => {
    const left = part && model ? cachedFor(part, model) : 0;
    const on = Boolean(part && chosen && partKey(chosen) === partKey(part));
    return (
      <button
        className={on ? "context-menu-row on" : "context-menu-row"}
        role="menuitemradio"
        aria-checked={on}
        disabled={!part}
        onClick={() => part && onPick(part)}
      >
        <span className="context-menu-check">{on && <CheckIcon size={12} />}</span>
        <span className="context-menu-text">
          <span className="context-menu-title">{title}</span>
          <span className="context-menu-note">{note}</span>
          {left > 0 && (
            <span className="context-menu-cached" title="Asking with it again re-reads it at the cached rate">
              Already sent — cached for {clock(left)} more
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div
      className="context-menu"
      ref={ref}
      role="menu"
      aria-label="What goes with the question"
      style={{ width: WIDTH, left: place?.left ?? -9999, top: place?.top ?? 0 }}
    >
      {attKey ? (
        <>
          {row("Full text", fullNote, parts?.full ?? null)}
          {row("This section", sectionNote, parts?.section ?? null)}
          {row("Visible pages", visibleNote, parts?.visible ?? null)}
          <div className="context-menu-foot">The work's title and authors go with each.</div>
        </>
      ) : (
        <div className="context-menu-foot">There is no PDF of this work in Zotero to send.</div>
      )}
    </div>
  );
}
