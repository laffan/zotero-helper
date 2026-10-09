// PDF outlines on the React side: the open PDF's (the outline panel
// beside the pages) and any downloaded PDF's (the Highlights tab files
// highlights under the section headings they fall in).
//
// The viewer hands over the open PDF's outline as it loads. For a PDF
// on this device that isn't open, the Highlights tab asks for it and it
// is read from the cached file — never fetched from Zotero just for
// this. Kept in memory for the session.
import { useEffect, useSyncExternalStore } from "react";
import type { OutlineEntry } from "../pdfviewer/outline";
import { annotationPosition, type Annotation } from "./highlights";
import { useStore } from "./store";
import { invoke } from "./tauri";

export type { OutlineEntry };

/** attKey → outline (empty: the PDF has none). */
const outlines = new Map<string, OutlineEntry[]>();
const loading = new Set<string>();

/** A value React components can watch. */
function signal<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    get: () => value,
    set(v: T): void {
      if (v === value) return;
      value = v;
      for (const l of listeners) l();
    },
    use: () => useSyncExternalStore(subscribe, () => value, () => value),
  };
}

/** Bumped whenever an outline arrives. */
const outlinesVersion = signal(0);
/** The page the reader shows (1-based), for the panel's current entry —
 *  apart, so a page turn doesn't re-render what only needs outlines. */
const readerPage = signal(0);

export function setOutline(attKey: string, outline: OutlineEntry[]): void {
  outlines.set(attKey, outline);
  outlinesVersion.set(outlinesVersion.get() + 1);
}

export const setReaderPage = (page: number) => readerPage.set(page);
export const useReaderPage = readerPage.use;

/** The outline of `attKey`, or null while it isn't known. */
export function useOutline(attKey: string | null | undefined): OutlineEntry[] | null {
  outlinesVersion.use();
  return attKey ? (outlines.get(attKey) ?? null) : null;
}

async function loadFromCache(attKey: string): Promise<void> {
  loading.add(attKey);
  try {
    const [{ getPdfjs }, { readOutline }, { PDFJS_ASSETS }] = await Promise.all([
      import("../pdfviewer/pdfjs"),
      import("../pdfviewer/outline"),
      import("./pdfjsAssets"),
    ]);
    const bytes = await invoke<ArrayBuffer>("download_attachment_file", { attKey });
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), ...PDFJS_ASSETS }).promise;
    try {
      if (!outlines.has(attKey)) setOutline(attKey, await readOutline(doc));
    } finally {
      await doc.loadingTask.destroy().catch(() => {});
    }
  } catch {
    // Unreadable: highlights simply list without headings.
    setOutline(attKey, []);
  } finally {
    loading.delete(attKey);
  }
}

/** Outlines of these PDFs, as far as known. Asking reads, one after
 *  another, those downloaded to this device; the rest stay unknown. */
export function useOutlines(attKeys: string[]): Map<string, OutlineEntry[]> {
  outlinesVersion.use();
  const cached = useStore((s) => s.cachedPdfs);
  // The open PDF's arrives from the viewer.
  const open = useStore((s) => s.reading?.attKey);
  const wanted = attKeys
    .filter((k) => k !== open && !outlines.has(k) && !loading.has(k) && cached[k])
    .join(",");
  useEffect(() => {
    if (!wanted) return;
    void (async () => {
      for (const k of wanted.split(",")) if (!outlines.has(k) && !loading.has(k)) await loadFromCache(k);
    })();
  }, [wanted]);
  const out = new Map<string, OutlineEntry[]>();
  for (const k of attKeys) {
    const o = outlines.get(k);
    if (o) out.set(k, o);
  }
  return out;
}

// --- sections ---------------------------------------------------------------

export interface Section {
  /** Position in the outline tree, "0.2.1" — the panel's row id. */
  id: string;
  title: string;
  /** Titles from the top level down to this one. */
  path: string[];
  depth: number;
  pageIndex: number;
  /** PDF y (up from the bottom) of the heading; Infinity for the top
   *  of the page. */
  top: number;
}

const sectionsCache = new WeakMap<OutlineEntry[], Section[]>();

/** The entries that point into the pages, in the order they occur
 *  there (an outline is usually in document order, but needn't be). */
export function sectionsOf(outline: OutlineEntry[]): Section[] {
  const known = sectionsCache.get(outline);
  if (known) return known;
  const out: Section[] = [];
  const walk = (list: OutlineEntry[], path: string[], id: string) => {
    list.forEach((e, i) => {
      const p = [...path, e.title];
      const eid = id ? `${id}.${i}` : String(i);
      if (e.pageIndex != null) {
        out.push({ id: eid, title: e.title, path: p, depth: path.length, pageIndex: e.pageIndex, top: e.top ?? Infinity });
      }
      walk(e.children, p, eid);
    });
  };
  walk(outline, [], "");
  // Stable: entries at the same spot keep their outline order, so the
  // deeper heading (listed later) is the one a highlight falls under.
  const sorted = out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.pageIndex - b.s.pageIndex || b.s.top - a.s.top || a.i - b.i)
    .map((x) => x.s);
  sectionsCache.set(outline, sorted);
  return sorted;
}

/** Where an annotation starts: its page and the top of its first mark. */
function annotationStart(a: Annotation): { pageIndex: number; top: number } | null {
  const pos = annotationPosition(a);
  if (!pos || typeof pos.pageIndex !== "number") return null;
  let top = -Infinity;
  for (const r of pos.rects ?? []) top = Math.max(top, r[1], r[3]);
  for (const path of pos.paths ?? []) for (let i = 1; i < path.length; i += 2) top = Math.max(top, path[i]);
  return { pageIndex: pos.pageIndex, top: top === -Infinity ? Infinity : top };
}

/** A heading counts as above a mark it is level with: the highlight of
 *  a heading itself belongs to that heading's section. */
const LEVEL_SLOP = 4;

/** The index in `sections` of the section `a` falls in; -1 before the
 *  first heading (or when it has no position). */
export function sectionIndexOf(sections: Section[], a: Annotation): number {
  const at = annotationStart(a);
  if (!at) return -1;
  // The last section starting at or before the mark.
  let lo = 0;
  let hi = sections.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sections[mid];
    const before = s.pageIndex < at.pageIndex || (s.pageIndex === at.pageIndex && s.top + LEVEL_SLOP >= at.top);
    if (before) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The section the reader is in: the last heading on or before `page`
 *  (1-based). -1 before the first. */
export function sectionAtPage(sections: Section[], page: number): number {
  let found = -1;
  for (let i = 0; i < sections.length && sections[i].pageIndex <= page - 1; i++) found = i;
  return found;
}
