// What each shortcut does (bindings.ts names them). Most of them press
// a button that is already on screen, or set what that button sets, so
// the keyboard and the pointer never drift apart.
import { readerCommand } from "../../components/ReaderPane";
import type { ViewerCommand } from "../../pdfviewer/commands";
import { aiConnected } from "../ai/models";
import { readItem } from "../notes";
import { showMeta, toggleMeta, toggleSidebar } from "../panels";
import { appLog, useStore, type MetaTab } from "../store";
import { moveSelection } from "./listNav";
import { cyclePane, paneActivate, paneArrow } from "./panes";

/** Focus the first element matching `selector` once it is rendered —
 *  a tab just switched to draws on the next frame or so. */
function focusWhenShown(selector: string, select = false): void {
  let tries = 0;
  const attempt = () => {
    const el = document.querySelector<HTMLInputElement>(selector);
    if (el) {
      el.focus();
      if (select) el.select?.();
    } else if (tries++ < 20) requestAnimationFrame(attempt);
  };
  attempt();
}

function showTab(tab: MetaTab): void {
  const s = useStore.getState();
  if (!s.reading && !s.selectedKeys.length) return;
  s.setMetaTab(tab);
  showMeta();
}

/** The conversations tab exists only with AI connected, for one entry. */
function showChats(): void {
  const s = useStore.getState();
  if (aiConnected(s.settings) && (s.reading || s.selectedKeys.length === 1)) showTab("chats");
}

function toggleLeft(): void {
  const s = useStore.getState();
  // While reading, the left of the window is the outline's.
  if (s.reading) {
    if (document.querySelector(".toolbar-reading [aria-label='Toggle outline']")) s.setOutlineOpen(!s.outlineOpen);
  } else toggleSidebar();
}

function viewPdf(): void {
  const { selectedKeys } = useStore.getState();
  if (selectedKeys.length !== 1) return;
  void readItem(selectedKeys[0]).then((opened) => {
    if (!opened) appLog("info", "This entry has no PDF to view");
  });
}

const viewer = (cmd: ViewerCommand) => () => readerCommand(cmd);

export const RUN: Record<string, () => void> = {
  toggleLeft,
  toggleRight: toggleMeta,
  focusSearch: () => focusWhenShown(".toolbar .toolbar-search input", true),

  listInfo: () => showTab("details"),
  listHighlights: () => showTab("highlights"),
  listNotes: () => showTab("notes"),
  listChats: showChats,
  listPdf: viewPdf,
  nextPane: () => cyclePane(1),
  prevPane: () => cyclePane(-1),
  moveUp: () => paneArrow("up"),
  moveDown: () => paneArrow("down"),
  moveLeft: () => paneArrow("left"),
  moveRight: () => paneArrow("right"),
  extendUp: () => moveSelection(-1, true, true),
  extendDown: () => moveSelection(1, true, true),
  activate: paneActivate,

  pdfInfo: () => showTab("details"),
  pdfHighlights: () => showTab("highlights"),
  pdfNotes: () => showTab("notes"),
  pdfChats: showChats,
  pdfSearchHighlights: () => {
    showTab("highlights");
    focusWhenShown(".meta-panel .hl-search", true);
  },
  pdfThumbnails: viewer("thumbnails"),
  pdfFolded: viewer("folded"),
  pdfFoldFilters: viewer("foldFilters"),
  pdfExpandFold: viewer("expandFold"),
  pdfHorizontal: viewer("horizontal"),
  pdfVertical: viewer("vertical"),
  pdfFit1: viewer("fit1"),
  pdfFit2: viewer("fit2"),
  pdfFit3: viewer("fit3"),
  pdfFixed: viewer("fixed"),
  pdfContinuous: viewer("continuous"),
  pdfNext: viewer("next"),
  pdfPrev: viewer("prev"),
};
