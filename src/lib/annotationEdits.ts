// Highlights and underlines made in the reader, written the way Zotero's
// own reader writes them: as annotation items, children of the PDF
// attachment. The PDF file itself is never touched — Zotero doesn't
// keep annotations in it either — so Zotero desktop, iOS and the web
// library all show these as their own.
//
// A change shows at once (the item goes straight into the store, and
// pendingAnnotations keeps it there across syncs) and is queued in the
// Rust outbox (src-tauri/src/annotations.rs), which is pushed a moment
// after each change, every couple of minutes while anything waits,
// when the app goes to the background or returns to the foreground,
// and when it comes back online.
import type { Annotation } from "./highlights";
import { forget, holdDeleted, holdItem, holdPatch } from "./pendingAnnotations";
import { appLog, useStore } from "./store";
import { invoke, isTauri } from "./tauri";
import type { Settings, ZItem } from "./types";

const PUSH_DELAY_MS = 1500;
const PUSH_EVERY_MS = 2 * 60 * 1000;
// The server's limits (dataserver Zotero_Items).
const MAX_TEXT = 7500;
const MAX_PAGE_LABEL = 50;

/** What the reader hands over for a new highlight or underline. */
export interface NewAnnotation {
  attKey: string;
  type: "highlight" | "underline";
  color: string;
  text: string;
  pageLabel: string;
  sortIndex: string;
  position: { pageIndex: number; rects: number[][] };
}

export interface AnnotationPatch {
  color?: string;
  comment?: string;
}

interface OutboxOp {
  key: string;
  op: "create" | "update" | "delete";
  data?: Record<string, unknown>;
  version?: number;
}

interface Pushed {
  key: string;
  status: "created" | "updated" | "deleted" | "gone" | "rejected";
  item?: ZItem;
  version: number;
  message?: string;
}

/** A Zotero item key: eight characters from the alphabet Zotero uses
 *  (no 0, 1, O), so the annotation has its final key from the start. */
