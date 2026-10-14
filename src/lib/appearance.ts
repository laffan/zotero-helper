// Settings → General: the light / dark appearance and the UI font size.
// Both are this device's (kept with the other UI prefs in the store),
// and both apply at once, without Save. The stylesheets do the work:
// tokens.css swaps its colours on <html data-theme>, and every font
// size in the app is drawn at `calc(Npx * var(--font-scale))`, a
// multiple of the 13px the UI was designed at.
import { useStore } from "./store";

export type Appearance = "system" | "light" | "dark";

export const APPEARANCES: { id: Appearance; label: string }[] = [
  { id: "system", label: "Match the system" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** The size the stylesheets were drawn at. */
export const BASE_FONT_SIZE = 13;
export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18];

function apply(appearance: Appearance, fontSize: number): void {
  const root = document.documentElement;
  if (appearance === "system") delete root.dataset.theme;
  else root.dataset.theme = appearance;
  root.style.setProperty("--font-scale", String(fontSize / BASE_FONT_SIZE));
}

/** Apply the stored choice before the first render (so a dark choice
 *  doesn't flash light), and follow it from then on. */
export function initAppearance(): void {
  const s = useStore.getState();
  apply(s.appearance, s.uiFontSize);
  useStore.subscribe((now, prev) => {
    if (now.appearance !== prev.appearance || now.uiFontSize !== prev.uiFontSize) {
      apply(now.appearance, now.uiFontSize);
    }
  });
}
