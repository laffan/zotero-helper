// The explainer's window: a passage of the open PDF explained, floating
// over the pages at the bottom right (reading mode included) so the
// passage stays in sight. It opens from the selection bar's AI button
// (lib/ai/explain.ts) and asks its question by itself — the full
// question names the work it was read in, but only the passage is
// shown. There are no follow-ups: a toggle in its head says what goes
// with the question instead — No Context (the default: the question
// alone) or Context (the work, the page and the PDF's text around it) —
// and switching asks again, the new answer in place of the old. ×,
// Escape or a press anywhere outside closes the window; the explanation
// is kept, under Explanations.
import { useEffect, useRef, useState } from "react";
import { persistChats, sendChatMessage } from "../lib/ai/chat";
import { explainContext } from "../lib/ai/explain";
import { formatUsd } from "../lib/ai/models";
import { useStore } from "../lib/store";
import type { Chat } from "../lib/types";
import { Bubble } from "./ChatPanel";
import { CloseIcon, QuestionIcon, Spinner } from "./Icons";
import { readerPageCount } from "./ReaderPane";

/** The question an explainer asks, and what it shows of it. */
function questionOf(chat: Chat, fallback: { question?: string; display?: string } | null) {
  const first = chat.messages.find((m) => m.role === "user");
  return { question: first?.content ?? fallback?.question, display: first?.display ?? fallback?.display };
}

export function ExplainChat() {
  const explain = useStore((s) => s.explain);
  const chat = useStore((s) => s.chats.find((c) => c.id === s.explain?.chatId));
  const busyId = useStore((s) => s.chatBusy);
  const busy = Boolean(chat) && busyId === chat?.id;
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const asked = useRef<string | null>(null);
  // The question last asked again, should that fail (Try again).
  const again = useRef<{ question?: string; display?: string } | null>(null);

  const close = () => useStore.getState().setExplain(null);

  const send = async (text: string, display?: string) => {
    if (!chat || !text.trim()) return;
    setError(null);
    try {
      await sendChatMessage(chat.id, text, display);
    } catch (e) {
      setError(String(e));
    }
  };
  const askFirst = () => {
    if (!chat) return;
    const q = questionOf(chat, again.current ?? explain);
    if (q.question) void send(q.question, q.display);
  };

  // The question goes out as the window opens.
  useEffect(() => {
    if (!chat || !explain?.question || chat.messages.length || asked.current === chat.id) return;
    asked.current = chat.id;
    askFirst();
  }, [chat?.id, explain?.question]);

  // A press anywhere outside the window closes it — and still does what
  // it was pressed for (a tap on another explained passage opens that).
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!explain) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [explain]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.messages.length, busy]);

  // Escape closes the window before it reaches reading mode's exit.
  useEffect(() => {
    if (!explain) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [explain]);

  if (!explain || !chat) return null;
  const withContext = chat.context !== "";

  /** Ask again, with the work as context or without: the new answer
   *  takes the old one's place. */
  const setContext = async (on: boolean) => {
    if (busy || preparing || on === withContext) return;
    const { question, display } = questionOf(chat, explain);
    if (!question) return;
    again.current = { question, display };
    setError(null);
    let context = "";
    if (on) {
      setPreparing(true);
      try {
        context = await explainContext(chat, readerPageCount(chat.passage?.attKey));
      } catch (e) {
        setError(`Couldn't read the PDF: ${e}`);
        return;
      } finally {
        setPreparing(false);
      }
    }
    const s = useStore.getState();
    const cur = s.chats.find((c) => c.id === chat.id);
    if (!cur) return;
    // A four-characters-a-token estimate; the reply books the real cost.
    s.upsertChat({ ...cur, context, contextTokens: Math.ceil(context.length / 4), messages: [] });
    void persistChats();
    await send(question, display);
  };

  const waiting = busy || preparing;
  return (
    <div className="explain-chat" role="dialog" aria-label="Explain the passage" ref={boxRef}>
      <div className="explain-head">
        <QuestionIcon size={13} />
        <span className="explain-title" title={chat.title}>
          {chat.title}
        </span>
        <button className="icon-btn" onClick={close} aria-label="Close" title="Close (Esc) — the explanation is kept">
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="explain-context" role="radiogroup" aria-label="What goes with the question">
        <button
          role="radio"
          aria-checked={!withContext}
          className={withContext ? "" : "on"}
          disabled={waiting}
          onClick={() => void setContext(false)}
          title="The question alone — the concept explained on its own terms"
        >
          No Context
        </button>
        <button
          role="radio"
          aria-checked={withContext}
          className={withContext ? "on" : ""}
          disabled={waiting}
          onClick={() => void setContext(true)}
          title="With the work, the page and the PDF's text around it — what the passage means here"
        >
          Context
        </button>
      </div>
      <div className="explain-scroll chat-scroll" ref={scrollRef}>
        {chat.messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.display ?? m.content} source={chat.source} />
        ))}
        {waiting && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-msg-body chat-thinking">
              <Spinner size={13} /> {preparing ? "reading the PDF…" : "thinking…"}
            </div>
          </div>
        )}
        {error && (
          <div className="error-msg">
            {error}{" "}
            {!waiting && !chat.messages.some((m) => m.role === "assistant") && (
              <button className="link-btn" onClick={askFirst}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
      <div className="explain-meter">
        {withContext && `${Math.round(chat.contextTokens / 1000)}K tokens of context · `}
        {formatUsd(chat.costUsd)} spent
      </div>
    </div>
  );
}
