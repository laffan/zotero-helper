// The layout last chosen in the viewer, so the next PDF opens the same
// way. Without one, a portrait viewer (an iPad upright) starts in
// vertical fit: the horizontal default fits pages to the height, which
// crops them there.
import type { LayoutMode } from "./types";

export type FitMode = "fit" | "fit-2" | "fit-3";

export interface ViewPrefs {
  layoutMode: LayoutMode;
  fitMode: FitMode;
  fixedZoom: number;
  /** One page at a time (single.ts); absent in prefs saved before it. */
  single?: boolean;
}

const VIEW_KEY = "zh-pdf-view";

export function loadViewPrefs(): ViewPrefs | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    return v && typeof v.layoutMode === "string" ? (v as ViewPrefs) : null;
  } catch {
    return null;
  }
}

export function saveViewPrefs(v: ViewPrefs): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}
