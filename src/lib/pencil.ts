// The iPad's input around the PDF pages, where it needs native help
// (tauri-plugin-pencil):
//
// - The Apple Pencil's double-tap and squeeze, handed on as a window
//   event — "zh-pencil", detail `{ kind, action }`, the action being what
//   Settings → Apple Pencil asks for — which the PDF viewer's ink mode
//   listens for while it is on, and the notepad. The one the Pencil last
//   touched takes it (`pencilLastOn`).
// - The system's text-selection menu (Copy, Look Up, …), dismissed over
//   a selection in the PDF, where it covers the viewer's own bar. Nothing
//   on the page can keep it from appearing, so it is dismissed as the
//   selection settles, and once more a moment later in case it came up
//   after. Selections elsewhere (the notes) keep their menu.
//
// iPad only: elsewhere there is nothing to hear and no such menu.
import { appLog } from "./store";
import { invoke, isTauri } from "./tauri";

// Where the Pencil last came down, for whoever hears its double-tap.
let pencilTarget: Element | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "pen") pencilTarget = e.target as Element;
    },
    true,
  );
}

/** Did the Pencil last come down inside `el`? */
export const pencilLastOn = (el: Element): boolean => Boolean(pencilTarget && el.contains(pencilTarget));
/** …on a notepad (its double-tap is the notepad's, not ink mode's)? */
export const pencilOnNotepad = (): boolean => Boolean(pencilTarget?.closest?.(".notepad-canvas"));

/** After a selection in the PDF settles: dismiss the menu, and again. */
const MENU_HIDE_MS = [60, 400];

function selectionInPdf(): boolean {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode) return false;
  const el = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
  return Boolean(el?.closest(".textLayer"));
}

function watchPdfSelections(): void {
  let timers: number[] = [];
  const hideSoon = () => {
    if (!selectionInPdf()) return;
    timers.forEach(clearTimeout);
    timers = MENU_HIDE_MS.map((ms) =>
      window.setTimeout(() => {
        if (selectionInPdf()) void invoke("plugin:pencil|hide_edit_menu").catch(() => {});
      }, ms),
    );
  };
  document.addEventListener("selectionchange", hideSoon);
  document.addEventListener("touchend", hideSoon, { passive: true });
}

export interface PencilGesture {
  kind: "tap" | "squeeze";
  action: string;
}

/** Start listening (and watching selections). Called once, from
 *  bootstrap. */
export async function listenForPencil(): Promise<void> {
  if (!isTauri || !document.documentElement.classList.contains("ipados")) return;
  watchPdfSelections();
  try {
    const { addPluginListener } = await import("@tauri-apps/api/core");
    for (const kind of ["tap", "squeeze"] as const) {
      await addPluginListener("pencil", kind, (p: { action?: string }) => {
        const detail: PencilGesture = { kind, action: p.action ?? "switchEraser" };
        window.dispatchEvent(new CustomEvent("zh-pencil", { detail }));
      });
    }
  } catch (e) {
    appLog("debug", `Apple Pencil events unavailable: ${e}`);
  }
}
