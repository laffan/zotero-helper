// Zotero annotations — highlights, underlines, notes, drawings — as the
// highlight browser and the PDF viewer use them.
//
// They need no download of their own: an annotation is an ordinary
// Zotero item (itemType "annotation", parentItem = the PDF attachment),
// so every sync, the full refresh included, already brings them into the
// library cache along with everything else. This module only picks them
// out and puts them in reading order.
import { attachmentsOf, isStandaloneAttachment, REAL_KEY } from "./collections";
import type { Settings, ZItem } from "./types";

export interface Annotation {
  key: string;
  /** The PDF attachment the annotation is on. */
  attKey: string;
  type: string; // highlight | underline | note | image | ink | text
  color: string;
  text: string;
  comment: string;
  pageLabel: string;
  sortIndex: string;
  tags: string[];
  /** Imported from the PDF file by Zotero, and read-only there. */
  external: boolean;
  /** The raw item, so painters can reach `annotationPosition`. */
  _raw: ZItem;
  _parsedPosition?: AnnotationPosition | null;
}

export interface AnnotationPosition {
  pageIndex: number;
  rects?: number[][];
  paths?: number[][];
}

/** Zotero's annotation colours, in the order its reader offers them.
 *  The API only accepts lowercase `#rrggbb`. */
export const ANNOTATION_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Yellow", hex: "#ffd400" },
  { name: "Red", hex: "#ff6666" },
  { name: "Green", hex: "#5fb236" },
  { name: "Blue", hex: "#2ea8e5" },
  { name: "Purple", hex: "#a28ae5" },
  { name: "Magenta", hex: "#e56eee" },
  { name: "Orange", hex: "#f19837" },
  { name: "Gray", hex: "#aaaaaa" },
];

/** PDF text extraction puts a line break at every visual line, mid-
 *  sentence or not, and a soft-hyphenated word comes out as "hyphen-
 *  ated". Collapse both so a highlight reads as the sentence it was. */
export function tidyHighlightText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/[\r\n]+/g, " ")
    .replace(/(\p{L})- (\p{Ll})/gu, "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalize(item: ZItem): Annotation {
  const d = item.data as Record<string, unknown>;
  return {
    key: item.key,
    attKey: String(d.parentItem ?? ""),
    type: String(d.annotationType ?? "highlight"),
    color: String(d.annotationColor ?? "").toLowerCase(),
    text: tidyHighlightText(String(d.annotationText ?? "")),
    comment: String(d.annotationComment ?? ""),
    pageLabel: String(d.annotationPageLabel ?? ""),
    sortIndex: String(d.annotationSortIndex ?? ""),
    tags: (item.data.tags ?? []).map((t) => t.tag).filter(Boolean),
    external: d.annotationIsExternal === true,
    _raw: item,
  };
}

/** Zotero's sortIndex is a zero-padded `page|offset|top` string, so a
 *  plain string compare is reading order. */
function byReadingOrder(a: Annotation, b: Annotation): number {
  return a.sortIndex < b.sortIndex ? -1 : a.sortIndex > b.sortIndex ? 1 : 0;
}

/** attKey -> its annotations in reading order, for the whole library.
 *  Built once per library change. */
export function annotationIndex(items: ZItem[]): Map<string, Annotation[]> {
  const out = new Map<string, Annotation[]>();
  for (const item of items) {
    if (item.data?.itemType !== "annotation") continue;
    const a = normalize(item);
    if (!a.attKey) continue;
    const list = out.get(a.attKey);
    if (list) list.push(a);
    else out.set(a.attKey, [a]);
  }
  for (const list of out.values()) list.sort(byReadingOrder);
  return out;
}

let indexCache: { items: ZItem[]; index: Map<string, Annotation[]> } | null = null;

/** annotationIndex, memoised on the library array — the store replaces
 *  that array on every change, so identity is the right cache key. */
export function annotationIndexFor(items: ZItem[]): Map<string, Annotation[]> {
  if (indexCache?.items !== items) indexCache = { items, index: annotationIndex(items) };
  return indexCache.index;
}

let byKeyCache: { items: ZItem[]; map: Map<string, Annotation> } | null = null;

