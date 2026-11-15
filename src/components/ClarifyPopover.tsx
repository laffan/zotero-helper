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
// outside the bar, or Escape, closes it. It is placed on the screen
// (fixed, under the passage, or over it where there is no room below),
// so the explainer's rounded edge doesn't clip it.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ClarifyAt } from "../lib/ai/threads";
import { passageOf } from "../lib/ai/threadMarks";
import { SendIcon, Sparkles } from "./Icons";

/** A passage to ask about, and where it is on the screen: its left
 *  edge, top and bottom. */
export interface ClarifyTarget {
  at: ClarifyAt;
  x: number;
  top: number;
  bottom: number;
}

/** How long the selection rests before the bar comes, ms. */
const SETTLE_MS = 250;
/** The bar's width, px (less where the strip is narrower). */
const WIDTH = 300;

const elementOf = (n: Node) => (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement);

/** The passage selected in an answer within `stripRef`, as it comes to
 *  rest; null until there is one (and once the bar is closed). */
export function useClarifySelection(
  stripRef: RefObject<HTMLElement>,
): [ClarifyTarget | null, (t: ClarifyTarget | null) => void] {
  const [target, setTarget] = useState<ClarifyTarget | null>(null);
  useEffect(() => {
    let timer = 0;
    let down = false;
    const check = () => {
      const sel = window.getSelection();
      const strip = stripRef.current;
      if (!sel || sel.isCollapsed || !sel.rangeCount || !strip) return;
      const range = sel.getRangeAt(0);
      const msg = elementOf(range.startContainer)?.closest<HTMLElement>(".thread-msg[data-index]");
      const col = msg?.closest<HTMLElement>(".thread-col");
      const body = msg?.querySelector(".chat-msg-assistant .chat-md");
      if (!msg || !col || !body || !strip.contains(col) || !body.contains(range.startContainer)) return;
      const passage = passageOf(body, range);
      if (!passage) return;
      const r = range.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      setTarget({
        at: { parentId: col.dataset.thread || null, messageIndex: Number(msg.dataset.index), ...passage },
        x: r.left,
        top: Math.max(r.top, b.top),
        bottom: Math.min(r.bottom, b.bottom),
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
  }, [stripRef]);
  return [target, setTarget];
}

/** The bar itself, under the passage (over it, where there is no room
 *  below), kept on the screen. */
export function ClarifyPopover({
  target,
  onAsk,
  onClose,
}: {
  target: ClarifyTarget;
  onAsk: (question?: string) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(target.bottom + 6);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const below = target.bottom + 6;
    setTop(below + h > window.innerHeight - 8 ? Math.max(8, target.top - h - 6) : below);
  }, [target]);
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

  const width = Math.min(WIDTH, window.innerWidth - 16);
  const left = Math.max(8, Math.min(target.x, window.innerWidth - 8 - width));
  const ask = (q?: string) => {
    window.getSelection()?.removeAllRanges();
    onAsk(q?.trim() || undefined);
  };
  return (
    <div
      className="clarify-pop"
      ref={ref}
      style={{ left, top, width }}
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
