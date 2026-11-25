// The explainer's window: a passage of the open PDF explained, floating
// over the pages at the bottom right (reading mode included) so the
// passage stays in sight. It opens from the selection bar's AI button,
// or a highlight's (lib/ai/explain.ts), with the passage quoted and
// nothing asked yet: a row says what goes with the question — No
// Context (the default: the question alone) or In Context, whose menu
// (ExplainContextMenu.tsx) picks the part of the PDF that goes with the
// work's title and authors: the full text, the passage's section or the
// pages in view — and Ask, at its right, asks. The full question names
// the work it was read in, but only the passage is shown. There are no
// follow-ups: a choice changed once there is an answer makes Ask ask
// again, the new answer in place of the old (and, should that fail, the
// old one back). ×, Escape or a press anywhere outside closes the
// window; the explanation is kept, under Explanations — unless nothing
// was asked, and then there is nothing to keep (explain.ts). Remove
// Underline, at its foot (a second press confirms), unmarks the passage
// in the PDF: the explanation stays under Explanations, its page still
// known (the In Context menu and the list's link back go by it), but
// the passage's rects are let go, so the dashed underline — and the tap
// that reopened it there — are gone. The list's link back still finds
// the passage by its words and marks it for the moment, as an answer's
// citation does.
//
// A passage of the answer can be selected and asked about all the same
// (ThreadStrip.tsx): its clarification opens in a column to the right,
// the window widening for it, and can be asked about in turn — but not
// carried on, as the explanation itself isn't. Asking again lets go of
// them with the answer they were asked of.
import { useEffect, useRef, useState } from "react";
import { persistChats, sendChatMessage } from "../lib/ai/chat";
import { partKey } from "../lib/ai/contextCache";
import { explainContext, headExplanation, partSent } from "../lib/ai/explain";
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

/** The explainer open, if any: a window of its own for each
 *  explanation, so nothing of one carries over to the next — the
 *  question last asked again (which a new explanation, having no
 *  messages yet, would otherwise have asked in place of its own
 *  passage), an error, the menu, the columns open. */
export function ExplainChat() {
  const id = useStore((s) => s.explain?.chatId);
  return id ? <ExplainWindow key={id} /> : null;
}

function ExplainWindow() {
  const explain = useStore((s) => s.explain);
  const chat = useStore((s) => s.chats.find((c) => c.id === s.explain?.chatId));
  const busyId = useStore((s) => s.chatBusy);
  const busy = Boolean(chat) && busyId === chat?.id;
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // What goes with the question: null for nothing, a part of the PDF —
  // or, until the reader picks, what the answer there was asked with.
  const [choice, setChoice] = useState<ContextPart | null | undefined>(undefined);

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
  const asked = chat.messages.length > 0;
  const answered = chat.messages.some((m) => m.role === "assistant");
  const { question, display } = questionOf(chat, explain);

  /** Is `part` what the question there was asked with? */
  const sameAsAsked = (part: ContextPart | null) =>
    part ? Boolean(chat.contextPart) && partKey(chat.contextPart!) === partKey(part) : !withContext;
  const chosenOn = choice === undefined ? withContext : choice !== null;
  const waiting = busy || preparing;
  const canAsk = !waiting && Boolean(question) && (!asked || (choice !== undefined && !sameAsAsked(choice)));

  /** Ask, with the part of the work chosen as context or none: once
   *  there is an answer, the new one takes its place — or, should the
   *  asking fail, the old one is put back. */
  const ask = async () => {
    if (!canAsk || !question) return;
    const part = choice === undefined ? (withContext ? (chat.contextPart ?? null) : null) : choice;
    setMenu(false);
    setError(null);
    let context = "";
    let sent: string | undefined;
    if (part) {
      setPreparing(true);
      try {
        ({ context, sent } = await explainContext(chat, part));
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
    const before = {
      context: cur.context,
      contextPart: cur.contextPart,
      contextTokens: cur.contextTokens,
      messages: cur.messages,
      threads: cur.threads,
    };
    // A four-characters-a-token estimate; the reply books the real cost.
    // The clarifications go with the answer they were asked of.
    s.upsertChat({
      ...cur,
      context,
      // What of the part went, when the caps cut it ("only pp. 1–37 of 212").
      contextPart: part ? { ...part, sent } : undefined,
      contextTokens: Math.ceil(context.length / 4),
      messages: [],
      threads: [],
    });
    void persistChats();
    setChoice(undefined);
    try {
      await sendChatMessage(chat.id, question, display);
      // A long passage is named, for the lists to head it by.
      headExplanation(chat.id);
    } catch (e) {
      setError(String(e));
      const now = useStore.getState().chats.find((c) => c.id === chat.id);
      if (now && !now.messages.length && before.messages.length) {
        useStore.getState().upsertChat({ ...now, ...before });
        void persistChats();
      }
    }
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
        <button className="icon-btn" onClick={close} aria-label="Close" title="Close (Esc)">
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="explain-controls">
        <div className="explain-context" role="radiogroup" aria-label="What goes with the question">
          <button
            role="radio"
            aria-checked={!chosenOn}
            className={chosenOn ? "" : "on"}
            disabled={waiting}
            onClick={() => {
              setMenu(false);
              setChoice(null);
            }}
            title="The question alone — the concept explained on its own terms"
          >
            No Context
          </button>
          <button
            ref={inContext}
            role="radio"
            aria-checked={chosenOn}
            aria-haspopup="menu"
            aria-expanded={menu}
            className={chosenOn ? "on" : ""}
            disabled={waiting}
            onClick={() => setMenu(!menu)}
            title="With the work and a part of its PDF — the full text, this section or the pages in view: what the passage means here"
          >
            In Context <ChevronDown size={9} />
          </button>
        </div>
        <button
          className="tool-btn accent explain-ask"
          disabled={!canAsk}
          onClick={() => void ask()}
          title={
            canAsk
              ? answered
                ? "Ask again with this choice — the new answer takes the old one's place"
                : "Ask the AI to explain the passage"
              : answered
                ? "Answered — choose another context to ask again"
                : "Asking…"
          }
        >
          {waiting ? <Spinner size={12} /> : null} {answered ? "Ask again" : "Ask"}
        </button>
      </div>
      {menu && inContext.current && (
        <ExplainContextMenu
          chat={chat}
          chosen={choice === undefined ? (withContext ? (chat.contextPart ?? null) : null) : choice}
          anchor={inContext.current}
          onPick={(part) => {
            setChoice(part);
            setMenu(false);
          }}
          onClose={() => setMenu(false)}
        />
      )}
      <ThreadStrip
        chat={chat}
        continuable={false}
        hideQuestion
        className="explain-scroll"
        scrollRef={scrollRef}
        onColumns={setColumns}
        rootBefore={display ? <blockquote className="explain-passage">“{display}”</blockquote> : null}
        rootAfter={
          <>
            {waiting && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-body chat-thinking">
                  <Spinner size={13} /> {preparing ? "reading the PDF…" : "thinking…"}
                </div>
              </div>
            )}
            {error && <div className="error-msg">{error}</div>}
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
            `${chat.contextPart ? `${partSent(chat.contextPart)} · ` : ""}${Math.round(chat.contextTokens / 1000)}K tokens · `}
          {formatUsd(chat.costUsd)} spent
        </span>
      </div>
    </div>
  );
}
