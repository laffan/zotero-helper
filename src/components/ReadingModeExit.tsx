// Reading mode's controls, the only things on screen besides the pages:
// a red × at the window's top left (and Escape) leaves it; below it, the
// same size and spacing, a caret toggles the sentence tool (a tap
// selects the sentence under it, as a ⌘-click does) and a pen toggles
// ink mode — the Pencil writing, or selecting and highlighting like a
// finger. Both are the viewer's own, toggled through its commands and
// shown filled while on (the store's `sentenceTool` / `inkMode`, which
// the viewer reports). With ink mode on, holding the pen a moment
// (HOLD_MS) opens a flyout of the pen's colours beside it — the bottom
// bar's colour chip, which reading mode hides — and a dot on the pen
// shows the colour it writes in. At the top right, opposite the ×, a red rectangle
// opens the notepad (ReadingNotepad.tsx). Reading mode itself is the
// store's `readingMode`
// — App.tsx gives the app the `reading-mode` class, and readingmode.css
// hides the rest.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { readerCommand, readerPen } from "./ReaderPane";

const HOLD_MS = 450;

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
  const pen = usePenColors(inkMode);

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
        title={inkMode ? "The Pencil writes — hold for its colour" : "The Pencil selects and highlights"}
        aria-label="Pen"
        aria-pressed={inkMode}
        aria-haspopup={inkMode ? "menu" : undefined}
        {...pen.holdProps}
      >
        {PEN}
        {inkMode && pen.color && <span className="reading-mode-pen-dot" style={{ background: pen.color }} />}
      </button>
      {pen.open && (
        <div className="reading-mode-pen-colors" role="menu" aria-label="Pen colour" ref={pen.menuRef}>
          {pen.palette.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={c === pen.color}
              aria-label={`Colour ${c}`}
              className={c === pen.color ? "reading-mode-pen-color on" : "reading-mode-pen-color"}
              style={{ "--swatch": c } as React.CSSProperties}
              onClick={() => pen.choose(c)}
            />
          ))}
        </div>
      )}
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

/** The pen button's press: a tap toggles ink mode; held (with ink mode
 *  on) it opens the colour flyout instead, which a colour, a press
 *  elsewhere or Escape closes. */
function usePenColors(inkMode: boolean) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState<string | null>(null);
  const timer = useRef(0);
  const held = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The colour the pen writes in, as ink mode starts.
  useEffect(() => {
    setColor(inkMode ? (readerPen()?.color() ?? null) : null);
    if (!inkMode) setOpen(false);
  }, [inkMode]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!menuRef.current?.contains(t) && !t.closest?.(".reading-mode-pen")) setOpen(false);
    };
    // Before reading mode's own Escape, which would leave it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const cancel = () => window.clearTimeout(timer.current);
  const holdProps = {
    onPointerDown: () => {
      held.current = false;
      cancel();
      if (!inkMode) return;
      timer.current = window.setTimeout(() => {
        held.current = true;
        setColor(readerPen()?.color() ?? null);
        setOpen(true);
      }, HOLD_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    // The iPad's long-press menu, a right-click's.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      // The press that opened the flyout doesn't also end ink mode.
      if (held.current) {
        held.current = false;
        return;
      }
      setOpen(false);
      readerCommand("ink");
    },
  };

  return {
    open,
    color,
    palette: readerPen()?.palette ?? [],
    menuRef,
    holdProps,
    choose(c: string): void {
      readerPen()?.setColor(c);
      setColor(c);
      setOpen(false);
    },
  };
}
