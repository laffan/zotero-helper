// Clarify: what a selection in an answer brings up, in a conversation
// or an explainer (ThreadStrip.tsx). A small bar under the selection —
// the passage, quoted, then Clarify, which asks about it at once in the
// words of Settings → AI → Prompts, and a box to ask something of one's
// own about it instead (Enter, or the arrow). Either opens the answer
// in a column to the right (lib/ai/threads.ts).
//
// The passage is taken when the selection comes to rest (a pointer let
// go, or — the iPad's handles, which send no pointer events — a pause in
// the selection's changes), and kept: a tap into the box lets go of the
// selection itself. Only an answer's text counts — not a question, not
// a column's head — and only one answer's at a time. A press anywhere
// outside the bar, or Escape, closes it.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ClarifyAt } from "../lib/ai/threads";
import { passageOf } from "../lib/ai/threadMarks";
import { SendIcon, Sparkles } from "./Icons";

/** A passage to ask about, and where under it the bar goes (in the
 *  coordinates of the strip's columns). */
export interface ClarifyTarget {
  at: ClarifyAt;
  x: number;
  y: number;
}

/** How long the selection rests before the bar comes, ms. */
const SETTLE_MS = 250;
/** The bar's width, px (less where the strip is narrower). */
const WIDTH = 300;

const elementOf = (n: Node) => (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement);

/** The passage selected in an answer within `colsRef`, as it comes to
 *  rest; null until there is one (and once the bar is closed). */
export function useClarifySelection(
  colsRef: RefObject<HTMLElement>,
): [ClarifyTarget | null, (t: ClarifyTarget | null) => void] {
  const [target, setTarget] = useState<ClarifyTarget | null>(null);
  useEffect(() => {
    let timer = 0;
    let down = false;
    const check = () => {
      const sel = window.getSelection();
      const cols = colsRef.current;
      if (!sel || sel.isCollapsed || !sel.rangeCount || !cols) return;
      const range = sel.getRangeAt(0);
      const msg = elementOf(range.startContainer)?.closest<HTMLElement>(".thread-msg[data-index]");
      const col = msg?.closest<HTMLElement>(".thread-col");
      const body = msg?.querySelector(".chat-msg-assistant .chat-md");
      if (!msg || !col || !body || !cols.contains(col) || !body.contains(range.startContainer)) return;
      const passage = passageOf(body, range);
      if (!passage) return;
      const box = cols.getBoundingClientRect();
      const r = range.getBoundingClientRect();
      const bottom = Math.min(r.bottom, body.getBoundingClientRect().bottom);
      setTarget({
        at: { parentId: col.dataset.thread || null, messageIndex: Number(msg.dataset.index), ...passage },
        x: r.left - box.left,
        y: bottom - box.top + 6,
      });
    };
    const soon = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, ms);
    };
    const onChange = () => {
      if (!down) soon(SETTLE_MS);
    };
    const onDown = () => {
      down = true;
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      soon(60);
    };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
    };
  }, [colsRef]);
  return [target, setTarget];
}

/** The bar itself, under the passage, kept inside the strip's view. */
export function ClarifyPopover({
  target,
  strip,
  onAsk,
  onClose,
}: {
  target: ClarifyTarget;
  strip: HTMLElement;
  onAsk: (question?: string) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const width = Math.min(WIDTH, strip.clientWidth - 16);
  const lo = strip.scrollLeft + 8;
  const left = Math.max(lo, Math.min(target.x, lo + strip.clientWidth - 16 - width));
  const ask = (q?: string) => {
    window.getSelection()?.removeAllRanges();
    onAsk(q?.trim() || undefined);
  };
  return (
    <div
      className="clarify-pop"
      ref={ref}
      style={{ left, top: target.y, width }}
      role="dialog"
      aria-label="Ask about the selected passage"
    >
      <div className="clarify-quote" title={target.at.quote}>
        “{target.at.quote}”
      </div>
      <div className="clarify-row">
        <button
          className="tool-btn accent clarify-go"
          onClick={() => ask()}
          title="Ask for this part of the answer to be explained further — in a column to the right"
        >
          <Sparkles size={12} /> Clarify
        </button>
        <input
          className="clarify-input"
          value={question}
          placeholder="Or ask about it…"
          aria-label="Your question about the passage"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && question.trim()) {
              e.preventDefault();
              ask(question);
            }
          }}
        />
        <button
          className="icon-btn"
          disabled={!question.trim()}
          onClick={() => ask(question)}
          aria-label="Ask"
          title="Ask your question about the passage"
        >
          <SendIcon size={13} />
        </button>
      </div>
    </div>
  );
}
