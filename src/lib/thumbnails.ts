// First-page thumbnails for the folder icon view.
//
// Rendering is expensive (download the PDF, rasterize page 1), so each
// attachment is rendered once and cached on disk by the Rust side; this
// module is the in-memory layer plus a one-at-a-time worker, which also
// keeps us from hammering Zotero's file endpoint. Requests come from
// visible grid cells, so scrolling naturally prioritizes what's on
// screen.
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "./tauri";

const THUMB_LONG_EDGE = 400;
const THUMB_QUALITY = 0.72;

type State = { url: string } | { pending: true } | { failed: true };

const cache = new Map<string, State>();
const queue: string[] = [];
const listeners = new Set<() => void>();
let working = false;

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

async function renderOne(attKey: string): Promise<void> {
  // Disk cache first — the common path after the first visit.
  const cached = await invoke<string | null>("read_thumbnail", { attKey });
  if (cached) {
    cache.set(attKey, { url: `data:image/jpeg;base64,${cached}` });
    return;
  }
  const [{ renderFirstPageJpeg }, bytes] = await Promise.all([
    import("./pdfPage"),
    invoke<ArrayBuffer>("download_attachment_file", { attKey }),
  ]);
  const b64 = await renderFirstPageJpeg(bytes, THUMB_LONG_EDGE, THUMB_QUALITY);
  cache.set(attKey, { url: `data:image/jpeg;base64,${b64}` });
  // Persist for next launch; a failure here only costs a re-render.
  void invoke("write_thumbnail", { attKey, data: b64 }).catch(() => {});
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
