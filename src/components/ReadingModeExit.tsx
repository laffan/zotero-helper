// Reading mode's controls, the only things on screen besides the pages:
// a red × at the window's top left (and Escape) leaves it; below it, the
// same size and spacing, a caret toggles the sentence tool (a tap
// selects the sentence under it, as a ⌘-click does) and a pen toggles
// ink mode — the Pencil writing, or selecting and highlighting like a
// finger. Both are the viewer's own, toggled through its commands and
// shown filled while on (the store's `sentenceTool` / `inkMode`, which
// the viewer reports). At the top right, opposite the ×, a red rectangle
// opens the notepad (ReadingNotepad.tsx). Reading mode itself is the
// store's `readingMode`
// — App.tsx gives the app the `reading-mode` class, and readingmode.css
// hides the rest.
import { useEffect } from "react";
import { useStore } from "../lib/store";
import { readerCommand } from "./ReaderPane";

const CARET = (
  <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5.5 2.5c1.4 0 2.5.6 2.5 1.8 0-1.2 1.1-1.8 2.5-1.8" />
    <path d="M8 4.3v7.4" />
    <path d="M5.5 13.5c1.4 0 2.5-.6 2.5-1.8 0 1.2 1.1 1.8 2.5 1.8" />
    <path d="M6.4 8h3.2" />
  </svg>
);
const PEN = (
  <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11.2 2.3l2.5 2.5L5.6 12.9l-3.3.8.8-3.3z" />
    <path d="M9.8 3.7l2.5 2.5" />
  </svg>
);

export function ReadingModeExit() {
  const leave = () => useStore.getState().setReadingMode(false);
  const sentenceTool = useStore((s) => s.sentenceTool);
  const inkMode = useStore((s) => s.inkMode);
  const notepadOpen = useStore((s) => s.notepadOpen);

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
        className={sentenceTool ? "reading-mode-tool reading-mode-sentence on" : "reading-mode-tool reading-mode-sentence"}
        title={sentenceTool ? "Sentence tool on: a tap selects its sentence" : "Sentence tool: a tap selects its sentence"}
        aria-label="Sentence tool"
        aria-pressed={sentenceTool}
        onClick={() => readerCommand("sentence")}
      >
        {CARET}
      </button>
      <button
        type="button"
        className={inkMode ? "reading-mode-tool reading-mode-pen on" : "reading-mode-tool reading-mode-pen"}
        title={inkMode ? "The Pencil writes" : "The Pencil selects and highlights"}
        aria-label="Pen"
        aria-pressed={inkMode}
        onClick={() => readerCommand("ink")}
      >
        {PEN}
      </button>
      <button
        type="button"
        className={notepadOpen ? "reading-mode-notepad on" : "reading-mode-notepad"}
        title={notepadOpen ? "Close the notepad" : "Open the notepad — write with the Pencil"}
        aria-label="Notepad"
        aria-pressed={notepadOpen}
        onClick={() => useStore.getState().setNotepadOpen(!notepadOpen)}
      />
    </>
  );
}
