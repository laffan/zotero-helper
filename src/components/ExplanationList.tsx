// The reader's explanations (lib/ai/explain.ts), shown as what they are:
// a question and its answer, not conversations to carry on. Each is a
// box — the passage asked about as its head, a link that unfolds the
// answer beneath it (folded to begin with, and set in as far as the
// passage) — with, at its right, the page the passage was read on, a
// link back to it (the PDF opened at the page, the passage found and
// marked, as an answer's citations are — even once its underline is
// removed from the pages), an info button that shows the rest (when,
// which model, what it cost, with or without its context) and a quieter
// trash can. They are listed in the entry's conversations tab
// (ItemChats.tsx) and, across every document, in the sidebar's
// Explanations, where each also names the work it was read in (a link
// back too), and a filter box narrows them by passage, answer or work.
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { removeChat } from "../lib/ai/chat";
import { formatTokens, formatUsd, modelLabel } from "../lib/ai/models";
import { pdfAttachmentOf } from "../lib/collections";
import { useStore } from "../lib/store";
import type { Chat } from "../lib/types";
import { ChevronDown, ChevronRight, InfoIcon, TrashIcon } from "./Icons";
import { openReaderAt } from "./ReaderPane";

/** An explainer, not a conversation of Questions. */
export const isExplanation = (c: Chat) => c.mode === "explain";

function when(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** The passage asked about, and the answer (the latest, if asked again). */
function exchange(chat: Chat): { question: string; answer: string | null } {
  const q = chat.messages.find((m) => m.role === "user");
  const a = [...chat.messages].reverse().find((m) => m.role === "assistant");
  return { question: q?.display ?? q?.content ?? chat.title, answer: a?.content ?? null };
}

/** The details the box leaves out, in a small popup under its info
 *  button; a press elsewhere or Escape closes it. */
function Details({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.(".explanation-info")) onClose();
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
  const rows: [string, string][] = [
    ["Asked", when(chat.createdMs)],
    ["Model", modelLabel(chat.model)],
    ["Cost", formatUsd(chat.costUsd)],
    ["Context", chat.context ? `the work and its PDF (${formatTokens(chat.contextTokens)})` : "none"],
    ["From", chat.source.label],
  ];
  return (
    <div className="explanation-details" ref={ref} role="dialog" aria-label="About this explanation">
      {rows.map(([k, v]) => (
        <div key={k} className="explanation-details-row">
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** The way back to an explanation's passage: the PDF opened (or moved)
 *  at its page, and the passage found and marked there, as an answer's
 *  citations are (lib/pdfQuote.ts, citeMark.ts) — whether or not it is
 *  still underlined in the pages: Remove Highlight lets go of that
 *  mark, not of this. Null without a PDF to go to. */
function useGoToPassage(chat: Chat): (() => void) | null {
  const items = useStore((s) => s.library.items);
  const itemKey = chat.source.itemKeys[0];
  const attKey = chat.passage?.attKey ?? pdfAttachmentOf(items, itemKey)?.key;
  if (!itemKey || !attKey) return null;
  const { question } = exchange(chat);
  return () => openReaderAt(itemKey, attKey, (chat.passage?.pageIndex ?? 0) + 1, { quote: question });
}

/** One explanation, its answer folded until its passage is pressed, the
 *  page it was read on at its right — the link back to the passage.
 *  `linked` adds the work it was read in, under it (the sidebar's list,
 *  across documents), a link back too. */
export function ExplanationCard({ chat, linked = false }: { chat: Chat; linked?: boolean }) {
  const [info, setInfo] = useState(false);
  const [open, setOpen] = useState(false);
  const { question, answer } = exchange(chat);
  const goTo = useGoToPassage(chat);
  const page = chat.passage ? `p. ${chat.passage.pageIndex + 1}` : "Find";
  const work = chat.source.itemTitles[0] || chat.source.label;
  return (
    <div className={open ? "explanation open" : "explanation"}>
      <div className="explanation-head">
        <button
          className="link-btn explanation-question"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={open ? "Fold the answer" : "Show the answer"}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span>{question}</span>
        </button>
        <div className="explanation-actions">
          {goTo && (
            <button className="link-btn explanation-page" onClick={goTo} title={`Show the passage in the PDF — ${page}`}>
              {page}
            </button>
          )}
          <button
            className={info ? "icon-btn explanation-info on" : "icon-btn explanation-info"}
            onClick={() => setInfo(!info)}
            aria-label="About this explanation"
            aria-expanded={info}
            title="When, which model, what it cost"
          >
            <InfoIcon size={13} />
          </button>
          <button
            className="icon-btn explanation-delete"
            onClick={() => void removeChat(chat.id)}
            aria-label="Delete this explanation"
            title="Delete this explanation"
          >
            <TrashIcon size={13} />
          </button>
        </div>
        {info && <Details chat={chat} onClose={() => setInfo(false)} />}
      </div>
      {open && (
        <div className="explanation-answer chat-md">
          {answer ? <Markdown remarkPlugins={[remarkGfm]}>{answer}</Markdown> : <em>No answer yet.</em>}
        </div>
      )}
      {linked &&
        (goTo ? (
          <button className="link-btn explanation-source" onClick={goTo} title={`Open the PDF at the passage — “${question}”`}>
            {work}
          </button>
        ) : (
          <div className="explanation-source">{work}</div>
        ))}
    </div>
  );
}

/** Does `chat` match the filter `q` (lower case) — in its passage,
 *  its answer or the work it was read in? */
function matches(chat: Chat, q: string): boolean {
  const { question, answer } = exchange(chat);
  return [question, answer ?? "", chat.source.label].some((t) => t.toLowerCase().includes(q));
}

/** The sidebar's Explanations: every explanation, newest first. */
export function ExplanationList() {
  const chats = useStore((s) => s.chats);
  const [query, setQuery] = useState("");
  const list = useMemo(
    () => chats.filter(isExplanation).sort((a, b) => b.createdMs - a.createdMs),
    [chats],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((c) => matches(c, q)) : list;
  }, [list, query]);
  return (
    <section className="item-list explanation-list">
      <div className="view-bar">
        <span className="chat-list-heading">Explanations</span>
        <input
          className="word-list-filter"
          type="search"
          placeholder="Filter explanations…"
          aria-label="Filter explanations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="list-body">
        {list.length === 0 ? (
          <div className="list-empty">
            No explanations yet — select a passage in a PDF and use the sparkles over it.
          </div>
        ) : shown.length === 0 ? (
          <div className="list-empty">No explanation matches “{query.trim()}”.</div>
        ) : (
          shown.map((c) => <ExplanationCard key={c.id} chat={c} linked />)
        )}
      </div>
      <footer className="list-footer">
        <span>
          {shown.length < list.length && `${shown.length} of `}
          {list.length} explanation{list.length === 1 ? "" : "s"}
          {shown.length > 0 && ` · ${formatUsd(shown.reduce((sum, c) => sum + c.costUsd, 0))} spent`}
        </span>
      </footer>
    </section>
  );
}
