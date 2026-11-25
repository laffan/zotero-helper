// Messages between the app's windows (lib/windows/): each one a Tauri
// event sent to every window, marked with the window that sent it so
// that it can pass over its own. What one window changes that the
// others hold too — the library, conversations, bookmarks, the look of
// the app — is announced here, and the others take it in (shared.ts).
//
// Kept to the one event and plain payloads: a window that isn't
// listening, or isn't there, costs nothing. No window is told about
// before it exists, so a window opening learns nothing from here; it
// reads the disk as the app does when it starts.
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../tauri";

const EVENT = "zh-windows";

/** This window's label: "main" for the window the app opens with,
 *  window-… for those opened since (index.ts; the system's own, from
 *  tauri-plugin-scenes, window-scene-…). */
export const windowLabel: string = (() => {
  if (!isTauri) return "main";
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
})();

interface Message {
  kind: string;
  from: string;
}

type Handler = (m: Record<string, unknown>) => void;
const handlers = new Map<string, Set<Handler>>();
let listening = false;

function listenOnce(): void {
  if (listening || !isTauri) return;
  listening = true;
  void listen<Message & Record<string, unknown>>(EVENT, (e) => {
    const m = e.payload;
    if (!m || m.from === windowLabel) return;
    for (const fn of handlers.get(m.kind) ?? []) {
      try {
        fn(m);
      } catch (err) {
        console.warn(`Windows: taking in “${m.kind}” failed`, err);
      }
    }
  });
}

/** Tell the other windows that `kind` changed here, with what they need
 *  to take it in. Keep it small: it is serialised once for every one. */
export function announce(kind: string, payload: Record<string, unknown> = {}): void {
  if (!isTauri) return;
  emit(EVENT, { ...payload, kind, from: windowLabel }).catch(() => {});
}

/** Hear another window's announcements of `kind`. Returns the undo. */
export function hear<T extends object>(kind: string, fn: (m: T) => void): () => void {
  listenOnce();
  let set = handlers.get(kind);
  if (!set) handlers.set(kind, (set = new Set()));
  const h = fn as unknown as Handler;
  set.add(h);
  return () => set!.delete(h);
}

/** Something this window writes to disk that the others hold a copy of
 *  (bookmarks, sections, words, conversations, settings): call the
 *  returned function once a write has landed, and the other windows
 *  `reload` it from the disk — unless `pending()`, a write of their own
 *  waiting to land, which they will announce in turn. So the last
 *  write stands, everywhere; two in the same moment, one is lost. */
export function shareDisk(kind: string, reload: () => unknown, pending: () => boolean = () => false): () => void {
  hear(kind, () => {
    if (!pending()) void reload();
  });
  return () => announce(kind);
}
