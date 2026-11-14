// The explainer's window: a passage of the open PDF explained, floating
// over the pages at the bottom right (reading mode included) so the
// passage stays in sight. It opens from the selection bar's AI button
// (lib/ai/explain.ts) and asks its question by itself — the full
// question names the work it was read in, but only the passage is
// shown. There are no follow-ups: a toggle in its head says what goes
// with the question instead — No Context (the default: the question
// alone) or In Context, whose menu (ExplainContextMenu.tsx) picks the
// part of the PDF that goes with the work's title and authors: the
// full text, the passage's section or the pages in view — and
// switching asks again, the new answer in place of the old. ×,
// Escape or a press anywhere outside closes the window; the explanation
// is kept, under Explanations. Remove Underline, at its foot (a second
// press confirms), unmarks the passage in the PDF: the explanation stays
// under Explanations, its page still known (the In Context menu and the
// list's link back go by it), but the passage's rects are let go, so the
// dashed underline — and the tap that reopened it there — are gone. The
// list's link back still finds the passage by its words and marks it
// for the moment, as an answer's citation does.
//
// A passage of the answer can be selected and asked about all the same
// (ThreadStrip.tsx): its clarification opens in a column to the right,
// the window widening for it, and can be asked about in turn — but not
// carried on, as the explanation itself isn't. Asking again with the
// other context lets go of them with the answer they were asked of.
import { useEffect, useRef, useState } from "react";
import { persistChats, sendChatMessage } from "../lib/ai/chat";
import { partKey } from "../lib/ai/contextCache";
import { explainContext, headExplanation } from "../lib/ai/explain";
import { formatUsd } from "../lib/ai/models";
import { useStore } from "../lib/store";
import type { Chat, ContextPart } from "../lib/types";
import { ExplainContextMenu } from "./ExplainContextMenu";
import { ChevronDown, CloseIcon, QuestionIcon, Spinner } from "./Icons";
import { followRoot, ThreadStrip } from "./ThreadStrip";

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
  // How many columns the strip has open: the window widens for two.
  const [columns, setColumns] = useState(1);
  // The In Context menu: which part of the PDF goes with the question.
  const [menu, setMenu] = useState(false);
  const inContext = useRef<HTMLButtonElement>(null);
  const [confirmUnmark, setConfirmUnmark] = useState(false);
  useEffect(() => {
    if (!confirmUnmark) return;
    const t = window.setTimeout(() => setConfirmUnmark(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmUnmark]);

  const send = async (text: string, display?: string) => {
    if (!chat || !text.trim()) return;
    setError(null);
    try {
      await sendChatMessage(chat.id, text, display);
      // A long passage is named, for the lists to head it by.
      headExplanation(chat.id);
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
    if (el) followRoot(el);
  }, [chat?.messages.length, busy]);

  // Escape closes the window before it reaches reading mode's exit.
  useEffect(() => {
    if (!explain) return;
    const onKey = (e: KeyboardEvent) => {
      // The Clarify bar or the In Context menu, when up, closes first
      // (by itself).
      if (e.key !== "Escape" || boxRef.current?.querySelector(".clarify-pop, .context-menu")) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [explain]);

  if (!explain || !chat) return null;
  const withContext = chat.context !== "";

  const sameAs = (part: ContextPart | null) =>
    part ? Boolean(chat.contextPart) && partKey(chat.contextPart!) === partKey(part) : !withContext;

  /** Ask again, with a part of the work as context or without: the new
   *  answer takes the old one's place. */
  const setContext = async (part: ContextPart | null) => {
    setMenu(false);
    if (busy || preparing || sameAs(part)) return;
    const { question, display } = questionOf(chat, explain);
    if (!question) return;
    again.current = { question, display };
    setError(null);
    let context = "";
    if (part) {
      setPreparing(true);
      try {
        context = await explainContext(chat, part);
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
    // The clarifications go with the answer they were asked of.
    s.upsertChat({
      ...cur,
      context,
      contextPart: part ?? undefined,
      contextTokens: Math.ceil(context.length / 4),
      messages: [],
      threads: [],
    });
    void persistChats();
    await send(question, display);
  };

  /** Unmark the passage (the explanation stays). */
  const unmark = () => {
    if (!confirmUnmark) return setConfirmUnmark(true);
    const s = useStore.getState();
    const cur = s.chats.find((c) => c.id === chat.id);
    if (cur?.passage) s.upsertChat({ ...cur, passage: { ...cur.passage, rects: [] } });
    void persistChats();
    close();
  };
  const marked = Boolean(chat.passage?.rects.length);

  const waiting = busy || preparing;
  return (
    <div
      className={columns > 1 ? "explain-chat threaded" : "explain-chat"}
      role="dialog"
      aria-label="Explain the passage"
      ref={boxRef}
    >
      <div className="explain-head">
        <QuestionIcon size={13} />
        <span className="explain-title" title={chat.heading ?? chat.title}>
          {chat.heading ?? chat.title}
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
          onClick={() => void setContext(null)}
          title="The question alone — the concept explained on its own terms"
        >
          No Context
        </button>
        <button
          ref={inContext}
          role="radio"
          aria-checked={withContext}
          aria-haspopup="menu"
          aria-expanded={menu}
          className={withContext ? "on" : ""}
          disabled={waiting}
          onClick={() => setMenu(!menu)}
          title="With the work and a part of its PDF — the full text, this section or the pages in view: what the passage means here"
        >
          In Context <ChevronDown size={9} />
        </button>
      </div>
      {menu && inContext.current && (
        <ExplainContextMenu
          chat={chat}
          anchor={inContext.current}
          onPick={(part) => void setContext(part)}
          onClose={() => setMenu(false)}
        />
      )}
      <ThreadStrip
        chat={chat}
        continuable={false}
        className="explain-scroll"
        scrollRef={scrollRef}
        onColumns={setColumns}
        rootAfter={
          <>
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
          </>
        }
      />
      <div className="explain-meter">
        {marked && (
          <button
            className={`link-btn explain-unmark ${confirmUnmark ? "confirm" : ""}`}
            onClick={unmark}
            title="Take the dashed outline off this passage in the PDF — the explanation is kept"
          >
            {confirmUnmark ? "Press again to remove" : "Remove Underline"}
          </button>
        )}
        <span>
          {withContext &&
            `${chat.contextPart ? `${chat.contextPart.label} · ` : ""}${Math.round(chat.contextTokens / 1000)}K tokens · `}
          {formatUsd(chat.costUsd)} spent
        </span>
      </div>
    </div>
  );
}
