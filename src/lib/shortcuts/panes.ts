// The library's three panes from the keyboard. Tab moves between the
// sidebar, the item list and the details panel (skipping one that is
// folded away), and the arrows act in the pane that has it:
//   sidebar — a cursor moves through the folders (← / → fold and
//             unfold), Return opens the one it is on;
//   list    — the selection moves (listNav.ts);
//   details — ← / → switch tabs, ↑ / ↓ scroll, Return goes to the notes.
// The pane is the one last clicked, or tabbed to; it is outlined only
// while the keyboard is being used to move around.
import { create } from "zustand";
import { moveSelection, openSelection } from "./listNav";

export type Pane = "sidebar" | "list" | "meta";

interface PaneState {
  pane: Pane;
  /** Outline the pane — set by keyboard moves, cleared by the pointer. */
  shown: boolean;
}

export const usePane = create<PaneState>(() => ({ pane: "list", shown: false }));

const PANE_SELECTORS: Record<Pane, string> = {
  sidebar: ".panes > .sidebar",
  list: ".panes > .item-list, .panes > .chat-list",
  meta: ".panes > .meta-panel",
};
const ORDER: Pane[] = ["sidebar", "list", "meta"];

function paneEl(p: Pane): HTMLElement | null {
  return document.querySelector<HTMLElement>(PANE_SELECTORS[p]);
}

/** On screen: in the row, or a drawer slid in. */
function visible(p: Pane): boolean {
  const el = paneEl(p);
  if (!el || el.classList.contains("collapsed")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.right > 1 && r.left < window.innerWidth - 1;
}

/** The pane the pointer went down in becomes the keyboard's. */
export function followPointer(target: EventTarget | null): void {
  const el = target instanceof Element ? target : null;
  const pane = ORDER.find((p) => el?.closest(PANE_SELECTORS[p]));
  usePane.setState({ ...(pane ? { pane } : {}), shown: false });
}

export function cyclePane(dir: 1 | -1): void {
  const { pane } = usePane.getState();
  const open = ORDER.filter(visible);
  if (!open.length) return;
  const at = open.indexOf(pane);
  const next = open[(at + dir + open.length) % open.length];
  if (next === "sidebar") placeSidebarCursor(sidebarRows().findIndex((r) => r.classList.contains("selected")));
  usePane.setState({ pane: next, shown: true });
}

/** The pane the arrows act in — the list, when the remembered one has
 *  gone (folded away, or the PDF closed over it). */
function activePane(): Pane {
  const { pane } = usePane.getState();
  return visible(pane) ? pane : "list";
}

// --- the sidebar's cursor ---------------------------------------------------

let sidebarCursor = -1;

const sidebarRows = () => Array.from(document.querySelectorAll<HTMLElement>(".panes > .sidebar .tree-row"));

function placeSidebarCursor(idx: number): void {
  const rows = sidebarRows();
  rows.forEach((r) => r.removeAttribute("data-kbd-cursor"));
  if (!rows.length) return;
  sidebarCursor = Math.max(0, Math.min(rows.length - 1, idx));
  const row = rows[sidebarCursor];
  row.setAttribute("data-kbd-cursor", "");
  row.scrollIntoView({ block: "nearest" });
}

function sidebarMove(delta: number): void {
  const rows = sidebarRows();
  // Rows come and go as folders fold; find the cursor's row again.
  let at = rows.findIndex((r) => r.hasAttribute("data-kbd-cursor"));
  if (at < 0) at = sidebarCursor >= 0 ? sidebarCursor : rows.findIndex((r) => r.classList.contains("selected"));
  placeSidebarCursor(at < 0 ? 0 : at + delta);
}

function sidebarRow(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".panes > .sidebar .tree-row[data-kbd-cursor]");
}

/** ← folds the folder the cursor is on, → unfolds it. */
function sidebarFold(open: boolean): void {
  const toggle = sidebarRow()?.querySelector<HTMLButtonElement>(".tree-toggle");
  if (toggle && (toggle.getAttribute("aria-label") === "Expand") === open) toggle.click();
}

// --- the details panel ------------------------------------------------------

function metaTab(delta: number): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".panes > .meta-panel .meta-tab"));
  if (!tabs.length) return;
  const at = tabs.findIndex((t) => t.classList.contains("active"));
  tabs[(at + delta + tabs.length) % tabs.length].click();
}

function metaScroll(delta: number): void {
  const content = document.querySelector<HTMLElement>(".panes > .meta-panel .meta-content");
  if (!content) return;
  // The tab's own scroller, when it has one (the notes, the highlights).
  const scrollers = [content, ...content.querySelectorAll<HTMLElement>(".cm-scroller, .hl-list, .meta-content > *")];
  const el = scrollers.find((s) => s.scrollHeight > s.clientHeight + 1) ?? content;
  el.scrollBy({ top: delta * 60 });
}

// --- the arrows and Return, in whichever pane has them ------------------------

export function paneArrow(dir: "up" | "down" | "left" | "right", extend = false): void {
  usePane.setState({ shown: true });
  const pane = activePane();
  if (pane === "sidebar") {
    if (dir === "up" || dir === "down") sidebarMove(dir === "up" ? -1 : 1);
    else sidebarFold(dir === "right");
  } else if (pane === "meta") {
    if (dir === "left" || dir === "right") metaTab(dir === "left" ? -1 : 1);
    else metaScroll(dir === "up" ? -1 : 1);
  } else if (dir === "up" || dir === "down") {
    moveSelection(dir === "up" ? -1 : 1, extend, true);
  } else moveSelection(dir === "left" ? -1 : 1, extend);
}

export function paneActivate(): void {
  const pane = activePane();
  if (pane === "sidebar") sidebarRow()?.click();
  else if (pane === "meta") document.querySelector<HTMLElement>(".panes > .meta-panel .cm-content")?.focus();
  else openSelection();
}
