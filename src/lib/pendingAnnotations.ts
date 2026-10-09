// Annotations changed on this device that the library cache doesn't
// know about yet, laid over every library the store is handed.
//
// The library comes from the Rust cache, which only learns about an
// annotation at the next sync — so without this, a sync that finished
// after a highlight was made (or the cache loaded at startup, with the
// highlight still in the outbox) would make the highlight vanish until
// the sync after. Each entry holds this device's view of one annotation
// until a library at least as new as the write arrives: `until` is the
// library version Zotero gave the write, unset while it is unsent.
//
// No store import here: the store calls applyPending from setLibrary.
import type { LibraryCache, ZItem } from "./types";

type Entry =
  | { kind: "item"; item: ZItem; until?: number }
  | { kind: "patch"; patch: Record<string, unknown>; until?: number }
  | { kind: "deleted"; until?: number };

const pending = new Map<string, Entry>();

/** This device's current view of an annotation (a create or an edit). */
export function holdItem(item: ZItem, until?: number): void {
  pending.set(item.key, { kind: "item", item, until });
}

/** An edit known only as its changed fields — an unsent update found
 *  in the outbox at startup, before the item itself is at hand. */
export function holdPatch(key: string, patch: Record<string, unknown>): void {
  pending.set(key, { kind: "patch", patch });
}

/** A deletion. */
export function holdDeleted(key: string, until?: number): void {
  pending.set(key, { kind: "deleted", until });
}

export function forget(key: string): void {
  pending.delete(key);
}

/** The library with this device's annotation changes applied. Entries
 *  whose write the library already includes are dropped on the way. */
export function applyPending(lib: LibraryCache): LibraryCache {
  if (!pending.size) return lib;
  for (const [key, e] of pending) {
    if (e.until !== undefined && lib.version >= e.until) pending.delete(key);
  }
  if (!pending.size) return lib;
  const seen = new Set<string>();
  const items: ZItem[] = [];
  for (const item of lib.items) {
    const e = pending.get(item.key);
    if (!e) items.push(item);
    else if (e.kind === "item") {
      seen.add(item.key);
      items.push(e.item);
    } else if (e.kind === "patch") {
      items.push({ ...item, data: { ...item.data, ...e.patch } });
    }
  }
  for (const [key, e] of pending) {
    if (e.kind === "item" && !seen.has(key)) items.push(e.item);
  }
  return { ...lib, items };
}
