// The Apple Pencil's double-tap and squeeze (tauri-plugin-pencil), handed
// on as a window event — "zh-pencil", detail `{ kind, action }`, the
// action being what Settings → Apple Pencil asks for — which the PDF
// viewer's ink mode listens for while it is on. iPad only: elsewhere
// there is nothing to hear.
import { appLog } from "./store";
import { isTauri } from "./tauri";

export interface PencilGesture {
  kind: "tap" | "squeeze";
  action: string;
}

/** Start listening. Called once, from bootstrap. */
export async function listenForPencil(): Promise<void> {
  if (!isTauri || !document.documentElement.classList.contains("ipados")) return;
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
