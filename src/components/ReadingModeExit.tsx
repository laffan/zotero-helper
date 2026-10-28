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
// shows the colour it writes in; the flyout also has the notepad's
// switch of tools — pen, eraser, lasso — and the pen button shows the
// tool in force: the pen, an eraser (the eraser is shared with the
// notepad, lib/penTool.ts) or a lasso. The
// notepad's icon is ReadingNotepad.tsx's. Reading mode itself is the
// store's `readingMode`
// — App.tsx gives the app the `reading-mode` class, and readingmode.css
// hides the rest.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { LassoIcon } from "./NotepadBody";
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
const ERASER = (
  <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.2 13.5L2.4 9.7a1 1 0 0 1 0-1.4l5.9-5.9a1 1 0 0 1 1.4 0l3.8 3.8a1 1 0 0 1 0 1.4l-6 5.9z" />
    <path d="M5 7.1l4.9 4.9" />
    <path d="M6.2 13.5h7.3" />
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
  const inkTool = useStore((s) => s.inkTool);
  const erasing = inkMode && inkTool === "eraser";
  const lassoing = inkMode && inkTool === "select";
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
        title={
          erasing
            ? "The Pencil erases (double-tap it to write) — hold for its tools"
            : lassoing
              ? "The Pencil draws a lasso round drawings — hold for its tools"
              : inkMode
                ? "The Pencil writes (hold it still to lasso) — hold for its colour and tools"
                : "The Pencil selects and highlights"
        }
        aria-label="Pen"
        aria-pressed={inkMode}
        aria-haspopup={inkMode ? "menu" : undefined}
        {...pen.holdProps}
      >
        {erasing ? ERASER : lassoing ? <LassoIcon size={20} /> : PEN}
        {inkMode && inkTool === "pen" && pen.color && <span className="reading-mode-pen-dot" style={{ background: pen.color }} />}
      </button>
      {pen.open && (
        <div className="reading-mode-pen-colors" role="menu" aria-label="Pen colour and tool" ref={pen.menuRef}>
          {/* The notepad's switch: pen, eraser (shared with it), lasso. */}
          <div className="notepad-modes" role="radiogroup" aria-label="What the Pencil does">
            {(
              [
                ["pen", "Write", PEN],
                ["eraser", "Erase (the Pencil's double-tap)", ERASER],
                ["select", "Lasso — draw a loop round drawings (or hold the pen still)", <LassoIcon key="l" />],
              ] as const
            ).map(([t, label, icon]) => (
              <button
                key={t}
                type="button"
                role="radio"
                className={inkTool === t ? "notepad-mode on" : "notepad-mode"}
                title={label}
                aria-label={label}
                aria-checked={inkTool === t}
                onClick={() => pen.chooseTool(t)}
              >
                {icon}
              </button>
            ))}
          </div>
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
    /** A colour: the pen writes in it (back to the pen, if it wasn't). */
    choose(c: string): void {
      const p = readerPen();
      p?.setColor(c);
      if (p && p.tool() !== "pen") p.setTool("pen");
      setColor(c);
      setOpen(false);
    },
    chooseTool(t: "pen" | "eraser" | "select"): void {
      readerPen()?.setTool(t);
      setOpen(false);
    },
  };
}
