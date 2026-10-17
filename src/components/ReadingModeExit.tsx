// Reading mode's way back: a red × at the window's top left
// (the only thing on screen besides the pages), and Escape. Reading
// mode itself is the store's `readingMode` — App.tsx gives the app the
// `reading-mode` class, and readingmode.css hides the rest.
//
// Below it, a red ⌘ of the same size stands in for the key
// when no keyboard is attached: while it is on (filled), a tap on a
// line marks its sentence, as a ⌘-click does (the store's
// `commandLatch`, read by the viewer's sentenceMark.ts).
import { useEffect } from "react";
import { useStore } from "../lib/store";

export function ReadingModeExit() {
  const leave = () => useStore.getState().setReadingMode(false);
  const latched = useStore((s) => s.commandLatch);

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
    <>
      <button
        type="button"
        className="reading-mode-exit"
        title="Leave reading mode (Esc)"
        aria-label="Leave reading mode"
        onClick={leave}
      />
      <button
        type="button"
        className={latched ? "reading-mode-cmd on" : "reading-mode-cmd"}
        title={latched ? "⌘ is on: a tap highlights its sentence" : "Hold ⌘: a tap highlights its sentence"}
        aria-label="Command key"
        aria-pressed={latched}
        onClick={() => useStore.getState().setCommandLatch(!latched)}
      />
    </>
  );
}
