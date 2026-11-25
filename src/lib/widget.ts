// The iOS home-screen widget, Continue Reading (src-tauri/ios-widget/),
// from the page's side: what it shows, and the links it opens the app
// with. Only in the app on iOS; elsewhere `startWidget` does nothing.
//
// What it shows: the PDFs opened last, each with its title, author, the
// page it was left on and — once read here — its page count; and a
// picture of each one's page, the reader's highlights and ink on it,
// drawn from the open PDF (`readerPageImage`) once a page has been read a
// moment (SETTLE_MS, and the pen at rest), and again as the app goes to
// the background, the last chance to show the page it is left on.
//
// The widget has pins of its own (a PDF kept in its place there,
// src-tauri/ios-widget/Sources/ContinueReadingPins.swift), which the app
// doesn't know of, so the list is the whole of Recent still in the
// library, newest first: a pinned PDF is in it however long ago it was
// read, and the widget picks what it shows. Pictures are only ever of the
// PDF open, which is the latest, so they are sent for the first three
// (SHOWN) only, each once; the native side (tauri-plugin-widget's
// WidgetPlugin.swift, in the app group the widget reads) keeps those of
// the latest three and of the pinned PDFs, and says which it has, so one
// it let go is sent again when its PDF is back among the three. The list
// is sent when it changes: a PDF opened, a page turned, a picture drawn.
// What came of it goes to the log, once each time it changes: how many
// PDFs the widget has to choose from, or why the native side couldn't
// write them (`report`).
//
// The links: a tap on a PDF in the widget opens the app with
// zoterohelper://open?item=…&att=…&page=…, which the plugin keeps until
// it is taken here — at once on starting (the link that launched the
// app) and whenever the plugin says one came (`open-url`) — and the PDF
// opens at that page, as from Recent.
import { openReaderAt, readerPageCount, readerPageImage } from "../components/ReaderPane";
import { creatorSummary, itemTitle } from "./collections";
import { whenPenRested, WRITING_PAUSE_MS } from "./penActivity";
import { lastPage, useRecent } from "./recent";
import { appLog, useStore } from "./store";
import { invoke, isTauri, on } from "./tauri";

/** How many PDFs the largest widget shows, the latest first (pins aside). */
const SHOWN = 3;
/** How long a page is read before it is pictured, ms. */
const SETTLE_MS = 4000;
/** The picture's width, px: a medium widget's half at 3×. */
const PICTURE_PX = 480;
/** Each PDF's page count, once read here (the widget's "of 30"). */
const COUNTS_KEY = "zh-widget-page-counts";

interface WidgetPdf {
  itemKey: string;
  attKey: string;
  title: string;
  author: string;
  page: number;
  pageCount: number | null;
  openedMs: number;
}

const onIos = () => isTauri && navigator.maxTouchPoints > 1 && /iPad|iPhone|Mac/.test(navigator.userAgent);