export function newItemKey(): string {
  const chars = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// In a group library, other members' annotations are theirs: Zotero's
// reader won't edit them, and neither does this one. Which ones are
// this person's isn't in the item data the app holds, so the app only
// edits group annotations it made itself (remembered on this device).
const OWN_KEY = "zh-own-annotations";

function ownKeys(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OWN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function rememberOwn(key: string): void {
  const keys = ownKeys();
  keys.add(key);
  try {
    localStorage.setItem(OWN_KEY, JSON.stringify([...keys]));
  } catch {
    /* storage unavailable: the annotation is still written */
  }
}

/** May this app change or delete `a`? Annotations Zotero imported from
 *  the PDF file are read-only in Zotero, so they are here too. */
export function canEditAnnotation(a: Annotation, settings: Settings | null): boolean {
  if (a.external) return false;
  return settings?.libraryType !== "group" || ownKeys().has(a.key);
}

// Every local change bumps its annotation's revision, so a push result
// that arrives after a newer edit doesn't overwrite that edit.
const revs = new Map<string, number>();
const bump = (key: string) => revs.set(key, (revs.get(key) ?? 0) + 1);

// Outbox writes go one at a time, in the order they were made — a
// create has to be folded in before the edit that follows it.
let chain: Promise<unknown> = Promise.resolve();
function enqueue(op: OutboxOp): void {
  chain = chain
    .then(() => invoke("annotations_enqueue", { op: { data: null, version: 0, ...op } }))
    .catch((e) => appLog("error", `Could not save the annotation change on this device: ${e}`));
  schedulePush();
}

function show(item: ZItem): void {
  bump(item.key);
  holdItem(item);
  useStore.getState().upsertItem(item);
}

function itemOf(key: string): ZItem | undefined {
  return useStore.getState().library.items.find((i) => i.key === key);
}

/** Create a highlight or underline. Returns its key. */
export function createAnnotation(n: NewAnnotation): string {
  const key = newItemKey();
  const data: Record<string, unknown> = {
    key,
    version: 0,
    itemType: "annotation",
    parentItem: n.attKey,
    annotationType: n.type,
    annotationText: n.text.slice(0, MAX_TEXT),
    annotationComment: "",
    annotationColor: n.color.toLowerCase(),
    annotationPageLabel: n.pageLabel.slice(0, MAX_PAGE_LABEL),
    annotationSortIndex: n.sortIndex,
    annotationPosition: JSON.stringify(n.position),
    tags: [],
  };
  rememberOwn(key);
  show({ key, version: 0, data: data as ZItem["data"] });
  enqueue({ key, op: "create", data });
  return key;
}

/** Change an annotation's colour and/or comment. */
export function updateAnnotation(key: string, patch: AnnotationPatch): void {
  const item = itemOf(key);
  if (!item) return;
  const fields: Record<string, unknown> = {};
  if (patch.color !== undefined) fields.annotationColor = patch.color.toLowerCase();
  if (patch.comment !== undefined) fields.annotationComment = patch.comment;
  const changed = Object.keys(fields).filter((f) => item.data[f] !== fields[f]);
  if (!changed.length) return;
  show({ ...item, data: { ...item.data, ...fields } });
  enqueue({ key, op: "update", data: fields, version: item.version });
}

/** Delete an annotation. */
export function deleteAnnotation(key: string): void {
  const item = itemOf(key);
  if (!item) return;
  bump(key);
  holdDeleted(key);
  useStore.getState().removeItem(key);
  enqueue({ key, op: "delete", version: item.version });
}

function adopt(r: Pushed): void {
  const st = useStore.getState();
  switch (r.status) {
    case "created":
      if (r.item) {
        holdItem(r.item, r.item.version);
        st.upsertItem(r.item);
      }
      break;
    case "updated": {
      const item = itemOf(r.key);
      if (!item) break;
      const next = { ...item, version: r.version, data: { ...item.data, version: r.version } };
      holdItem(next, r.version);
      st.upsertItem(next);
      break;
    }
    case "deleted":
      holdDeleted(r.key, r.version);
      break;
    case "gone":
      // Deleted in Zotero meanwhile; the next sync confirms it.
      holdDeleted(r.key, st.library.version + 1);
      st.removeItem(r.key);
      break;
    case "rejected":
      forget(r.key);
      st.removeItem(r.key);
      appLog("error", `Zotero refused the annotation: ${r.message ?? "no reason given"}`);
      break;
  }
}

let pushTimer = 0;
let pushing = false;
let pushAgain = false;

function schedulePush(delay = PUSH_DELAY_MS): void {
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void pushAnnotations(), delay);
}

/** Send whatever is waiting. Quietly does nothing offline. */
export async function pushAnnotations(): Promise<void> {
  if (!isTauri || !navigator.onLine) return;
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  try {
    await chain;
    const before = new Map(revs);
    const results = await invoke<Pushed[]>("annotations_push");
    // A result for an annotation edited again meanwhile is stale; that
    // edit is in the outbox and the next push sends it.
    for (const r of results) if (revs.get(r.key) === before.get(r.key)) adopt(r);
  } catch (e) {
    appLog("debug", `Annotation push failed: ${e}`);
  } finally {
    pushing = false;
    if (pushAgain) {
      pushAgain = false;
      schedulePush(300);
    }
  }
}

/** Lay unsent changes over the library and start pushing. Called once
 *  from bootstrap, before the library cache is loaded. */
export async function startAnnotationSync(): Promise<void> {
  if (!isTauri) return;
  try {
    const ops = await invoke<OutboxOp[]>("annotations_outbox");
    for (const op of ops) {
      if (op.op === "create" && op.data) {
        holdItem({ key: op.key, version: 0, data: op.data as ZItem["data"] });
      } else if (op.op === "update" && op.data) holdPatch(op.key, op.data);
      else if (op.op === "delete") holdDeleted(op.key);
    }
    if (ops.length) appLog("info", `${ops.length} annotation change(s) waiting to reach Zotero`);
  } catch (e) {
    appLog("debug", `Annotation outbox unavailable: ${e}`);
  }
  schedulePush(0);
  window.setInterval(() => void pushAnnotations(), PUSH_EVERY_MS);
  // Leaving: send what's there before iPadOS suspends the app.
  // Returning: the connection may have come back while suspended, and
  // the "online" event isn't reliably delivered on resume.
  document.addEventListener("visibilitychange", () => void pushAnnotations());
  window.addEventListener("online", () => void pushAnnotations());
}
