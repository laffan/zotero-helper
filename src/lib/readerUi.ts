// The reading UI around each PDF, kept per PDF beside its view
// (lib/recent.ts), so that coming back to a PDF — from the list, or
// through the recent-PDFs menu — finds everything as it was left: the
// notes panel's width and whether it is shown, the highlights / notes
// split and the tab in front, the outline (open, which headings are
// unfolded, where it is scrolled), the Highlights tab's search, colours
// and scroll, the search in the PDF and the match it was on, and the
// caret and scroll in the notes. The viewer's own state (layout,
// folded view and its filter, the place) is viewState.ts's.
//
// A PDF read here for the first time takes the panels as they were
// last left, as its layout takes the last one chosen. Closing a PDF
// gives the library back its details panel as it was.
import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { lastUi, saveUi } from "./recent";
import { useStore, type MetaTab } from "./store";

export interface ReaderUi {
  /** The panels, held in the app's store while the PDF is open. */
  notesWidth?: number;
  splitHighlights?: number;
  metaHidden?: boolean;
  metaTab?: MetaTab;
  outlineOpen?: boolean;
  /** The outline's unfolded headings (OutlinePanel's ids). */
  outlineExpanded?: string[];
  outlineScroll?: number;
  /** The Highlights tab: its search, the colours picked, its scroll. */
  hlQuery?: string;
  hlColors?: string[];
  hlScroll?: number;
  /** The search in the PDF, and its current match (1-based). */
  search?: string;
  searchHit?: number;
  /** The notes' caret or selection (anchor, head), and the position
   *  at the top of their view. */
  notesSel?: [number, number];
  notesTop?: number;
}

const PANEL_FIELDS = ["notesWidth", "splitHighlights", "metaHidden", "metaTab", "outlineOpen"] as const;

let following = false;

/** Keep the panels per PDF: put a PDF's back as it opens, record their
 *  changes while it is open. Called once from bootstrap. */
export function followReaderUi(): void {
  if (following) return;
  following = true;
  // The details panel as the library had it, for when the PDF closes.
  let libraryMetaHidden: boolean | null = null;
  useStore.subscribe((s, prev) => {
    const att = s.reading?.attKey ?? null;
    const was = prev.reading?.attKey ?? null;
    if (s.reading && !prev.reading) libraryMetaHidden = prev.metaHidden;
    if (!s.reading && prev.reading) {
      if (libraryMetaHidden !== null && s.metaHidden !== libraryMetaHidden) {
        useStore.setState({ metaHidden: libraryMetaHidden });
      }
      libraryMetaHidden = null;
      return;
    }
    if (!att) return;
    if (att !== was) {
      // Its panels as it left them; any it has no record of yet are
      // the ones it opens with, and recorded so — left untouched, they
      // are how it was left.
      const ui = lastUi(att);
      const patch: Partial<ReaderUi> = {};
      const missing: Partial<ReaderUi> = {};
      for (const f of PANEL_FIELDS) Object.assign(ui[f] !== undefined ? patch : missing, { [f]: ui[f] ?? s[f] });
      if (Object.keys(missing).length) saveUi(att, missing);
      if (Object.keys(patch).length) useStore.setState(patch);
      return;
    }
    const changed: Partial<ReaderUi> = {};
    for (const f of PANEL_FIELDS) if (s[f] !== prev[f]) Object.assign(changed, { [f]: s[f] });
    if (Object.keys(changed).length) saveUi(att, changed);
  });
}

type Value<K extends keyof ReaderUi> = NonNullable<ReaderUi[K]>;

/** Like useState, for one part of the reading UI: while `attKey` names
 *  the open PDF it starts as that PDF left it and is kept for it —
 *  following a switch to another PDF without remounting. With no PDF
 *  (null) it is plain state. */
export function usePdfUi<K extends keyof ReaderUi>(
  attKey: string | null,
  key: K,
  initial: Value<K>,
): [Value<K>, (v: Value<K>) => void] {
  const read = (): Value<K> => ((attKey ? lastUi(attKey)[key] : undefined) ?? initial) as Value<K>;
  const [state, setState] = useState(() => ({ attKey, value: read() }));
  let current = state;
  if (state.attKey !== attKey) {
    current = { attKey, value: read() };
    setState(current);
  }
  const set = useCallback(
    (value: Value<K>) => {
      setState({ attKey, value });
      if (attKey) saveUi(attKey, { [key]: value });
    },
    [attKey, key],
  );
  return [current.value, set];
}

/** Keep an element's scroll in the reading UI of `attKey`: put back
 *  when the element (or the PDF) changes, recorded as it scrolls. */
export function usePdfUiScroll(
  attKey: string | null,
  key: "hlScroll" | "outlineScroll",
  ref: RefObject<HTMLElement>,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !attKey) return;
    el.scrollTop = lastUi(attKey)[key] ?? 0;
    const onScroll = () => saveUi(attKey, { [key]: el.scrollTop });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [attKey, key, ref]);
}