function counts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(COUNTS_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function keepCount(attKey: string, n: number): void {
  const all = counts();
  if (all[attKey] === n) return;
  all[attKey] = n;
  try {
    localStorage.setItem(COUNTS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the widget goes without the count */
  }
}

/** The PDFs the widget chooses from: Recent's still in the library,
 *  newest first. */
function shelf(): WidgetPdf[] {
  // All of Recent (up to 100) against the whole library: looked up, not searched.
  const byKey = new Map(useStore.getState().library.items.map((i) => [i.key, i]));
  const known = counts();
  const out: WidgetPdf[] = [];
  for (const r of useRecent.getState().opened) {
    const item = byKey.get(r.itemKey);
    if (!item || !byKey.has(r.attKey)) continue;
    const pageCount = readerPageCount(r.attKey);
    if (pageCount) keepCount(r.attKey, pageCount);
    out.push({
      itemKey: r.itemKey,
      attKey: r.attKey,
      title: itemTitle(item),
      author: creatorSummary(item),
      page: lastPage(r.attKey) ?? 1,
      pageCount: pageCount ?? known[r.attKey] ?? null,
      openedMs: r.ms,
    });
  }
  return out;
}

// Each PDF's picture: of which page, drawn from which library (a new
// highlight is a new library), and whether the widget has it yet.
const pictures = new Map<string, { page: number; library: object; data: string; sent: boolean }>();
let lastSent = "";

/** Picture the page of the PDF open, unless it is pictured as it is. */
async function picture(): Promise<void> {
  const st = useStore.getState();
  const attKey = st.reading?.attKey;
  if (!attKey) return;
  const page = lastPage(attKey);
  const had = pictures.get(attKey);
  if (!page || (had && had.page === page && had.library === st.library)) return;
  try {
    const data = await readerPageImage(attKey, page - 1, PICTURE_PX);
    if (data) pictures.set(attKey, { page, library: st.library, data, sent: false });
  } catch (e) {
    appLog("debug", `Widget: the page could not be pictured: ${e}`);
  }
}

/** Send the shelf, and any picture the widget hasn't had. */
async function send(): Promise<void> {
  const entries = shelf();
  const thumbnails: Record<string, string> = {};
  for (const e of entries.slice(0, SHOWN)) {
    const p = pictures.get(e.attKey);
    if (p && !p.sent) thumbnails[e.attKey] = p.data;
  }
  const key = JSON.stringify(entries);
  if (key === lastSent && !Object.keys(thumbnails).length) return;
  try {
    const written = await invoke<{ listed: number; folder: string; kept: string[] }>("plugin:widget|update", {
      payload: { entries, thumbnails },
    });
    lastSent = key;
    // What the widget has: a picture sent and kept. One it let go goes
    // again once its PDF is among the latest three again.
    const kept = new Set(written.kept);
    for (const [k, p] of pictures) p.sent = kept.has(k) && (p.sent || k in thumbnails);
    report(
      "info",
      `Widget: ${written.listed} PDF${written.listed === 1 ? "" : "s"} to choose from, in ${written.folder}`,
      written.listed,
    );
  } catch (e) {
    report("warn", `Widget: could not update it: ${e}`);
  }
}

// What the log last said of the widget: said again only when it changes
// (an update goes with every page turned), so a failure shows once, as
// does the first update that works and any change in how many it lists.
let lastReport = "";
function report(level: "info" | "warn", message: string, listed?: number): void {
  const said = level === "info" ? `ok ${listed}` : message;
  if (said === lastReport) return;
  lastReport = said;
  appLog(level, message);
}

let sendTimer = 0;
const sendSoon = (ms = 800) => {
  window.clearTimeout(sendTimer);
  sendTimer = window.setTimeout(() => void send(), ms);
};

// A page read a moment, the pen at rest: pictured, then sent.
let settleTimer = 0;
let waitPen: (() => void) | null = null;
function pictureSoon(): void {
  window.clearTimeout(settleTimer);
  waitPen?.();
  settleTimer = window.setTimeout(() => {
    waitPen = whenPenRested(WRITING_PAUSE_MS, () => void picture().then(() => send()));
  }, SETTLE_MS);
}

/** Once the library has loaded: a link may come before it does. */
function libraryLoaded(): Promise<void> {
  if (useStore.getState().library.items.length) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useStore.subscribe((s) => {
      if (!s.library.items.length) return;
      off();
      resolve();
    });
  });
}

/** The link the app was opened with, if any: its PDF, at its page. With
 *  several windows (lib/windows/), each hears of a link and the first on
 *  screen takes it — one out of sight leaves it for one in view, or
 *  takes it itself as it comes into view. */
async function openLink(): Promise<void> {
  if (document.visibilityState === "hidden") return;
  const url = await invoke<string | null>("plugin:widget|take_open_url").catch(() => null);
  if (!url) return;
  await libraryLoaded();
  try {
    const u = new URL(url);
    const item = u.searchParams.get("item");
    const att = u.searchParams.get("att");
    const page = Number(u.searchParams.get("page")) || 1;
    if (u.host !== "open" || !item || !att) return;
    if (!useStore.getState().library.items.some((i) => i.key === att)) return;
    appLog("info", `Widget: opening ${att} at p. ${page}`);
    openReaderAt(item, att, page);
  } catch (e) {
    appLog("debug", `Widget: not a link to open (${url}): ${e}`);
  }
}

let started = false;

/** As the app starts (after bootstrap); once. */
export function startWidget(): void {
  if (started || !onIos()) return;
  started = true;
  void openLink();
  void on("open-url", () => void openLink());
  useRecent.subscribe((s, prev) => {
    if (s.opened !== prev.opened) sendSoon();
    if (s.pages !== prev.pages) {
      sendSoon();
      pictureSoon();
    }
  });
  // A highlight or a drawing made: the page is pictured again.
  useStore.subscribe((s, prev) => {
    if (s.library !== prev.library && s.reading?.attKey) pictureSoon();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return void openLink();
    window.clearTimeout(settleTimer);
    void picture().then(() => send());
  });
  sendSoon(0);
}
