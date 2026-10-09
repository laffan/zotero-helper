// First-page thumbnails for the folder icon view.
//
// Rendering is expensive (download the PDF, rasterize page 1), so each
// attachment is rendered once and cached on disk by the Rust side; this
// module is the in-memory layer plus a one-at-a-time worker, which also
// keeps us from hammering Zotero's file endpoint. Requests come from
// visible grid cells, so scrolling naturally prioritizes what's on
// screen.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useStore } from "./store";
import { invoke } from "./tauri";
import type { ThumbAnnotation } from "./pdfPage";

const THUMB_LONG_EDGE = 400;
const THUMB_QUALITY = 0.72;

type State = { url: string } | { pending: true } | { failed: true };

const cache = new Map<string, State>();
const queue: string[] = [];
const listeners = new Set<() => void>();
let working = false;
/** Bumped on every change, as the snapshot hooks re-render on. */
let version = 0;
/** Attachments with a thumbnail on disk (any variant), read once from
 *  the Rust side so the item list knows which covers exist without
 *  loading them. */
let onDisk: Set<string> | null = null;
let diskLoading = false;

function emit(): void {
  version++;
  for (const l of listeners) l();
}

async function loadDiskList(): Promise<void> {
  if (onDisk || diskLoading) return;
  diskLoading = true;
  try {
    onDisk = new Set(await invoke<string[]>("list_thumbnails"));
  } catch {
    onDisk = new Set();
  } finally {
    diskLoading = false;
    emit();
  }
}

/** Is there nothing left to render for this attachment? A thumbnail
 *  that could not be rendered counts: there will never be one. */
function settled(attKey: string): boolean {
  const st = cache.get(attKey);
  if (st) return !("pending" in st);
  return onDisk?.has(attKey) ?? false;
}

/** Forget every thumbnail — after Settings clears them from disk. */
export function forgetThumbnails(): void {
  cache.clear();
  onDisk = new Set();
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Zotero's own annotations for this attachment's first page. They live
 *  as child items in the API — never inside the PDF bytes — so they
 *  arrive with a normal sync and must be painted on separately. */
function firstPageAnnotations(attKey: string): ThumbAnnotation[] {
  const out: ThumbAnnotation[] = [];
  for (const i of useStore.getState().library.items) {
    const d = i.data as Record<string, unknown> | undefined;
    if (!d || d.parentItem !== attKey || d.itemType !== "annotation") continue;
    let pos: { pageIndex?: number; rects?: number[][]; paths?: number[][] } = {};
    const raw = d.annotationPosition;
    try {
      pos = typeof raw === "string" ? JSON.parse(raw) : ((raw as typeof pos) ?? {});
    } catch {
      continue;
    }
    if ((pos.pageIndex ?? 0) !== 0) continue;
    out.push({
      type: String(d.annotationType ?? "highlight"),
      color: String(d.annotationColor ?? ""),
      pageIndex: 0,
      rects: Array.isArray(pos.rects) ? pos.rects : [],
      paths: Array.isArray(pos.paths) ? pos.paths : [],
    });
  }
  return out;
}

/** Cache variant: what is painted on the first page, so a highlight
 *  added, recoloured or removed there re-renders the thumbnail — and
 *  nothing else does. (It used to count every annotation in the PDF by
 *  item version, so a highlight on page 40, or a sync that only bumped
 *  versions, threw the thumbnail away and downloaded the PDF again.)
 *  With nothing on page 1 it is "0x0", the old scheme's value for an
 *  unannotated PDF, so those thumbnails stay valid across the change. */
function annotationSignature(marks: ThumbAnnotation[]): string {
  if (!marks.length) return "0x0";
  const text = marks
    .map((m) => `${m.type}|${m.color}|${JSON.stringify(m.rects)}|${JSON.stringify(m.paths)}`)
    .sort()
    .join("\n");
  // FNV-1a, 32-bit: enough to tell one page's marks from another's.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `p${marks.length.toString(36)}x${(h >>> 0).toString(36)}`;
}

async function renderOne(attKey: string): Promise<void> {
  const marks = firstPageAnnotations(attKey);
  const variant = annotationSignature(marks);
  // Disk cache first — the common path after the first visit.
  const cached = await invoke<string | null>("read_thumbnail", {
    attKey,
    variant,
  });
  if (cached) {
    cache.set(attKey, { url: `data:image/jpeg;base64,${cached}` });
    return;
  }
  const [{ renderFirstPageJpeg }, bytes] = await Promise.all([
    import("./pdfPage"),
    invoke<ArrayBuffer>("download_attachment_file", { attKey }),
  ]);
  const b64 = await renderFirstPageJpeg(bytes, THUMB_LONG_EDGE, THUMB_QUALITY, marks);
  cache.set(attKey, { url: `data:image/jpeg;base64,${b64}` });
  // Persist for next launch; a failure here only costs a re-render.
  void invoke("write_thumbnail", { attKey, variant, data: b64 }).catch(() => {});
}

async function pump(): Promise<void> {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const attKey = queue.shift();
      if (!attKey) break;
      try {
        await renderOne(attKey);
      } catch {
        cache.set(attKey, { failed: true });
      }
      emit();
    }
  } finally {
    working = false;
  }
}

/** Queue a thumbnail render unless this attachment is already known. */
function request(attKey: string): void {
  if (cache.has(attKey)) return;
  cache.set(attKey, { pending: true });
  queue.push(attKey);
  void pump();
}

/** Thumbnail data URL for an attachment, or null while it renders (or
 *  if it can't be rendered). Mounting with a new key queues it. */
export function useThumbnail(attKey: string | undefined): string | null {
  const state = useSyncExternalStore(
    subscribe,
    () => (attKey ? cache.get(attKey) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (attKey) request(attKey);
  }, [attKey]);
  return state && "url" in state ? state.url : null;
}

/** True once every one of these attachments has its thumbnail —
 *  i.e. the folder's covers have all been rendered (by visiting its
 *  icon view), so the list can show them too without causing any. */
export function useThumbnailsReady(attKeys: string[]): boolean {
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    void loadDiskList();
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => attKeys.length > 0 && attKeys.every(settled), [attKeys, v]);
}