/** One annotation by its key — how a Zotero link in the notes finds the
 *  colour of the highlight it names. */
export function annotationByKey(items: ZItem[], key: string): Annotation | undefined {
  if (byKeyCache?.items !== items) {
    const map = new Map<string, Annotation>();
    for (const list of annotationIndexFor(items).values()) for (const a of list) map.set(a.key, a);
    byKeyCache = { items, map };
  }
  return byKeyCache.map.get(key);
}

/** The attachments an entry's annotations can hang off: its synced
 *  child attachments, or the row itself for a standalone file. */
export function annotatableAttachments(items: ZItem[], item: ZItem): ZItem[] {
  if (isStandaloneAttachment(item)) return REAL_KEY.test(item.key) ? [item] : [];
  return attachmentsOf(items, item.key);
}

/** Parse (and remember) an annotation's position payload. */
export function annotationPosition(a: Annotation): AnnotationPosition | null {
  if (a._parsedPosition !== undefined) return a._parsedPosition;
  let pos: AnnotationPosition | null = null;
  const raw = (a._raw.data as Record<string, unknown>).annotationPosition;
  try {
    if (typeof raw === "string") pos = JSON.parse(raw);
    else if (raw && typeof raw === "object") pos = raw as AnnotationPosition;
  } catch {
    pos = null;
  }
  a._parsedPosition = pos;
  return pos;
}

/** Colours in the order they first appear, for the swatch column. */
export function colorsOf(list: Annotation[]): string[] {
  const out: string[] = [];
  for (const a of list) if (a.color && !out.includes(a.color)) out.push(a.color);
  return out;
}

/** Does an annotation match the browser's filter box? */
export function matchesQuery(a: Annotation, q: string): boolean {
  if (!q) return true;
  return `${a.text} ${a.comment} ${a.pageLabel} ${a.tags.join(" ")}`
    .toLowerCase()
    .includes(q);
}

/** zotero://open-pdf link. `annotationKey` makes Zotero scroll to and
 *  select that annotation — the same link its own "copy" produces. */
export function pdfLink(
  settings: Settings | null,
  attKey: string,
  page?: string | number | null,
  annotationKey?: string,
): string {
  const scope =
    settings?.libraryType === "group" && settings.zoteroUserId
      ? `groups/${settings.zoteroUserId}`
      : "library";
  const params: string[] = [];
  if (page != null && page !== "") params.push(`page=${encodeURIComponent(String(page))}`);
  if (annotationKey) params.push(`annotation=${encodeURIComponent(annotationKey)}`);
  const url = `zotero://open-pdf/${scope}/items/${attKey}`;
  return params.length ? `${url}?${params.join("&")}` : url;
}

/** A zotero://open-pdf link taken apart again — how a page reference in
 *  the notes knows which PDF and page it points at. */
export function parsePdfLink(
  href: string,
): { attKey: string; page?: number; annotation?: string } | null {
  const m = /^zotero:\/\/open-pdf\/(?:library|groups\/\d+)\/items\/([A-Z0-9]+)(?:\?(.*))?$/i.exec(href);
  if (!m) return null;
  const params = new URLSearchParams(m[2] ?? "");
  const page = Number(params.get("page"));
  return {
    attKey: m[1],
    page: Number.isFinite(page) && page > 0 ? page : undefined,
    annotation: params.get("annotation") ?? undefined,
  };
}

/** A highlight as Markdown for the notes: the passage as a blockquote,
 *  the comment beneath it, and a page link back to Zotero. The notes
 *  belong to one work, so the citation only needs the page. */
export function annotationMarkdown(settings: Settings | null, a: Annotation): string {
  const lines: string[] = [];
  const quote = a.text.trim();
  const comment = a.comment.trim();
  if (quote) for (const ln of quote.split(/\r?\n/)) lines.push(`> ${ln}`);
  if (comment) {
    if (lines.length) lines.push(">");
    for (const ln of comment.split(/\r?\n/)) lines.push(`> ${ln}`);
  }
  const page = a.pageLabel ? `p. ${a.pageLabel}` : "highlight";
  lines.push("", `— [${page}](${pdfLink(settings, a.attKey, a.pageLabel || null, a.key)})`);
  return lines.join("\n");
}
