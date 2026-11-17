// The Highlights tab's colour filter and the search's marks, shared by
// the list (HighlightsPanel.tsx) and the Highlight Map (HighlightMap.tsx):
// one state for both, kept per PDF (lib/readerUi.ts), so the panel can
// cross from one to the other with the same colours picked.
//
// The colours picked: none picked is all of them. A click picks one
// colour (or, on the only one picked, all again); ⌘-click (Ctrl
// elsewhere) adds or removes one, as in a file list. The PDFs' bookmarks
// have an entry of their own after the colours. The list hides what the
// filter leaves out; the map dims it.
import { useMemo } from "react";
import { BOOKMARK_FILTER, isBookmark } from "../lib/bookmarks";
import { colorLetter, colorsOf, type Annotation } from "../lib/highlights";
import { usePdfUi } from "../lib/readerUi";
import { BookmarkIcon } from "./Icons";

const NO_COLORS: string[] = [];

const filterOf = (a: Annotation) => (isBookmark(a) ? BOOKMARK_FILTER : a.color);

/** The colour filter over `all` (the open PDF's, kept for it). */
export function useHighlightFilter(attKey: string | null, all: Annotation[]) {
  const [picked, setPicked] = usePdfUi(attKey, "hlColors", NO_COLORS);
  const colors = useMemo(() => colorsOf(all), [all]);
  const marks = all.filter(isBookmark).length;
  const filters = marks ? [...colors, BOOKMARK_FILTER] : colors;
  const active = picked.filter((c) => filters.includes(c));
  return {
    colors,
    /** How many of `all` are bookmarks. */
    marks,
    /** The swatches' entries: the colours, then bookmarks. */
    filters,
    active,
    pick(c: string, e: React.MouseEvent): void {
      if (e.metaKey || e.ctrlKey) {
        setPicked(active.includes(c) ? active.filter((x) => x !== c) : [...active, c]);
      } else setPicked(active.length === 1 && active[0] === c ? [] : [c]);
    },
    clear: () => setPicked([]),
    /** Is `a` among what the filter keeps? */
    passes: (a: Annotation) => !active.length || active.includes(filterOf(a)),
  };
}

export type HighlightFilter = ReturnType<typeof useHighlightFilter>;

/** The swatches: a column beside the list, a row in the map's bar. */
export function ColorSwatches({ filter, row = false }: { filter: HighlightFilter; row?: boolean }) {
  const { colors, marks, filters, active, pick, clear } = filter;
  if (filters.length < 2) return null;
  return (
    <div className={row ? "hl-colors hl-colors-row" : "hl-colors"}>
      <button
        className={`hl-swatch hl-swatch-all ${active.length ? "" : "active"}`}
        onClick={clear}
        title="All colours"
      />
      {colors.map((c) => (
        <button
          key={c}
          className={`hl-swatch ${active.includes(c) ? "active" : ""}`}
          style={{ backgroundColor: c }}
          data-letter={colorLetter(c)}
          onClick={(e) => pick(c, e)}
          title="Only this colour (⌘-click to pick several)"
        />
      ))}
      {marks > 0 && (
        <button
          className={`hl-swatch hl-swatch-bookmark ${active.includes(BOOKMARK_FILTER) ? "active" : ""}`}
          onClick={(e) => pick(BOOKMARK_FILTER, e)}
          title="Only bookmarks (⌘-click to add them to colours)"
          aria-label="Only bookmarks"
        >
          <BookmarkIcon size={11} filled />
        </button>
      )}
    </div>
  );
}

/** `text` with the search's matches (`q`, lower case) marked. */
export function Marked({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let last = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, last)) {
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <mark className="hl-match" key={i}>
        {text.slice(i, i + q.length)}
      </mark>,
    );
    last = i + q.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
