// Reading mode's way back: a red ring at the window's top left
// (the only thing on screen besides the pages), and Escape. Reading
// mode itself is the store's `readingMode` — App.tsx gives the app the
// `reading-mode` class, and readingmode.css hides the rest.
import { useEffect } from "react";
import { useStore } from "../lib/store";

export function ReadingModeExit() {
  const leave = () => useStore.getState().setReadingMode(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((e.target as Element | null)?.closest?.("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      type="button"
      className="reading-mode-exit"
      title="Leave reading mode (Esc)"
      aria-label="Leave reading mode"
      onClick={leave}
    />
  );
}
