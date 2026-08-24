/** Which provider every AI feature talks to. */
export type AiService = "anthropic" | "openai";

export interface Settings {
  zoteroApiKey: string;
  zoteroUserId: string;
  libraryType: "user" | "group";
  contactEmail: string;
  aiService: AiService;
  anthropicApiKey: string;
  anthropicModel: string;
  openaiApiKey: string;
  openaiModel: string;
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

/** A learned "where does this source keep its PDFs" rule
 *  (src-tauri/src/pdf/patterns.rs). */
export interface PdfPattern {
  host: string;
  doiPrefix: string;
  /** PDF URL with the DOI blanked out, or "" when it carried none. */
  template: string;
  /** Landing → PDF substring substitution, or "" when there wasn't one. */
  rewriteFrom: string;
  rewriteTo: string;
  hits: number;
  misses: number;
  learnedMs: number;
  lastUsedMs: number;
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

// --- Questions: chats about a folder, a selection, or one item --------------

/** How much of each work went into the conversation. */
export type AskDepth = "abstracts" | "full";

/** What a chat is about — shown under its title in the Questions list,
 *  and the reason the chat can never silently change scope: the works
 *  are read once, at creation, and the text is kept with the chat. */
export interface ChatSource {
  kind: "item" | "selection" | "folder";
  /** Zotero keys of the works whose text is in the context. */
  itemKeys: string[];
  /** "Attention Is All You Need", "Reading list", "7 items". */
  label: string;
  /** Titles of the works, so the Questions list can say which ones —
   *  the items may have moved or gone by the time it's read back. */
  itemTitles: string[];
  depth: AskDepth;
  /** Works that contributed nothing (no PDF, no abstract). */
  missing: string[];
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
  /** What the call that produced this reply cost, in USD. */
  costUsd?: number;
  usage?: ChatUsage;
}

export interface Chat {
  id: string;
  /** Named by the model after the first exchange; until then, the
   *  source's own label. */
  title: string;
  titled: boolean;
  createdMs: number;
  service: AiService;
  model: string;
  source: ChatSource;
  /** The works, rendered once. Byte-stable for the life of the chat so
   *  every later turn hits the provider's prefix cache. */
  context: string;
  contextTokens: number;
  messages: ChatMessage[];
  /** Everything spent on this conversation so far, in USD. */
  costUsd: number;
  /** When the last request went out — the cache countdown's zero. */
  lastCallMs: number;
}

/** Where a request is being started from. Everything the AI menu needs
 *  to label its two Ask entries, and everything the request needs to
 *  resolve the works when it runs. */
export interface AskTarget {
  kind: ChatSource["kind"];
  /** Selected item keys; empty for a folder, whose contents are
   *  resolved at request time. */
  keys: string[];
  collectionKey: string;
  /** What the conversation will call its source. */
  label: string;
  /** How many works this covers. */
  count: number;
}

/** A work the request can't fully answer for: no abstract on record, or
 *  no PDF to read. `fixable` marks the ones the app can go and get. */
export interface AskGap {
  key: string;
  title: string;
  fixable: boolean;
}

/** A gathered but not-yet-confirmed request, waiting behind the cost
 *  popup. Holding the text here means confirming costs nothing extra:
 *  the works have already been read. */
export interface PendingAsk {
  target: AskTarget;
  source: ChatSource;
  context: string;
  tokens: number;
  /** False when the token count is a four-chars-per-token estimate. */
  exact: boolean;
  service: AiService;
  model: string;
  /** Works with nothing to contribute, and whether retrieval could
   *  change that. Only meaningful before the chat is created. */
  gaps: AskGap[];
}
