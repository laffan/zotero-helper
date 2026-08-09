export interface Settings {
  zoteroApiKey: string;
  zoteroUserId: string;
  libraryType: "user" | "group";
  contactEmail: string;
  anthropicApiKey: string;
  anthropicModel: string;
  rateLimitMs: number;
}

export interface ZCollectionData {
  key: string;
  version: number;
  name: string;
  parentCollection: string | false;
}

export interface ZCollection {
  key: string;
  version: number;
  data: ZCollectionData;
}

export interface ZCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

export interface ZTag {
  tag: string;
  type?: number;
}

export interface ZItemData {
  key: string;
  version: number;
  itemType: string;
  title?: string;
  creators?: ZCreator[];
  abstractNote?: string;
  date?: string;
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  url?: string;
  publicationTitle?: string;
  journalAbbreviation?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  place?: string;
  language?: string;
  shortTitle?: string;
  extra?: string;
  collections?: string[];
  tags?: ZTag[];
  parentItem?: string;
  contentType?: string;
  linkMode?: string;
  filename?: string;
  dateAdded?: string;
  dateModified?: string;
  [key: string]: unknown;
}

export interface ZItemMeta {
  creatorSummary?: string;
  parsedDate?: string;
  numChildren?: number;
}

export interface ZItem {
  key: string;
  version: number;
  data: ZItemData;
  meta?: ZItemMeta;
}

export interface LibraryCache {
  version: number;
  collections: ZCollection[];
  items: ZItem[];
  lastSyncMs: number;
  /** Zotero's colored ("numbered") tags, in their assigned order — a
   *  library setting, fetched alongside the items. */
  tagColors: TagColor[];
}

export interface TagColor {
  name: string;
  color: string;
}

export interface LogLine {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  ts: number;
}

export type ImportStage =
  | "pending"
  | "resolving"
  | "creating"
  | "finding-pdf"
  | "downloading"
  | "uploading"
  | "done"
  | "needs-manual"
  | "error";

export interface ImportJob {
  id: string;
  identifier: string;
  stage: ImportStage;
  message?: string;
  itemKey?: string;
  item?: ZItemData;
  collectionKey?: string;
  candidates: string[];
  landingUrl?: string;
  doi?: string;
  hasPdf?: boolean;
}

export interface Resolved {
  item: ZItemData;
  pdfCandidates: string[];
  landingUrl?: string | null;
  kind: string;
}

export interface DownloadedPdf {
  path: string;
  size: number;
  filename: string;
}

export interface SyncProgress {
  phase: string;
  done: number;
  total: number;
}

/** Which slice of the metadata a query runs against. Picked from the
 *  menu behind the toolbar's magnifier. */
export type SearchMode = "all" | "title" | "creators" | "date" | "publication";

/** Labels double as the search field's placeholder, so they read as an
 *  instruction ("Search Titles"), not as a noun. */
export const SEARCH_MODES: { id: SearchMode; label: string }[] = [
  { id: "all", label: "Search all metadata" },
  { id: "title", label: "Search Titles" },
  { id: "creators", label: "Search Authors" },
  { id: "date", label: "Search Date Range" },
  { id: "publication", label: "Search Publication" },
];

/** Year bounds for the date-range mode; either end may be left blank. */
export interface SearchDates {
  from: string;
  to: string;
}

/** The two abstract options render the same field at different lengths,
 *  so picking one clears the other. */
export const EXCLUSIVE_SUMMARY_GROUPS: string[][] = [
  ["abstractShort", "abstractNote"],
];

export const SUMMARY_FIELD_OPTIONS: { id: string; label: string }[] = [
  { id: "title", label: "Title" },
  { id: "creators", label: "Authors" },
  { id: "date", label: "Date" },
  { id: "publicationTitle", label: "Publication" },
  { id: "abstractShort", label: "Abstract (abbreviated)" },
  { id: "abstractNote", label: "Abstract (full)" },
  { id: "DOI", label: "DOI" },
  { id: "url", label: "URL" },
  { id: "tags", label: "Tags" },
];
