// More than one window of the app — on the iPad as scenes (iPadOS 26
// windowing, Split View, Stage Manager), elsewhere as ordinary windows.
// The header's New Window menu (components/WindowMenu.tsx) opens one of
// three: a duplicate of this one (what it shows, its selection, search,
// panels, the PDF open at the same place), a fresh one (the app as it
// opens), or one on a PDF found from the menu's search. iPadOS's own
// ways — the app icon's New Window, App Exposé's "+" — open a fresh one
// (tauri-plugin-scenes builds it).
//
// A window is told what to open with by its URL: `index.html#window=…`,
// the boot below, read once as the page starts (`applyWindowBoot`, from
// main.tsx). A web view that reloads (iPadOS reclaiming its memory)
// opens as it was first opened.
//
// After that each window is its own: its folder, selection, search, the
// PDF it has open. What they share loosely is what is kept — the
// library, the annotations, conversations, bookmarks, sections, words,
// notepads, notes, settings and the look of the app — each window
// telling the others when it changes (channel.ts, shared.ts).
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { flushReaderView } from "../../components/ReaderPane";
import { readItem } from "../notes";
import { useRecent } from "../recent";
import { appLog, useStore } from "../store";
import { isTauri } from "../tauri";
import { windowLabel } from "./channel";

/** Whether this build can open another window (not in a plain browser). */
export const canOpenWindows = isTauri;

type StoreState = ReturnType<typeof useStore.getState>;

/** What Duplicate Window copies of a window: what it shows, and how. */
const COPIED = [
  "selectedCollection",
  "selectedKeys",
  "searchQuery",
  "searchMode",
  "searchDates",
  "searchSorted",
  "selectedChatId",
  "metaTab",
  "sidebarHidden",
  "metaHidden",
  "outlineOpen",
  "leftWidth",
  "rightWidth",
  "notesWidth",
  "notesWidthNarrow",
  "termHeight",
  "logOpen",
  "reading",
  "readingMode",
  "notepadOpen",
] as const;

type Copied = Pick<StoreState, (typeof COPIED)[number]>;
type RecentPage = ReturnType<typeof useRecent.getState>["pages"][string];

/** A window as Duplicate Window copies it. */
export interface WindowSnapshot {
  state: Copied;
  /** The open PDF's page, view and reading UI (lib/recent.ts) as they
   *  are this moment, so the copy opens it at the same place. */
  page?: { attKey: string; record: RecentPage };
}

/** What a new window opens on. */
export type WindowBoot =
  | { kind: "duplicate"; snapshot: WindowSnapshot }
  /** A PDF, found from the menu's search: its entry. */
  | { kind: "open"; itemKey: string };

const HASH = "window";

/** This window, as it is now. */
export function snapshotWindow(): WindowSnapshot {
  const s = useStore.getState();
  const state = Object.fromEntries(COPIED.map((k) => [k, s[k]])) as Copied;
  const attKey = s.reading?.attKey;
  if (!attKey) return { state };
  // The viewer's place written out first: it is kept after a pause.
  flushReaderView();
  const record = useRecent.getState().pages[attKey];
  return record ? { state, page: { attKey, record } } : { state };
}

const isMobile = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) || document.documentElement.classList.contains("ipados");

/** Open another window: a duplicate of this one, a fresh one (no
 *  boot), or one on a PDF. */
export async function openWindow(boot: WindowBoot | null): Promise<void> {
  if (!canOpenWindows) return;
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const label = `window-${id}`;
  const url = boot ? `index.html#${HASH}=${encodeURIComponent(JSON.stringify(boot))}` : "index.html";
  // iPadOS sizes and places a scene itself; elsewhere the new window
  // takes this one's size, a little down and to the right of it.
  let opts: ConstructorParameters<typeof WebviewWindow>[1] = { url };
  if (!isMobile()) {
    opts = { url, title: "Zotero Helper", width: window.innerWidth, height: window.innerHeight, minWidth: 380, minHeight: 500 };
    try {
      const me = getCurrentWindow();
      const [pos, scale] = await Promise.all([me.outerPosition(), me.scaleFactor()]);
      opts = { ...opts, x: pos.x / scale + 30, y: pos.y / scale + 30 };
    } catch {
      /* placed where the system puts it */
    }
  }
  appLog("info", `Opening a ${boot ? (boot.kind === "open" ? "window on a PDF" : "duplicate window") : "fresh window"} (${label})`);
  const win = new WebviewWindow(label, opts);
  win.once("tauri://error", (e) => appLog("error", `Could not open the window: ${String(e.payload ?? e)}`));
}

/** The boot this window was opened with, if any. */
function bootOf(): WindowBoot | null {
  const m = /(?:^#|&)window=([^&]*)/.exec(window.location.hash);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1])) as WindowBoot;
  } catch {
    return null;
  }
}

/** Open what this window was opened for — before the first render, so
 *  a duplicate is drawn as its original was from the start. A PDF found
 *  from the search waits for the library (`afterBoot`). */
export function applyWindowBoot(): { afterBoot?: () => void } {
  if (windowLabel === "main") return {};
  const boot = bootOf();
  if (!boot) return {};
  if (boot.kind === "duplicate") {
    const { state, page } = boot.snapshot;
    if (page) useRecent.setState((s) => ({ pages: { ...s.pages, [page.attKey]: page.record } }));
    useStore.setState(state);
    return {};
  }
  return {
    afterBoot: () => {
      const go = () => void readItem(boot.itemKey);
      if (useStore.getState().library.items.length) return go();
      const off = useStore.subscribe((s) => {
        if (!s.library.items.length) return;
        off();
        go();
      });
    },
  };
}
